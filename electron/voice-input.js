const DEFAULT_LANGUAGE = 'en';

function t(key) {
  if (window.appI18n && typeof window.appI18n.t === 'function') {
    return window.appI18n.t(key);
  }
  return key;
}

function applyLanguageFromConfig(cfg) {
  if (!window.appI18n || typeof window.appI18n.setLanguage !== 'function') {
    return;
  }
  const lang = (cfg && cfg.app_language) || DEFAULT_LANGUAGE;
  window.appI18n.setLanguage(lang);
}

function initializeLanguage() {
  if (!window.appI18n) {
    return;
  }
  window.appI18n.setLanguage(DEFAULT_LANGUAGE);
  document.title = t('voice.pageTitle');
  if (typeof window.appI18n.onChange === 'function') {
    window.appI18n.onChange(() => {
      registerVoiceInputTranslations();
      window.appI18n.apply();
      document.title = t('voice.pageTitle');
    });
  }
}


function registerVoiceInputTranslations() {
  if (!window.appI18n) {
    return;
  }
  const navTitle = document.querySelector('.nav-title');
  if (navTitle) {
    navTitle.dataset.i18n = 'voice.nav.title';
  }
  const backButton = document.querySelector('.back-btn');
  if (backButton) {
    backButton.dataset.i18n = 'common.backNav';
    backButton.dataset.i18nTitle = 'voice.nav.backTooltip';
  }
  const sectionTitle = document.querySelector('.section-title');
  if (sectionTitle) {
    sectionTitle.dataset.i18n = 'voice.section.title';
  }
  const enableLabel = document.querySelector('label[for="voiceInputEnabled"]');
  if (enableLabel) {
    enableLabel.dataset.i18n = 'voice.fields.enable';
  }
  const hotkeyInput = document.getElementById('voiceInputHotkey');
  if (hotkeyInput) {
    hotkeyInput.dataset.i18nPlaceholder = 'voice.placeholders.hotkey';
  }

  const hotkeyLabel = document.querySelector('label[for="voiceInputHotkey"]');
  if (hotkeyLabel) {
    hotkeyLabel.dataset.i18n = 'voice.fields.hotkey';
  }
  const hotkeyNote = document.querySelector('#voiceInputHotkey')?.parentElement?.querySelector('.form-note');
  if (hotkeyNote) {
    hotkeyNote.dataset.i18n = 'voice.notes.hotkey';
  }
  const engineLabel = document.querySelector('label[for="voiceInputEngine"]');
  if (engineLabel) {
    engineLabel.dataset.i18n = 'voice.fields.engine';
  }
  const languageLabel = document.querySelector('label[for="voiceInputLanguage"]');
  if (languageLabel) {
    languageLabel.dataset.i18n = 'voice.fields.language';
  }
  const insertLabel = document.querySelector('label[for="voiceInputTranslate"]');
  if (insertLabel) {
    insertLabel.dataset.i18n = 'voice.fields.insertTranslation';
  }
  const insertNote = document.getElementById('tlNote');
  if (insertNote) {
    insertNote.dataset.i18n = 'voice.fields.insertNote';
  }
  const translateLabel = document.querySelector('label[for="voiceInputTranslateLanguage"]');
  if (translateLabel) {
    translateLabel.dataset.i18n = 'voice.fields.translateLanguage';
  }
  const backLink = document.querySelector('.buttons .btn-secondary');
  if (backLink) {
    backLink.dataset.i18n = 'common.backLink';
  }
}


if (window.appI18n && typeof window.appI18n.extend === 'function') {
  window.appI18n.extend({
    en: {
      'common.backNav': '\u2190 Back',
      'common.backLink': 'Back',
      'voice.pageTitle': 'Voice Input Settings',
      'voice.nav.title': 'Voice Input Settings',
      'voice.nav.backTooltip': 'Back to main window',
      'voice.section.title': 'Voice Input',
      'voice.fields.enable': 'Enable voice input (press once to start, press again to stop)',
      'voice.fields.hotkey': 'Hotkey',
      'voice.fields.engine': 'Transcription Engine',
      'voice.fields.language': 'Transcription Language',
      'voice.fields.insertTranslation': 'Insert translation after completion',
      'voice.fields.insertNote': 'If enabled, the translation will be inserted after stopping.',
      'voice.fields.translateLanguage': 'Translation Target Language',
      'voice.placeholders.hotkey': 'e.g. F3 or A',
      'voice.notes.hotkey': 'Supports F1-F24, A-Z, 0-9',
      'voice.notify.loadFailed': 'Failed to load configuration',
      'voice.notify.saveFailed': 'Save failed'
    },
    zh: {
      'common.backNav': '\u2190 返回',
      'common.backLink': '返回',
      'voice.nav.title': '语音输入设置',
      'voice.nav.backTooltip': '返回主界面',
      'voice.section.title': '语音输入',
      'voice.fields.enable': '启用语音输入（按一次开始，再按一次停止）',
      'voice.fields.hotkey': '快捷键',
      'voice.fields.engine': '转写引擎',
      'voice.fields.language': '转写语言',
      'voice.fields.insertTranslation': '完成后插入翻译结果',
      'voice.fields.insertNote': '启用后将在停止时插入翻译文本。',
      'voice.fields.translateLanguage': '翻译目标语言',
      'voice.placeholders.hotkey': '例如：F3 或 A',
      'voice.notes.hotkey': '支持 F1-F24、A-Z、0-9',
      'voice.notify.loadFailed': '配置加载失败',
      'voice.notify.saveFailed': '保存失败'
    }
  });
}

let currentConfig = {};

