(() => {
  window.__speechProbeSurvey = '';
  const report = (mode, result) => { window.__speechProbeSurvey += mode + ' ' + result + '\n'; };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const output = $('speechSampleStatus');
  const originalMode = cfg.voiceMode;
  const missingOnly = window.__speechProbeMissingOnly;
  const offlineKoreanOnly = window.__speechProbeOfflineKoreanOnly;
  const modes = [...$('voiceMode').options].map(option => option.value)
    .filter(mode => offlineKoreanOnly ? ['supertonicPhone', 'mimicPhone', 'meloPhone'].includes(mode)
      : !missingOnly || freeSpeechService(mode));
  let korean = '안녕하세요. 반갑습니다.';
  const prompt = '정확히 다음 한 문장만 답해 주세요: 안녕하세요. 반갑습니다.';
  const call = (url, headers, body) => speechRequest(
    id => Android.postJson(id, url, JSON.stringify(body), JSON.stringify(headers)), 35000);
  const contentHeaders = {'Content-Type':'application/json'};
  const gemma = async () => {
    const key = cfg.savedProviders.gemini?.apiKey || cfg.ttsKeys.gemini;
    if (!key) { report('chat', 'GEMMA_NO_KEY'); return; }
    const data = await call('https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent',
      {...contentHeaders, 'x-goog-api-key':key},
      {contents:[{parts:[{text:prompt}]}], generationConfig:{maxOutputTokens:80}});
    const reply = data.candidates?.[0]?.content?.parts?.find(part => part.text && !part.thought)?.text;
    if (reply?.trim()) { korean = reply.trim().slice(0, 40); report('chat', 'GEMMA_OK'); return; }
    const error = data.error || {};
    report('chat', 'GEMMA_' + (Number(error.code) || (error.status === 'RESOURCE_EXHAUSTED' ? 429 : 'NO_TEXT')));
    if (Number(error.code) !== 429 && error.status !== 'RESOURCE_EXHAUSTED') return;
    const openai = cfg.savedProviders.openai;
    if (!openai?.apiKey) { report('chat', 'OPENAI_NO_KEY'); return; }
    const backup = await call('https://api.openai.com/v1/chat/completions',
      {...contentHeaders, Authorization:'Bearer ' + openai.apiKey},
      {model:'gpt-4.1-mini',max_tokens:40,messages:[{role:'user',content:prompt}]});
    const text = backup.choices?.[0]?.message?.content;
    if (text?.trim()) korean = text.trim().slice(0, 40);
    report('chat', text?.trim() ? 'OPENAI_OK' : 'OPENAI_FAILED');
  };
  const prerequisite = mode => {
    const service = voiceKeyService(mode);
    if (service) return !cfg.ttsKeys?.[service] ? 'NO_KEY' : mode === 'cartesia' && !cfg.cartesiaFreeConfirm ? 'FREE_TIER_UNCONFIRMED' : '';
    return '';
  };
  (async () => {
    if (offlineKoreanOnly) {
      const expected = {supertonicPhone:'(완전무료)', mimicPhone:'(완전무료)', meloPhone:'(완전무료)',
        kokoroPhone:'(완전무료)', device:'(기기음성)', gemini:'(일일한도)',
        eleven:'(크레딧소진)', cartesia:'(크레딧소진)', 'ssfm-v31':'(크레딧소진)'};
      const correct = Object.entries(expected).every(([mode, label]) => {
        const badge = document.querySelector(`[data-mode="${mode}"] .voice-plan-badge`);
        return badge?.textContent === label &&
          (label !== '(완전무료)' || badge.classList.contains('voice-plan-offline'));
      });
      report('badges', correct ? 'OK' : 'INCORRECT');
      report('qwen-tts', document.querySelector('[data-mode="qwenPhone"]') ? 'PRESENT' : 'REMOVED');
    } else if (!missingOnly) await gemma();
    for (const mode of modes) {
      const missing = prerequisite(mode);
      if (missing) { report(mode, missing); continue; }
      cfg.voiceMode = mode;
      if (mode === 'device') {
        await say(korean, true);
        await sleep(1800);
        report(mode, Android.info().includes('tts=true') ? 'SYSTEM_TTS_REQUESTED' : 'SYSTEM_TTS_UNAVAILABLE');
        continue;
      }
      const started = performance.now();
      await say(mode === 'kokoroPhone' ? 'Hello. It is nice to meet you.' : korean, true);
      const generationTime = ((performance.now() - started) / 1000).toFixed(1);
      if (playingAudio && output.textContent.includes('재생 중')) {
        const audio = playingAudio;
        for (let i = 0; i < 60 && !audio.ended; i++) await sleep(200);
        const playback = audio.ended ? 'PLAYBACK_COMPLETE' : 'PLAYBACK_STARTED';
        report(mode, offlineKoreanOnly ? `${playback} generated=${generationTime}s audio=${audio.duration.toFixed(1)}s` : playback);
        continue;
      }
      const error = output.textContent;
      if (offlineKoreanOnly) { report(mode, error); continue; }
      const status = error.match(/\b(?:400|401|402|403|404|429|500|503)\b/)?.[0];
      report(mode, status ? 'HTTP_' + status : /무료|과금/.test(error) ? 'FREE_PLAN_CHECK' :
        /권한|목록/.test(error) ? 'VOICE_ACCESS' : /시간/.test(error) ? 'TIMEOUT' :
        /답 없음/.test(error) ? 'NO_AUDIO' : 'SYNTHESIS_FAILED');
    }
  })().catch(() => report('probe', 'UNEXPECTED_ERROR')).finally(() => {
    stopCurrentSpeech();
    cfg.voiceMode = originalMode;
    syncUI();
    window.__speechProbeComplete = true;
  });
  return 'started';
})()
