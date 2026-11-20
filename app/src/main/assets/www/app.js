/* 나와 대화하는 아바타
 * persona -> avatar -> STT(나) -> LLM -> TTS(아바타)
 * Android WebView(window.Android bridge)에서는 네이티브 STT/TTS,
 * 브라우저에서는 Web Speech API를 쓴다.
 */
'use strict';

const $ = (id) => document.getElementById(id);
const bridge = window.Android || null;
const desktop = document.documentElement.hasAttribute('data-avatar-desktop');
const shareAndroid = bridge?.isShareBuild?.() === true;
const autoApply = desktop || shareAndroid;

/* ---------- settings ---------- */
const LS = 'avatar-chat-settings';
const defaults = {
  persona: '', temp: 1.8, maxTokens: 160, topP: 0.9, rate: 1.0, pitch: 1.0,
  baseUrl: bridge || desktop ? '' : 'https://api.openai.com/v1',
  apiKey: '', model: bridge || desktop ? 'Gemma 4 E2B' : 'gpt-4o-mini',
  provider: bridge || desktop ? 'local-gemma' : 'openai',
  turns: 3, voiceEnabled: true, voiceMode: 'device', style: '3D'
};
let cfg = { ...defaults };
try { Object.assign(cfg, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) {}
const save = () => localStorage.setItem(LS, JSON.stringify(cfg));
if (!cfg.defaultsUpdated) {
  if (cfg.persona === '너는 고양이야. 귀엽고 장난스러운 말투로 짧게 답해.') cfg.persona = defaults.persona;
  if (cfg.temp === 0.7) cfg.temp = defaults.temp;
  if (shareAndroid && cfg.provider === 'openai' && cfg.model === 'gpt-4o-mini' && !cfg.apiKey) {
    Object.assign(cfg, {provider:defaults.provider, model:defaults.model, baseUrl:defaults.baseUrl});
  }
  cfg.defaultsUpdated = true;
  save();
}
if (desktop && !cfg.desktopLocalEnabled) {
  if (cfg.provider === 'openai' && !cfg.apiKey) {
    Object.assign(cfg, {provider:defaults.provider, model:defaults.model, baseUrl:defaults.baseUrl});
  }
  cfg.desktopLocalEnabled = true;
  save();
}
if ('voice' in cfg) {
  delete cfg.voice;
  save();
}
if (['fish', 'ai'].includes(cfg.voiceMode) || 'fishKey' in cfg) {
  if (['fish', 'ai'].includes(cfg.voiceMode)) cfg.voiceMode = 'device';
  delete cfg.fishKey;
  save();
}
const geminiModes = new Set(['gemini', 'gemini38', 'gemini31']);
const elevenModels = {eleven:'eleven_v4', eleven3:'eleven_v3', eleven2:'eleven_multilingual_v2', elevenFlash:'eleven_flash_v2_5'};
const pcModes = new Set(['kokoro', 'supertonic', 'qwen', 'openvoice', 'qwenDesign']);
const phoneModes = new Set(['supertonicPhone', 'mimicPhone', 'kokoroPhone', 'meloPhone']);
const oldVoiceModes = {kokoro:'kokoroPhone', supertonic:'supertonicPhone', qwenPhone:'supertonicPhone'};
if (oldVoiceModes[cfg.voiceMode] || ((bridge || desktop) && pcModes.has(cfg.voiceMode))) {
  cfg.voiceMode = oldVoiceModes[cfg.voiceMode] || 'device';
  save();
}
if (bridge || desktop) {
  document.querySelectorAll('#voiceMode [data-preview]').forEach(group => group.remove());
}
if (!bridge && !desktop) {
  const deviceVoice = $('voiceMode').querySelector('[value="device"]');
  deviceVoice.textContent = '브라우저 기본 음성';
  deviceVoice.parentElement.label = '운영체제';
}
function voiceChoice(mode, label) {
  const badge = document.createElement('span');
  badge.className = 'voice-plan-badge';
  if (phoneModes.has(mode) || pcModes.has(mode)) {
    badge.classList.add('voice-plan-offline');
    badge.textContent = '(완전무료)';
  } else if (geminiModes.has(mode)) {
    badge.textContent = '(일일한도)';
  } else if (elevenModels[mode] || freeSpeechService(mode)) {
    badge.textContent = '(크레딧소진)';
  } else {
    badge.classList.add('voice-plan-device');
    badge.textContent = '(기기음성)';
  }
  return [badge, document.createTextNode(' ' + label)];
}
function syncVoicePicker() {
  const select = $('voiceMode');
  $('voicePickerCurrent').replaceChildren(...voiceChoice(select.value, voiceLabel(select.value)));
  for (const button of $('voicePickerList').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === select.value));
  }
}
function buildVoicePicker() {
  const list = $('voicePickerList');
  for (const group of $('voiceMode').querySelectorAll('optgroup')) {
    const section = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'voice-provider-label';
    title.textContent = group.label;
    section.append(title);
    for (const option of group.querySelectorAll('option')) {
      if (!bridge && !desktop && ['mimicPhone', 'meloPhone'].includes(option.value)) option.disabled = true;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.mode = option.value;
      button.disabled = option.disabled;
      button.append(...voiceChoice(option.value, option.textContent + (option.disabled ? ' · Android 앱' : '')));
      button.addEventListener('click', () => {
        const select = $('voiceMode');
        select.value = option.value;
        select.dispatchEvent(new Event('change'));
        $('voicePicker').open = false;
        $('voicePickerCurrent').focus();
      });
      section.append(button);
    }
    list.append(section);
  }
}

