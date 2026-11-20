(async () => {
  const report = [];
  const emptyField = id => {
    const input = document.getElementById(id);
    return input.type === 'password' && input.value === '' && !input.disabled && !input.readOnly;
  };
  const storedKeys = [
    cfg.apiKey,
    ...Object.values(cfg.ttsKeys || {}),
    ...Object.values(cfg.savedProviders || {}).map(provider => provider.apiKey)
  ];
  report.push('SAVED_CREDENTIALS ' + (storedKeys.some(Boolean) ? 'PRESENT' : 'EMPTY'));
  report.push('CHAT_KEY ' + (emptyField('apiKey') ? 'EMPTY_EDITABLE' : 'FAILED'));
  if (window.__speechProbeApplyShareDefaults && Android.isShareBuild()) {
    if (cfg.persona !== '') {
      ui.persona.value = '';
      if (autoApply) ui.persona.dispatchEvent(new Event('input'));
      else document.getElementById('savePersona').click();
    }
    if (cfg.temp !== 1.8) {
      ui.temp.value = '1.8';
      ui.temp.dispatchEvent(new Event('input'));
    }
  }
  report.push('DEFAULTS ' + (cfg.provider === 'local-gemma' && cfg.persona === '' && cfg.temp === 1.8
    && document.getElementById('cloudApiSettings').disabled ? 'OK' : 'FAILED'));
  report.push('GEMINI_CHECKBOX ' + (document.getElementById('geminiFreeConfirm') ? 'PRESENT' : 'REMOVED'));

  const voiceMode = document.getElementById('voiceMode');
  const initial = voiceMode.value;
  for (const mode of ['gemini', 'eleven', 'ssfm-v31', 'cartesia']) {
    voiceMode.value = mode;
    syncSpeechSettings();
    report.push(mode + ' ' + (voiceMode.value === mode && emptyField('voiceApiKey') ? 'EMPTY_EDITABLE' : 'FAILED'));
  }
  voiceMode.value = initial;
  syncSpeechSettings();
  if (Android.localChatReady('local-gemma') && cfg.provider === 'local-gemma' && !cfg.apiKey) {
    const voice = cfg.voiceEnabled;
    cfg.voiceEnabled = false;
    await ask('대한민국의 수도는 어디인가요? 도시 이름만 말해 주세요.');
    cfg.voiceEnabled = voice;
    report.push('GEMMA_KEYLESS ' + (ui.botText.textContent.includes('서울') ? 'OK' : 'UNEXPECTED_REPLY'));
    resetConversation();
  } else {
    report.push('GEMMA_KEYLESS MODEL_NOT_READY');
  }
  window.__speechProbeSurvey = report.join('\n') + '\n';
  window.__speechProbeComplete = true;
})();
