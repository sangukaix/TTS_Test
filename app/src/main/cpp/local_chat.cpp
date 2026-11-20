#include <jni.h>
#include <algorithm>
#include <memory>
#include <string>
#include <stdexcept>
#include <vector>
#include <mutex>

#include "llama.h"
#include "common.h"
#include "chat.h"

namespace {
std::mutex engine_lock;
std::unique_ptr<llama_model, decltype(&llama_model_free)> model(nullptr, llama_model_free);
common_chat_templates_ptr templates;
std::string loaded_path;
constexpr int context_size = 2048;

std::string bytes(JNIEnv *env, jbyteArray value) {
    std::string result(env->GetArrayLength(value), '\0');
    if (!result.empty()) {
        env->GetByteArrayRegion(value, 0, static_cast<jsize>(result.size()), reinterpret_cast<jbyte *>(result.data()));
    }
    return result;
}

void unload() {
    templates.reset();
    model.reset();
    loaded_path.clear();
}

void load(const std::string &path) {
    if (model && path == loaded_path) return;
    unload();
    static const bool restored = [] {
        llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
        llama_backend_init();
        return true;
    }();
    (void) restored;
    auto params = llama_model_default_params();
    params.n_gpu_layers = 0;
    model.reset(llama_model_load_from_file(path.c_str(), params));
    if (!model) throw std::runtime_error("MODEL_LOAD_FAILED");
    templates = common_chat_templates_init(model.get(), "");
    loaded_path = path;
}

std::vector<llama_token> tokens_for(const common_chat_prompt &prompt, const llama_vocab *vocab) {
    std::vector<llama_token> tokens;
    for (const auto &part : prompt.parts) {
        auto more = common_tokenize(vocab, part.text, false, !part.is_input);
        tokens.insert(tokens.end(), more.begin(), more.end());
    }
    const auto bos = llama_vocab_bos(vocab);
    if (llama_vocab_get_add_bos(vocab) && (tokens.empty() || tokens.front() != bos)) {
        tokens.insert(tokens.begin(), bos);
    }
    return tokens;
}

std::string generate(const std::string &path, std::vector<common_chat_msg> messages, int limit, float temp, float top_p) {
    load(path);
    const llama_vocab *vocab = llama_model_get_vocab(model.get());
    common_chat_templates_inputs input;
    input.messages = std::move(messages);
    input.enable_thinking = false;
    auto formatted = common_chat_templates_apply(templates.get(), input);
    auto prompt = tokens_for(formatted.prompt, vocab);
    while (prompt.size() + limit > context_size && input.messages.size() >= 4) {
        input.messages.erase(input.messages.begin() + 1, input.messages.begin() + 3);
        formatted = common_chat_templates_apply(templates.get(), input);
        prompt = tokens_for(formatted.prompt, vocab);
    }
    if (prompt.empty() || prompt.size() + limit > context_size) throw std::runtime_error("CONTEXT_LIMIT");

    auto params = llama_context_default_params();
    params.n_ctx = context_size;
    params.n_batch = 256;
    params.n_ubatch = 128;
    params.n_threads = 4;
    params.n_threads_batch = 4;
    std::unique_ptr<llama_context, decltype(&llama_free)> context(llama_init_from_model(model.get(), params), llama_free);
    if (!context) throw std::runtime_error("CONTEXT_CREATE_FAILED");
    for (size_t i = 0; i < prompt.size(); i += params.n_batch) {
        int count = static_cast<int>(std::min<size_t>(params.n_batch, prompt.size() - i));
        if (llama_decode(context.get(), llama_batch_get_one(prompt.data() + i, count))) throw std::runtime_error("PROMPT_FAILED");
    }

    std::unique_ptr<llama_sampler, decltype(&llama_sampler_free)> sampler(
        llama_sampler_chain_init(llama_sampler_chain_default_params()), llama_sampler_free);
    if (temp <= 0.01f) {
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_greedy());
    } else {
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_top_k(40));
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_top_p(top_p, 1));
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_temp(temp));
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
    }
    common_chat_input response;
    for (int i = 0; i < limit; ++i) {
        auto next = llama_sampler_sample(sampler.get(), context.get(), -1);
        if (llama_vocab_is_eog(vocab, next)) break;
        response.append(common_token_to_piece(vocab, next, true), next);
        if (llama_decode(context.get(), llama_batch_get_one(&next, 1))) throw std::runtime_error("GENERATION_FAILED");
    }
    common_chat_parser_params parser(formatted);
    parser.parser = formatted.parser;
    auto result = common_chat_parse(response, true, parser);
    if (result.content.find_first_not_of(" \r\n\t") == std::string::npos) throw std::runtime_error("NO_ANSWER");
    return result.content;
}
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_mbc_avatarchat_LocalChat_nativeGenerate(JNIEnv *env, jclass, jbyteArray path,
        jobjectArray roles, jobjectArray contents, jint limit, jfloat temperature, jfloat top_p) {
    std::lock_guard<std::mutex> lock(engine_lock);
    try {
        std::vector<common_chat_msg> messages;
        const auto count = env->GetArrayLength(roles);
        for (jsize i = 0; i < count; ++i) {
            auto role = static_cast<jbyteArray>(env->GetObjectArrayElement(roles, i));
            auto content = static_cast<jbyteArray>(env->GetObjectArrayElement(contents, i));
            common_chat_msg message;
            message.role = bytes(env, role);
            message.content = bytes(env, content);
            env->DeleteLocalRef(role);
            env->DeleteLocalRef(content);
            messages.push_back(std::move(message));
        }
        const auto answer = generate(bytes(env, path), std::move(messages), std::clamp<int>(limit, 8, 256),
            std::clamp<float>(temperature, 0.0f, 2.0f), std::clamp<float>(top_p, 0.01f, 1.0f));
        auto output = env->NewByteArray(static_cast<jsize>(answer.size()));
        if (output) env->SetByteArrayRegion(output, 0, static_cast<jsize>(answer.size()), reinterpret_cast<const jbyte *>(answer.data()));
        return output;
    } catch (const std::exception &error) {
        const std::string message = error.what();
        const char *safe = message == "CONTEXT_LIMIT" ? "대화가 너무 깁니다. 최근 대화 수를 줄이거나 질문을 짧게 입력해 주세요."
            : message == "NO_ANSWER" ? "로컬 모델에서 답변을 받지 못했습니다."
            : "휴대폰에서 로컬 모델을 실행하지 못했습니다.";
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), safe);
        return nullptr;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_mbc_avatarchat_LocalChat_nativeClose(JNIEnv *, jclass) {
    std::lock_guard<std::mutex> lock(engine_lock);
    unload();
}