const koreanSpeechSample = '안녕하세요. 오늘은 여러 가지 목소리를 비교해 볼까요?';
const englishSpeechSample = 'Hello! Shall we compare how these voices sound?';
const isTypecast = mode => /^ssfm-v(31|30|21)$/.test(mode);
const freeSpeechService = mode => isTypecast(mode) ? 'typecast' : mode === 'cartesia' ? 'cartesia' : null;
const voiceKeyService = mode => geminiModes.has(mode) ? 'gemini' : elevenModels[mode] ? 'eleven' : freeSpeechService(mode);
const voiceKeyLabels = {gemini:'Gemini', eleven:'ElevenLabs', typecast:'타입캐스트', cartesia:'Cartesia'};
function voiceLabel(mode) {
  return [...$('voiceMode').options].find(option => option.value === mode)?.textContent || mode;
}
const providers = { openai: {baseUrl:'https://api.openai.com/v1', model:'gpt-4o-mini'}, gemini: {baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai', model:'gemini-3.5-flash-lite'}, exaone: {baseUrl:'https://api.exaone.ai/v1', model:'k-exaone_v2.5'} };
const localProviders = {
  'local-gemma': {baseUrl:'', model:'Gemma 4 E2B'},
  'local-qwen': {baseUrl:'', model:'Qwen3.5 2B'}
};
Object.assign(providers, localProviders);
const isLocalProvider = provider => Object.hasOwn(localProviders, provider);
if (!Object.hasOwn(providers, cfg.provider)) Object.assign(cfg, {
  provider:defaults.provider, model:defaults.model, baseUrl:defaults.baseUrl, apiKey:''
});
cfg.savedProviders ||= {};
cfg.ttsKeys ||= {};
if (!cfg.singleKeysMigrated) {
  const previousProfiles = cfg.keyProfiles || {};
  const selected = cfg.selectedProfiles || {};
  const speechProfile = previousProfiles.gemini?.find(item => item.id === (cfg.ttsGeminiProfile || selected.gemini));
  if (speechProfile?.apiKey) cfg.ttsKeys.gemini ||= speechProfile.apiKey;
  if (cfg.elevenKey) cfg.ttsKeys.eleven ||= cfg.elevenKey;
  for (const provider of Object.keys(providers)) {
    if (isLocalProvider(provider)) continue;
    const profile = previousProfiles[provider]?.find(item => item.id === selected[provider]);
    if (profile) cfg.savedProviders[provider] = {apiKey:profile.apiKey, model:profile.model};
    else if (Object.hasOwn(previousProfiles, provider)) delete cfg.savedProviders[provider];
    if (cfg.provider === provider && cfg.apiKey) {
      cfg.savedProviders[provider] = {apiKey:cfg.apiKey, model:cfg.model};
    }
  }
  for (const key of ['keyProfiles', 'selectedProfiles', 'ttsGeminiProfile', 'elevenKey']) delete cfg[key];
  cfg.singleKeysMigrated = true;
  save();
}
cfg.apiKey = isLocalProvider(cfg.provider) ? '' : cfg.savedProviders[cfg.provider]?.apiKey || '';
function storeChatSettings(key, model) {
  cfg.apiKey = key;
  cfg.model = model || providers[cfg.provider].model;
  const saved = cfg.savedProviders[cfg.provider] = {model:cfg.model};
  if (key) saved.apiKey = key;
  $('clearApi').disabled = !key;
  save();
  showAppliedSettings();
}
let localModelPoll;
let desktopStatusRequest = 0;
async function desktopRequest(route, body) {
  try {
    const response = await fetch(route, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
    });
    return await response.json();
  } catch {
    return {error:{message:'Windows 앱 실행 창을 확인해 주세요.'}};
  }
}
function showLocalModelStatus(state) {
  const button = $('installLocalModel');
  button.hidden = state.ready || !state.available;
  button.disabled = Boolean(state.active);
  button.textContent = state.active ? '다운로드 중…' : '모델 다운로드 · ' + state.size;
  $('apiStatus').textContent = state.ready
    ? ''
    : state.error?.message || state.message || '이 로컬 모델을 실행하려면 모델 파일을 준비해 주세요.';
  if (state.active) localModelPoll = setTimeout(syncApiFields, 1000);
}
function syncApiFields() {
  clearTimeout(localModelPoll);
  const request = ++desktopStatusRequest;
  const local = isLocalProvider(cfg.provider);
  $('cloudApiSettings').disabled = local;
  $('clearApi').disabled = !cfg.apiKey;
  $('installLocalModel').hidden = true;
  if (!local) return;
  $('apiStatus').textContent = '';
  if (desktop) {
    desktopRequest('/local/model/status', {provider:cfg.provider}).then(state => {
      if (request === desktopStatusRequest) showLocalModelStatus(state);
    });
    return;
  }
  if (!bridge) {
    $('apiStatus').textContent = '로컬 대화 모델은 Android 앱에서 실행합니다.';
    return;
  }
  if (bridge.localChatReady?.(cfg.provider)) {
    showLocalModelStatus({ready:true});
    return;
  }
  showLocalModelStatus(JSON.parse(bridge.localModelStatus?.(cfg.provider) || '{}'));
}
$('installLocalModel').addEventListener('click', async () => {
  if (desktop) {
    const provider = cfg.provider;
    $('installLocalModel').disabled = true;
    const state = await desktopRequest('/local/model/download', {provider});
    if (provider === cfg.provider) {
      if (state.error) {
        $('installLocalModel').disabled = false;
        $('apiStatus').textContent = state.error.message;
      } else syncApiFields();
    }
    return;
  }
  bridge?.startLocalModelDownload?.(cfg.provider);
  syncApiFields();
});
const modelOptions = {
  openai: [['gpt-4o-mini','GPT-4o mini'], ['gpt-4.1-mini','GPT-4.1 mini'], ['gpt-4.1','GPT-4.1']],
  gemini: [['gemini-3.5-flash-lite','Gemini 3.5 Flash-Lite'], ['gemini-3.6-flash','Gemini 3.6 Flash'], ['gemini-3.8-flash','Gemini 3.8 Flash']],
  exaone: [['k-exaone_v2.5','K-EXAONE 2.5']]
};
function populateModels(provider, value) {
  const select = $('modelChoice');
  select.replaceChildren();
  if (isLocalProvider(provider)) { select.add(new Option(value, value)); return; }
  for (const [id, label] of modelOptions[provider]) select.add(new Option(label, id));
  select.add(new Option('직접 입력', '__custom__'));
  select.value = modelOptions[provider].some(([id]) => id === value) ? value : '__custom__';
}


const ui = {
  persona: $('persona'), temp: $('temp'), maxTokens: $('maxTokens'), topP: $('topP'),
  rate: $('rate'), pitch: $('pitch'), baseUrl: $('baseUrl'), apiKey: $('apiKey'),
  model: $('model'), micBtn: $('micBtn'), micHint: $('micHint'), micIcon: $('micIcon'),
  sendBtn: $('sendBtn'), askInput: $('askInput'), meText: $('meText'), botText: $('botText'),
  botName: $('botName'), status: $('status'), avatarName: $('avatarName'), canvas: $('avatar'),
  regenBtn: $('regenBtn'), clearBtn: $('clearBtn'), style: $('style')
};

let lastVoiceStatus = '아직 재생 전';
let voiceLoading = false;
function syncActivityIndicator() {
  const label = thinking ? 'AI 답변 생성 중…' : voiceLoading ? '음성 생성 중…' : '';
  $('chatActivityLabel').textContent = label;
  $('chatActivity').hidden = !label;
}
function setVoiceLoading(loading) {
  voiceLoading = loading;
  syncActivityIndicator();
}
function showAppliedSettings() {
  const names = {openai:'OpenAI', gemini:'Gemini', exaone:'EXAONE'};
  const mode = cfg.voiceMode || defaults.voiceMode;
  const chat = isLocalProvider(cfg.provider) ? '(로컬) ' + localProviders[cfg.provider].model
    : cfg.apiKey ? (names[cfg.provider] || cfg.provider) + ' · ' + cfg.model
      : desktop ? 'API 키 미입력' : '로컬 데모 (API 키 없음)';
  const voice = cfg.voiceEnabled === false ? '텍스트 전용' : voiceLabel(mode) + ' (' + lastVoiceStatus + ')';
  const persona = (cfg.persona || '').replace(/\s+/g, ' ').trim();
  const characters = Array.from(persona);
  const briefPersona = characters.length > 15 ? characters.slice(0, 14).join('') + '…' : (persona || '없음');
  $('currentChatModel').textContent = chat;
  $('currentVoiceModel').textContent = voice;
  $('currentPersona').textContent = briefPersona;
}
const numFields = ['temp', 'maxTokens', 'topP', 'rate', 'pitch', 'turns'];
ui.turns = $('turns');
const usageKey = 'avatar-chat-usage-v1';
function refreshUsage() {
  let entries = []; try { entries = JSON.parse(localStorage.getItem(usageKey) || '[]').filter(x => x.t > Date.now()-3600000); } catch(e) {}
  const input = entries.reduce((a,x)=>a+x.input,0), output = entries.reduce((a,x)=>a+x.output,0);
  try { localStorage.setItem(usageKey, JSON.stringify(entries)); } catch(e) {}
}
function recordUsage(u) {
  if (!u || !Number.isFinite(Number(u.prompt_tokens)) || !Number.isFinite(Number(u.completion_tokens))) return;
  try { const list = JSON.parse(localStorage.getItem(usageKey) || '[]').filter(x=>x.t>Date.now()-3600000); list.push({t:Date.now(),input:Number(u.prompt_tokens),output:Number(u.completion_tokens)}); localStorage.setItem(usageKey,JSON.stringify(list)); refreshUsage(); } catch(e) {}
}
refreshUsage(); setInterval(refreshUsage, 60000);
function syncTextOnly() {
  const disabled = cfg.voiceEnabled === false;
  $('textOnly').checked = disabled;
  const settings = $('speechSettings');
  settings.disabled = disabled;
  settings.inert = disabled;
  for (const summary of settings.querySelectorAll('summary')) {
    if (disabled) summary.tabIndex = -1;
    else summary.removeAttribute('tabindex');
  }
  for (const slider of [ui.rate, ui.pitch]) {
    slider.disabled = disabled;
    slider.parentElement.classList.toggle('speech-slider-disabled', disabled);
  }
  prepareDesktopMelo();
}
let meloPreparation;
function prepareDesktopMelo() {
  if (!desktop || meloPreparation || cfg.voiceEnabled === false || cfg.voiceMode !== 'meloPhone') return;
  meloPreparation = desktopRequest('/local/tts/prepare', {}).then(result => {
    if (!result.ready) meloPreparation = null;
  });
}
$('textOnly').addEventListener('change', () => {
  cfg.voiceEnabled = !$('textOnly').checked;
  if (!cfg.voiceEnabled) {
    stopCurrentSpeech();
    $('voicePicker').open = false;
    $('speechSampleStatus').textContent = '';
  }
  syncTextOnly();
  save(); lastVoiceStatus = '아직 재생 전'; showAppliedSettings();
});
function syncUI() {
  ui.persona.value = cfg.persona;
  syncTextOnly();
  for (const k of numFields) { ui[k].value = cfg[k]; ui[k].parentElement.querySelector('output').value = cfg[k]; }
  $('provider').value = cfg.provider; ui.baseUrl.value = cfg.baseUrl; ui.apiKey.value = cfg.apiKey; ui.model.value = cfg.model; populateModels(cfg.provider, cfg.model);
  syncApiFields();
  $('voiceMode').value = cfg.voiceMode || defaults.voiceMode; syncSpeechSettings();
  ui.style.value = cfg.style; showAppliedSettings();
}
for (const k of numFields) {
  ui[k].addEventListener('input', () => {
    cfg[k] = Number(ui[k].value);
    ui[k].parentElement.querySelector('output').value = cfg[k];
    save(); applyVoice();
  });
}
$('provider').addEventListener('change', () => {
  const provider = $('provider').value;
  if (provider !== cfg.provider && (isLocalProvider(provider) || isLocalProvider(cfg.provider))) resetConversation();
  $('avatarNotice').textContent = '';
  const saved = isLocalProvider(provider) ? null : cfg.savedProviders[provider];
  cfg.provider = provider;
  ui.baseUrl.value = cfg.baseUrl = providers[provider].baseUrl;
  ui.apiKey.value = cfg.apiKey = saved?.apiKey || '';
  ui.model.value = cfg.model = saved?.model || providers[provider].model;
  populateModels(provider, cfg.model);
  syncApiFields();
  save();
  showAppliedSettings();
  if (!isLocalProvider(provider)) $('apiStatus').textContent = cfg.apiKey ? '저장된 키를 불러왔습니다.' : '';
});
$('modelChoice').addEventListener('change', () => {
  if ($('modelChoice').value === '__custom__') {
    ui.model.value = '';
    ui.model.focus();
    return;
  }
  ui.model.value = $('modelChoice').value;
  storeChatSettings(cfg.apiKey, ui.model.value);
});
ui.model.addEventListener('input', () => {
  const model = ui.model.value.trim();
  populateModels(cfg.provider, model);
  storeChatSettings(cfg.apiKey, model);
});
ui.apiKey.addEventListener('input', () => {
  storeChatSettings(ui.apiKey.value.trim(), cfg.model);
  $('apiStatus').textContent = cfg.apiKey ? '키를 자동 저장했습니다.' : '';
});
$('clearApi').addEventListener('click', () => {
  ui.apiKey.value = '';
  storeChatSettings('', cfg.model);
  $('apiStatus').textContent = '키를 삭제했습니다.';
});
function syncSpeechSettings() {
  const mode = $('voiceMode').value;
  const service = freeSpeechService(mode);
  const keyService = voiceKeyService(mode);
  $('voiceKeySettings').hidden = !keyService;
  $('voiceKeyLabel').textContent = keyService ? voiceKeyLabels[keyService] + ' API 키' : 'API 키';
  $('voiceApiKey').value = cfg.ttsKeys[keyService] || '';
  $('clearVoiceKey').disabled = !$('voiceApiKey').value;
  $('elevenSettings').hidden = !elevenModels[mode];
  $('freeSpeechSettings').hidden = !service;
  $('typecastCreditRow').hidden = service !== 'typecast';
  $('cartesiaConfirmation').hidden = service !== 'cartesia';
  $('cartesiaFreeConfirm').checked = cfg.cartesiaFreeConfirm === true;
  $('freeSpeechNote').textContent = service === 'typecast'
    ? '월 15,000 크레딧 · 무료 플랜 전용 · 비상업적 사용 · 음성 제공: 타입캐스트'
    : '월 20,000 크레딧 · 계정 잔여량은 Cartesia 대시보드에서 확인';
  const laptopPreview = !bridge && !desktop && (pcModes.has(mode) || ['supertonicPhone', 'kokoroPhone'].includes(mode));
  $('localSpeechSettings').hidden = !laptopPreview;
  $('localSpeechNote').textContent = laptopPreview ? '이 미리보기에서는 노트북이 읽습니다.' : '';
  syncVoicePicker();
  if (autoApply) updateAutoVoiceStatus(mode);
}
function voiceSetupMessage(mode) {
  const service = voiceKeyService(mode);
  if (service && !cfg.ttsKeys[service]) return voiceKeyLabels[service] + ' API 키를 입력해 주세요.';
  if (service === 'cartesia' && !cfg.cartesiaFreeConfirm) return 'Cartesia 무료 플랜 여부를 확인해 주세요.';
  return '';
}
function updateAutoVoiceStatus(mode) {
  $('voiceApplyStatus').textContent = voiceSetupMessage(mode) || '자동 적용됨';
}
$('voiceMode').addEventListener('change', () => {
  syncSpeechSettings();
  const mode = $('voiceMode').value;
  if (autoApply) {
    applyVoiceSelection(mode);
    return;
  }
  $('voiceApplyStatus').textContent = mode === cfg.voiceMode ? '현재 적용 중' : '저장 및 적용을 눌러 주세요.';
  if (elevenModels[mode]) refreshElevenCredits();
  if (isTypecast(mode)) refreshTypecastCredits();
});
function applyManualVoiceSettings() {
  const mode = $('voiceMode').value;
  const setup = voiceSetupMessage(mode);
  if (setup) {
    $('voiceApplyStatus').textContent = setup;
    return;
  }
  applyVoiceSelection(mode);
}
function applyVoiceSelection(mode) {
  const setup = autoApply ? voiceSetupMessage(mode) : '';
  stopCurrentSpeech();
  cfg.voiceMode = mode; save(); applyVoice(); prepareDesktopMelo();
  if (['', koreanSpeechSample, englishSpeechSample].includes($('speechSample').value)) {
    $('speechSample').value = mode.startsWith('kokoro') ? englishSpeechSample : koreanSpeechSample;
  }
  $('speechSampleStatus').textContent = '';
  lastVoiceStatus = setup ? '설정 필요' : '아직 재생 전'; showAppliedSettings();
  $('voiceApplyStatus').textContent = autoApply ? setup || '자동 적용됨' : '저장하고 적용했습니다.';
  if (elevenModels[mode]) refreshElevenCredits();
  if (isTypecast(mode)) refreshTypecastCredits();
}
if (autoApply) $('applyVoiceMode').remove();
else $('applyVoiceMode').addEventListener('click', applyManualVoiceSettings);

function storeVoiceKey() {
  const mode = $('voiceMode').value;
  const service = voiceKeyService(mode);
  const key = $('voiceApiKey').value.trim();
  if (!service || key === (cfg.ttsKeys[service] || '')) return;
  if (key) cfg.ttsKeys[service] = key;
  else delete cfg.ttsKeys[service];
  if (service === 'cartesia') {
    cfg.cartesiaFreeConfirm = false;
    $('cartesiaFreeConfirm').checked = false;
  }
  if (service === voiceKeyService(cfg.voiceMode)) {
    stopCurrentSpeech();
    $('speechSampleStatus').textContent = '';
    lastVoiceStatus = voiceSetupMessage(cfg.voiceMode) ? '설정 필요' : '아직 재생 전';
    showAppliedSettings();
  }
  save();
  $('clearVoiceKey').disabled = !key;
  const creditMessage = key ? '새로고침으로 확인' : 'API 키를 입력한 후 조회';
  if (service === 'eleven') $('elevenCredits').textContent = 'ElevenLabs 크레딧: ' + creditMessage;
  if (service === 'typecast') $('typecastCredits').textContent = '타입캐스트 크레딧: ' + creditMessage;
  $('voiceApplyStatus').textContent = key ? voiceSetupMessage(mode) || '키를 자동 저장했습니다.' : '키를 삭제했습니다.';
}
$('voiceApiKey').addEventListener('input', storeVoiceKey);
$('voiceApiKey').addEventListener('change', () => {
  storeVoiceKey();
  const service = voiceKeyService($('voiceMode').value);
  if (service === 'eleven') refreshElevenCredits();
  if (service === 'typecast') refreshTypecastCredits();
});
$('clearVoiceKey').addEventListener('click', () => {
  $('voiceApiKey').value = '';
  storeVoiceKey();
});
$('cartesiaFreeConfirm').addEventListener('change', () => {
  cfg.cartesiaFreeConfirm = $('cartesiaFreeConfirm').checked;
  if (autoApply) applyVoiceSelection($('voiceMode').value);
  else save();
});
$('playSpeechSample').addEventListener('click', () => {
  const sentence = $('speechSample').value.trim();
  if (readySpeech?.sample && readySpeech.text === sentence) {
    readySpeech.play();
    return;
  }
  if (sentence) say(sentence, true);
});
$('playReadySpeech').addEventListener('click', () => readySpeech?.play());
async function refreshTypecastCredits() {
  const key = cfg.ttsKeys?.typecast;
  const status = $('typecastCredits');
  if (!key || (!desktop && !bridge?.typecastCredits)) {
    status.textContent = '타입캐스트 크레딧: API 키를 입력한 후 조회';
    return;
  }
  status.textContent = '타입캐스트 크레딧 조회 중…';
  const result = desktop ? await desktopRequest('/speech/typecast/credits', {key})
    : await speechRequest(id => bridge.typecastCredits(id, key));
  if (key !== cfg.ttsKeys?.typecast) return;
  status.textContent = result.error ? '타입캐스트 크레딧: 조회 실패'
    : result.free ? '타입캐스트 잔여 크레딧: ' + result.remaining.toLocaleString() + ' / ' + result.limit.toLocaleString()
    : '타입캐스트: 무료 플랜에서만 사용 가능';
}
$('refreshTypecast').addEventListener('click', refreshTypecastCredits);
// Discard previously stored manual voice IDs when upgrading.
if ('elevenVoice' in cfg || 'elevenCatVoice' in cfg || 'elevenToughVoice' in cfg) {
  delete cfg.elevenVoice; delete cfg.elevenCatVoice; delete cfg.elevenToughVoice; save();
}
function chooseElevenVoice(voices, persona) {
  const p = persona.toLowerCase();
  const female = /여성|여자|소녀|고양이|귀여|밝은|female|woman|cat/.test(p);
  const male = /남성|남자|깡패|건달|조폭|낮은 목소리|male|man|gangster/.test(p);
  const preferFemale = female && !male, preferMale = male && !female;
  const scored = voices.filter(v => v && /^[A-Za-z0-9_-]{1,100}$/.test(v.voice_id || '')).map(v => {
    const meta = (v.name + ' ' + (v.description || '') + ' ' + JSON.stringify(v.labels || {})).toLowerCase();
    let score = /korean|한국|ko-kr/.test(meta) ? 5 : 0;
    if (preferFemale && /female|woman|여성|여자/.test(meta)) score += 3;
    if (preferMale && /male|man|남성|남자/.test(meta) && !/female|woman/.test(meta)) score += 3;
    if (/깡패|건달|조폭|거친|gangster/.test(p) && /rough|raspy|deep|gravel|harsh/.test(meta)) score += 2;
    if (/고양이|귀여|밝은|cat/.test(p) && /bright|playful|cheerful|warm/.test(meta)) score += 2;
    return {v, score};
  }).sort((a,b) => b.score - a.score);
  return scored[0]?.v || null;
}
function requestElevenVoices(key) {
  if (desktop) return desktopRequest('/speech/eleven/voices', {key});
  return new Promise(resolve => {
    const id = 'r' + (++reqSeq), timer = setTimeout(() => { if (pending[id]) { delete pending[id]; resolve({error:{message:'음성 목록 확인 시간 초과'}}); } }, 30000);
    pending[id] = result => { clearTimeout(timer); resolve(result); };
    try { bridge.getElevenVoices(id, key); }
    catch(e) { clearTimeout(timer); delete pending[id]; resolve({error:{message:e.message}}); }
  });
}
function refreshElevenCredits() {
  const display = $('elevenCredits');
  if (!cfg.ttsKeys.eleven) { display.textContent = 'ElevenLabs 크레딧: API 키를 입력해 주세요.'; return; }
  if (!desktop && !bridge?.getElevenCredits) { display.textContent = 'ElevenLabs 크레딧: 휴대폰 앱에서 확인할 수 있습니다.'; return; }
  display.textContent = 'ElevenLabs 크레딧 확인 중…';
  const key = cfg.ttsKeys.eleven;
  const show = result => {
    if (key !== cfg.ttsKeys.eleven) return;
    if (result.error) { display.textContent = 'ElevenLabs 크레딧: 확인 실패 (' + result.error.message + ')'; return; }
    if (!Number.isFinite(result.used) || !Number.isFinite(result.limit)) { display.textContent = 'ElevenLabs 크레딧: 계정에서 정보를 제공하지 않았습니다.'; return; }
    display.textContent = 'ElevenLabs 남은 크레딧: ' + Math.max(0, result.limit - result.used).toLocaleString() + ' / ' + result.limit.toLocaleString();
  };
  if (desktop) {
    desktopRequest('/speech/eleven/credits', {key}).then(show);
    return;
  }
  const id = 'r' + (++reqSeq);
  const timer = setTimeout(() => {
    if (!pending[id]) return;
    delete pending[id];
    if (key === cfg.ttsKeys.eleven) display.textContent = 'ElevenLabs 크레딧: 확인 시간 초과';
  }, 30000);
  pending[id] = result => {
    clearTimeout(timer);
    show(result);
  };
  try { bridge.getElevenCredits(id, key); }
  catch(e) { clearTimeout(timer); delete pending[id]; display.textContent = 'ElevenLabs 크레딧: 확인 실패'; }
}
$('refreshCredits').addEventListener('click', refreshElevenCredits);
function applyPersona() {
  if (autoApply && cfg.persona === ui.persona.value) return;
  cfg.persona = ui.persona.value; save();
  resetConversation(); resetAvatar();
  lastVoiceStatus = '아직 재생 전'; showAppliedSettings();
  $('personaStatus').textContent = autoApply ? '자동 적용됨 · 이전 대화 초기화' : '저장하고 적용했습니다. 이전 대화를 초기화했습니다.';
  ui.status.textContent = '새 페르소나가 적용되었습니다.';
}
if (autoApply) {
  $('savePersona').remove();
  ui.persona.addEventListener('input', event => { if (!event.isComposing) applyPersona(); });
  ui.persona.addEventListener('compositionend', applyPersona);
} else {
  ui.persona.addEventListener('input', () => { $('personaStatus').textContent = '저장하면 적용됩니다.'; });
  $('savePersona').addEventListener('click', applyPersona);
}
ui.style.addEventListener('change', () => { cfg.style = ui.style.value; save(); resetAvatar(); });

/* ---------- persona -> tone ---------- */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function tone() {
  const p = cfg.persona.toLowerCase();
  const t = { rate: cfg.rate, pitch: cfg.pitch, name: '아바타' };
  if (/고양이|猫|cat/.test(p)) { t.pitch += 0.35; t.rate += 0.1; t.name = '고양이 아바타'; }
  else if (/강아지|개|dog/.test(p)) { t.pitch += 0.15; t.name = '강아지 아바타'; }
  else if (/할머니|OLDER|할아버지|grandma|grandpa/.test(p)) { t.pitch -= 0.25; t.rate -= 0.15; t.name = '어르신 아바타'; }
  else if (/ robot|로봇|android/.test(p)) { t.pitch -= 0.1; t.rate += 0.05; t.name = '로봇 아바타'; }
  else if (/child|아이|어린이|young/.test(p)) { t.pitch += 0.4; t.rate += 0.1; t.name = '아이 아바타'; }
  return t;
}

/* ---------- avatar from persona (canvas 2D/3D) ---------- */
function spec() {
  const h = hash(cfg.persona || 'avatar');
  const hue = h % 360;
  return {
    style: cfg.style || '3D',
    hue, sat: 30 + (h >> 9) % 45, light: 55 + (h >> 15) % 25,
    eyes: (h >> 5) % 3, ears: (h >> 7) % 3, mouth: (h >> 11) % 3,
    glasses: ((h >> 13) % 2) === 1, hat: ((h >> 17) % 3) === 1,
    fur: ((h >> 19) % 2) === 1
  };
}
let mouthOpen = 0, spin = 0, thinking = false, apiImg = null;
const cv = ui.canvas, cx = cv.getContext('2d');

function drawAvatar() {
  const s = spec(), t = tone();
  ui.avatarName.textContent = t.name;
  ui.botName.textContent = t.name;
  const W = cv.width, H = cv.height;
  cx.clearRect(0, 0, W, H);
  const bg = cx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, `hsl(${s.hue}, ${s.sat}%, 92%)`);
  bg.addColorStop(1, `hsl(${(s.hue + 40) % 360}, ${s.sat}%, 80%)`);
  cx.fillStyle = bg; cx.fillRect(0, 0, W, H);

  if (s.style === '2D') draw2D(s); else draw3D(s);
}

