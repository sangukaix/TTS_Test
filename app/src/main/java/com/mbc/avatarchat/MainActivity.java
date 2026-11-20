package com.mbc.avatarchat;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import android.util.Base64;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** WebView + JS bridge. assets/www 페이지. 네이티브 STT(SpeechRecognizer) / TTS(TextToSpeech). */
public class MainActivity extends Activity implements TextToSpeech.OnInitListener {

    private WebView web;
    private TextToSpeech tts;
    private OfflineSpeech offlineSpeech;
    private LocalChat localChat;
    private LocalModelFiles localModelFiles;
    private SpeechRecognizer rec;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean ttsReady, listening;
    private volatile boolean recAvailable;
    private double rate = 1.0, pitch = 1.0;
    private String voiceName = "";
    private static final int REQ_MIC = 11;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        offlineSpeech = new OfflineSpeech(getFilesDir(), getAssets());
        localModelFiles = LocalModelFiles.get(this);
        localChat = new LocalChat(localModelFiles);
        recAvailable = SpeechRecognizer.isRecognitionAvailable(this);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(true);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient());
        web.loadUrl("file:///android_asset/www/index.html");
        setContentView(web);
        tts = new TextToSpeech(this, this);
        checkMic();
    }

    @Override
    protected void onResume() {
        super.onResume();
        recAvailable = SpeechRecognizer.isRecognitionAvailable(this);
        web.evaluateJavascript("window.__onSttAvailabilityChanged?.()", null);
    }

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS) {
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String id) { call("__onDeviceSpeechState", id, "started"); }

                @Override
                public void onDone(String id) { call("__onDeviceSpeechState", id, "finished"); }

                @Override
                public void onError(String id) { call("__onDeviceSpeechState", id, "failed"); }

                @Override
                public void onStop(String id, boolean interrupted) { call("__onDeviceSpeechState", id, "finished"); }
            });
            ttsReady = true;
            int r = tts.setLanguage(Locale.KOREAN);
            applyVoice();
            call("__onTtsState", (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED)
                    ? "korean voice not installed" : "ready");
        } else {
            call("__onTtsState", "init failed");
        }
    }

    private void applyVoice() {
        if (!ttsReady) return;
        tts.setSpeechRate((float) rate);
        tts.setPitch((float) pitch);
        if (voiceName != null && !voiceName.isEmpty()) {
            try {
                Set<Voice> vs = tts.getVoices();
                if (vs != null) {
                    for (Voice v : vs) {
                        if (v.getName().toLowerCase().contains(voiceName.toLowerCase())) {
                            tts.setVoice(v);
                            break;
                        }
                    }
                }
            } catch (Exception ignored) {
            }
        } else {
            // Restore the device's Korean default after a specific voice was selected.
            tts.setLanguage(Locale.KOREAN);
        }
    }

    private void call(String fn, String... args) {
        StringBuilder js = new StringBuilder("window.").append(fn).append("(");
        for (int i = 0; i < args.length; i++) {
            if (i > 0) js.append(",");
            js.append(JSONObject.quote(args[i]));
        }
        String s = js.append(");").toString();
        if (Looper.myLooper() == Looper.getMainLooper()) web.evaluateJavascript(s, null);
        else ui.post(new Runnable() { public void run() { web.evaluateJavascript(s, null); } });
    }

    private interface SpeechJob { JSONObject run() throws Exception; }

    private void runSpeech(String id, SpeechJob job) {
        new Thread(() -> {
            String result;
            try { result = job.run().toString(); }
            catch (Exception | LinkageError error) {
                result = "{\"error\":{\"message\":" + JSONObject.quote(String.valueOf(error.getMessage())) + "}}";
            }
            call("__onApiResponse", id, result);
        }).start();
    }

    private boolean micOk() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private void checkMic() {
        if (micOk()) call("__onBridgeState", "mic ok");
        else requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] grants) {
        call("__onBridgeState", (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) ? "mic ok" : "mic denied");
    }

    @Override
    public void onDestroy() {
        if (rec != null) { rec.destroy(); rec = null; }
        if (tts != null) { tts.stop(); tts.shutdown(); }
        new Thread(offlineSpeech::close).start();
        new Thread(localChat::close).start();
        super.onDestroy();
    }

    private void listen() {
        if (!recAvailable) { call("__onSttError", "no native speech recognizer"); return; }
        if (!micOk()) { call("__onSttError", "mic permission denied"); checkMic(); return; }
        if (rec == null) {
            rec = SpeechRecognizer.createSpeechRecognizer(this);
            rec.setRecognitionListener(new Listener());
        }
        Intent in = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        in.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        in.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR");
        in.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        in.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        in.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        listening = true;
        rec.startListening(in);
    }

    private class Listener implements RecognitionListener {
        public void onReadyForSpeech(Bundle params) { call("__onBridgeState", "listening"); }
        public void onBeginningOfSpeech() {}
        public void onRmsChanged(float rmsdB) {}
        public void onBufferReceived(byte[] buffer) {}
        public void onEndOfSpeech() {}
        public void onError(int error) {
            listening = false;
            call("__onSttError", "code " + error);
        }
        public void onResults(Bundle results) {
            listening = false;
            List<String> rs = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            call("__onStt", (rs != null && !rs.isEmpty()) ? rs.get(0) : "");
        }
        public void onPartialResults(Bundle partial) {
            List<String> rs = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (rs != null && !rs.isEmpty()) call("__onSttPartial", rs.get(0));
        }
        public void onEvent(int eventType, Bundle params) {}
    }

    private class Bridge {
        @JavascriptInterface
        public boolean isShareBuild() {
            return getPackageName().endsWith(".share");
        }

        @JavascriptInterface
        public boolean localChatReady(String provider) {
            return localChat.ready(provider);
        }

        @JavascriptInterface
        public String localModelStatus(String provider) throws Exception {
            if (localChat.compatible()) return localModelFiles.status(provider).toString();
            return new JSONObject().put("message", "로컬 모델은 Android 8 이상 64비트 ARM 기기에서 실행됩니다.").toString();
        }

        @JavascriptInterface
        public void startLocalModelDownload(String provider) {
            if (localChat.compatible()) {
                localModelFiles.start(provider);
            }
        }

        @JavascriptInterface
        public void postLocalChat(String id, String provider, String body) {
            runSpeech(id, () -> localChat.reply(provider, body));
        }

        @JavascriptInterface
        public void speak(String text, double r, double p, String name, String utteranceId) {
            if (!ttsReady) {
                call("__onDeviceSpeechState", utteranceId, "failed");
                return;
            }
            rate = r; pitch = p; voiceName = name == null ? "" : name;
            applyVoice();
            if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId) == TextToSpeech.ERROR) {
                call("__onDeviceSpeechState", utteranceId, "failed");
            }
        }

        @JavascriptInterface
        public void stopSpeaking() {
            if (ttsReady) tts.stop();
        }

        @JavascriptInterface
        public void setVoice(double r, double p, String name) {
            rate = r; pitch = p; voiceName = name == null ? "" : name;
            applyVoice();
        }

        @JavascriptInterface
        public boolean micGranted() {
            return micOk();
        }

        @JavascriptInterface
        public boolean sttAvailable() {
            return recAvailable;
        }

        @JavascriptInterface
        public void startListening() {
            ui.post(new Runnable() { public void run() { listen(); } });
        }

        @JavascriptInterface
        public void stopListening() {
            ui.post(new Runnable() { public void run() {
                if (rec != null) rec.stopListening();
                listening = false;
            } });
        }

        @JavascriptInterface
        public String voices() {
            JSONArray a = new JSONArray();
            if (ttsReady && tts.getVoices() != null) {
                for (Voice v : tts.getVoices()) a.put(v.getName());
            }
            return a.toString();
        }

        @JavascriptInterface
        public void postJson(final String id, final String url, final String body, final String headersJson) {
            new Thread(new Runnable() {
                public void run() {
                    String out;
                    try {
                        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                        c.setConnectTimeout(20000);
                        c.setReadTimeout(url.equals("http://127.0.0.1:8766/tts") ? 160000 : 60000);
                        c.setRequestMethod("POST");
                        JSONObject hs = new JSONObject(headersJson);
                        Iterator<String> ks = hs.keys();
                        while (ks.hasNext()) {
                            String k = ks.next();
                            c.setRequestProperty(k, hs.getString(k));
                        }
                        c.setDoOutput(true);
                        c.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
                        int code = c.getResponseCode();
                        InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
                        StringBuilder sb = new StringBuilder();
                        if (is != null) {
                            BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
                            String line;
                            while ((line = br.readLine()) != null) sb.append(line);
                            br.close();
                        }
                        out = sb.length() > 0 ? sb.toString() : "{\"error\":{\"message\":\"HTTP " + code + "\"}}";
                    } catch (Exception e) {
                        out = "{\"error\":{\"message\":" + JSONObject.quote("네트워크 오류: " + String.valueOf(e.getMessage())) + "}}";
                    }
                    call("__onApiResponse", id, out);
                }
            }).start();
        }

        @JavascriptInterface
        public void postFreeSpeech(String id, String mode, String key, String text, String tone, float speed) {
            runSpeech(id, () -> FreeSpeech.generate(mode, key, text, tone, speed));
        }

        @JavascriptInterface
        public void typecastCredits(String id, String key) {
            runSpeech(id, () -> FreeSpeech.credits(key));
        }

        @JavascriptInterface
        public void postPhoneSpeech(String id, String mode, String text, String tone, float speed) {
            runSpeech(id, () -> offlineSpeech.synthesize(mode, text, tone, speed));
        }

        @JavascriptInterface
        public void postElevenSpeech(final String id, final String body, final String key, final String voiceId) {
            new Thread(() -> {
                HttpURLConnection c = null;
                String out;
                try {
                    // Fail closed unless the account confirms a free plan with overages disabled.
                    HttpURLConnection check = (HttpURLConnection) new URL("https://api.elevenlabs.io/v1/user/subscription").openConnection();
                    check.setConnectTimeout(15000); check.setReadTimeout(15000);
                    check.setRequestProperty("xi-api-key", key);
                    try {
                        if (check.getResponseCode() != 200) throw new Exception("무료 플랜 확인 실패: API 키에 구독 조회 권한이 필요합니다");
                        StringBuilder info = new StringBuilder();
                        try (BufferedReader reader = new BufferedReader(new InputStreamReader(check.getInputStream(), StandardCharsets.UTF_8))) {
                            String line; while ((line = reader.readLine()) != null) info.append(line);
                        }
                        JSONObject subscription = new JSONObject(info.toString());
                        Object extension = subscription.opt("max_credit_limit_extension");
                        if (!"free".equalsIgnoreCase(subscription.optString("tier")) || !(extension instanceof Number) || ((Number) extension).longValue() != 0) {
                            throw new Exception("무료 플랜 및 추가 과금 차단 상태를 확인할 수 없어 요청을 중단했습니다");
                        }
                    } finally { check.disconnect(); }
                    if (!voiceId.matches("[A-Za-z0-9_-]{1,100}")) throw new Exception("잘못된 Voice ID");
                    JSONObject speech = new JSONObject(body);
                    String model = speech.getString("model_id");
                    String url = "https://api.elevenlabs.io/v1/text-to-speech/" + voiceId;
                    if ("eleven_v4".equals(model)) {
                        url = "https://api.elevenlabs.io/v1/text-to-dialogue";
                        JSONObject line = new JSONObject().put("voice_id", voiceId).put("text", speech.getString("text"));
                        speech.remove("text");
                        speech.put("inputs", new JSONArray().put(line));
                    } else if ("eleven_multilingual_v2".equals(model)) {
                        speech.remove("language_code");
                    }
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(20000); c.setReadTimeout(60000);
                    c.setRequestMethod("POST"); c.setDoOutput(true);
                    c.setRequestProperty("Content-Type", "application/json");
                    c.setRequestProperty("xi-api-key", key);
                    try (java.io.OutputStream os = c.getOutputStream()) { os.write(speech.toString().getBytes(StandardCharsets.UTF_8)); }
                    int code = c.getResponseCode();
                    if (code < 200 || code >= 300) throw new Exception("음성 서비스 HTTP " + code);
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    try (InputStream in = c.getInputStream()) {
                        byte[] buffer = new byte[8192]; int count;
                        while ((count = in.read(buffer)) != -1) {
                            if (bytes.size() + count > 10000000) throw new Exception("음성 응답이 너무 큽니다");
                            bytes.write(buffer, 0, count);
                        }
                    }
                    out = new JSONObject().put("audio", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)).toString();
                } catch (Exception e) {
                    out = "{\"error\":{\"message\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}}";
                } finally { if (c != null) c.disconnect(); }
                call("__onApiResponse", id, out);
            }).start();
        }

        @JavascriptInterface
        public void getElevenVoices(final String id, final String key) {
            new Thread(() -> {
                HttpURLConnection c = null; String out;
                try {
                    c = (HttpURLConnection) new URL("https://api.elevenlabs.io/v2/voices?voice_type=default&page_size=100").openConnection();
                    c.setConnectTimeout(15000); c.setReadTimeout(15000); c.setRequestProperty("xi-api-key", key);
                    if (c.getResponseCode() != 200) throw new Exception("음성 목록 조회 실패: API 키의 음성 읽기 권한을 확인하세요");
                    StringBuilder data = new StringBuilder();
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                        String line; while ((line = reader.readLine()) != null) data.append(line);
                    }
                    JSONObject response = new JSONObject(data.toString());
                    JSONArray input = response.optJSONArray("voices"), voices = new JSONArray();
                    if (input != null) for (int i = 0; i < input.length(); i++) {
                        JSONObject v = input.optJSONObject(i); if (v == null) continue;
                        JSONObject entry = new JSONObject().put("voice_id", v.optString("voice_id"))
                            .put("name", v.optString("name"))
                            .put("description", v.optString("description"))
                            .put("labels", v.optJSONObject("labels") == null ? new JSONObject() : v.optJSONObject("labels"));
                        voices.put(entry);
                    }
                    out = new JSONObject().put("voices", voices).toString();
                } catch (Exception e) {
                    out = "{\"error\":{\"message\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}}";
                } finally { if (c != null) c.disconnect(); }
                call("__onApiResponse", id, out);
            }).start();
        }

        @JavascriptInterface
        public void getElevenCredits(final String id, final String key) {
            new Thread(() -> {
                HttpURLConnection c = null;
                String out;
                try {
                    c = (HttpURLConnection) new URL("https://api.elevenlabs.io/v1/user/subscription").openConnection();
                    c.setConnectTimeout(15000); c.setReadTimeout(15000);
                    c.setRequestProperty("xi-api-key", key);
                    if (c.getResponseCode() != 200) throw new Exception("구독 조회 권한 또는 API 키를 확인하세요");
                    StringBuilder data = new StringBuilder();
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                        String line; while ((line = reader.readLine()) != null) data.append(line);
                    }
                    JSONObject subscription = new JSONObject(data.toString());
                    if (!subscription.has("character_count") || !subscription.has("character_limit")) throw new Exception("사용량 정보가 없습니다");
                    out = new JSONObject().put("used", subscription.getInt("character_count")).put("limit", subscription.getInt("character_limit")).toString();
                } catch (Exception e) {
                    out = "{\"error\":{\"message\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}}";
                } finally { if (c != null) c.disconnect(); }
                call("__onApiResponse", id, out);
            }).start();
        }

        @JavascriptInterface
        public String info() {
            return "android native bridge: tts=" + ttsReady + " stt=" + recAvailable + " mic=" + micOk();
        }
    }
}
