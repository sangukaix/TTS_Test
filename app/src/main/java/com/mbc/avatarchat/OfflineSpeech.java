package com.mbc.avatarchat;

import android.content.res.AssetManager;
import android.util.Base64;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.GenerationConfig;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsSupertonicModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

final class OfflineSpeech {
    private static final String SUPER = "sherpa-onnx-supertonic-3-tts-int8-2026-05-11";
    private static final String MIMIC = "vits-mimic3-ko_KO-kss_low";
    private static final String KOKORO = "kokoro-int8-multi-lang-v1_0";
    private static final String[] SUPER_FILES = {"duration_predictor.int8.onnx", "text_encoder.int8.onnx",
            "vector_estimator.int8.onnx", "vocoder.int8.onnx", "tts.json", "unicode_indexer.bin", "voice.bin"};
    private final File root;
    private final AssetManager assets;
    private final MeloSpeech melo;
    private OfflineTts engine;
    private String loaded = "";

    OfflineSpeech(File files, AssetManager assets) {
        this.root = new File(files, "tts-models");
        this.assets = assets;
        melo = new MeloSpeech(root, assets);
    }

    private static String archiveName(String mode) {
        if ("supertonicPhone".equals(mode)) return SUPER;
        if ("mimicPhone".equals(mode)) return MIMIC;
        if ("kokoroPhone".equals(mode)) return KOKORO;
        throw new IllegalArgumentException("지원하지 않는 오프라인 모델입니다");
    }

    private void prepare(String mode) throws Exception {
        String name = archiveName(mode);
        File destination = new File(root, name);
        File ready = new File(destination, ".ready");
        if (ready.isFile()) return;
        if (!root.isDirectory() && !root.mkdirs()) throw new Exception("모델 저장 폴더를 준비할 수 없습니다");
        if (root.getUsableSpace() < 200_000_000) throw new Exception("모델 파일을 준비할 여유 공간이 부족합니다");
        try (InputStream archive = assets.open("tts/" + name + ".tar.bz2", AssetManager.ACCESS_STREAMING)) {
            unpack(archive, destination, name);
        }
        if (SUPER.equals(name)) {
            for (String file : SUPER_FILES) requireFile(destination, file);
        } else if (KOKORO.equals(name)) {
            kokoroConfig(destination);
        } else {
            requireFile(destination, "ko_KO-kss_low.onnx");
            requireFile(destination, "tokens.txt");
            if (!new File(destination, "espeak-ng-data").isDirectory()) throw new Exception("한국어 발음 데이터가 없습니다");
        }
        if (!ready.createNewFile()) throw new Exception("모델 준비를 마칠 수 없습니다");
    }

    private static String requireFile(File dir, String name) throws Exception {
        File file = new File(dir, name);
        if (!file.isFile() || file.length() <= 0) throw new Exception("설치된 모델 파일을 확인해 주세요");
        return file.getAbsolutePath();
    }

    static File prepareAsset(AssetManager assets, File folder, String name, long size) throws IOException {
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("모델 폴더를 만들 수 없습니다");
        File model = new File(folder, name);
        if (model.isFile() && model.length() == size) return model;
        File partial = new File(folder, name + ".part");
        if (folder.getUsableSpace() + partial.length() < size) {
            throw new IOException("음성 모델을 준비할 여유 공간이 부족합니다");
        }
        try (InputStream input = assets.open("tts/" + name, AssetManager.ACCESS_STREAMING);
             FileOutputStream output = new FileOutputStream(partial)) {
            byte[] buffer = new byte[65536];
            for (int count; (count = input.read(buffer)) != -1;) output.write(buffer, 0, count);
        }
        if (partial.length() != size || !partial.renameTo(model)) {
            throw new IOException("음성 모델을 휴대폰에 준비할 수 없습니다");
        }
        return model;
    }

    private static OfflineTtsKokoroModelConfig kokoroConfig(File dir) throws Exception {
        OfflineTtsKokoroModelConfig model = new OfflineTtsKokoroModelConfig();
        String weights = new File(dir, "model.int8.onnx").isFile() ? "model.int8.onnx" : "model.onnx";
        model.setModel(requireFile(dir, weights));
        model.setVoices(requireFile(dir, "voices.bin"));
        model.setTokens(requireFile(dir, "tokens.txt"));
        model.setDataDir(new File(dir, "espeak-ng-data").getAbsolutePath());
        model.setLexicon(requireFile(dir, "lexicon-us-en.txt") + "," + requireFile(dir, "lexicon-zh.txt"));
        return model;
    }