function draw2D(s) {
  const W = cv.width, H = cv.height, cxx = W / 2, cy = H / 2;
  const R = 130, col = `hsl(${s.hue},${s.sat}%,${s.light}%)`, dark = `hsl(${s.hue},${s.sat + 10}%,${s.light - 22}%)`;
  cx.fillStyle = col;
  cx.beginPath(); cx.arc(cxx, cy, R, 0, Math.PI * 2); cx.fill();
  if (s.ears === 0) { // cat ears
    for (const d of [-1, 1]) {
      cx.beginPath();
      cx.moveTo(cxx + d * 95, cy - 60); cx.lineTo(cxx + d * 130, cy - 150); cx.lineTo(cxx + d * 40, cy - 120);
      cx.closePath(); cx.fill();
    }
  } else if (s.ears === 1) {
    for (const d of [-1, 1]) { cx.beginPath(); cx.ellipse(cxx + d * 120, cy - 30, 30, 45, d * 0.4, 0, Math.PI * 2); cx.fill(); }
  }
  if (s.hat) { cx.fillStyle = dark; cx.fillRect(cxx - 110, cy - 165, 220, 26); }
  cx.fillStyle = '#1b2330';
  const ey = cy - 25, ex = 45;
  for (const d of [-1, 1]) {
    if (s.eyes === 0) { cx.beginPath(); cx.ellipse(cxx + d * ex, ey, 14, 20, 0, 0, Math.PI * 2); cx.fill(); }
    else if (s.eyes === 1) { cx.fillRect(cxx + d * ex - 16, ey - 8, 32, 16); }
    else { cx.beginPath(); cx.arc(cxx + d * ex, ey, 16, 0, Math.PI * 2); cx.fill(); }
  }
  if (s.glasses) {
    cx.strokeStyle = dark; cx.lineWidth = 5;
    for (const d of [-1, 1]) { cx.beginPath(); cx.arc(cxx + d * ex, ey, 26, 0, Math.PI * 2); cx.stroke(); }
  }
  cx.fillStyle = dark; cx.beginPath(); cx.arc(cxx, cy + 20, 10, 0, Math.PI * 2); cx.fill();
  cx.strokeStyle = '#1b2330'; cx.lineWidth = 6; cx.lineCap = 'round';
  const my = cy + 70;
  cx.beginPath();
  if (mouthOpen > 0.1) { cx.ellipse(cxx, my, 34, 10 + mouthOpen * 26, 0, 0, Math.PI * 2); cx.fillStyle = '#7c2f3f'; cx.fill(); }
  else { cx.moveTo(cxx - 40, my); cx.quadraticCurveTo(cxx, my + (s.mouth === 1 ? -14 : 14), cxx + 40, my); cx.stroke(); }
}

