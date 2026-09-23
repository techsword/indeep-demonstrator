#!/usr/bin/env python3
"""Serve the web UI and reverse-proxy API calls to the demo server.

WHY THIS EXISTS
---------------
The upstream demo server serves no static files and has no CORS middleware.
A browser page therefore cannot call it directly across origins (the page would
be blocked by the browser's same-origin policy, and the server would not even
send the ``Access-Control-Allow-Origin`` header). This small helper puts the
static UI and the API on ONE origin by serving the UI locally and forwarding
API requests to the backend. The backend may be a local cuda-workstation server
or a remote server reached through an SSH tunnel; either way the browser only
ever talks to this proxy.

It uses only the Python standard library (Python 3.10+), so it runs with a plain
system ``python3`` on a demo laptop -- no pip installs required.

USAGE
-----
    python3 tools/serve_web_ui.py --backend http://127.0.0.1:8031 --port 8041

Then open:

    http://127.0.0.1:8041/

Options:
    --backend   Base URL of the demo server (default http://127.0.0.1:8031)
    --port      Port to listen on (default 8041)
    --bind      Interface to bind (default 127.0.0.1)
    --root      Static directory to serve (default <repo>/src/web)
"""

from __future__ import annotations

import argparse
import http.client
import json
import mimetypes
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

# Resolve the repo root from this script's location: <repo>/tools/serve_web_ui.py
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
DEFAULT_ROOT = os.path.join(REPO_ROOT, "src", "web")

HEALTH_TIMEOUT = 5.0
POST_TIMEOUT = 300.0
CHUNK_SIZE = 64 * 1024

# Hop-by-hop headers must not be forwarded by a proxy: we frame the response
# ourselves, so forwarding these would corrupt the stream.
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}

CONFIG = {
    "backend": "http://127.0.0.1:8031",
    "root": DEFAULT_ROOT,
}


def log(msg: str) -> None:
    """Concise stdout logging with flushing, so demo output is live."""
    print(msg, flush=True)


def log_request_line(method: str, path: str, status: int, elapsed_ms: float) -> None:
    log(f"[serve_web_ui] {method} {path} -> {status} ({elapsed_ms:.1f} ms)")


def log_backend_error(detail: str) -> None:
    log(f"[serve_web_ui] backend error for {CONFIG['backend']}: {detail}")


def backend_connection(timeout: float = POST_TIMEOUT) -> http.client.HTTPConnection:
    """Open a fresh connection to the configured backend."""
    parts = urlsplit(CONFIG["backend"])
    host = parts.hostname
    if host is None:
        raise ValueError(f"invalid backend URL: {CONFIG['backend']!r}")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if parts.scheme == "https":
        return http.client.HTTPSConnection(host, port, timeout=timeout)
    return http.client.HTTPConnection(host, port, timeout=timeout)


def backend_base_path() -> str:
    """Path prefix of the backend URL (usually empty)."""
    path = urlsplit(CONFIG["backend"]).path or ""
    return path.rstrip("/")


