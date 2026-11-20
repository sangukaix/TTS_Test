"""Run Avatar Chat on a loopback address and relay its supported API calls."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener
import webbrowser
from cloud_speech import NoRedirect, handle as cloud_speech
from local_chat import LocalChat
from offline_speech import OfflineSpeech

HOST = "127.0.0.1"
PORT = 18765
ORIGIN = f"http://{HOST}:{PORT}"
WEB = Path(__file__).resolve().parent / "www"
FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
}
UPSTREAM = {
    "/api/openai/chat": ("https://api.openai.com/v1/chat/completions", "Authorization"),
    "/api/openai/images": ("https://api.openai.com/v1/images/generations", "Authorization"),
    "/api/gemini/chat": (
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "Authorization"
    ),
    "/api/gemini/images": (
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-image:generateContent",
        "x-goog-api-key",
    ),
    "/api/exaone/chat": ("https://api.exaone.ai/v1/chat/completions", "Authorization"),
}
MAX_REQUEST_BYTES = 128 * 1024
MAX_RESPONSE_BYTES = 24 * 1024 * 1024
CHAT = LocalChat()
VOICE = OfflineSpeech()
SPEECH_ROUTES = {
    "eleven/generate", "eleven/voices", "eleven/credits", "typecast/credits",
    "cloud/generate", "gemini/interactions", "gemini/preview",
}
LOCAL_ROUTES = {"/local/model/status", "/local/model/download", "/local/chat", "/local/tts", "/local/tts/prepare"}


def local_action(path, data):
    if path == "/local/model/status":
        return CHAT.status(data.get("provider"))
    if path == "/local/model/download":
        return CHAT.start_download(data.get("provider"))
    if path == "/local/chat":
        return CHAT.reply(data.get("provider"), data["request"])
    if path == "/local/tts/prepare":
        VOICE.prepare_melo()
        return {"ready": True}
    return VOICE.generate(data.get("mode"), data.get("text"), data.get("tone"), data.get("speed", 1))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def reply(self, status, data, content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; img-src 'self' data:; media-src 'self' data:; frame-ancestors 'none'")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def error(self, status, message):
        self.reply(status, json.dumps({"error": {"message": message}}).encode("utf-8"))

    def do_GET(self):
        if self.headers.get("Host") != f"{HOST}:{PORT}":
            self.error(403, "로컬 앱 주소에서 다시 실행해 주세요.")
            return
        file = FILES.get(urlsplit(self.path).path)
        if file is None:
            self.error(404, "요청한 파일이 없습니다.")
            return
        name, mime = file
        self.reply(200, (WEB / name).read_bytes(), mime)

    def do_POST(self):
        if self.headers.get("Host") != f"{HOST}:{PORT}" or self.headers.get("Origin") != ORIGIN:
            self.error(403, "로컬 앱 화면에서 다시 실행해 주세요.")
            return
        endpoint = UPSTREAM.get(self.path)
        local = self.path in LOCAL_ROUTES
        speech = self.path.removeprefix("/speech/") if self.path.startswith("/speech/") else ""
        if endpoint is None and not local and speech not in SPEECH_ROUTES:
            self.error(404, "지원하는 API 경로가 아닙니다.")
            return
        size = self.headers.get("Content-Length", "")
        if self.headers.get_content_type() != "application/json" or not size.isascii() or not size.isdigit():
            self.error(400, "올바른 JSON 요청이 필요합니다.")
            return
        if len(size) > 8 or not 0 < int(size) <= MAX_REQUEST_BYTES:
            self.error(413, "요청 크기가 너무 큽니다.")
            return
        try:
            body = self.rfile.read(int(size))
            data = json.loads(body)
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object")
        except (ValueError, TimeoutError, ConnectionResetError):
            self.error(400, "요청 내용을 읽을 수 없습니다.")
            return
        if endpoint is None:
            try:
                result = local_action(self.path, data) if local else cloud_speech(speech, data)
                self.reply(200, json.dumps(result, ensure_ascii=False).encode("utf-8"))
            except ValueError as error:
                self.error(400, str(error))
            except (KeyError, TypeError):
                self.error(400, "모델에 보낼 요청 내용을 확인해 주세요.")
            except (OSError, RuntimeError, ImportError):
                self.error(502, "모델 또는 음성 서비스를 실행할 수 없습니다.")
            return
        url, auth_header = endpoint
        credential = self.headers.get(auth_header)
        if not credential:
            self.error(400, "선택한 서비스의 API 키를 입력해 주세요.")
            return
        request = Request(url, data=body, headers={"Content-Type": "application/json", auth_header: credential})
        try:
            try:
                upstream = build_opener(NoRedirect()).open(request, timeout=75)
            except HTTPError as error:
                upstream = error
            with upstream:
                data = upstream.read(MAX_RESPONSE_BYTES + 1)
                if len(data) > MAX_RESPONSE_BYTES:
                    self.error(502, "AI 서비스의 응답 크기가 너무 큽니다.")
                    return
                if upstream.headers.get_content_type() != "application/json":
                    self.error(502, f"AI 서비스에서 JSON 응답을 받지 못했습니다 (HTTP {upstream.code}).")
                    return
                self.reply(upstream.code, data)
        except (URLError, OSError):
            self.error(502, "AI 서비스 연결을 확인해 주세요.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print(f"Could not start Avatar Chat. Close any app using port {PORT} and try again.")
        return 1
    with server:
        print(f"Avatar Chat is ready at {ORIGIN}/", flush=True)
        print("Keep this window open while using the app. Press Ctrl+C to close.", flush=True)
        if not args.no_browser:
            webbrowser.open(ORIGIN + "/")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            CHAT.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