const parts = [];
function build3D(s) {
  parts.length = 0;
  const R = 110;
  parts.push({ t: 'sphere', r: R, c: `hsl(${s.hue},${s.sat}%,${s.light}%)`, p: [0, 0, 0] });
  if (s.ears === 0) for (const d of [-1, 1]) parts.push({ t: 'sphere', r: 26, c: `hsl(${s.hue},${s.sat}%,${s.light - 12}%)`, p: [d * 78, -70, 20] });
  else if (s.ears === 1) for (const d of [-1, 1]) parts.push({ t: 'sphere', r: 24, c: `hsl(${s.hue},${s.sat}%,${s.light - 12}%)`, p: [d * 92, -20, 10] });
  for (const d of [-1, 1]) parts.push({ t: 'sphere', r: 14, c: '#1b2330', p: [d * 42, -18, R - 4] });
  parts.push({ t: 'sphere', r: 9, c: `hsl(${s.hue},${s.sat}%,${s.light - 20}%)`, p: [0, 18, R - 2] });
  parts.push({ t: 'mouth', r: 22 + mouthOpen * 22, c: mouthOpen > 0.1 ? '#7c2f3f' : '#1b2330', p: [0, 55, R - 6] });
  if (s.hat) parts.push({ t: 'sphere', r: 30, c: `hsl(${s.hue},${s.sat + 10}%,${s.light - 25}%)`, p: [0, -120, 0] });
}
function draw3D(s) {
  build3D(s);
  const W = cv.width, H = cv.height, ox = W / 2, oy = H / 2 + 20;
  const cyaw = Math.cos(spin), syaw = Math.sin(spin), cp = Math.cos(0.18), sp = Math.sin(0.18);
  const list = parts.map((pt) => {
    let [x, y, z] = pt.p;
    let x1 = x * cyaw + z * syaw, z1 = -x * syaw + z * cyaw;
    let y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    const d = 340 / (340 + z2);
    return { ...pt, sx: ox + x1 * d, sy: oy - y1 * d, d, depth: z2 };
  }).sort((a, b) => a.depth - b.depth);
  for (const p of list) {
    const r = p.r * p.d;
    if (p.t === 'mouth') {
      cx.fillStyle = p.c; cx.beginPath(); cx.ellipse(p.sx, p.sy, r, r * (mouthOpen > 0.1 ? 1.2 : 0.45), 0, 0, Math.PI * 2); cx.fill();
    } else {
      const g = cx.createRadialGradient(p.sx - r * 0.35, p.sy - r * 0.35, r * 0.05, p.sx, p.sy, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, p.c);
      cx.fillStyle = g; cx.beginPath(); cx.arc(p.sx, p.sy, r, 0, Math.PI * 2); cx.fill();
    }
  }
}

