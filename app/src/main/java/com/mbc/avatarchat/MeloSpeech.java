package com.mbc.avatarchat;

import android.content.res.AssetManager;
import java.io.File;
import java.io.IOException;

final class MeloSpeech {
    private static final String MODEL = "melotts_kr_int8.onnx";
    private static final long MODEL_BYTES = 53465508;
    private final File folder;
    private final AssetManager assets;
    private long handle;

    MeloSpeech(File folder, AssetManager assets) {
        this.folder = folder;
        this.assets = assets;
    }

    float[] samples(String text, float speed) throws IOException {
        long[] tokens = MeloKorean.tokens(text);
        if (tokens.length > 1600) throw new IOException("MeloTTS로 읽을 문장을 줄여 주세요");
        if (handle == 0) {
            System.loadLibrary("avatar_melo_tts");
            handle = load(OfflineSpeech.prepareAsset(assets, folder, MODEL, MODEL_BYTES).getAbsolutePath());
        }
        return generate(handle, tokens, Math.max(.7f, Math.min(1.4f, speed)));
    }

    void close() {
        if (handle != 0) release(handle);
        handle = 0;
    }

    private static native long load(String model) throws IOException;
    private static native float[] generate(long handle, long[] tokens, float speed) throws IOException;
    private static native void release(long handle);
}
