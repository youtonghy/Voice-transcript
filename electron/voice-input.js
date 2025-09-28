const DEFAULT_LANGUAGE = 'en';

function setDocumentLanguage(lang) {
  if (document && document.documentElement) {
    let htmlLang = 'en';
    if (lang === 'zh') {
      htmlLang = 'zh-CN';
    } else if (lang === 'ja') {
      htmlLang = 'ja-JP';
    }
    document.documentElement.lang = htmlLang;
  }
}

const LANGUAGE_ALIASES = {
  chinese: 'Chinese',
  zh: 'Chinese',
  'zh-cn': 'Chinese',
  english: 'English',
  en: 'English',
  japanese: 'Japanese',
  ja: 'Japanese',
  'ja-jp': 'Japanese',
  korean: 'Korean',
  ko: 'Korean',
  spanish: 'Spanish',
  es: 'Spanish',
  french: 'French',
  fr: 'French',
  german: 'German',
  de: 'German',
  italian: 'Italian',
  it: 'Italian',
  portuguese: 'Portuguese',
  pt: 'Portuguese',
  russian: 'Russian',
  ru: 'Russian',
  arabic: 'Arabic',
  ar: 'Arabic',
  hindi: 'Hindi',
  hi: 'Hindi',
  thai: 'Thai',
  th: 'Thai',
  vietnamese: 'Vietnamese',
  vi: 'Vietnamese',
  indonesian: 'Indonesian',
  id: 'Indonesian',
  turkish: 'Turkish',
  tr: 'Turkish',
  dutch: 'Dutch',
  nl: 'Dutch',
  polish: 'Polish',
  pl: 'Polish',
  ukrainian: 'Ukrainian',
  uk: 'Ukrainian',
  czech: 'Czech',
  cs: 'Czech'
};

function normalizeLanguageAlias(value, fallback = 'Chinese') {
  if (!value) {
    return fallback;
  }
  const key = value.toString().trim().toLowerCase();
  return LANGUAGE_ALIASES[key] || fallback;
}


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
  setDocumentLanguage(lang);
  window.appI18n.setLanguage(lang);
  if (typeof window.appI18n.apply === 'function') {
    window.appI18n.apply();
  }
}

function initializeLanguage() {
  if (!window.appI18n) {
    return;
  }
  setDocumentLanguage(DEFAULT_LANGUAGE);
  window.appI18n.setLanguage(DEFAULT_LANGUAGE);
  if (typeof window.appI18n.apply === 'function') {
    window.appI18n.apply();
  }
  document.title = t('voice.pageTitle');
  if (typeof window.appI18n.onChange === 'function') {
    window.appI18n.onChange(() => {
      registerVoiceInputTranslations();
      if (typeof window.appI18n.apply === 'function') {
        window.appI18n.apply();
      }
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
    const normalized = normalizeLanguageAlias(raw);
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




