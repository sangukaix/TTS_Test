package com.mbc.avatarchat;

import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class FreeSpeech {
    private static final String TYPECAST = "https://api.typecast.ai";
    private static final String CARTESIA = "https://api.cartesia.ai";

    static JSONObject credits(String key) throws Exception {
        JSONObject data = new JSONObject(json(TYPECAST + "/v1/users/me/subscription", key));
        JSONObject credits = data.getJSONObject("credits");
        int limit = credits.getInt("plan_credits");
        int used = credits.getInt("used_credits");
        return new JSONObject().put("free", "free".equals(data.getString("plan")))
                .put("limit", limit).put("remaining", Math.max(0, limit - used));
    }

    static JSONObject generate(String mode, String key, String text, String tone, float speed) throws Exception {
        if (text.isEmpty() || text.length() > 2000) throw new Exception("음성은 한 번에 2,000자까지 읽을 수 있습니다");
        speed = Math.max(0.75f, Math.min(1.25f, speed));
        byte[] audio;
        if (mode.matches("ssfm-v(31|30|21)")) {
            JSONObject quota = credits(key);
            if (!quota.getBoolean("free")) throw new Exception("타입캐스트 무료 플랜에서만 재생할 수 있습니다");
            if (quota.getInt("remaining") < text.length()) throw new Exception("타입캐스트 무료 크레딧이 부족합니다");
            String gender = "low".equals(tone) ? "male" : "female";
            JSONArray list = new JSONArray(json(TYPECAST + "/v3/voices?voice_type=original&model=" + mode + "&gender=" + gender, key));
            JSONObject voice = null;
            for (int i = 0; i < list.length(); i++) {
                JSONObject candidate = list.getJSONObject(i);
                JSONObject names = candidate.optJSONObject("voice_name");
                if (candidate.optString("voice_id").startsWith("tc_") && names != null
                        && !names.isNull("kor") && !names.optString("kor").isEmpty()) {
                    voice = candidate;
                    break;
                }
            }
            if (voice == null) throw new Exception("사용할 수 있는 타입캐스트 기본 음성이 없습니다");
            JSONObject output = new JSONObject().put("audio_format", "wav").put("audio_tempo", speed);
            JSONObject body = new JSONObject().put("voice_id", voice.getString("voice_id"))
                    .put("text", text).put("model", mode).put("language", "kor").put("output", output);
            String emotion = "bright".equals(tone) ? "happy" : "low".equals(tone) ? "angry" : "normal";
            JSONArray models = voice.optJSONArray("models");
            if (models != null) for (int i = 0; i < models.length(); i++) {
                JSONObject info = models.getJSONObject(i);
                JSONArray emotions = info.optJSONArray("emotions");
                if (!mode.equals(info.optString("version")) || emotions == null) continue;
                for (int j = 0; j < emotions.length(); j++) {
                    if (!emotion.equals(emotions.optString(j))) continue;
                    JSONObject prompt = new JSONObject().put("emotion_preset", emotion);
                    if (!"ssfm-v21".equals(mode)) prompt.put("emotion_type", "preset");
                    body.put("prompt", prompt);
                    break;
                }
            }
            audio = request(TYPECAST + "/v1/text-to-speech", key, body);
        } else if ("cartesia".equals(mode)) {
            String gender = "low".equals(tone) ? "masculine" : "feminine";
            JSONArray list = new JSONObject(json(CARTESIA + "/voices?language=ko&limit=30&gender=" + gender, key)).getJSONArray("data");
            JSONObject voice = null;
            for (int i = 0; i < list.length(); i++) {
                JSONObject candidate = list.getJSONObject(i);
                if ("public".equals(candidate.optString("access")) && "active".equals(candidate.optString("status"))) {
                    voice = candidate;
                    break;
                }
            }
            if (voice == null) throw new Exception("Cartesia의 한국어 공개 음성을 찾을 수 없습니다");
            JSONObject output = new JSONObject().put("container", "wav").put("encoding", "pcm_s16le").put("sample_rate", 24000);
            JSONObject body = new JSONObject().put("model_id", "sonic-3.6").put("transcript", text).put("language", "ko")
                    .put("voice", voice.getString("id")).put("generation_config", new JSONObject().put("speed", speed))
                    .put("output_format", output);
            audio = request(CARTESIA + "/tts/bytes", key, body);
        } else {
            throw new Exception("지원하지 않는 음성 모델입니다");
        }
        if (audio.length < 44 || !"RIFF".equals(new String(audio, 0, 4, StandardCharsets.US_ASCII))) {
            throw new Exception("올바른 WAV 응답을 받지 못했습니다");
        }
        return new JSONObject().put("audio", Base64.encodeToString(audio, Base64.NO_WRAP));
    }

    private static String json(String url, String key) throws Exception {
        return new String(request(url, key, null), StandardCharsets.UTF_8);
    }

    private static byte[] request(String url, String key, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(45000);
            if (url.startsWith(TYPECAST + "/")) connection.setRequestProperty("X-API-KEY", key);
            else {
                connection.setRequestProperty("Authorization", "Bearer " + key);
                connection.setRequestProperty("Cartesia-Version", "2026-08-14");
            }
            if (body != null) {
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
            }
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("음성 서비스 HTTP " + code);
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (output.size() + count > 8_000_000) throw new Exception("음성 응답이 너무 큽니다");
                    output.write(buffer, 0, count);
                }
                return output.toByteArray();
            }
        } finally {
            connection.disconnect();
        }
    }
}
