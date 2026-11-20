# 나와 대화하는 아바타

한국어 음성으로 대화하고 여러 TTS 엔진을 비교하는 Windows·Android 앱입니다. 두 버전이 같은 HTML·CSS·JavaScript 화면을 사용합니다.

- [설치·실행·빌드·Codex 안내](REQUIREMENTS.md)
- [Windows 실행판과 Android APK](https://github.com/sangukaix/TTS_Test/releases)

버튼을 누른 채 말하면 음성 인식(STT)이 시작됩니다. 손을 떼면 인식한 문장을 대화 모델(LLM)에 보내고, 답변은 선택한 음성 엔진(TTS)으로 재생합니다. 텍스트 입력으로도 대화할 수 있습니다.

| 기능 | 구현 |
| --- | --- |
| Windows | Python 로컬 HTTP 서버와 기본 브라우저. Windows 음성 인식은 Web Speech API 사용 |
| Android | Java·WebView·JavaScript Bridge. Android `SpeechRecognizer`와 `TextToSpeech` 사용 |
| 로컬 대화 | C++·JNI 또는 Windows CPU용 llama.cpp에서 Gemma 4 E2B와 Qwen3.5 2B의 GGUF 실행 |
| 음성 합성 | 기기 음성, Sherpa-ONNX·ONNX Runtime을 이용한 로컬 음성, 외부 TTS API |
| 아바타 | Canvas 아바타, OpenAI 또는 Gemini 이미지 API |

이 저장소에는 화면, Windows 서버, Android Java·C++ 코드와 빌드 설정이 들어 있습니다. 모델, 외부 실행 환경, 생성된 APK와 ZIP의 준비 방법은 설치 안내에 있습니다.
