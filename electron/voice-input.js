let currentConfig = {};

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  setupEvents();
});

async function loadConfig() {
  try {
    currentConfig = await window.electronAPI.getConfig();
    fillForm(currentConfig);
  } catch (e) {
    notify('❌ 加载配置失败', 'error');
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

  // 所有控件默认失焦即保存
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
    notify('❌ 保存失败', 'error');
    return false;
  }
}

// Debounced autosave
let t = null;
function autoSave() {
  if (t) clearTimeout(t);
  t = setTimeout(() => { save(); }, 600);
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
