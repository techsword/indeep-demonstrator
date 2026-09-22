"""A module for playing Demonstrator audio on a client/app."""

import os
import subprocess
import sys
from pathlib import Path

from playsound import playsound

class PlaybackModule:
    """A module for playing back Demonstrator audio.

    Attributes:
        path_to_resources: Path to the `resources` folder, which contains the temporarily stored audio files of the user and TTS utterances.
        path_to_temp_tts: Path to the temporarily stored TTS utterance.
    """

    def __init__(self):
        self.path_to_resources = Path(Path(__file__).parents[0], "resources")
        self.path_to_temp_tts = Path(self.path_to_resources, "audio", "temp_tts.mp3")
    
    def playback(self, audio_length: float) -> None:
        """Plays back the temporarily stored TTS utterance file.

        Args:
            audio_length (float): The length of the temporarily stored TTS utterance in seconds.
        """

        if sys.platform.startswith("linux"):
            # playsound's Linux backend (GStreamer/PyGObject) is not available in the
            # venv and does not support block=False. ffplay blocks until playback ends.
            subprocess.run(
                ["ffplay", "-nodisp", "-autoexit", "-loglevel", "error",
                 str(self.path_to_temp_tts)]
            )
        else:
            playsound(str(self.path_to_temp_tts), block=True)
        os.remove(self.path_to_temp_tts)
