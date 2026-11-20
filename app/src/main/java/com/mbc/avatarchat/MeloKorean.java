package com.mbc.avatarchat;

import java.text.Normalizer;
import java.util.Arrays;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Maps Korean pronunciation to the jamo IDs of the MeloTTS Korean checkpoint. */
final class MeloKorean {
    private static final int HANGUL = 0xac00;
    private static final Pattern RUNS = Pattern.compile("[가-힣]+|[0-9]+|[A-Z]+|[!?…,.\u0027-]");
    private static final String[] LETTERS = {"에이", "비", "씨", "디", "이", "에프", "지", "에이치",
            "아이", "제이", "케이", "엘", "엠", "엔", "오", "피", "큐", "알", "에스", "티",
            "유", "브이", "더블유", "엑스", "와이", "제트"};
    private static final String DIGITS = "영일이삼사오육칠팔구";
    // Final consonants are realized as one of seven sounds in this model's vocabulary.
    private static final int[] FINALS = {0, 1, 1, 1, 4, 4, 4, 7, 8, 1, 16, 8, 8, 8,
            17, 8, 16, 17, 17, 7, 7, 21, 7, 7, 1, 7, 17, 7};
    private static final int[] LIAISON = {-1, 0, 1, 9, 2, 12, 18, 3, 5, 0, 6, 7, 9, 16, 17, 18,
            6, 7, 9, 9, 10, -1, 12, 14, 15, 16, 17, 18};
    private static final int[] RETAINED = {0, 0, 0, 1, 0, 4, 4, 0, 0, 8, 8, 8, 8, 8, 8, 8,
            0, 0, 17, 0, 0, 21, 0, 0, 0, 0, 0, 0};
    private static final String PUNCTUATION = "!?…,.\u0027-";

    static long[] tokens(String text) {
        String normalized = Normalizer.normalize(text, Normalizer.Form.NFKC).toUpperCase(Locale.ROOT);
        Matcher runs = RUNS.matcher(normalized);
        long[] out = new long[normalized.length() * 50 + 5];
        int count = 3; // Interleave the blank ID (0) and pad both ends as in MeloTTS.
        while (runs.find()) {
            String run = runs.group();
            char first = run.charAt(0);
            int punctuation = PUNCTUATION.indexOf(first);
            if (punctuation >= 0) {
                out[count] = 210 + punctuation;
                count += 2;
                continue;
            }
            if (first >= '0' && first <= '9') run = readNumber(run);
            else if (first >= 'A' && first <= 'Z') {
                StringBuilder spoken = new StringBuilder();
                for (int i = 0; i < run.length(); i++) spoken.append(LETTERS[run.charAt(i) - 'A']);
                run = spoken.toString();
            }
            for (int syllable : pronunciation(run)) {
                out[count] = 162 + syllable / 588;
                out[count + 2] = 181 + syllable / 28 % 21;
                count += 4;
                switch (syllable % 28) {
                    case 1: out[count] = 202; break;
                    case 4: out[count] = 203; break;
                    case 7: out[count] = 204; break;
                    case 8: out[count] = 205; break;
                    case 16: out[count] = 206; break;
                    case 17: out[count] = 207; break;
                    case 21: out[count] = 208; break;
                    default: continue;
                }
                count += 2;
            }
        }
        if (count == 3) throw new IllegalArgumentException("읽을 수 있는 글자가 없습니다");
        return Arrays.copyOf(out, count + 2);
    }

    private static String readNumber(String input) {
        if (input.length() > 8 || input.charAt(0) == '0') {
            StringBuilder digits = new StringBuilder();
            for (int i = 0; i < input.length(); i++) digits.append(DIGITS.charAt(input.charAt(i) - '0'));
            return digits.toString();
        }
        StringBuilder spoken = new StringBuilder();
        for (int offset = 0; offset < input.length(); offset++) {
            int digit = input.charAt(offset) - '0';
            int power = input.length() - offset - 1;
            if (digit != 0) {
                if (digit != 1 || power % 4 == 0) spoken.append(DIGITS.charAt(digit));
                spoken.append(new String[]{"", "십", "백", "천"}[power % 4]);
            }
            if (power == 4) spoken.append("만");
        }
        return spoken.toString();
    }

    private static int[] pronunciation(String word) {
        int[] sounds = new int[word.length()];
        for (int i = 0; i < word.length(); i++) sounds[i] = word.charAt(i) - HANGUL;
        for (int i = 0; i + 1 < sounds.length; i++) {
            int tail = sounds[i] % 28;
            if (tail == 0) continue;
            int lead = sounds[i + 1] / 588;
            int vowel = sounds[i + 1] / 28 % 21;
            int finalSound = FINALS[tail];
            if (lead == 11) {
                if ((tail == 7 || tail == 25) && vowel == 20) {
                    lead = tail == 7 ? 12 : 14;
                    finalSound = 0;
                } else if (tail == 27 || tail == 6 || tail == 15) {
                    finalSound = RETAINED[tail];
                } else if (LIAISON[tail] >= 0) {
                    lead = LIAISON[tail];
                    finalSound = RETAINED[tail];
                }
            } else if (lead == 18) {
                int aspirated = aspirate(LIAISON[tail]);
                if (aspirated >= 0) {
                    lead = aspirated;
                    finalSound = RETAINED[tail];
                }
            } else if (tail == 27 || tail == 6 || tail == 15) {
                int aspirated = aspirate(lead);
                if (aspirated >= 0) {
                    lead = aspirated;
                    finalSound = RETAINED[tail];
                }
            } else if (lead == 2 || lead == 6 || lead == 5) {
                if (finalSound == 1) finalSound = 21;
                if (finalSound == 7) finalSound = 4;
                if (finalSound == 17) finalSound = 16;
                if (lead == 5 && finalSound == 4) finalSound = 8;
                else if (lead == 5 && finalSound != 8) lead = 2;
                else if (lead == 2 && finalSound == 8) lead = 5;
            } else if (finalSound == 1 || finalSound == 7 || finalSound == 17) {
                switch (lead) {
                    case 0: lead = 1; break;
                    case 3: lead = 4; break;
                    case 7: lead = 8; break;
                    case 9: lead = 10; break;
                    case 12: lead = 13; break;
                    default: break;
                }
            }
            sounds[i] += finalSound - tail;
            sounds[i + 1] = lead * 588 + sounds[i + 1] % 588;
        }
        int last = sounds.length - 1;
        int tail = sounds[last] % 28;
        sounds[last] += FINALS[tail] - tail;
        return sounds;
    }

    private static int aspirate(int lead) {
        switch (lead) {
            case 0: return 15;
            case 3: return 16;
            case 7: return 17;
            case 12: return 14;
            default: return -1;
        }
    }
}