class Handler(BaseHTTPRequestHandler):
    server_version = "ServeWebUI/1.0"

    # ------------------------------------------------------------------ utils
    def _safe_local_path(self, url_path: str) -> str | None:
        """Map a URL path to a file under --root, rejecting traversal."""
        rel = unquote(url_path).lstrip("/")
        if rel == "":
            rel = "index.html"
        root = os.path.realpath(CONFIG["root"])
        candidate = os.path.realpath(os.path.join(root, rel))
        if candidate != root and not candidate.startswith(root + os.sep):
            return None
        return candidate

    def _send_bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self._send_bytes(status, body, "application/json")

    # ------------------------------------------------------------------- GET
    def do_GET(self) -> None:  # noqa: N802 (stdlib naming)
        start = time.monotonic()
        url_path = urlsplit(self.path).path
        try:
            if url_path == "/health":
                self._handle_health()
            elif url_path == "/":
                self._handle_static("/index.html")
            else:
                self._handle_static(url_path)
        finally:
            log_request_line("GET", self.path, getattr(self, "_status", 0),
                             (time.monotonic() - start) * 1000.0)

    def _handle_health(self) -> None:
        detail = None
        try:
            conn = backend_connection(HEALTH_TIMEOUT)
            try:
                conn.request("GET", backend_base_path() + "/", headers={"Accept": "*/*"})
                resp = conn.getresponse()
                resp.read()
                if 200 <= resp.status < 300:
                    self._status = 200
                    self._send_json(200, {
                        "status": "ok",
                        "server_ready": True,
                        "backend": CONFIG["backend"],
                    })
                    return
                detail = f"backend returned HTTP {resp.status}"
            finally:
                conn.close()
        except (OSError, http.client.HTTPException, ValueError) as exc:
            detail = f"{type(exc).__name__}: {exc}"
            log_backend_error(detail)
        self._status = 503
        self._send_json(503, {
            "status": "error",
            "server_ready": False,
            "backend": CONFIG["backend"],
            "detail": detail or "backend not ready",
        })

    def _handle_static(self, url_path: str) -> None:
        local = self._safe_local_path(url_path)
        if local is None or not os.path.isfile(local):
            self._status = 404
            self._send_bytes(404, b"404 Not Found\n", "text/plain; charset=utf-8")
            return
        try:
            with open(local, "rb") as fh:
                body = fh.read()
        except OSError as exc:
            self._status = 500
            self._send_bytes(500, f"500 {exc}\n".encode(), "text/plain; charset=utf-8")
            return
        ctype, _ = mimetypes.guess_type(local)
        if ctype is None:
            ctype = "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "text/javascript"):
            ctype += "; charset=utf-8"
        self._status = 200
        self._send_bytes(200, body, ctype)

    # ------------------------------------------------------------------ POST
    def do_POST(self) -> None:  # noqa: N802 (stdlib naming)
        start = time.monotonic()
        url_path = urlsplit(self.path).path
        try:
            if url_path == "/user-speech":
                self._handle_user_speech()
            else:
                self._status = 404
                self._send_bytes(404, b"404 Not Found\n", "text/plain; charset=utf-8")
        finally:
            log_request_line("POST", self.path, getattr(self, "_status", 0),
                             (time.monotonic() - start) * 1000.0)

    def _body_chunks(self, length: int):
        """Yield the request body in chunks, reading exactly `length` bytes."""
        remaining = length
        while remaining > 0:
            chunk = self.rfile.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk

    def _handle_user_speech(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            length = 0

        fwd_headers = {"Content-Length": str(length)}
        if self.headers.get("Content-Type"):
            fwd_headers["Content-Type"] = self.headers["Content-Type"]
        if self.headers.get("Accept"):
            fwd_headers["Accept"] = self.headers["Accept"]

        target = backend_base_path() + "/user-speech"
        try:
            conn = backend_connection()
            try:
                conn.request("POST", target, body=self._body_chunks(length),
                             headers=fwd_headers)
                resp = conn.getresponse()
                self._status = resp.status
                # send_response_only avoids adding our own Server/Date so the
                # backend's headers are forwarded faithfully (no duplicates).
                self.send_response_only(resp.status)
                for name, value in resp.getheaders():
                    if name.lower() in HOP_BY_HOP:
                        continue
                    self.send_header(name, value)
                self.end_headers()
                # Stream the backend body straight through to the client.
                while True:
                    chunk = resp.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            finally:
                conn.close()
        except (OSError, http.client.HTTPException, ValueError) as exc:
            detail = f"{type(exc).__name__}: {exc}"
            log_backend_error(detail)
            self._status = 502
            body = json.dumps({
                "status": "error",
                "detail": f"backend unreachable: {detail}",
                "backend": CONFIG["backend"],
            }).encode("utf-8")
            try:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except OSError:
                pass

    # ------------------------------------------------- other/unknown methods
    def _handle_unsupported(self) -> None:
        start = time.monotonic()
        self._status = 404
        self._send_bytes(404, b"404 Not Found\n", "text/plain; charset=utf-8")
        log_request_line(self.command, self.path, 404,
                         (time.monotonic() - start) * 1000.0)

    def __getattr__(self, name: str):
        # BaseHTTPRequestHandler looks up ``do_<METHOD>``; return our 404 handler
        # for any method we do not implement explicitly (instead of the stdlib's
        # default 501), satisfying the "any other method -> 404" contract.
        if name.startswith("do_"):
            return self._handle_unsupported
        raise AttributeError(name)

    # --------------------------------------------------------------- logging
    def log_message(self, fmt, *args):  # noqa: A003 (stdlib naming)
        # Suppress the noisy default per-request stderr line; we log ourselves.
        return

    def log_error(self, fmt, *args):
        return


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Serve the web UI and proxy API calls to the demo server "
                    "(single origin, stdlib only).",
    )
    parser.add_argument("--backend", default="http://127.0.0.1:8031",
                        help="Base URL of the demo server (default: %(default)s)")
    parser.add_argument("--port", type=int, default=8041,
                        help="Port to listen on (default: %(default)s)")
    parser.add_argument("--bind", default="127.0.0.1",
                        help="Interface to bind (default: %(default)s)")
    parser.add_argument("--root", default=DEFAULT_ROOT,
                        help="Static directory to serve (default: %(default)s)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        print(f"error: --root directory does not exist: {root}", file=sys.stderr)
        return 2
    if not os.path.isfile(os.path.join(root, "index.html")):
        print(f"warning: {root}/index.html not found; GET / will return 404",
              file=sys.stderr)

    CONFIG["backend"] = args.backend.rstrip("/")
    CONFIG["root"] = root

    try:
        server = ThreadingHTTPServer((args.bind, args.port), Handler)
    except OSError as exc:
        print(f"error: cannot bind {args.bind}:{args.port}: {exc}", file=sys.stderr)
        return 2

    log(f"[serve_web_ui] serving {root}")
    log(f"[serve_web_ui] proxying /user-speech and /health -> {CONFIG['backend']}")
    log(f"[serve_web_ui] open http://{args.bind}:{args.port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("\n[serve_web_ui] shutting down")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
