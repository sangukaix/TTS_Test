(() => {
  const initial = {...cfg};
  const report = (name, passed) => {
    window.__speechProbeSurvey += name + ' ' + (passed ? 'OK' : 'FAILED') + '\n';
  };
  window.__speechProbeSurvey = '';
  (async () => {
    report('SAVE_CONTROLS_REMOVED', ['savePersona', 'applyVoiceMode', 'saveGeminiVoiceKey', 'saveEleven']
      .every(id => !$(id)));
    const samplePersona = '한국어 테스트 페르소나';
    ui.persona.value = samplePersona;
    ui.persona.dispatchEvent(new Event('input'));
    report('PERSONA_AUTO_APPLIED', cfg.persona === samplePersona
      && JSON.parse(localStorage.getItem(LS)).persona === samplePersona);
    $('voicePickerList').querySelector('[data-mode="supertonicPhone"]').click();
    report('ENGINE_AUTO_APPLIED', cfg.voiceMode === 'supertonicPhone'
      && JSON.parse(localStorage.getItem(LS)).voiceMode === 'supertonicPhone');
    report('LOCAL_VOICE_NOTE_HIDDEN', $('localSpeechSettings').hidden && !$('localSpeechNote').textContent);
    await say('안녕하세요. 테스트입니다.', true);
    const audio = playingAudio;
    for (let i = 0; audio && !audio.ended && i < 60; i++) await new Promise(resolve => setTimeout(resolve, 200));
    report('SUPERTONIC_PLAYBACK', audio?.ended);
  })().catch(() => report('PROBE_EXECUTION', false)).finally(() => {
    resetConversation();
    Object.assign(cfg, initial);
    save(); syncUI(); resetAvatar();
    $('personaStatus').textContent = '';
    $('speechSampleStatus').textContent = '';
    window.__speechProbeComplete = true;
  });
})();