(function loop() {
  spin += thinking ? 0.03 : 0.012;
  if (!apiImg) drawAvatar();
  requestAnimationFrame(loop);
})();

/* ---------- voice (TTS) ---------- */
function applyVoice() {
  if (bridge) bridge.setVoice(cfg.rate, cfg.pitch, '');
}

let deviceSpeechStartTimer;
function finishDeviceSpeechStart(generation, failed = false) {
  if (generation !== speechGeneration) return;
  clearTimeout(deviceSpeechStartTimer);
  setVoiceLoading(false);
  if (failed) mouthOpen = 0;
}
function deviceSay(text) {
  const t = tone();
  lastVoiceStatus = (cfg.voiceMode || defaults.voiceMode) === 'device' ? '기본 음성 사용' : '기본 음성으로 대체'; showAppliedSettings();
  if (!bridge && !window.speechSynthesis) return;
  const generation = speechGeneration;
  const finish = (failed = false) => finishDeviceSpeechStart(generation, failed);
  setVoiceLoading(true);
  deviceSpeechStartTimer = setTimeout(() => finish(true), 20000);
  mouthOpen = 1;
  try {
    if (bridge) {
      bridge.speak(text, t.rate, t.pitch, '', String(generation));
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR'; u.rate = t.rate; u.pitch = t.pitch;
    const v = window.speechSynthesis.getVoices().find(x => /^ko(?:-|$)/i.test(x.lang));
    if (v) u.voice = v;
    u.onstart = () => finish();
    u.onend = () => finish(true);
    u.onerror = () => finish(true);
    window.speechSynthesis.speak(u);
  } catch {
    finish(true);
  }
}

// Gemini 3.1 returns 24 kHz, mono, signed 16-bit little-endian PCM.
function pcmToWavBase64(encoded) {
  const pcm = atob(encoded), bytes = new Uint8Array(44 + pcm.length), view = new DataView(bytes.buffer);
  const write = (offset, value) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  write(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, pcm.length, true);
  for (let i = 0; i < pcm.length; i++) bytes[44 + i] = pcm.charCodeAt(i);
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

let speechGeneration = 0, playingAudio = null, readySpeech = null;
function clearReadySpeech() {
  readySpeech = null;
  const button = $('playReadySpeech');
  button.hidden = true;
  button.disabled = false;
  $('playSpeechSample').textContent = '적용된 음성 듣기';
}
function stopCurrentSpeech() {
  ++speechGeneration; mouthOpen = 0;
  clearTimeout(deviceSpeechStartTimer);
  setVoiceLoading(false);
  clearReadySpeech();
  $('playSpeechSample').disabled = false;
  if (bridge?.stopSpeaking) bridge.stopSpeaking();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (playingAudio) { playingAudio.pause(); playingAudio = null; }
}
function speechRequest(dispatch, timeout = 90000) {
  return new Promise(resolve => {
    const id = 'r' + (++reqSeq);
    const timer = setTimeout(() => {
      delete pending[id];
      resolve({error:{message:'음성 응답 시간 초과'}});
    }, timeout);
    pending[id] = value => { clearTimeout(timer); resolve(value); };
    try { dispatch(id); }
    catch (error) { clearTimeout(timer); delete pending[id]; resolve({error:{message:error.message}}); }
  });
}
async function pcSpeech(mode, text, tone) {
  const url = 'http://127.0.0.1:8766/tts';
  const body = JSON.stringify({mode, text:text.slice(0, mode === 'openvoice' ? 80 : 160), persona:mode === 'qwenDesign' ? cfg.persona.slice(0, 200) : tone});
  const headers = {'Content-Type':'application/json'};
  if (bridge?.postJson) return speechRequest(id => bridge.postJson(id, url, body, JSON.stringify(headers)), 165000);
  return (await fetch(url, {method:'POST', headers, body})).json();
}
async function say(text, sample = false) {
  if (!sample) ui.botText.textContent = text;
  stopCurrentSpeech();
  const generation = speechGeneration;
  if (cfg.voiceEnabled === false) return;
  const mode = cfg.voiceMode || defaults.voiceMode;
  lastVoiceStatus = '요청 중'; showAppliedSettings();
  const service = freeSpeechService(mode);
  const key = cfg.ttsKeys[voiceKeyService(mode)];
  if (mode === 'device') { deviceSay(text); if (sample) $('speechSampleStatus').textContent = '기본 음성 요청 완료'; return; }
  setVoiceLoading(true);
  const generating = voiceLabel(mode) + ' 음성 생성 중…';
  ui.status.textContent = generating;
  if (sample) {
    $('speechSampleStatus').textContent = generating;
    $('playSpeechSample').disabled = true;
  }
  const p = cfg.persona.toLowerCase();
  const tone = /깡패|건달|조폭|무서운|gangster|낮고/.test(p) ? 'low'
    : /고양이|cat|귀여운|밝은/.test(p) ? 'bright' : 'neutral';
  const instructions = '한국어로 자연스럽게 말하세요. 다음 캐릭터의 성격에 어울리는 말투, 감정, 속도와 억양을 표현하세요. 캐릭터 설명: ' + cfg.persona.slice(0, 1000);
  const tag = /깡패|건달|조폭|무서운|gangster/.test(p) ? '[stern, low and rough]' : /고양이|cat|귀여운|밝은/.test(p) ? '[playful and cheerful]' : '';
  function showSpeechError(error) {
    if (generation !== speechGeneration) return;
    setVoiceLoading(false);
    clearReadySpeech();
    const message = '음성 실패 · ' + error.message;
    if (sample) {
      lastVoiceStatus = '재생 실패'; showAppliedSettings();
      $('speechSampleStatus').textContent = message;
    } else {
      ui.status.textContent = message + ' · 기본 음성으로 읽습니다.';
      deviceSay(text);
    }
  }
  try {
    let elevenVoice = null;
    let result;
    const previewMode = bridge || desktop ? null : ({kokoroPhone:'kokoro', supertonicPhone:'supertonic'}[mode] || (pcModes.has(mode) ? mode : null));
    if (previewMode) {
      result = await pcSpeech(previewMode, text, tone);
    } else if (phoneModes.has(mode)) {
      if (!desktop && !bridge?.postPhoneSpeech) throw new Error('휴대폰 앱에서 이 음성을 실행해 주세요');
      const sentence = text.slice(0, 320);
      result = desktop ? await desktopRequest('/local/tts', {mode, text:sentence, tone, speed:cfg.rate})
        : await speechRequest(id => bridge.postPhoneSpeech(id, mode, sentence, tone, cfg.rate));
    } else if (service) {
      if (!key) throw new Error('음성 서비스 API 키를 입력해 주세요');
      if (mode === 'cartesia' && !cfg.cartesiaFreeConfirm) throw new Error('Cartesia 무료 플랜을 확인해 주세요');
      if (!desktop && !bridge?.postFreeSpeech) throw new Error('휴대폰 앱에서 이 클라우드 음성을 실행해 주세요');
      const sentence = text.slice(0, 2000);
      result = desktop ? await desktopRequest('/speech/cloud/generate', {
        mode, key, text:sentence, tone, speed:cfg.rate, confirmed:cfg.cartesiaFreeConfirm === true
      }) : await speechRequest(id => bridge.postFreeSpeech(id, mode, key, sentence, tone, cfg.rate));
    } else if (elevenModels[mode]) {
      if (!key) throw new Error('ElevenLabs API 키를 입력해 주세요');
      if (!desktop && (!bridge?.postElevenSpeech || !bridge.getElevenVoices)) throw new Error('휴대폰 앱에서 ElevenLabs 음성을 실행해 주세요');
      const list = await requestElevenVoices(key);
      if (generation !== speechGeneration) return;
      if (list.error) throw new Error(list.error.message);
      elevenVoice = chooseElevenVoice(list.voices || [], cfg.persona);
      if (!elevenVoice) throw new Error('사용 가능한 기본 음성이 없습니다');
      const expressive = mode === 'eleven' || mode === 'eleven3';
      const body = {model_id:elevenModels[mode], text:(expressive && tag ? tag + ' ' : '') + text, language_code:'ko'};
      result = desktop ? await desktopRequest('/speech/eleven/generate', {
        body, key, voice:elevenVoice.voice_id
      }) : await speechRequest(id => bridge.postElevenSpeech(id, JSON.stringify(body), key, elevenVoice.voice_id));
    } else if (geminiModes.has(mode)) {
      if (!key) throw new Error('Gemini 음성에 사용할 API 키를 입력해 주세요');
      if (!desktop && !bridge?.postJson) throw new Error('휴대폰 앱에서 Gemini 음성을 실행해 주세요');
      const geminiVoice = tone === 'low' ? 'Algenib' : tone === 'bright' ? 'Leda' : 'Kore';
      const root = 'https://generativelanguage.googleapis.com/v1beta/';
      const headers = JSON.stringify({'Content-Type':'application/json','x-goog-api-key':key});
      if (mode === 'gemini31') {
        const body = {contents:[{parts:[{text:instructions + '\n다음 문장만 말하세요: ' + text}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:geminiVoice}}}}};
        result = desktop ? await desktopRequest('/speech/gemini/preview', {body, key})
          : await speechRequest(id => bridge.postJson(id, root + 'models/gemini-3.1-flash-tts-preview:generateContent', JSON.stringify(body), headers));
      } else {
        const model = mode === 'gemini38' ? 'gemini-3.8-flash-tts' : 'gemini-3.8-flash-lite-tts';
        const body = {model, input:[{type:'user_input',content:[{type:'text',text,annotations:[{type:'speech_metadata',style:instructions}]}]}],response_format:{type:'audio',mime_type:'audio/wav'},generation_config:{speech_config:[{voice:geminiVoice}]},store:false};
        result = desktop ? await desktopRequest('/speech/gemini/interactions', {body, key})
          : await speechRequest(id => bridge.postJson(id, root + 'interactions', JSON.stringify(body), headers));
      }
    } else {
      throw new Error('지원하지 않는 음성 모델입니다');
    }
    if (generation !== speechGeneration) return;
    let audio = result.audio, mime = elevenModels[mode] ? 'audio/mpeg' : 'audio/wav';
    if (mode === 'gemini31') {
      const parts = result.candidates?.[0]?.content?.parts || [];
      const raw = parts.find(part => part.inlineData?.data || part.inline_data?.data);
      const pcm = raw?.inlineData?.data || raw?.inline_data?.data;
      if (pcm) { audio = pcmToWavBase64(pcm); mime = 'audio/wav'; }
    } else if (geminiModes.has(mode)) {
      const blocks = [];
      function collect(x) {
        if (!x || typeof x !== 'object') return;
        if (x.type === 'audio' && typeof x.data === 'string') blocks.push(x);
        for (const v of Object.values(x)) if (typeof v === 'object' && v) Array.isArray(v) ? v.forEach(collect) : collect(v);
      }
      collect(result); const block = blocks[0] || result.output_audio;
      audio = block?.data; mime = block?.mime_type || 'audio/wav';
    }
    if (!audio) throw new Error(result.error?.message || '음성 응답 없음');
    setVoiceLoading(false);
    const player = new Audio('data:' + mime + ';base64,' + audio);
    playingAudio = player;
    player.onended = () => {
      if (generation !== speechGeneration) return;
      mouthOpen = 0;
      const finished = voiceLabel(mode) + ' 재생 완료';
      ui.status.textContent = finished;
      if (sample) $('speechSampleStatus').textContent = finished;
    };
    async function playAudio() {
      if (generation !== speechGeneration) return;
      await player.play();
      if (generation !== speechGeneration) return;
      clearReadySpeech();
      mouthOpen = 1;
      lastVoiceStatus = elevenVoice ? '재생 확인됨 · ' + (elevenVoice.name || '자동 선택') : '재생 확인됨';
      showAppliedSettings();
      const status = voiceLabel(mode) + ' 재생 중';
      ui.status.textContent = status;
      if (sample) $('speechSampleStatus').textContent = status;
      if (elevenModels[mode]) refreshElevenCredits();
      if (isTypecast(mode)) refreshTypecastCredits();
    }
    try {
      await playAudio();
    } catch (error) {
      if (error.name !== 'NotAllowedError') throw error;
      if (generation !== speechGeneration) return;
      const button = sample ? $('playSpeechSample') : $('playReadySpeech');
      button.hidden = false;
      button.textContent = '생성된 음성 재생';
      const resume = '음성 생성 완료 · 재생을 눌러 주세요.';
      ui.status.textContent = resume;
      if (sample) $('speechSampleStatus').textContent = resume;
      lastVoiceStatus = '재생 대기'; showAppliedSettings();
      readySpeech = {sample, text, play: () => {
        button.disabled = true;
        playAudio().catch(showSpeechError).finally(() => {
          if (generation === speechGeneration) button.disabled = false;
        });
      }};
    }
  } catch (error) {
    showSpeechError(error);
  } finally {
    if (sample && generation === speechGeneration) $('playSpeechSample').disabled = false;
  }
}

/* ---------- STT ---------- */
let recog = null, holdingMic = false, micPointer = null, micPermission;
let spokenParts = [], awaitingFinal = false, finalTimer = null;
const sttEngine = bridge ? 'Android SpeechRecognizer' : 'Web Speech API';
const sttErrors = {
  'not-allowed':'마이크 권한 필요', 'mic permission denied':'마이크 권한 필요', 'code 9':'마이크 권한 필요',
  'audio-capture':'마이크 입력 오류', 'code 3':'마이크 입력 오류',
  'no-speech':'인식된 음성 없음', 'code 6':'인식된 음성 없음', 'code 7':'인식된 음성 없음',
  network:'서비스 연결 오류', 'code 1':'서비스 연결 오류', 'code 2':'서비스 연결 오류',
  'no native speech recognizer':'서비스 미지원'
};
function setSttStatus(status) {
  const line = $('currentStt');
  const text = sttEngine + ' (' + status + ')';
  if (line.textContent !== text) line.textContent = text;
}
function syncSttReadiness() {
  if (holdingMic || awaitingFinal) return;
  const available = bridge ? bridge.sttAvailable?.() !== false : Boolean(recog);
  const permissionNeeded = bridge ? bridge.micGranted?.() === false : micPermission?.state === 'denied';
  ui.micBtn.disabled = !available;
  ui.micIcon.textContent = available ? '🎤' : '⛔';
  ui.micHint.textContent = available ? '누른 상태에서 말하세요' : '음성 인식 미지원 · 키보드를 이용해 주세요';
  setSttStatus(!available ? '서비스 미지원' : permissionNeeded ? '마이크 권한 필요' : '대기');
}
function setMic(on) {
  ui.micBtn.classList.toggle('on', on);
  ui.micHint.textContent = on ? '듣고 있어요 · 손을 떼면 전송합니다' : '누른 상태에서 말하세요';
}
function submitSpeech() {
  clearTimeout(finalTimer); finalTimer = null;
  const text = spokenParts.join(' ').trim();
  spokenParts = []; awaitingFinal = false;
  setSttStatus(text ? '인식 완료' : '인식된 음성 없음');
  if (text) { ui.meText.textContent = text; ask(text); }
  else ui.status.textContent = '인식된 말이 없습니다. 버튼을 누른 채 다시 말씀해 주세요.';
}
function failStt(error) {
  if (!holdingMic && !awaitingFinal) return;
  holdingMic = false; micPointer = null; setMic(false);
  if (awaitingFinal && spokenParts.length) {
    submitSpeech();
    return;
  }
  awaitingFinal = false;
  clearTimeout(finalTimer); finalTimer = null;
  const status = sttErrors[error] || '인식 오류';
  setSttStatus(status);
  ui.status.textContent = '음성 인식 오류: ' + status;
}
function startRecognition() {
  setSttStatus('연결 중');
  try {
    if (bridge) bridge.startListening();
    else if (recog) recog.start();
  } catch {
    failStt('start');
  }
}
function stopRecognition() {
  if (bridge) bridge.stopListening();
  else if (recog) { try { recog.stop(); } catch (e) { submitSpeech(); } }
}
if (bridge) {
  window.__onStt = (text) => {
    if (!holdingMic && !awaitingFinal) return;
    if (text) spokenParts.push(text);
    if (holdingMic) startRecognition();
    else if (awaitingFinal) submitSpeech();
  };
  window.__onSttPartial = (text) => { if (holdingMic && text) ui.meText.textContent = [...spokenParts, text].join(' '); };
  window.__onSttError = failStt;
  window.__onSttAvailabilityChanged = syncSttReadiness;
  window.__onBridgeState = (msg) => {
    if (msg === 'listening' && holdingMic) setSttStatus('듣는 중');
    else if (msg === 'mic ok' || msg === 'mic denied') syncSttReadiness();
  };
  window.__onTtsState = (msg) => { ui.status.textContent = 'TTS: ' + msg; };
  window.__onDeviceSpeechState = (id, state) => finishDeviceSpeechStart(Number(id), state !== 'started');
} else if (window.SpeechRecognition || window.webkitSpeechRecognition) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  recog = new R(); recog.lang = 'ko-KR'; recog.interimResults = true; recog.continuous = true;
  recog.onstart = () => { if (holdingMic) setSttStatus('듣는 중'); };
  recog.onresult = (e) => {
    if (!holdingMic && !awaitingFinal) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) spokenParts.push(e.results[i][0].transcript);
      else interim += e.results[i][0].transcript;
    }
    ui.meText.textContent = [...spokenParts, interim].filter(Boolean).join(' ');
  };
  recog.onend = () => { if (holdingMic) startRecognition(); else if (awaitingFinal) submitSpeech(); };
  recog.onerror = (e) => failStt(e.error);
  navigator.permissions?.query({name:'microphone'}).then(permission => {
    micPermission = permission;
    permission.addEventListener('change', syncSttReadiness);
    syncSttReadiness();
  }).catch(() => {});
}
ui.micBtn.addEventListener('pointerdown', (event) => {
  if (ui.micBtn.disabled || holdingMic || awaitingFinal || event.button !== 0) return;
  event.preventDefault(); micPointer = event.pointerId;
  ui.micBtn.setPointerCapture(event.pointerId);
  spokenParts = []; holdingMic = true; setMic(true);
  ui.status.textContent = '듣고 있습니다…'; startRecognition();
});
function releaseMic(event) {
  if (!holdingMic || (event && event.pointerId !== micPointer)) return;
  holdingMic = false; micPointer = null; awaitingFinal = true; setMic(false);
  setSttStatus('변환 중');
  ui.status.textContent = '음성을 확인하고 있습니다…';
  finalTimer = setTimeout(() => { if (awaitingFinal) submitSpeech(); }, 8000);
  stopRecognition();
}
ui.micBtn.addEventListener('pointerup', releaseMic);
ui.micBtn.addEventListener('pointercancel', releaseMic);
ui.micBtn.addEventListener('lostpointercapture', releaseMic);
window.addEventListener('blur', () => releaseMic());

