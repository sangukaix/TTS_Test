"""Korean pronunciation and tensor inputs matching the Android MeloTTS frontend."""

import re
import unicodedata

import numpy as np

RUNS = re.compile("[가-힣]+|[0-9]+|[A-Z]+|[!?…,.'-]")
LETTERS = "에이 비 씨 디 이 에프 지 에이치 아이 제이 케이 엘 엠 엔 오 피 큐 알 에스 티 유 브이 더블유 엑스 와이 제트".split()
DIGITS = "영일이삼사오육칠팔구"
PUNCTUATION = "!?…,.'-"
FINALS = (0, 1, 1, 1, 4, 4, 4, 7, 8, 1, 16, 8, 8, 8, 17, 8, 16, 17, 17, 7, 7, 21, 7, 7, 1, 7, 17, 7)
LIAISON = (-1, 0, 1, 9, 2, 12, 18, 3, 5, 0, 6, 7, 9, 16, 17, 18, 6, 7, 9, 9, 10, -1, 12, 14, 15, 16, 17, 18)
RETAINED = (0, 0, 0, 1, 0, 4, 4, 0, 0, 8, 8, 8, 8, 8, 8, 8, 0, 0, 17, 0, 0, 21, 0, 0, 0, 0, 0, 0)
FINAL_TOKENS = {1: 202, 4: 203, 7: 204, 8: 205, 16: 206, 17: 207, 21: 208}
ASPIRATE = {0: 15, 3: 16, 7: 17, 12: 14}
TENSE = {0: 1, 3: 4, 7: 8, 9: 10, 12: 13}


def read_number(digits):
    if len(digits) > 8 or digits[0] == "0":
        return "".join(DIGITS[int(digit)] for digit in digits)
    spoken = []
    for power, digit in zip(range(len(digits) - 1, -1, -1), map(int, digits)):
        if digit:
            if digit != 1 or power % 4 == 0:
                spoken.append(DIGITS[digit])
            spoken.append(("", "십", "백", "천")[power % 4])
        if power == 4:
            spoken.append("만")
    return "".join(spoken)


def pronunciation(word):
    syllables = [ord(char) - 0xAC00 for char in word]
    for i in range(len(syllables) - 1):
        tail = syllables[i] % 28
        if not tail:
            continue
        lead, remainder = divmod(syllables[i + 1], 588)
        vowel = remainder // 28
        final = FINALS[tail]
        if lead == 11:
            if tail in (7, 25) and vowel == 20:
                lead, final = (12 if tail == 7 else 14), 0
            elif tail in (27, 6, 15):
                final = RETAINED[tail]
            elif LIAISON[tail] >= 0:
                lead, final = LIAISON[tail], RETAINED[tail]
        elif lead == 18:
            if LIAISON[tail] in ASPIRATE:
                lead, final = ASPIRATE[LIAISON[tail]], RETAINED[tail]
        elif tail in (27, 6, 15):
            if lead in ASPIRATE:
                lead, final = ASPIRATE[lead], RETAINED[tail]
        elif lead in (2, 6, 5):
            final = {1: 21, 7: 4, 17: 16}.get(final, final)
            if lead == 5 and final == 4:
                final = 8
            elif lead == 5 and final != 8:
                lead = 2
            elif lead == 2 and final == 8:
                lead = 5
        elif final in (1, 7, 17):
            lead = TENSE.get(lead, lead)
        syllables[i] += final - tail
        syllables[i + 1] = lead * 588 + remainder
    tail = syllables[-1] % 28
    syllables[-1] += FINALS[tail] - tail
    return syllables


def tokens(text):
    result = [0, 0, 0]
    for word in RUNS.findall(unicodedata.normalize("NFKC", text).upper()):
        first = word[0]
        if first in PUNCTUATION:
            result.extend((210 + PUNCTUATION.index(first), 0))
            continue
        if "0" <= first <= "9":
            word = read_number(word)
        elif "A" <= first <= "Z":
            word = "".join(LETTERS[ord(char) - ord("A")] for char in word)
        for syllable in pronunciation(word):
            result.extend((162 + syllable // 588, 0, 181 + syllable // 28 % 21, 0))
            if syllable % 28 in FINAL_TOKENS:
                result.extend((FINAL_TOKENS[syllable % 28], 0))
    if len(result) == 3:
        raise ValueError("읽을 수 있는 글자가 없습니다.")
    result.extend((0, 0))
    if len(result) > 1600:
        raise ValueError("MeloTTS로 읽을 문장을 줄여 주세요.")
    return result


def synthesize(engine, text, speed):
    ids = tokens(text)
    count = len(ids)
    tones = np.zeros((1, count), dtype=np.int64)
    languages = np.zeros((1, count), dtype=np.int64)
    tones[:, 1::2] = 11
    languages[:, 1::2] = 4
    inputs = {
        "x": np.array([ids], dtype=np.int64), "x_lengths": np.array([count], dtype=np.int64),
        "sid": np.array([0], dtype=np.int64), "tone": tones, "language": languages,
        "bert": np.zeros((1, 1024, count), dtype=np.float32),
        "ja_bert": np.zeros((1, 768, count), dtype=np.float32),
        "noise_scale": np.array(.6, dtype=np.float32),
        "length_scale": np.array(1 / speed, dtype=np.float32),
        "noise_scale_w": np.array(.8, dtype=np.float32),
        "sdp_ratio": np.array(.2, dtype=np.float32),
    }
    return engine.run(["audio"], inputs)[0], 44100
