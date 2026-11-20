"""Fetch pinned dependencies and build TTS Test on Windows."""

import argparse
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.request import urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
MAIN = APP / "src" / "main"
DESKTOP = ROOT / "desktop"
SHERPA_RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
LLAMA_REPO = "https://github.com/ggml-org/llama.cpp"
LLAMA_TAG = "b12532"
LLAMA_COMMIT = "08c252e221759e0f69e80f0450b295c92d2344e1"
NDK = "27.1.12297006"
CMAKE = "3.30.5"
MODELS = {
    "sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2": "82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427",
    "vits-mimic3-ko_KO-kss_low.tar.bz2": "f015d1d15a52ed00d6fe22757c5ef4a74283c53daf829c838fa5c22616ed789c",
    "kokoro-int8-multi-lang-v1_0.tar.bz2": "72c347230107ef8a31098ec4d468a605244beef5f1ed00db97efa13518800653",
}


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def fetch(url, path, sha256):
    if path.is_file() and digest(path) == sha256:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {path.name}", flush=True)
    with TemporaryDirectory(dir=path.parent) as temporary:
        candidate = Path(temporary) / path.name
        with urlopen(url, timeout=60) as response, candidate.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
        if digest(candidate) != sha256:
            raise ValueError(f"SHA-256 mismatch for {path.name}")
        candidate.replace(path)
    return path


def fetch_models():
    assets = MAIN / "assets" / "tts"
    for name, sha256 in MODELS.items():
        fetch(f"{SHERPA_RELEASE}/tts-models/{name}", assets / name, sha256)
    fetch(
        "https://huggingface.co/gnyong/melotts-kr-onnx/resolve/a956c7a26329701b6fd7dedce697c981d309dc44/melotts_kr_int8.onnx",
        assets / "melotts_kr_int8.onnx",
        "421b94ce7e803fdd0126c7d39d90192b64878794619668cf3ec12611fc860f88",
    )


def run(*args, env=None):
    subprocess.run(args, cwd=ROOT, env=env, check=True)


def build_windows(cache):
    runtime = fetch(
        "https://www.python.org/ftp/python/3.13.17/python-3.13.17-embed-amd64.zip",
        cache / "python-3.13.17-embed-amd64.zip",
        "9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38",
    )
    llama = fetch(
        f"{LLAMA_REPO}/releases/download/{LLAMA_TAG}/llama-{LLAMA_TAG}-bin-win-cpu-x64.zip",
        cache / "llama-win.zip",
        "beb8c051a782fb0970d4ae20fa276a6dfd3e7245685b185244a22570e9e473fa",
    )
    output = ROOT / "dist" / "TTS-Test-Windows.zip"
    output.parent.mkdir(exist_ok=True)
    with TemporaryDirectory(dir=cache) as staging, TemporaryDirectory(dir=output.parent) as packaged:
        staging = Path(staging)
        vendor = staging / "vendor"
        llama_dir = staging / "llama"
        with ZipFile(llama) as archive:
            archive.extractall(llama_dir)
        run(sys.executable, "-m", "pip", "install", "--only-binary=:all:", "--no-deps",
            "--target", vendor, "-r", DESKTOP / "requirements.txt")
        pending = Path(packaged) / output.name
        run(sys.executable, DESKTOP / "package.py", runtime, pending,
            "--llama-dir", llama_dir, "--vendor-dir", vendor)
        pending.replace(output)
    print(output)


