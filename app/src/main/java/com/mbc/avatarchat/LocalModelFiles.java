package com.mbc.avatarchat;

import android.content.Context;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.security.MessageDigest;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

final class LocalModelFiles {
    private static LocalModelFiles instance;

    private enum Model {
        GEMMA("gemma-4-e2b.gguf", "2.84GB", 2841481184L,
                "ggml-org/gemma-4-E2B-it-GGUF/resolve/2a8538c2e2d4687953a86c422c7c623cfd022880/gemma-4-E2B-it-Q4_0.gguf",
                "8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52"),
        QWEN("qwen3.5-2b.gguf", "1.28GB", 1280835840L,
                "unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf",
                "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223");

        final String name, label, url, sha256;
        final long bytes;

        Model(String name, String label, long bytes, String path, String sha256) {
            this.name = name;
            this.label = label;
            this.bytes = bytes;
            this.url = "https://huggingface.co/" + path + "?download=true";
            this.sha256 = sha256;
        }
    }

    private final File internal;
    private final File downloads;
    private String active = "";
    private String lastProvider = "";
    private String message = "";
    private volatile int percent;

    static synchronized LocalModelFiles get(Context context) {
        if (instance == null) {
            instance = new LocalModelFiles(context.getFilesDir(), context.getExternalFilesDir("local-llm"));
        }
        return instance;
    }

    private LocalModelFiles(File files, File downloads) {
        internal = new File(files, "local-llm");
        this.downloads = downloads == null ? internal : downloads;
    }

    private static Model model(String provider) {
        switch (provider) {
            case "local-gemma": return Model.GEMMA;
            case "local-qwen": return Model.QWEN;
            default: throw new IllegalArgumentException("지원하지 않는 로컬 모델입니다.");
        }
    }

    private static boolean hasHeader(File file) {
        try (FileInputStream in = new FileInputStream(file)) {
            return in.read() == 'G' && in.read() == 'G' && in.read() == 'U' && in.read() == 'F';
        } catch (IOException error) {
            return false;
        }
    }

    File find(String provider) {
        Model entry = model(provider);
        File installed = new File(internal, entry.name);
        if (installed.length() > 1_000_000_000L && hasHeader(installed)) return installed;
        File downloaded = new File(downloads, entry.name);
        if (downloaded.length() == entry.bytes && hasHeader(downloaded)) return downloaded;
        return null;
    }

    synchronized JSONObject status(String provider) throws Exception {
        Model entry = model(provider);
        boolean busy = !active.isEmpty();
        String info = provider.equals(lastProvider) ? message : "";
        if (busy) info = provider.equals(active) ? "모델 다운로드 중 · " + percent + "%" : "다른 모델을 다운로드 중입니다.";
        if (info.isEmpty()) info = "모델 파일을 한 번 다운로드하면 인터넷과 API 키 없이 대화할 수 있습니다.";
        return new JSONObject().put("available", true).put("active", busy)
                .put("size", entry.label).put("message", info);
    }

    synchronized void start(String provider) {
        Model entry = model(provider);
        if (!active.isEmpty() || find(provider) != null) return;
        active = provider;
        percent = 0;
        new Thread(() -> {
            String result = "";
            try {
                download(entry);
            } catch (Exception error) {
                result = error.getMessage();
                if (result == null || !result.startsWith("모델")) result = "모델 다운로드 연결을 확인하고 다시 시도하세요.";
            } finally {
                synchronized (LocalModelFiles.this) {
                    active = "";
                    lastProvider = provider;
                    message = result;
                }
            }
        }, "avatar-model-download").start();
    }

    private void download(Model model) throws Exception {
        if (!downloads.isDirectory() && !downloads.mkdirs()) throw new IOException("모델 폴더를 만들 수 없습니다.");
        File partial = new File(downloads, model.name + ".part");
        long have = partial.length();
        if (have > model.bytes) {
            if (!partial.delete()) throw new IOException("모델 다운로드 임시 파일을 정리할 수 없습니다.");
            have = 0;
        }
        if (model.bytes - have > downloads.getUsableSpace() - 100_000_000L) {
            throw new IOException("모델을 다운로드할 저장 공간이 부족합니다.");
        }
        if (have < model.bytes) {
            HttpsURLConnection connection = (HttpsURLConnection) new URL(model.url).openConnection();
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (have > 0) connection.setRequestProperty("Range", "bytes=" + have + "-");
            try {
                int code = connection.getResponseCode();
                if (code == 200) {
                    if (model.bytes > downloads.getUsableSpace() + have - 100_000_000L) {
                        throw new IOException("모델을 다운로드할 저장 공간이 부족합니다.");
                    }
                    have = 0;
                } else {
                    String range = connection.getHeaderField("Content-Range");
                    if (code != 206 || range == null || !range.startsWith("bytes " + have + "-")
                            || !range.endsWith("/" + model.bytes)) {
                        throw new IOException("모델 다운로드가 실패했습니다 (HTTP " + code + "). 다시 시도하세요.");
                    }
                }
                try (InputStream in = connection.getInputStream();
                     FileOutputStream out = new FileOutputStream(partial, have > 0)) {
                    byte[] buffer = new byte[262144];
                    for (int count; (count = in.read(buffer)) != -1;) {
                        have += count;
                        if (have > model.bytes) throw new IOException("모델 파일 크기가 올바르지 않습니다.");
                        out.write(buffer, 0, count);
                        percent = (int) (have * 99 / model.bytes);
                    }
                }
            } finally {
                connection.disconnect();
            }
        }
        if (have != model.bytes) throw new IOException("모델 다운로드가 중단되었습니다. 다시 시도하면 이어서 받습니다.");
        if (!verify(partial, model.sha256)) {
            if (!partial.delete()) throw new IOException("모델 다운로드 임시 파일을 정리할 수 없습니다.");
            throw new IOException("모델 파일을 검증하지 못했습니다. 다시 다운로드해 주세요.");
        }
        if (!partial.renameTo(new File(downloads, model.name))) throw new IOException("모델 파일을 저장할 수 없습니다.");
    }

    private static boolean verify(File file, String expected) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[262144];
            for (int count; (count = input.read(buffer)) != -1;) digest.update(buffer, 0, count);
        }
        StringBuilder hex = new StringBuilder(64);
        for (byte value : digest.digest()) {
            hex.append(Character.forDigit((value & 255) >>> 4, 16));
            hex.append(Character.forDigit(value & 15, 16));
        }
        return expected.equals(hex.toString());
    }
}
