"""Fixed speech-provider routes for the Windows app."""

import base64
import json
import re
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

ELEVEN = "https://api.elevenlabs.io"
TYPECAST = "https://api.typecast.ai"
CARTESIA = "https://api.cartesia.ai"
GEMINI = "https://generativelanguage.googleapis.com/v1beta/"
TYPECAST_MODELS = {"ssfm-v31", "ssfm-v30", "ssfm-v21"}
ELEVEN_MODELS = {"eleven_v4", "eleven_v3", "eleven_multilingual_v2", "eleven_flash_v2_5"}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, headers, body=None):
    data = None
    if body is not None:
        headers = {**headers, "Content-Type": "application/json"}
        data = json.dumps(body).encode("utf-8")
    try:
        with build_opener(NoRedirect()).open(Request(url, data=data, headers=headers), timeout=60) as response:
            content = response.read(12_000_001)
    except HTTPError as error:
        raise ValueError(f"음성 서비스 HTTP {error.code}. API 키와 서비스 설정을 확인하세요.") from error
    if not content or len(content) > 12_000_000:
        raise ValueError("음성 서비스 응답 크기가 올바르지 않습니다.")
    return content


def wav(audio):
    if len(audio) < 44 or audio[:4] != b"RIFF":
        raise ValueError("올바른 WAV 응답을 받지 못했습니다.")
    return {"audio": base64.b64encode(audio).decode("ascii")}


def eleven(action, key, data):
    headers = {"xi-api-key": key}
    if action == "eleven/voices":
        result = json.loads(request(ELEVEN + "/v2/voices?voice_type=default&page_size=100", headers))
        return {"voices": result.get("voices", [])}
    subscription = json.loads(request(ELEVEN + "/v1/user/subscription", headers))
    if action == "eleven/credits":
        return {"used": subscription["character_count"], "limit": subscription["character_limit"]}
    extension = subscription.get("max_credit_limit_extension")
    if str(subscription.get("tier", "")).lower() != "free" or type(extension) not in (int, float) or extension != 0:
        raise ValueError("ElevenLabs 무료 플랜과 추가 과금 차단 상태를 확인해 주세요.")
    voice = data.get("voice", "")
    source = data["body"]
    model = source.get("model_id")
    if model not in ELEVEN_MODELS or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", voice):
        raise ValueError("ElevenLabs 음성 모델을 확인해 주세요.")
    text = source["text"]
    if not isinstance(text, str) or not 0 < len(text) <= 2400:
        raise ValueError("음성으로 읽을 문장을 줄여 주세요.")
    if model == "eleven_v4":
        url = ELEVEN + "/v1/text-to-dialogue"
        body = {"model_id": model, "language_code": "ko", "inputs": [{"voice_id": voice, "text": text}]}
    else:
        url = ELEVEN + "/v1/text-to-speech/" + voice
        body = {"model_id": model, "text": text}
        if model != "eleven_multilingual_v2":
            body["language_code"] = "ko"
    audio = request(url, headers, body)
    return {"audio": base64.b64encode(audio).decode("ascii")}


def typecast_credits(headers):
    data = json.loads(request(TYPECAST + "/v1/users/me/subscription", headers))
    credits = data["credits"]
    limit = credits["plan_credits"]
    return {"free": data.get("plan") == "free", "limit": limit,
            "remaining": max(0, limit - credits["used_credits"])}


def typecast(key, mode, text, tone, speed):
    headers = {"X-API-KEY": key}
    quota = typecast_credits(headers)
    if not quota["free"] or quota["remaining"] < len(text):
        raise ValueError("타입캐스트 무료 플랜과 남은 크레딧을 확인해 주세요.")
    gender = "male" if tone == "low" else "female"
    voices = json.loads(request(TYPECAST + f"/v3/voices?voice_type=original&model={mode}&gender={gender}", headers))
    voice = next((v for v in voices if str(v.get("voice_id", "")).startswith("tc_")
                  and (v.get("voice_name") or {}).get("kor")), None)
    if voice is None:
        raise ValueError("타입캐스트의 한국어 기본 음성을 찾을 수 없습니다.")
    body = {"voice_id": voice["voice_id"], "text": text, "model": mode, "language": "kor",
            "output": {"audio_format": "wav", "audio_tempo": speed}}
    emotion = {"bright": "happy", "low": "angry"}.get(tone, "normal")
    if any(m.get("version") == mode and emotion in (m.get("emotions") or []) for m in voice.get("models", [])):
        body["prompt"] = {"emotion_preset": emotion}
        if mode != "ssfm-v21":
            body["prompt"]["emotion_type"] = "preset"
    return wav(request(TYPECAST + "/v1/text-to-speech", headers, body))


def cartesia(key, text, tone, speed, confirmed):
    if confirmed is not True:
        raise ValueError("Cartesia 무료 플랜 여부를 확인해 주세요.")
    headers = {"Authorization": "Bearer " + key, "Cartesia-Version": "2026-08-14"}
    gender = "masculine" if tone == "low" else "feminine"
    result = json.loads(request(CARTESIA + f"/voices?language=ko&limit=30&gender={gender}", headers))
    voice = next((v for v in result["data"] if v.get("access") == "public" and v.get("status") == "active"), None)
    if voice is None:
        raise ValueError("Cartesia의 한국어 공개 음성을 찾을 수 없습니다.")
    body = {"model_id": "sonic-3.6", "transcript": text, "language": "ko",
            "voice": {"id": voice["id"]}, "generation_config": {"speed": speed},
            "output_format": {"container": "wav", "encoding": "pcm_s16le", "sample_rate": 24000}}
    return wav(request(CARTESIA + "/tts/bytes", headers, body))


def handle(action, data):
    key = data.get("key")
    if not isinstance(key, str) or not key or len(key) > 512 or not key.isascii() or any(c in key for c in "\r\n"):
        raise ValueError("선택한 음성 서비스의 API 키를 입력해 주세요.")
    if action.startswith("eleven/"):
        return eleven(action, key, data)
    if action.startswith("gemini/"):
        endpoint = "interactions" if action == "gemini/interactions" else "models/gemini-3.1-flash-tts-preview:generateContent"
        return json.loads(request(GEMINI + endpoint, {"x-goog-api-key": key}, data["body"]))
    if action == "typecast/credits":
        return typecast_credits({"X-API-KEY": key})
    mode, text, tone = data["mode"], data["text"], data.get("tone")
    if not isinstance(text, str) or not 0 < len(text) <= 2000:
        raise ValueError("음성은 한 번에 2,000자까지 읽을 수 있습니다.")
    speed = max(.75, min(1.25, float(data.get("speed", 1))))
    if mode in TYPECAST_MODELS:
        return typecast(key, mode, text, tone, speed)
    if mode == "cartesia":
        return cartesia(key, text, tone, speed, data.get("confirmed"))
    raise ValueError("지원하는 음성 모델을 선택해 주세요.")