    private static void unpack(InputStream archive, File destination, String name) throws Exception {
        if (!destination.isDirectory() && !destination.mkdirs()) throw new Exception("모델 폴더를 만들 수 없습니다");
        String prefix = destination.getCanonicalPath() + File.separator;
        byte[] buffer = new byte[32768];
        long total = 0;
        try (TarArchiveInputStream input = new TarArchiveInputStream(new BZip2CompressorInputStream(archive))) {
            TarArchiveEntry entry;
            while ((entry = input.getNextTarEntry()) != null) {
                String path = entry.getName();
                if (!entry.isFile() || !path.startsWith(name + "/")) continue;
                String relative = path.substring(name.length() + 1);
                File output = new File(destination, relative);
                if (!output.getCanonicalPath().startsWith(prefix)) throw new Exception("모델 경로가 올바르지 않습니다");
                total += entry.getSize();
                if (total > 350_000_000) throw new Exception("모델 압축을 풀 공간 한도를 넘었습니다");
                File parent = output.getParentFile();
                if (!parent.isDirectory() && !parent.mkdirs()) throw new Exception("모델 폴더를 만들 수 없습니다");
                try (FileOutputStream file = new FileOutputStream(output)) {
                    int count;
                    while ((count = input.read(buffer)) >= 0) file.write(buffer, 0, count);
                }
            }
        }
    }

    synchronized JSONObject synthesize(String mode, String text, String tone, float speed) throws Exception {
        if (text.trim().isEmpty() || text.length() > 320) throw new Exception("320자 이내의 문장을 사용하세요");
        if (!mode.equals(loaded)) {
            close();
            loaded = mode;
        }
        if ("meloPhone".equals(mode)) return wav(melo.samples(text, speed), 44100);
        boolean supertonic = "supertonicPhone".equals(mode);
        boolean kokoro = "kokoroPhone".equals(mode);
        if (kokoro && !text.matches("[\\x00-\\x7F]+")) throw new Exception("이 Kokoro 음성은 영어 문장만 읽을 수 있습니다");
        prepare(mode);
        if (engine == null) {
            File dir = new File(root, archiveName(mode));
            OfflineTtsConfig config = new OfflineTtsConfig();
            OfflineTtsModelConfig model = config.getModel();
            model.setNumThreads(3);
            if (supertonic) {
                String[] path = new String[SUPER_FILES.length];
                for (int i = 0; i < path.length; i++) path[i] = requireFile(dir, SUPER_FILES[i]);
                model.setSupertonic(new OfflineTtsSupertonicModelConfig(path[0], path[1], path[2],
                        path[3], path[4], path[5], path[6]));
            } else if (kokoro) {
                model.setKokoro(kokoroConfig(dir));
            } else {
                OfflineTtsVitsModelConfig vits = new OfflineTtsVitsModelConfig();
                vits.setModel(requireFile(dir, "ko_KO-kss_low.onnx"));
                vits.setTokens(requireFile(dir, "tokens.txt"));
                vits.setDataDir(new File(dir, "espeak-ng-data").getAbsolutePath());
                model.setVits(vits);
            }
            engine = new OfflineTts(null, config);
        }
        GenerationConfig options = new GenerationConfig();
        options.setSpeed(Math.max(.7f, Math.min(1.4f, speed)));
        if (supertonic) {
            options.setExtra(Collections.singletonMap("lang", "ko"));
            options.setNumSteps(8);
            options.setSid("low".equals(tone) ? 0 : "bright".equals(tone) ? 5 : 6);
        } else if (kokoro) {
            options.setSid("low".equals(tone) ? 16 : 3);
        }
        GeneratedAudio audio = engine.generateWithConfig(text, options);
        return wav(audio.getSamples(), audio.getSampleRate());
    }

    private static JSONObject wav(float[] samples, int rate) throws Exception {
        if (rate <= 0 || samples.length == 0 || samples.length > rate * 60) throw new Exception("음성 길이가 올바르지 않습니다");
        ByteBuffer wav = ByteBuffer.allocate(44 + samples.length * 2).order(ByteOrder.LITTLE_ENDIAN);
        wav.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(wav.capacity() - 8);
        wav.put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1).putShort((short) 1);
        wav.putInt(rate).putInt(rate * 2).putShort((short) 2).putShort((short) 16);
        wav.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(samples.length * 2);
        for (float sample : samples) wav.putShort((short) (Math.max(-1f, Math.min(1f, sample)) * 32767));
        return new JSONObject().put("audio", Base64.encodeToString(wav.array(), Base64.NO_WRAP));
    }

    synchronized void close() {
        melo.close();
        if (engine != null) engine.release();
        engine = null;
        loaded = "";
    }
}
