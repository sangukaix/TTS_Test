package com.mbc.avatarchat;

import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

final class LocalChat {
    private final LocalModelFiles files;
    private boolean loaded;

    LocalChat(LocalModelFiles files) { this.files = files; }

    boolean compatible() {
        return Build.VERSION.SDK_INT >= 26 && Arrays.asList(Build.SUPPORTED_ABIS).contains("arm64-v8a");
    }

    boolean ready(String provider) {
        try {
            return compatible() && files.find(provider) != null;
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    synchronized JSONObject reply(String provider, String body) throws Exception {
        if (!compatible()) throw new IllegalStateException("로컬 모델은 Android 8 이상 64비트 ARM 기기에서 실행됩니다.");
        File model = files.find(provider);
        if (model == null) throw new IllegalStateException("휴대폰에 이 로컬 모델 파일이 설치되어 있지 않습니다.");
        if (body.length() > 24000) throw new IllegalArgumentException("대화가 너무 깁니다. 질문을 짧게 입력해 주세요.");
        JSONObject request = new JSONObject(body);
        JSONArray messages = request.getJSONArray("messages");
        int count = messages.length();
        if (count < 2 || count > 22) throw new IllegalArgumentException("대화 형식이 올바르지 않습니다.");
        byte[][] roles = new byte[count][];
        byte[][] contents = new byte[count][];
        for (int i = 0; i < count; i++) {
            JSONObject message = messages.getJSONObject(i);
            String role = message.getString("role");
            if (!role.equals(i == 0 ? "system" : i % 2 == 1 ? "user" : "assistant")) {
                throw new IllegalArgumentException("대화 순서가 올바르지 않습니다.");
            }
            roles[i] = role.getBytes(StandardCharsets.UTF_8);
            contents[i] = message.getString("content").getBytes(StandardCharsets.UTF_8);
        }
        if (!loaded) {
            System.loadLibrary("avatar_local_chat");
            loaded = true;
        }
        byte[] reply = nativeGenerate(model.getAbsolutePath().getBytes(StandardCharsets.UTF_8),
                roles, contents, request.optInt("max_tokens", 160),
                (float) request.optDouble("temperature", 1.8), (float) request.optDouble("top_p", 0.9));
        return new JSONObject().put("text", new String(reply, StandardCharsets.UTF_8).trim());
    }

    synchronized void close() { if (loaded) nativeClose(); }

    private static native byte[] nativeGenerate(byte[] model, byte[][] roles, byte[][] contents,
                                                 int maxTokens, float temperature, float topP);
    private static native void nativeClose();
}
