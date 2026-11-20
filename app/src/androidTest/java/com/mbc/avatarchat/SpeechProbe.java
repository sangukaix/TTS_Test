package com.mbc.avatarchat;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONTokener;

public final class SpeechProbe extends Instrumentation {
    private boolean missingOnly;
    private boolean localChatOnly;
    private boolean offlineKoreanOnly;
    private boolean freshCredentialsOnly;
    private boolean applyShareDefaults;
    private boolean autoApplyOnly;

    @Override public void onCreate(Bundle args) {
        super.onCreate(args);
        missingOnly = "true".equals(args.getString("missingOnly"));
        localChatOnly = "true".equals(args.getString("localChatOnly"));
        offlineKoreanOnly = "true".equals(args.getString("offlineKoreanOnly"));
        freshCredentialsOnly = "true".equals(args.getString("freshCredentialsOnly"));
        applyShareDefaults = "true".equals(args.getString("applyShareDefaults"));
        autoApplyOnly = "true".equals(args.getString("autoApplyOnly"));
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            String target = getTargetContext().getPackageName();
            Intent intent = new Intent().setClassName(target, "com.mbc.avatarchat.MainActivity")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Activity activity = startActivitySync(intent);
            WebView web = findWebView(activity.getWindow().getDecorView());
            if (web == null) throw new IllegalStateException("WebView missing");
            long started = SystemClock.elapsedRealtime();
            while (!"ready".equals(evaluate(web, "typeof say === 'function' && document.readyState === 'complete' && document.getElementById('voicePickerList')?.children.length ? 'ready' : ''"))) {
                if (SystemClock.elapsedRealtime() - started > 15000) throw new IllegalStateException("Page not ready");
                SystemClock.sleep(250);
            }
            String probe = autoApplyOnly ? "auto-apply-probe.js"
                    : freshCredentialsOnly ? "fresh-credentials-probe.js"
                    : localChatOnly ? "local-chat-probe.js" : "speech-probe.js";
            try (InputStream source = getContext().getAssets().open(probe); ByteArrayOutputStream script = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096]; int n;
                while ((n = source.read(buffer)) >= 0) script.write(buffer, 0, n);
                evaluate(web, "window.__speechProbeMissingOnly = " + missingOnly);
                evaluate(web, "window.__speechProbeOfflineKoreanOnly = " + offlineKoreanOnly);
                evaluate(web, "window.__speechProbeApplyShareDefaults = " + applyShareDefaults);
                evaluate(web, new String(script.toByteArray(), StandardCharsets.UTF_8));
            }
            String previous = "";
            while (SystemClock.elapsedRealtime() - started < 980000) {
                String status = evaluate(web, "window.__speechProbeSurvey || ''");
                if (!previous.equals(status)) {
                    Bundle progress = new Bundle();
                    progress.putString("stream", status.substring(previous.length()));
                    sendStatus(1, progress);
                    previous = status;
                }
                if ("yes".equals(evaluate(web, "window.__speechProbeComplete ? 'yes' : ''"))) {
                    result.putString("stream", "\nSpeech probe finished.\n");
                    finish(Activity.RESULT_OK, result);
                    return;
                }
                SystemClock.sleep(450);
            }
            throw new IllegalStateException("Probe timeout");
        } catch (Exception error) {
            result.putString("stream", "\n" + error.getClass().getSimpleName() + ": " + error.getMessage() + "\n");
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private static WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView found = findWebView(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    private String evaluate(WebView web, String expression) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>("null");
        runOnMainSync(() -> web.evaluateJavascript(expression, response -> { value.set(response); latch.countDown(); }));
        if (!latch.await(8, TimeUnit.SECONDS)) throw new IllegalStateException("WebView response timeout");
        Object decoded = new JSONTokener(value.get()).nextValue();
        return decoded instanceof String ? (String) decoded : "";
    }
}
