"""Run the same four packaged speech models used by the Android app."""

import base64
from io import BytesIO
import os
from pathlib import Path
from threading import Lock
import tarfile
from tempfile import TemporaryDirectory
import wave

from local_chat import DATA, ROOT

ARCHIVES = {
    "supertonicPhone": "sherpa-onnx-supertonic-3-tts-int8-2026-05-11",
    "mimicPhone": "vits-mimic3-ko_KO-kss_low",
    "kokoroPhone": "kokoro-int8-multi-lang-v1_0",
}
ASSETS = ROOT / "tts"
CACHE = DATA / "tts-models"
SUPER_FILES = (
    "duration_predictor.int8.onnx", "text_encoder.int8.onnx", "vector_estimator.int8.onnx",
    "vocoder.int8.onnx", "tts.json", "unicode_indexer.bin", "voice.bin",
)


def prepare(name):
    destination = CACHE / name
    if destination.is_dir():
        return destination
    CACHE.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=CACHE) as scratch:
        with tarfile.open(ASSETS / (name + ".tar.bz2"), "r:bz2") as archive:
            archive.extractall(scratch, filter="data")
        source = Path(scratch) / name
        source.rename(destination)
    return destination


def config(engine, mode, path):
    if mode == "supertonicPhone":
        model = engine.OfflineTtsSupertonicModelConfig()
        for attribute, file in zip(
            ("duration_predictor", "text_encoder", "vector_estimator", "vocoder", "tts_json", "unicode_indexer", "voice_style"),
            SUPER_FILES,
        ):
            setattr(model, attribute, str(path / file))
        return engine.OfflineTtsModelConfig(supertonic=model, num_threads=3)
    if mode == "mimicPhone":
        model = engine.OfflineTtsVitsModelConfig(model=str(path / "ko_KO-kss_low.onnx"),
                                              tokens=str(path / "tokens.txt"), data_dir=str(path / "espeak-ng-data"))
        return engine.OfflineTtsModelConfig(vits=model, num_threads=3)
    weights = path / "model.int8.onnx"
    if not weights.is_file():
        weights = path / "model.onnx"
    model = engine.OfflineTtsKokoroModelConfig(model=str(weights), tokens=str(path / "tokens.txt"),
                                             voices=str(path / "voices.bin"), data_dir=str(path / "espeak-ng-data"),
                                             lexicon=f"{path / 'lexicon-us-en.txt'},{path / 'lexicon-zh.txt'}")
    return engine.OfflineTtsModelConfig(kokoro=model, num_threads=3)


class OfflineSpeech:
    def __init__(self):
        self.lock = Lock()
        self.melo_lock = Lock()
        self.melo = None
        self.mode = None
        self.engine = None

    def prepare_melo(self):
        with self.melo_lock:
            if self.melo is None:
                import onnxruntime as ort
                options = ort.SessionOptions()
                options.intra_op_num_threads = min(12, max(1, (os.process_cpu_count() or 4) // 2))
                options.add_session_config_entry("session.intra_op.allow_spinning", "0")
                self.melo = ort.InferenceSession(str(ASSETS / "melotts_kr_int8.onnx"), sess_options=options,
                                                 providers=["CPUExecutionProvider"])
            return self.melo

    def load(self, mode):
        self.engine = self.mode = None
        if mode == "meloPhone":
            self.engine = self.prepare_melo()
        else:
            import sherpa_onnx as sherpa
            model_config = config(sherpa, mode, prepare(ARCHIVES[mode]))
            self.engine = sherpa.OfflineTts(sherpa.OfflineTtsConfig(model=model_config))
        self.mode = mode

    def generate(self, mode, text, tone, speed):
        if mode not in ARCHIVES and mode != "meloPhone":
            raise ValueError("지원하는 음성 모델을 골라 주세요.")
        if not isinstance(text, str) or not 0 < len(text.strip()) <= 320:
            raise ValueError("320자 이내의 문장을 사용하세요.")
        if mode == "kokoroPhone" and not text.isascii():
            raise ValueError("이 Kokoro 음성은 영어 문장만 읽을 수 있습니다.")
        speed = max(.7, min(1.4, float(speed)))
        with self.lock:
            if self.mode != mode:
                self.load(mode)
            if mode == "meloPhone":
                from melo_korean import synthesize
                samples, rate = synthesize(self.engine, text, speed)
            else:
                import sherpa_onnx as sherpa
                options = sherpa.GenerationConfig()
                options.speed = speed
                if mode == "supertonicPhone":
                    options.extra = {"lang": "ko"}
                    options.num_steps = 8
                    options.sid = {"low": 0, "bright": 5}.get(tone, 6)
                elif mode == "kokoroPhone":
                    options.sid = 16 if tone == "low" else 3
                audio = self.engine.generate(text, options)
                samples, rate = audio.samples, audio.sample_rate
        import numpy as np
        samples = np.asarray(samples).reshape(-1)
        if not 0 < len(samples) <= rate * 60 or not np.isfinite(samples).all() or not np.any(samples):
            raise ValueError("생성된 음성을 읽을 수 없습니다.")
        output = BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
            pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
            wav.writeframes(pcm.tobytes())
        return {"audio": base64.b64encode(output.getvalue()).decode("ascii")}
