#include <dlfcn.h>
#include <jni.h>
#include <array>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#include "onnxruntime_c_api.h"

namespace {
const OrtApi &ort() {
    static const OrtApi *api = [] {
        // Match the bundled Sherpa runtime and use the stable ONNX Runtime C API.
        void *library = dlopen("libonnxruntime.so", RTLD_NOW | RTLD_LOCAL);
        if (!library) throw std::runtime_error("Cannot load ONNX Runtime");
        auto base = reinterpret_cast<decltype(&OrtGetApiBase)>(dlsym(library, "OrtGetApiBase"));
        const OrtApi *result = base ? base()->GetApi(ORT_API_VERSION) : nullptr;
        if (!result) throw std::runtime_error("ONNX Runtime API is missing");
        return result;
    }();
    return *api;
}

void check(OrtStatus *status) {
    if (!status) return;
    std::string message(ort().GetErrorMessage(status));
    ort().ReleaseStatus(status);
    throw std::runtime_error(message);
}

struct Engine {
    OrtEnv *env = nullptr;
    OrtSession *session = nullptr;
    OrtSessionOptions *options = nullptr;
    OrtMemoryInfo *memory = nullptr;

    ~Engine() {
        const auto &api = ort();
        if (session) api.ReleaseSession(session);
        if (options) api.ReleaseSessionOptions(options);
        if (memory) api.ReleaseMemoryInfo(memory);
        if (env) api.ReleaseEnv(env);
    }
};

template <typename T>
void tensor(const Engine &engine, OrtValue **out, T *data, size_t count,
            const int64_t *shape, size_t rank, ONNXTensorElementDataType type) {
    check(ort().CreateTensorWithDataAsOrtValue(engine.memory, data, count * sizeof(T),
            shape, rank, type, out));
}

void fail(JNIEnv *env, const std::exception &e) {
    env->ThrowNew(env->FindClass("java/io/IOException"), e.what());
}
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_mbc_avatarchat_MeloSpeech_load(JNIEnv *jni, jclass, jstring path) {
    try {
        const auto &api = ort();
        auto engine = std::make_unique<Engine>();
        check(api.CreateEnv(ORT_LOGGING_LEVEL_WARNING, "avatar-melo", &engine->env));
        check(api.CreateSessionOptions(&engine->options));
        check(api.SetIntraOpNumThreads(engine->options, 3));
        check(api.CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &engine->memory));
        const char *filename = jni->GetStringUTFChars(path, nullptr);
        if (!filename) return 0;
        auto status = api.CreateSession(engine->env, filename, engine->options, &engine->session);
        jni->ReleaseStringUTFChars(path, filename);
        check(status);
        return reinterpret_cast<jlong>(engine.release());
    } catch (const std::exception &e) {
        fail(jni, e);
        return 0;
    }
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_mbc_avatarchat_MeloSpeech_generate(JNIEnv *jni, jclass, jlong handle,
                                          jlongArray tokens, jfloat speed) {
    try {
        const auto &engine = *reinterpret_cast<Engine *>(handle);
        const auto &api = ort();
        const jsize count = jni->GetArrayLength(tokens);
        std::vector<jlong> ids(count);
        jni->GetLongArrayRegion(tokens, 0, count, ids.data());
        if (jni->ExceptionCheck()) return nullptr;
        int64_t length = count, speaker = 0;
        const int64_t one[] = {1}, sequence[] = {1, count};
        const int64_t bert_shape[] = {1, 1024, count}, ja_shape[] = {1, 768, count};
        std::vector<int64_t> tones(count, 0), languages(count, 0);
        for (int i = 1; i < count; i += 2) {
            tones[i] = 11;
            languages[i] = 4;
        }
        std::vector<float> bert(1024 * count), ja_bert(768 * count);
        float scales[] = {.6f, 1.f / speed, .8f, .2f};
        struct Values {
            std::array<OrtValue *, 11> inputs{};
            OrtValue *output = nullptr;
            OrtTensorTypeAndShapeInfo *shape = nullptr;
            ~Values() {
                const auto &api = ort();
                for (auto *value : inputs) if (value) api.ReleaseValue(value);
                if (output) api.ReleaseValue(output);
                if (shape) api.ReleaseTensorTypeAndShapeInfo(shape);
            }
        } values;
        auto &in = values.inputs;
        constexpr auto integers = ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64;
        constexpr auto floats = ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT;
        tensor(engine, &in[0], ids.data(), count, sequence, 2, integers);
        tensor(engine, &in[1], &length, 1, one, 1, integers);
        tensor(engine, &in[2], &speaker, 1, one, 1, integers);
        tensor(engine, &in[3], tones.data(), count, sequence, 2, integers);
        tensor(engine, &in[4], languages.data(), count, sequence, 2, integers);
        tensor(engine, &in[5], bert.data(), bert.size(), bert_shape, 3, floats);
        tensor(engine, &in[6], ja_bert.data(), ja_bert.size(), ja_shape, 3, floats);
        for (int i = 0; i < 4; ++i) tensor(engine, &in[i + 7], &scales[i], 1, nullptr, 0, floats);
        const char *names[] = {"x", "x_lengths", "sid", "tone", "language", "bert", "ja_bert",
                               "noise_scale", "length_scale", "noise_scale_w", "sdp_ratio"};
        const char *output_names[] = {"audio"};
        check(api.Run(engine.session, nullptr, names, in.data(), in.size(), output_names, 1, &values.output));
        check(api.GetTensorTypeAndShape(values.output, &values.shape));
        size_t samples = 0;
        check(api.GetTensorShapeElementCount(values.shape, &samples));
        if (samples == 0 || samples > 44100 * 60) throw std::runtime_error("Invalid MeloTTS audio length");
        void *data = nullptr;
        check(api.GetTensorMutableData(values.output, &data));
        jfloatArray audio = jni->NewFloatArray(static_cast<jsize>(samples));
        if (audio) jni->SetFloatArrayRegion(audio, 0, static_cast<jsize>(samples), static_cast<float *>(data));
        return audio;
    } catch (const std::exception &e) {
        fail(jni, e);
        return nullptr;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_mbc_avatarchat_MeloSpeech_release(JNIEnv *, jclass, jlong handle) {
    delete reinterpret_cast<Engine *>(handle);
}
