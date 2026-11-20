"""The Windows CPU runner for the two GGUFs used by the Android model downloader."""

import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
from threading import Lock, Thread
import time
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener, urlopen

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "AvatarChat"
MODELS = {
    "local-gemma": (
        "gemma-4-e2b.gguf", 2841481184,
        "8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52",
        "ggml-org/gemma-4-E2B-it-GGUF/resolve/2a8538c2e2d4687953a86c422c7c623cfd022880/gemma-4-E2B-it-Q4_0.gguf",
    ),
    "local-qwen": (
        "qwen3.5-2b.gguf", 1280835840,
        "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223",
        "unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf",
    ),
}


class LocalChat:
    def __init__(self):
        self.directory = DATA / "local-llm"
        self.download_lock = Lock()
        self.download_provider = None
        self.progress = 0
        self.errors = {}
        self.chat_lock = Lock()
        self.process = None
        self.provider = None
        self.address = None
        self.token = None
        self.opener = build_opener(ProxyHandler({}))

    def model_file(self, provider):
        if provider not in MODELS:
            raise ValueError("로컬 대화 모델을 선택해 주세요.")
        return self.directory / MODELS[provider][0]

    def ready(self, provider):
        file = self.model_file(provider)
        try:
            if file.stat().st_size != MODELS[provider][1]:
                return False
            with file.open("rb") as model:
                return model.read(4) == b"GGUF"
        except OSError:
            return False

    def status(self, provider):
        ready = self.ready(provider)
        _, size, _, _ = MODELS[provider]
        with self.download_lock:
            active = self.download_provider
            message = self.errors.get(provider)
            if active == provider:
                message = f"모델 다운로드 중 · {self.progress}%"
            elif active:
                message = "다른 모델을 다운로드 중입니다."
            return {
                "ready": ready, "available": True, "active": bool(active),
                "size": f"{size / 1_000_000_000:.2f}GB",
                "message": message or "모델 파일을 한 번 다운로드하면 인터넷과 API 키 없이 대화할 수 있습니다.",
            }

    def start_download(self, provider):
        if self.ready(provider):
            return self.status(provider)
        with self.download_lock:
            if not self.download_provider:
                self.download_provider = provider
                self.progress = 0
                self.errors.pop(provider, None)
                Thread(target=self.download, args=(provider,), daemon=True).start()
        return self.status(provider)

    def download(self, provider):
        file = self.model_file(provider)
        _, size, expected, source = MODELS[provider]
        partial = file.with_suffix(".part")
        error = None
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            received = partial.stat().st_size if partial.is_file() else 0
            if received > size:
                partial.unlink()
                received = 0
            if shutil.disk_usage(self.directory).free < size - received + 100_000_000:
                raise ValueError("모델을 다운로드할 저장 공간이 부족합니다.")
            if received < size:
                headers = {"Accept-Encoding": "identity"}
                if received:
                    headers["Range"] = f"bytes={received}-"
                request = Request(f"https://huggingface.co/{source}?download=true", headers=headers)
                with urlopen(request, timeout=45) as response:
                    if response.status == 200:
                        received = 0
                    elif not response.headers.get("Content-Range", "").startswith(f"bytes {received}-"):
                        raise ValueError("모델 다운로드 범위가 올바르지 않습니다.")
                    with partial.open("ab" if received else "wb") as output:
                        while chunk := response.read(1024 * 1024):
                            received += len(chunk)
                            if received > size:
                                raise ValueError("모델 파일 크기가 올바르지 않습니다.")
                            output.write(chunk)
                            self.progress = min(99, received * 100 // size)
            if received != size:
                raise ValueError("다운로드가 중단되었습니다. 다시 시도하면 이어서 받습니다.")
            with partial.open("rb") as model:
                actual = hashlib.file_digest(model, "sha256").hexdigest()
            if actual != expected:
                partial.unlink()
                raise ValueError("모델 파일을 검증하지 못했습니다. 다시 다운로드해 주세요.")
            partial.replace(file)
        except ValueError as failure:
            error = str(failure)
        except OSError:
            error = "모델 다운로드 연결과 저장 공간을 확인하고 다시 시도하세요."
        finally:
            with self.download_lock:
                self.errors[provider] = error
                self.download_provider = None

    def close(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(4)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        self.process = self.provider = None

    def start_engine(self, provider):
        if self.provider == provider and self.process and self.process.poll() is None:
            return
        self.close()
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        self.address = f"http://127.0.0.1:{port}"
        self.token = secrets.token_hex(24)
        self.process = subprocess.Popen([
            str(ROOT / "llama" / "llama-server.exe"), "--model", str(self.model_file(provider)),
            "--host", "127.0.0.1", "--port", str(port), "--api-key", self.token,
            "--ctx-size", "2048", "--threads", "4", "--n-gpu-layers", "0", "--parallel", "1",
            "--no-webui", "--reasoning", "off",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 100
        while self.process.poll() is None and time.monotonic() < deadline:
            try:
                request = Request(self.address + "/health", headers={"Authorization": "Bearer " + self.token})
                with self.opener.open(request, timeout=2) as response:
                    if json.load(response).get("status") == "ok":
                        self.provider = provider
                        return
            except OSError:
                pass
            time.sleep(.3)
        self.close()
        raise ValueError("로컬 모델을 실행하지 못했습니다. 노트북의 메모리와 모델 파일을 확인해 주세요.")

    def reply(self, provider, data):
        if not self.ready(provider):
            raise ValueError("AI API 설정에서 모델 다운로드를 눌러 주세요.")
        messages = data.get("messages")
        if not isinstance(messages, list) or not 2 <= len(messages) <= 22:
            raise ValueError("대화 형식을 확인해 주세요.")
        body = {
            "messages": messages, "stream": False,
            "max_tokens": max(1, min(256, int(data.get("max_tokens", 160)))),
            "temperature": max(0, min(2, float(data.get("temperature", 1.8)))),
            "top_p": max(0, min(1, float(data.get("top_p", .9)))),
            "chat_template_kwargs": {"enable_thinking": False},
        }
        with self.chat_lock:
            self.start_engine(provider)
            request = Request(self.address + "/v1/chat/completions", data=json.dumps(body).encode(),
                              headers={"Content-Type": "application/json", "Authorization": "Bearer " + self.token})
            try:
                with self.opener.open(request, timeout=180) as response:
                    result = json.load(response)
            except HTTPError as error:
                raise ValueError(f"로컬 모델 응답 오류 (HTTP {error.code}). 질문을 짧게 입력해 주세요.") from error
            text = result["choices"][0]["message"].get("content")
            if not text or not text.strip():
                raise ValueError("로컬 모델에서 답변을 받지 못했습니다.")
            return {"text": text.strip()}