/* ---------- LLM (OpenAI-compatible) ---------- */
const history = [];
let conversationGeneration = 0, avatarGeneration = 0;

/* API call: Android에서는 네이티브 HttpURLConnection으로 보낸다(CORS 우회).
   브라우저에서는 fetch를 쓴다. 둘 다 parsed JSON object를 resolve한다. */
const pending = {};
let reqSeq = 0;
window.__onApiResponse = (id, text) => {
  const cb = pending[id];
  if (!cb) return;
  delete pending[id];
  try { cb(JSON.parse(text)); } catch (e) { cb({ error: { message: '응답 parse 실패: ' + text } }); }
};
async function apiCall(url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey && cfg.provider === 'gemini' && url.includes(':generateContent')) headers['x-goog-api-key'] = cfg.apiKey;
  else if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
  if (bridge && bridge.postJson) {
    return new Promise((resolve) => {
      const id = 'r' + (++reqSeq);
      const timer = setTimeout(() => {
        if (pending[id]) { delete pending[id]; resolve({ error: { message: 'API 응답 시간이 초과되었습니다. 네트워크와 서비스 설정을 확인하세요.' } }); }
      }, 90000);
      pending[id] = (result) => { clearTimeout(timer); resolve(result); };
      try { bridge.postJson(id, url, JSON.stringify(body), JSON.stringify(headers)); }
      catch (e) { clearTimeout(timer); delete pending[id]; resolve({ error: { message: 'API 요청을 시작하지 못했습니다: ' + e.message } }); }
    });
  }
  const useProxy = desktop || (location.hostname === '127.0.0.1' && location.port === '8765');
  const operation = url.endsWith('/images/generations') || url.includes(':generateContent') ? 'images' : 'chat';
  const target = useProxy ? '/api/' + cfg.provider + '/' + operation : url;
  const r = await fetch(target, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });
  try { return await r.json(); } catch (e) { return { error: { message: 'HTTP ' + r.status } }; }
}

