(() => {
  window.__speechProbeSurvey = '';
  const report = (model, result) => { window.__speechProbeSurvey += model + ' ' + result + '\n'; };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const previous = {...cfg};
  (async () => {
    for (const provider of ['local-gemma', 'local-qwen']) {
      resetConversation();
      Object.assign(cfg, {
        provider, apiKey:'', baseUrl:'', model:localProviders[provider].model, voiceMode:'supertonicPhone',
        voiceEnabled:true, persona:'한국어로 이야기하는 친절한 아바타입니다.', temp:0, maxTokens:64, turns:0
      });
      syncUI();
      if (!$('cloudApiSettings').disabled || !Android.localChatReady(provider)) {
        report(provider, 'NOT_READY');
        continue;
      }
      const start = performance.now();
      await ask('대한민국의 수도를 한국어로 한 문장으로 말해 주세요.');
      const answer = ui.botText.textContent;
      if (!answer.includes('서울')) {
        report(provider, 'TEXT_FAILED ' + (answer === '…' ? ui.status.textContent : 'UNEXPECTED_ANSWER'));
        continue;
      }
      const seconds = ((performance.now() - start) / 1000).toFixed(2);
      report(provider, 'KOREAN_TEXT_OK ' + seconds + 's');
      for (let i = 0; i < 90 && !playingAudio?.ended; i++) await sleep(200);
      report(provider, playingAudio?.ended ? 'OFFLINE_TTS_COMPLETE' : 'OFFLINE_TTS_UNVERIFIED');
    }
  })().catch(() => report('probe', 'UNEXPECTED_ERROR')).finally(() => {
    resetConversation();
    Object.assign(cfg, previous);
    syncUI();
    window.__speechProbeComplete = true;
  });
  return 'started';
})()