document.addEventListener('DOMContentLoaded', () => {
  initializeLanguage();
  registerVoiceInputTranslations();
  if (window.appI18n) { window.appI18n.apply(); }
  loadConfig();
  setupEvents();
});

async function loadConfig() {
  try {
    currentConfig = await window.electronAPI.getConfig();
    applyLanguageFromConfig(currentConfig);
    fillForm(currentConfig);
  } catch (e) {
    notify(t('voice.notify.loadFailed'), 'error');
  }
}

function fillForm(cfg) {
  const viEnabledEl = document.getElementById('voiceInputEnabled');
  const viHotkeyEl = document.getElementById('voiceInputHotkey');
  const viEngineEl = document.getElementById('voiceInputEngine');
  const viLangEl = document.getElementById('voiceInputLanguage');
  const viTlChk = document.getElementById('voiceInputTranslate');
  const viTlLang = document.getElementById('voiceInputTranslateLanguage');
  const viTlGroup = document.getElementById('voiceInputTranslateLanguageGroup');

  if (viEnabledEl) viEnabledEl.checked = !!cfg.voice_input_enabled;
  if (viHotkeyEl) viHotkeyEl.value = cfg.voice_input_hotkey || 'F3';
  if (viEngineEl) {
    let eng = cfg.voice_input_engine || cfg.recognition_engine || cfg.transcribe_source || 'openai';
    viEngineEl.value = eng;
  }
  if (viLangEl) viLangEl.value = cfg.voice_input_language || 'auto';
  if (viTlChk) viTlChk.checked = !!cfg.voice_input_translate;
  if (viTlLang) {
    const raw = cfg.voice_input_translate_language || cfg.translate_language || 'Chinese';
    const map = {
      '中文': 'Chinese', 'Chinese': 'Chinese',
      'English': 'English',
      '日本語': 'Japanese', 'Japanese': 'Japanese',
      '한국어': 'Korean', 'Korean': 'Korean',
      'Español': 'Spanish', 'Spanish': 'Spanish',
      'Français': 'French', 'French': 'French',
      'Deutsch': 'German', 'German': 'German',
      'Italiano': 'Italian', 'Italian': 'Italian',
      'Português': 'Portuguese', 'Portuguese': 'Portuguese',
      'Русский': 'Russian', 'Russian': 'Russian',
      'العربية': 'Arabic', 'Arabic': 'Arabic',
      'हिन्दी': 'Hindi', 'Hindi': 'Hindi',
      'ไทย': 'Thai', 'Thai': 'Thai',
      'Tiếng Việt': 'Vietnamese', 'Vietnamese': 'Vietnamese',
      'Bahasa Indonesia': 'Indonesian', 'Indonesian': 'Indonesian',
      'Türkçe': 'Turkish', 'Turkish': 'Turkish',
      'Nederlands': 'Dutch', 'Dutch': 'Dutch',
      'Polski': 'Polish', 'Polish': 'Polish',
      'Українська': 'Ukrainian', 'Ukrainian': 'Ukrainian',
      'Čeština': 'Czech', 'Czech': 'Czech'
    };
    const normalized = map[raw] || 'Chinese';
    viTlLang.value = normalized;
  }
  if (viTlGroup) viTlGroup.style.display = (viTlChk && viTlChk.checked) ? 'block' : 'none';
  const tlNote = document.getElementById('tlNote');
  if (tlNote) tlNote.style.display = (viTlChk && viTlChk.checked) ? 'block' : 'none';
}

function setupEvents() {
  const viTlChk = document.getElementById('voiceInputTranslate');
  const viTlGroup = document.getElementById('voiceInputTranslateLanguageGroup');
  viTlChk.addEventListener('change', () => {
    viTlGroup.style.display = viTlChk.checked ? 'block' : 'none';
    const tlNote = document.getElementById('tlNote');
    if (tlNote) tlNote.style.display = viTlChk.checked ? 'block' : 'none';
    autoSave();
  });

  // Auto-save when inputs change or blur
  document.querySelectorAll('input, select, textarea').forEach(el => {
    el.addEventListener('change', autoSave);
    el.addEventListener('blur', autoSave);
    if (el.tagName === 'INPUT') el.addEventListener('input', debounce(autoSave, 500));
  });
}

function collect() {
  const cfg = { ...currentConfig };
  cfg.voice_input_enabled = document.getElementById('voiceInputEnabled').checked;
  cfg.voice_input_hotkey = (document.getElementById('voiceInputHotkey').value || '').trim() || 'F3';
  cfg.voice_input_engine = document.getElementById('voiceInputEngine').value;
  cfg.voice_input_language = document.getElementById('voiceInputLanguage').value;
  const tlOn = document.getElementById('voiceInputTranslate').checked;
  cfg.voice_input_translate = tlOn;
  cfg.voice_input_translate_language = tlOn ? (document.getElementById('voiceInputTranslateLanguage').value || '').trim() : (cfg.voice_input_translate_language || '');
  return cfg;
}

async function save() {
  try {
    const cfg = collect();
    await window.electronAPI.saveConfig(cfg);
    currentConfig = cfg;
    return true;
  } catch (e) {
    notify(t('voice.notify.saveFailed'), 'error');
    return false;
  }
}

// Debounced autosave
let autoSaveTimer = null;
function autoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { save(); }, 600);
}

function debounce(fn, ms) {
  let h = null; return (...args) => { if (h) clearTimeout(h); h = setTimeout(() => fn(...args), ms); };
}

function notify(text, type) {
  const div = document.createElement('div');
  div.className = 'top-notification';
  div.style.background = type === 'error' ? '#ff4757' : '#333';
  div.textContent = text;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2200);
}