async function ask(question) {
  const q = String(question || '').trim();
  if (!q || thinking) return;
  const provider = cfg.provider, local = isLocalProvider(provider);
  if (desktop && !local && !cfg.apiKey) {
    ui.status.textContent = '선택한 서비스의 API 키를 입력하거나 로컬 모델을 선택해 주세요.';
    return;
  }
  const generation = conversationGeneration;
  ui.meText.textContent = q;
  history.push({ role: 'user', content: q });
  thinking = true;
  syncActivityIndicator();
  ui.status.textContent = local ? '로컬 모델이 답변을 생성 중…' : cfg.apiKey ? 'API 호출 중…' : '로컬 데모 모드 (API 키 없음)';

  let answer;
  if (local) {
    let result;
    if (!desktop && (!bridge?.postLocalChat || !bridge.localChatReady?.(provider))) {
      result = {error:{message:bridge ? '휴대폰에 모델 파일을 설치해 주세요.' : 'Android 앱에서 실행해 주세요.'}};
    } else {
      const body = {
        temperature:cfg.temp, top_p:cfg.topP, max_tokens:Math.min(cfg.maxTokens, 256),
        messages:[
          {role:'system', content:cfg.persona + '\n한국어로 짧게 답하세요.'},
          ...history.slice(-(Number(cfg.turns) * 2 + 1))
        ]
      };
      result = desktop ? await desktopRequest('/local/chat', {provider, request:body})
        : await speechRequest(id => bridge.postLocalChat(id, provider, JSON.stringify(body)), 180000);
    }
    if (generation !== conversationGeneration) return;
    if (!result?.text) {
      thinking = false;
      syncActivityIndicator();
      history.pop();
      ui.status.textContent = result?.error?.message || '로컬 모델에서 답변을 받지 못했습니다.';
      return;
    }
    answer = result.text;
  } else if (cfg.apiKey) {
    try {
      const j = await apiCall(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        model: cfg.model || 'gpt-4o-mini',
        temperature: cfg.temp,
        top_p: cfg.topP,
        max_tokens: cfg.provider === 'exaone' ? Math.max(512, cfg.maxTokens) : cfg.maxTokens,
        ...(cfg.provider === 'exaone' ? { reasoning_effort: 'low' } : {}),
        messages: [
          { role: 'system', content: cfg.persona + '\nSpeak briefly. Match the persona tone.' },
          ...history.slice(-(Number(cfg.turns) * 2 + 1))
        ]
      });
      if (generation !== conversationGeneration) return;
      recordUsage(j.usage);
      answer = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content)
        || ('오류: ' + (j.error && j.error.message || j.status || '응답 없음'));
    } catch (e) {
      if (generation !== conversationGeneration) return;
      answer = '네트워크 오류: ' + e.message;
    }
  } else {
    answer = demoReply(q);
  }

  if (generation !== conversationGeneration) return;
  history.push({ role: 'assistant', content: answer });
  thinking = false;
  syncActivityIndicator();
  ui.status.textContent = local || !cfg.apiKey ? '응답 완료'
    : answer.startsWith('오류:') || answer.startsWith('네트워크 오류:') ? 'API 연결 실패: 키, 서비스 및 모델을 확인하세요.' : '응답 완료';
  say(answer);
}

