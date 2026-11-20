# 설치 및 실행 안내

릴리스 `v1.13` 기준입니다. 앱을 바로 써보려면 **1번**, 코드를 수정하거나 같은 기능의 실행판을 빌드하려면 **3번**, Codex에 설치를 맡기려면 **4번**을 보면 됩니다.

## 1. 배포 파일로 바로 실행

[GitHub Releases의 v1.13](https://github.com/sangukaix/TTS_Test/releases/tag/v1.13)에서 사용할 기기에 맞는 파일을 받습니다. 소스를 받으려면 이 문서의 3번에 있는 `git clone`을 사용합니다.

### Windows 64비트(Windows 10 또는 11 x64)

1. `TTS-Test-Windows.zip`을 PC에 복사하고 **모두 압축 풀기**를 선택합니다.
2. 압축을 푼 `Avatar Chat` 폴더에서 `Start.cmd`를 더블 클릭합니다. Python 실행 환경은 폴더에 포함되어 있습니다.
3. 기본 브라우저에 앱이 열립니다. 주소는 `http://127.0.0.1:18765/`입니다. 사용 중에는 `Start.cmd`가 연 창을 두고, 종료할 때는 창을 닫거나 `Ctrl+C`를 누릅니다.
4. 음성 입력을 시험하려면 Web Speech API를 지원하는 브라우저에서 앱을 열고 마이크를 허용합니다. 버튼을 누른 상태에서 말하고 손을 떼면 인식한 문장이 전송됩니다.

### Android(64비트 ARM 기기 권장)

1. `TTS-Test-Android.apk`를 휴대폰에 내려받거나 USB **파일 전송**으로 `Download` 폴더에 복사합니다.
2. 휴대폰의 **내 파일 → 다운로드**에서 APK를 누른 뒤 **설치** 또는 **업데이트**를 누릅니다. 설치 권한 안내가 뜨면 APK를 열고 있는 파일 앱에 설치 권한을 허용합니다.
3. **나와 대화하는 아바타**를 실행합니다. 음성 입력을 쓸 때 마이크 권한을 허용합니다.

Android 앱의 최소 버전은 Android 6입니다. 로컬 대화는 **Android 8 이상의 ARM64 기기**에서 지원합니다. 기존 앱과 서명 키가 다르면 Android가 업데이트를 거부합니다. 기존 앱을 삭제하면 그 앱에 저장한 키·설정·내려받은 모델이 지워집니다.

## 2. 처음 실행한 뒤 모델 선택

1. **AI API 설정**에서 기본값인 **(로컬) Google Gemma 4 E2B**를 선택하고 **모델 다운로드**를 한 번 누릅니다. **Alibaba Qwen3.5 2B**를 쓸 경우 그 모델을 선택해 따로 받습니다. 각각 약 2.84GB와 1.28GB이므로 해당 기기에 여유 저장공간을 준비합니다.
2. 다운로드가 끝나면 **안녕하세요**를 입력해 답변을 확인합니다. 로컬 대화는 모델 준비 후 인터넷과 API 키 없이 실행됩니다. 네트워크 연결이 필요한 음성 인식 서비스는 브라우저나 Android 설정에 따라 달라질 수 있습니다.
3. 음성은 기본으로 **기기 기본 음성**을 사용합니다. **Supertonic 3·Mimic 3·MeloTTS·Kokoro**는 배포 파일에 포함됩니다. TTS 엔진을 선택하고 **음성 비교 테스트**에서 들어볼 수 있습니다. 이 프로젝트에서 Kokoro는 영어 비교용입니다.
4. 외부 AI나 TTS를 쓰려면 서비스를 선택하고 본인의 키를 각각 입력합니다. 대화와 TTS 키는 따로 저장되며, 새 환경에서는 빈칸으로 시작합니다. Windows는 브라우저 `localStorage`, Android는 앱의 WebView 저장소를 사용합니다. **키 삭제**는 해당 키를 지우고, **설정·대화 초기화 (API 키 모두 삭제)**는 앱에 저장된 키와 설정·기록을 초기화합니다.
5. **아바타 생성**에서 이미지 API를 쓰려면 OpenAI 또는 Gemini와 사용 가능한 계정 키를 선택합니다. 지원 여부, 사용 한도와 요금은 각 서비스 계정을 확인합니다.

## 3. 소스에서 직접 빌드

### 공통 준비

Windows x64에서 [Git](https://git-scm.com/download/win)과 [Python 3.13 x64](https://www.python.org/downloads/windows/)를 준비합니다. Windows 패키지 빌드에는 `pip`가 필요합니다. 첫 빌드는 공식 배포처에서 모델과 의존 파일을 받아야 하므로 인터넷과 여유 저장공간이 필요합니다.

PowerShell에서 실행합니다.

```powershell
git clone https://github.com/sangukaix/TTS_Test.git
cd TTS_Test
git checkout v1.13
py -3.13 --version
```

`py` 런처가 없는 환경에서는 `python --version`이 3.13인지 확인한 후 아래 명령의 `py -3.13` 대신 `python`을 씁니다.

### Windows ZIP 빌드

```powershell
py -3.13 scripts/build.py windows
```

결과는 **`dist/TTS-Test-Windows.zip`**입니다. 이 ZIP을 풀어 1번의 Windows 실행 순서대로 확인합니다. 스크립트가 Python 내장 런타임, llama.cpp CPU 실행 파일, TTS 모델을 받고 `desktop/requirements.txt`의 고정 버전으로 Windows용 Python 모듈을 설치합니다.

### Android APK 빌드

1. **JDK 21**과 [Android Studio](https://developer.android.com/studio)를 준비합니다. `java -version`으로 버전을 확인합니다. 필요하면 PowerShell의 `JAVA_HOME`을 실제 설치된 JDK 21 경로로 지정합니다.
2. SDK Manager에서 **Android SDK Platform 36**, **Build-Tools 36.0.0**, **Platform-Tools**, **NDK (Side by side) 27.1.12297006**, **CMake 3.30.5**를 설치합니다. SDK 경로는 Android Studio의 SDK Manager에 표시됩니다.
3. PowerShell에서 아래 두 줄을 실행합니다. SDK를 다른 곳에 설치했다면 첫 줄을 실제 경로로 바꿉니다.

```powershell
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
py -3.13 scripts/build.py android --sdk $sdk
```

결과는 **`app/build/outputs/apk/share/app-share.apk`**입니다. 스크립트가 Android 라이브러리와 모델을 준비하고 CMake·NDK로 ARM64 네이티브 모듈을 빌드한 뒤 Gradle `assembleShare`를 실행합니다.

생성된 APK는 1번의 Android 순서대로 설치할 수 있습니다. USB 디버깅을 허용한 테스트 기기에 ADB로 설치하려면 다음 명령을 사용합니다.

```powershell
& (Join-Path $sdk 'platform-tools\adb.exe') devices
& (Join-Path $sdk 'platform-tools\adb.exe') install -r 'app\build\outputs\apk\share\app-share.apk'
```

이 빌드는 로컬 개발 환경의 디버그 키로 서명됩니다. 다른 PC에서 만든 APK와 서명이 다를 수 있습니다.

### 빌드에 쓰는 외부 파일

빌드 스크립트는 TTS 모델과 주요 바이너리 다운로드에 SHA-256 검사를 하고 llama.cpp 소스 커밋을 확인합니다. 다운로드한 외부 파일과 빌드 결과는 Git에서 제외됩니다. Android·Windows 공통 모델은 `app/src/main/assets/tts/`에 준비되며, 로컬 LLM 모델은 앱 안에서 필요할 때 받습니다.

- [llama.cpp b12532](https://github.com/ggml-org/llama.cpp/releases/tag/b12532)
- [Sherpa-ONNX v1.13.8](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.8) 및 [TTS 모델](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models)
- [Kokoro 모델](https://huggingface.co/hexgrad/Kokoro-82M), [Mimic 3 한국어 음성](https://github.com/MycroftAI/mimic3-voices/tree/master/voices/ko_KO/kss_low), [Supertonic](https://github.com/supertone-inc/supertonic), [MeloTTS Korean ONNX 변환본](https://huggingface.co/gnyong/melotts-kr-onnx/tree/a956c7a26329701b6fd7dedce697c981d309dc44)
- [ONNX Runtime](https://github.com/microsoft/onnxruntime) 헤더의 MIT 고지는 `third_party/onnxruntime/LICENSE`에 있습니다. 외부 런타임·모델에는 각 원본의 라이선스가 적용됩니다.

## 4. Codex로 설치하거나 빌드

Windows에서 3번의 `git clone`을 실행한 뒤, ChatGPT 데스크톱 앱의 Codex에서 내려받은 **`TTS_Test` 폴더**를 작업 폴더로 엽니다. 아래 요청을 붙여넣고 첫 줄에서 필요한 결과물 하나를 지정합니다. [Codex 데스크톱 안내](https://learn.chatgpt.com/docs/app)

```text
이 TTS_Test 프로젝트를 Windows 실행판 또는 Android APK로 준비해줘. 대상은 Windows 실행판이야.
먼저 REQUIREMENTS.md를 읽고, 실행만 필요하면 GitHub Releases의 v1.13 배포 파일을 사용해줘.
소스 빌드가 필요하면 Python과 Android SDK 등 필요한 도구가 있는지 확인하고,
문서의 scripts/build.py 명령을 실행해줘. 빠진 도구가 있으면 어떤 버전이 필요한지 알려줘.
Windows는 Start.cmd로 화면이 열리는지, Android는 APK가 만들어졌는지 확인해줘.
휴대폰에 설치할 경우 기존 앱 삭제가 필요하면 먼저 알려줘. 내 API 키는 요청하거나 출력하지 말아줘.
마지막에 실행 파일 경로와 실행 방법을 알려줘.
```

Windows나 USB 연결을 직접 다루는 작업에는 Windows PC에서 실행하는 Codex가 필요합니다. 휴대폰의 마이크 권한, USB 디버깅 승인, 클라우드 서비스 키 입력은 각 기기 소유자가 직접 선택합니다.
