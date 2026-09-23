"""Defines the RESTful API used by the Demonstrator to communicate between client and server."""

from __future__ import annotations

import os
import shutil
import threading
import uuid
from pathlib import Path
from urllib.parse import quote, unquote

import requests
from fastapi import FastAPI, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

import demonstrator

# Maximum time an HTTP API request waits for the state-machine thread. If this
# expires, the request is still processed and cleaned up by the server, but the
# client gets a 504 instead of hanging forever.
API_REQUEST_TIMEOUT_SECONDS = float(os.getenv("DEMONSTRATOR_API_TIMEOUT", "300"))


def _encode_header_value(value: object) -> str:
    """Return an ASCII-safe HTTP header value.

    Starlette encodes header values as latin-1, so a Whisper transcription
    containing a character outside latin-1 would otherwise cause a 500. We
    percent-encode everything and let the client decode it again.
    """

    return quote(str(value if value is not None else ""), safe="")


def _decode_header_value(value: str | None) -> str:
    """Decode a header value produced by :func:`_encode_header_value`."""

    if not value:
        return ""
    return unquote(value)


def send_user_speech_request(client: demonstrator.DemonstratorClient) -> tuple[float, str]:
    """Send a user utterance to the server and store the returned TTS audio.

    Args:
        client: The client whose temporary utterance should be sent.

    Returns:
        tuple[float, str]: The length in seconds and transcription of the
        synthesized audio returned by the server.
    """

    with open(client.vad_model.path_to_temp_user_utterance, "rb") as user_utterance_stream:
        response = requests.post(
            url=f"{client.api_url}/user-speech",
            files={"user_utterance": ("temp_user_utterance.mp3", user_utterance_stream, "audio/mpeg")},
            data={"read_intro": client.read_intro, "TTS_language": client.TTS_language},
            timeout=API_REQUEST_TIMEOUT_SECONDS + 30,
        )

    response.raise_for_status()

    with open(client.playback_module.path_to_temp_tts, "wb+") as temp_tts_stream:
        temp_tts_stream.write(response.content)

    return (
        float(response.headers["audio_length"]),
        _decode_header_value(response.headers.get("transcription")),
    )


fast_api = FastAPI()
fast_api.demonstrator = None

WEB_UI_DIR = Path(__file__).parent / "web"

# Serves the web interface.
fast_api.mount("/ui", StaticFiles(directory=WEB_UI_DIR, html=True), name="ui")


@fast_api.get("/")
def _API_root() -> dict:
    """Home endpoint of the API."""

    return {"message": "Successfully connected to the server. Hello World!"}


@fast_api.get("/health")
def _API_health() -> dict:
    """Lightweight health endpoint used by the web client."""

    return {
        "status": "ok",
        "server_ready": fast_api.demonstrator is not None,
    }


@fast_api.post("/user-speech")
def _API_user_speech(
    user_utterance: UploadFile,
    read_intro: bool = Form(...),
    TTS_language: str = Form(...),
) -> Response:
    """Receive a user utterance, synthesize a response, and return the audio.

    Each request gets its own input file, queue entry, event, and response
    object. The server state machine handles requests one at a time, so
    concurrent browser tabs or CLI clients can never overwrite one another's
    audio or steal each other's response.
    """

    server = fast_api.demonstrator
    if server is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The Demonstrator server is not ready yet.",
        )

    request_id = uuid.uuid4().hex
    requests_dir = Path(server.asr_model.path_to_resources) / "audio" / "requests"
    requests_dir.mkdir(parents=True, exist_ok=True)

    # Preserve the upload's extension so faster-whisper receives a file whose
    # container matches its name (the CLI sends MP3, the browser sends WAV).
    original_suffix = Path(user_utterance.filename or "").suffix.lower()
    allowed_suffixes = {".wav", ".mp3", ".m4a", ".mp4", ".webm", ".ogg", ".flac"}
    suffix = original_suffix if original_suffix in allowed_suffixes else ".audio"
    input_path = requests_dir / f"{request_id}{suffix}"

    try:
        with open(input_path, "wb") as user_utterance_stream:
            shutil.copyfileobj(user_utterance.file, user_utterance_stream)
    finally:
        user_utterance.file.close()

    request = {
        "id": request_id,
        "input_path": str(input_path),
        "read_intro": read_intro,
        "tts_language": TTS_language,
        "event": threading.Event(),
    }

    server.request_queue.put(request)

    if not request["event"].wait(API_REQUEST_TIMEOUT_SECONDS):
        # The request stays in the queue. The state machine will process it
        # later and remove its input file, so no shared state is corrupted.
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="The Demonstrator server did not respond in time. It may still be busy.",
        )

    if request.get("error"):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not create a response: {request['error']}",
        )

    audio_bytes = request.get("audio_bytes")
    if not audio_bytes:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="The Demonstrator server returned an empty response.",
        )

    return Response(
        content=audio_bytes,
        status_code=status.HTTP_201_CREATED,
        media_type="audio/mpeg",
        headers={
            "audio_length": _encode_header_value(request.get("audio_length", "")),
            "transcription": _encode_header_value(request.get("transcription", "")),
            "emotion": _encode_header_value(request.get("emotion", "")),
            "emotion_score": _encode_header_value(request.get("emotion_score", "")),
        },
    )