def build_native(sdk, cache, jobs):
    cmake_dir = sdk / "cmake" / CMAKE / "bin"
    cmake = cmake_dir / "cmake.exe"
    ninja = cmake_dir / "ninja.exe"
    ndk = sdk / "ndk" / NDK
    toolchain = ndk / "build" / "cmake" / "android.toolchain.cmake"
    for path in (cmake, ninja, toolchain):
        if not path.is_file():
            raise FileNotFoundError(f"Install Android NDK {NDK} and CMake {CMAKE}. Missing: {path}")
    llama = cache / "llama.cpp"
    if not llama.exists():
        run("git", "clone", "--depth", "1", "--branch", LLAMA_TAG, LLAMA_REPO + ".git", llama)
    commit = subprocess.check_output(["git", "-C", llama, "rev-parse", "HEAD"], text=True).strip()
    if commit != LLAMA_COMMIT:
        raise ValueError(f"Expected llama.cpp {LLAMA_COMMIT} at {llama}")

    native = MAIN / "jniLibs" / "arm64-v8a"
    native.mkdir(parents=True, exist_ok=True)
    ort_headers = ROOT / "third_party" / "onnxruntime" / "include"
    builds = (
        ("avatar_local_chat", MAIN / "cpp", "android-26", f"-DLLAMA_CPP_SOURCE={llama}"),
        ("avatar_melo_tts", MAIN / "cpp" / "melo-tts", "android-23", f"-DONNXRUNTIME_INCLUDE={ort_headers}"),
    )
    for target, sources, api_level, dependency in builds:
        build = cache / target
        run(cmake, "-S", sources, "-B", build, "-G", "Ninja", f"-DCMAKE_MAKE_PROGRAM={ninja}",
            f"-DCMAKE_TOOLCHAIN_FILE={toolchain}", "-DCMAKE_BUILD_TYPE=Release",
            "-DANDROID_ABI=arm64-v8a", f"-DANDROID_PLATFORM={api_level}", "-DANDROID_STL=c++_static", dependency)
        run(cmake, "--build", build, "--parallel", str(jobs), "--target", target)
        library = f"lib{target}.so"
        shutil.copy2(build / library, native / library)


def build_android(sdk, cache, jobs):
    fetch(
        f"{SHERPA_RELEASE}/v1.13.8/sherpa-onnx-1.13.8.aar",
        APP / "libs" / "sherpa-onnx-1.13.8.aar",
        "633c24321e06b1fe79feafa03ea16cbc0f8a286641e2da3559bac91bdb13bd96",
    )
    fetch(
        "https://repo.maven.apache.org/maven2/org/apache/commons/commons-compress/1.21/commons-compress-1.21.jar",
        APP / "libs" / "commons-compress-1.21.jar",
        "6aecfd5459728a595601cfa07258d131972ffc39b492eb48bdd596577a2f244a",
    )
    build_native(sdk, cache, jobs)
    env = {**os.environ, "ANDROID_HOME": str(sdk), "ANDROID_SDK_ROOT": str(sdk)}
    run("cmd.exe", "/d", "/c", "gradlew.bat", ":app:assembleShare", env=env)
    print(APP / "build" / "outputs" / "apk" / "share" / "app-share.apk")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", choices=("windows", "android"))
    parser.add_argument("--sdk", type=Path, help="Android SDK path")
    parser.add_argument("--jobs", type=int, default=4, help="Parallel Android C++ compilation jobs")
    args = parser.parse_args()
    if sys.platform != "win32" or platform.machine().lower() not in ("amd64", "x86_64") or sys.version_info[:2] != (3, 13):
        parser.error("Use Windows x64 and Python 3.13 x64.")
    if args.jobs < 1:
        parser.error("--jobs must be at least 1.")
    sdk_env = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    sdk = (args.sdk or (Path(sdk_env) if sdk_env else Path(os.environ["LOCALAPPDATA"]) / "Android" / "Sdk")).resolve()
    if args.target == "android" and not (sdk / "platforms" / "android-36").is_dir():
        parser.error(f"Install Android SDK Platform 36 or specify --sdk. Checked: {sdk}")
    cache = ROOT / ".deps"
    cache.mkdir(exist_ok=True)
    fetch_models()
    if args.target == "windows":
        build_windows(cache)
    else:
        build_android(sdk, cache, args.jobs)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