function demoReply(q) {
  const p = cfg.persona.toLowerCase();
  const name = tone().name;
  const pick = (arr) => arr[hash(q + cfg.persona) % arr.length];
  if (cfg.apiKey) return '';
  if (/안녕|hello|하이|반가/.test(q)) return pick([`${name}다! 반가워요.`, `안녕! ${name}, 오늘도 기분 좋아.`, `하이하이, 나 ${name}야.`]);
  if (/name|이름|누구|who/.test(q)) return pick([`나는 ${name}. 네가 준 페르소나로 움직이고 있어.`, `${name}라고 불러줘.`]);
  if (/temperature|temp|설정/.test(q)) return `temperature ${cfg.temp}, top_p ${cfg.topP}, max tokens ${cfg.maxTokens}, 말하기 속도 ${cfg.rate.toFixed(2)}, 피치 ${cfg.pitch.toFixed(2)}로 사용 중이야.`;
  if (/고양|냐|야옹|meow/.test(p)) return pick(['야옹~ 짧게 답했어.', '냥! 궁금한 거 또 말해줘.']);
  return pick([`${q}...음, 그건 temperature ${cfg.temp}로 생각해서 답할게.`, '짧게 답하라고 페르소나에 적혀 있어서 간단히 말하면: 좋은 생각 같아.', `${name} 모드에서 응답: ${q}에 대해 동의해.`]);
}

ui.sendBtn.addEventListener('click', () => { ask(ui.askInput.value); ui.askInput.value = ''; });
ui.askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { ask(ui.askInput.value); ui.askInput.value = ''; } });
function resetConversation() {
  ++conversationGeneration; history.length = 0; thinking = false;
  stopCurrentSpeech();
  const hadMic = holdingMic || awaitingFinal;
  holdingMic = false; awaitingFinal = false; micPointer = null; spokenParts = [];
  clearTimeout(finalTimer); finalTimer = null; setMic(false);
  if (hadMic) { if (bridge) bridge.stopListening(); else if (recog) { try { recog.abort(); } catch (e) {} } }
  syncSttReadiness();
  ui.askInput.value = ''; ui.meText.textContent = '…'; ui.botText.textContent = '…';
}
function resetAvatar() {
  ++avatarGeneration; apiImg = null;
  $('avatarNotice').textContent = '';
  $('avatarLoading').hidden = true; ui.regenBtn.disabled = false; drawAvatar();
}
ui.clearBtn.addEventListener('click', () => {
  cfg = {...defaults, savedProviders:{}, ttsKeys:{}, defaultsUpdated:true, singleKeysMigrated:true, desktopLocalEnabled:desktop};
  localStorage.removeItem(LS);
  localStorage.removeItem(usageKey);
  resetConversation();
  resetAvatar();
  lastVoiceStatus = '아직 재생 전';
  syncUI(); applyVoice();
  $('voicePicker').open = false;
  $('speechSample').value = koreanSpeechSample;
  for (const id of ['personaStatus', 'voiceApplyStatus', 'speechSampleStatus']) $(id).textContent = '';
  $('elevenCredits').textContent = 'ElevenLabs 크레딧: 확인 전';
  $('typecastCredits').textContent = '타입캐스트 크레딧: 확인 전';
  ui.status.textContent = '대기 중';
  $('resetStatus').textContent = '설정, API 키, 대화 기록을 모두 삭제했습니다.';
});

/* avatar via API image generation, fall back to persona-derived drawing */
ui.regenBtn.addEventListener('click', async () => {
  const notice = $('avatarNotice');
  if (isLocalProvider(cfg.provider)) {
    notice.textContent = '로컬 LLM 모델은 이미지 생성이 불가합니다.';
    return;
  }
  notice.textContent = '';
  if (!cfg.apiKey) { drawAvatar(); ui.status.textContent = 'API 키 없으면 persona 기반 캔버스 아바타 사용'; return; }
  if (!['openai','gemini'].includes(cfg.provider)) { ui.status.textContent = '이미지 생성은 Gemini 또는 OpenAI 설정에서 사용할 수 있습니다.'; return; }
  const generation = ++avatarGeneration;
  ui.status.textContent = '아바타 이미지 API 호출 중…';
  ui.regenBtn.disabled = true; $('avatarLoading').hidden = false;
  try {
    const prompt = 'Create a friendly square avatar portrait based on this persona, no text: ' + cfg.persona;
    const gemini = cfg.provider === 'gemini';
    const endpoint = gemini ? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-image:generateContent' : cfg.baseUrl.replace(/\/$/, '') + '/images/generations';
    const body = gemini ? {contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['IMAGE']}} : {model:'gpt-image-1-mini',prompt,size:'1024x1024',quality:'low'};
    const j = await apiCall(endpoint, body);
    if (generation !== avatarGeneration) return;
    const d = j.data && j.data[0];
    const parts = j.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(x => x.inlineData || x.inline_data);
    const blob = imagePart && (imagePart.inlineData || imagePart.inline_data);
    const url = gemini ? (blob ? 'data:' + (blob.mimeType || blob.mime_type || 'image/png') + ';base64,' + blob.data : '') : (d ? (d.url || (d.b64_json ? 'data:image/png;base64,' + d.b64_json : '')) : '');
    if (!url && j.error) throw new Error(j.error.message || 'API 오류');
    if (url) {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('생성된 이미지를 불러오지 못했습니다.'));
        img.src = url;
      });
      if (generation !== avatarGeneration) return;
      apiImg = img;
      cx.clearRect(0, 0, cv.width, cv.height);
      const scale = Math.min(cv.width / img.width, cv.height / img.height);
      const w = img.width * scale, h = img.height * scale;
      cx.drawImage(img, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
      ui.status.textContent = 'API로 생성한 아바타 이미지 (2D)';
      return;
    }
    ui.status.textContent = 'images API 응답 없음 → 캔버스 아바타 사용';
  } catch (e) {
    if (generation !== avatarGeneration) return;
    ui.status.textContent = 'images API 오류: ' + e.message + ' → 캔버스 아바타 사용';
  } finally {
    if (generation === avatarGeneration) { $('avatarLoading').hidden = true; ui.regenBtn.disabled = false; }
  }
  drawAvatar();
});

/* ---------- init ---------- */
buildVoicePicker();
syncUI();
syncSttReadiness();
if (cfg.voiceEnabled !== false) {
  if (elevenModels[cfg.voiceMode] && cfg.ttsKeys.eleven) refreshElevenCredits();
  if (isTypecast(cfg.voiceMode)) refreshTypecastCredits();
}
applyVoice();
drawAvatar();
if (bridge) ui.status.textContent = 'Android 네이티브 STT/TTS 브리지 연결됨';
ui.meText.textContent = '…';
ui.botText.textContent = '…';
