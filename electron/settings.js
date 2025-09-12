let currentConfig = {};
let autoSaveTimeout = null; // Debounce timer

document.addEventListener('DOMContentLoaded', () => {
    loadCurrentConfig();
    setupEventListeners();
    try { updateProviderVisibility(); } catch {}
    try { scrollToHashSection(); } catch {}
    try { attachGlobalAutoSave(); } catch {}
});

function setupEventListeners() {
    // Form submission
    document.getElementById('settingsForm').addEventListener('submit', saveSettings);
    
    // Translation switch
    document.getElementById('enableTranslation').addEventListener('change', toggleTranslationSettings);
    document.getElementById('enableTranslation').addEventListener('change', autoSave);
    
    // Translation mode switching
    document.getElementById('translationMode').addEventListener('change', () => {
        updateTranslationModeSettings();
        updateTranscribeLanguageAvailability();
        autoSave();
    });
    
    // Update transcription language availability when translation switch changes
    document.getElementById('enableTranslation').addEventListener('change', () => {
        updateTranscribeLanguageAvailability();
    });
    
    // Theater mode switch
    document.getElementById('theaterMode').addEventListener('change', autoSave);
    
    // Target language selection and customization
    const targetLanguage = document.getElementById('targetLanguage');
    const customLanguage = document.getElementById('customLanguage');
    targetLanguage.addEventListener('change', () => {
        updateCustomLanguageVisibility();
        autoSave();
    });
    customLanguage.addEventListener('input', autoSave);
    
    // Real-time validation of API key format and trigger home page detection
    document.getElementById('apiKey').addEventListener('input', (event) => {
        try { validateApiKey(); } catch {}
        // Trigger auto-save when API key input changes for real-time detection on main page
        autoSave();
    });
    
    // API URL changes also trigger real-time detection
    document.getElementById('apiUrl').addEventListener('input', autoSave);
    
    // 寮曟搸鍒囨崲锛堣瘑鍒?缈昏瘧锛?
    const recognitionEngine = document.getElementById('recognitionEngine');
    const translationEngine = document.getElementById('translationEngine');
    if (recognitionEngine) {
        recognitionEngine.addEventListener('change', () => {
            updateProviderVisibility();
            autoSave();
            try { console.log('[Settings] Recognition engine ->', recognitionEngine.value); } catch {}
        });
    }
    if (translationEngine) {
        translationEngine.addEventListener('change', () => {
            updateProviderVisibility();
            autoSave();
            try { console.log('[Settings] Translation engine ->', translationEngine.value); } catch {}
        });
    }
    
    // Voice input listeners
    const viEnabledEl = document.getElementById('voiceInputEnabled');
    const viHotkeyEl = document.getElementById('voiceInputHotkey');
    const viEngineEl = document.getElementById('voiceInputEngine');
    const viLangEl = document.getElementById('voiceInputLanguage');
    const viTlChk = document.getElementById('voiceInputTranslate');
    const viTlLang = document.getElementById('voiceInputTranslateLanguage');
    const viTlGroup = document.getElementById('voiceInputTranslateLanguageGroup');
    if (viEnabledEl) viEnabledEl.addEventListener('change', autoSave);
    if (viHotkeyEl) { viHotkeyEl.addEventListener('blur', autoSave); viHotkeyEl.addEventListener('change', autoSave); }
    if (viEngineEl) viEngineEl.addEventListener('change', autoSave);
    if (viLangEl) viLangEl.addEventListener('change', autoSave);
    if (viTlChk) viTlChk.addEventListener('change', () => {
        if (viTlGroup) viTlGroup.style.display = viTlChk.checked ? 'block' : 'none';
        autoSave();
    });
    if (viTlLang) viTlLang.addEventListener('input', autoSave);
    // No trigger mode switch (global toggle only)
    
    // Add auto-save on blur for all input fields
    const autoSaveInputs = [
        'apiKey', 'apiUrl', 'openaiTranscribeModel', 'openaiTranslateModel', 'targetLanguage', 'customLanguage', 'transcribeLanguage',
        'translationMode', 'language1', 'language2', 'recognitionEngine', 'translationEngine', 'sonioxApiKey', 'dashscopeApiKey', 'qwen3AsrModel',
        'silenceThreshold', 'silenceDuration', 'theaterMode'
    ];
    
    autoSaveInputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input) {
            input.addEventListener('blur', autoSave);
            input.addEventListener('change', autoSave);
        }
    });
}

// Scroll to anchor section if hash exists (e.g., #voice-input)
function scrollToHashSection() {
  const hash = (window.location.hash || '').replace(/^#/, '');
  if (!hash) return;
  const el = document.getElementById(hash);
  if (el && typeof el.scrollIntoView === 'function') {
    setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      try { el.focus({ preventScroll: true }); } catch {}
    }, 50);
  }
}

// 瀵硅缃〃鍗曞唴鎵€鏈夋帶浠舵坊鍔犲け鐒﹀嵆淇濆瓨
function attachGlobalAutoSave() {
  const form = document.getElementById('settingsForm');
  if (!form) return;
  const controls = form.querySelectorAll('input, select, textarea');
  controls.forEach(el => {
    el.addEventListener('blur', autoSave);
    el.addEventListener('change', autoSave);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.addEventListener('input', debounce(autoSave, 600));
    }
  });
}

function debounce(fn, ms) { let h=null; return (...args)=>{ if (h) clearTimeout(h); h=setTimeout(()=>fn(...args), ms); }; }

async function loadCurrentConfig() {
    try {
        currentConfig = await window.electronAPI.getConfig();
        populateForm(currentConfig);
    } catch (error) {
        showTopNotification(`Failed to load configuration: ${error.message}`, 'error');
    }
}

function populateForm(config) {
    // 寮曟搸閰嶇疆锛堝吋瀹规棫瀛楁 transcribe_source锛?
    (function(){
        const recEl = document.getElementById('recognitionEngine');
        const tlEl = document.getElementById('translationEngine');
        const rec = (config.recognition_engine || config.transcribe_source || 'openai');
        const tl = (config.translation_engine || 'openai');
        if (recEl) recEl.value = rec;
        if (tlEl) tlEl.value = tl;
        updateProviderVisibility();
    })();
    document.getElementById('apiKey').value = config.openai_api_key || '';
    document.getElementById('apiUrl').value = config.openai_base_url || '';
    const sonioxEl = document.getElementById('sonioxApiKey');
    if (sonioxEl) sonioxEl.value = config.soniox_api_key || '';
    
    const dashscopeEl = document.getElementById('dashscopeApiKey');
    if (dashscopeEl) dashscopeEl.value = config.dashscope_api_key || '';
    const qwenModelEl = document.getElementById('qwen3AsrModel');
    if (qwenModelEl) qwenModelEl.value = config.qwen3_asr_model || 'qwen3-asr-flash';
    
    // OpenAI model fields
    const oaiTrModel = document.getElementById('openaiTranscribeModel');
    if (oaiTrModel) oaiTrModel.value = config.openai_transcribe_model || 'gpt-4o-transcribe';
    const oaiTlModel = document.getElementById('openaiTranslateModel');
    if (oaiTlModel) oaiTlModel.value = config.openai_translate_model || 'gpt-4o-mini';
    
    // Translation settings
    const enableTranslation = document.getElementById('enableTranslation');
    enableTranslation.checked = config.enable_translation !== false;
    
    // Target language: if not in dropdown options, switch to custom
    const targetLanguage = document.getElementById('targetLanguage');
    const customLanguage = document.getElementById('customLanguage');
    let savedLang = config.translate_language || 'Chinese';
    if (savedLang === '中文') savedLang = 'Chinese';
    const options = Array.from(targetLanguage.options).map(o => o.value);
    if (options.includes(savedLang)) {
        targetLanguage.value = savedLang;
        if (customLanguage) {
            customLanguage.style.display = 'none';
            customLanguage.value = '';
        }
    } else {
        targetLanguage.value = '__custom__';
        if (customLanguage) {
            customLanguage.style.display = 'block';
            customLanguage.value = savedLang;
        }
    }
    
    // Recording settings
    (function(){
        const el = document.getElementById('transcribeLanguage');
        if (el) el.value = config.transcribe_language || 'auto';
    })();
    
    // Translation mode settings
    (function(){
        const el = document.getElementById('translationMode');
        if (el) el.value = config.translation_mode || 'fixed';
    })();
    
    // Smart translation language settings
    document.getElementById('language1').value = config.smart_language1 || 'Chinese';
    document.getElementById('language2').value = config.smart_language2 || 'English';
    
    // Advanced settings
    document.getElementById('silenceThreshold').value = config.silence_rms_threshold || 0.010;
    document.getElementById('silenceDuration').value = config.min_silence_seconds || 1.0;
    document.getElementById('theaterMode').checked = config.theater_mode === true;
    
    // Voice input settings
    try {
        const viEnabledEl = document.getElementById('voiceInputEnabled');
        const viHotkeyEl = document.getElementById('voiceInputHotkey');
        const viEngineEl = document.getElementById('voiceInputEngine');
        const viLangEl = document.getElementById('voiceInputLanguage');
        const viTlChk = document.getElementById('voiceInputTranslate');
        const viTlLang = document.getElementById('voiceInputTranslateLanguage');
        const viTlGroup = document.getElementById('voiceInputTranslateLanguageGroup');

        if (viEnabledEl) viEnabledEl.checked = !!(config.voice_input_enabled);
        if (viHotkeyEl) viHotkeyEl.value = (config.voice_input_hotkey || 'F3');
    if (viEngineEl) {
        let eng = (config.voice_input_engine || config.recognition_engine || config.transcribe_source || 'openai');
        viEngineEl.value = eng;
    }
        if (viLangEl) viLangEl.value = (config.voice_input_language || 'auto');
        if (viTlChk) viTlChk.checked = !!config.voice_input_translate;
        if (viTlLang) viTlLang.value = (config.voice_input_translate_language || config.translate_language || 'Chinese');
        if (viTlGroup) viTlGroup.style.display = (viTlChk && viTlChk.checked) ? 'block' : 'none';
        // Trigger mode removed; always global toggle
    } catch {}

    // Update UI based on current settings (guarded)
    try { toggleTranslationSettings(); } catch {}
    try { updateCustomLanguageVisibility(); } catch {}
    try { updateTranslationModeSettings(); } catch {}
    try { updateTranscribeLanguageAvailability(); } catch {}
    try { validateApiKey(); } catch {}
}

function toggleTranslationSettings() {
    const enable = document.getElementById('enableTranslation').checked;
    const elements = [
        'targetLanguage', 'customLanguage', 'translationMode', 
        'language1', 'language2'
    ];
    
    elements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.disabled = !enable;
        }
    });
    
    // Also disable/enable the translation mode container
    const modeContainer = document.querySelector('.translation-mode-container');
    if (modeContainer) {
        modeContainer.style.opacity = enable ? '1' : '0.5';
    }
}

function updateCustomLanguageVisibility() {
    const targetLanguage = document.getElementById('targetLanguage');
    const customLanguage = document.getElementById('customLanguage');
    if (!targetLanguage || !customLanguage) return;
    if (targetLanguage.value === '__custom__') {
        customLanguage.style.display = 'block';
        customLanguage.required = true;
    } else {
        customLanguage.style.display = 'none';
        customLanguage.required = false;
    }
}

function updateTranslationModeSettings() {
    const modeEl = document.getElementById('translationMode');
    const mode = modeEl ? modeEl.value : 'fixed';
    const smartSettings = document.querySelector('.smart-translation-settings');
    if (!smartSettings) return;
    if (mode === 'smart') {
        smartSettings.style.display = 'block';
    } else {
        smartSettings.style.display = 'none';
    }
}

function updateTranscribeLanguageAvailability() {
    const enableEl = document.getElementById('enableTranslation');
    const modeEl = document.getElementById('translationMode');
    const transcribeLanguage = document.getElementById('transcribeLanguage');
    if (!enableEl || !modeEl || !transcribeLanguage) return;
    const transcribeContainer = transcribeLanguage.parentElement;
    
    // Transcription language is only available when translation is disabled or in fixed mode
    const isAvailable = !enableEl.checked || modeEl.value === 'fixed';
    
    transcribeLanguage.disabled = !isAvailable;
    if (transcribeContainer && transcribeContainer.style) {
        transcribeContainer.style.opacity = isAvailable ? '1' : '0.5';
    }
    
    // Add a note for smart mode
    if (transcribeContainer) {
        const existingNote = transcribeContainer.querySelector('.mode-note');
        if (existingNote) existingNote.remove();
    }
    
    if (enableEl.checked && modeEl.value === 'smart' && transcribeContainer) {
        const note = document.createElement('div');
        note.className = 'mode-note';
        note.textContent = 'In Smart translation mode, transcription language is auto-detected';
        note.style.fontSize = '12px';
        note.style.color = '#666';
        note.style.marginTop = '5px';
        transcribeContainer.appendChild(note);
    }
}

function updateProviderVisibility() {
    const rec = (document.getElementById('recognitionEngine') || {}).value || 'openai';
    const tl = (document.getElementById('translationEngine') || {}).value || 'openai';
    // OpenAI 通用设置：任一引擎为 OpenAI 时显示
    document.querySelectorAll('.provider-openai-common').forEach(el => {
        el.style.display = (rec === 'openai' || tl === 'openai') ? '' : 'none';
    });
    // OpenAI 语音识别模型：仅当识别引擎为 OpenAI 时显示
    document.querySelectorAll('.provider-openai-rec').forEach(el => {
        el.style.display = (rec === 'openai') ? '' : 'none';
    });
    // OpenAI 翻译模型：仅当翻译引擎为 OpenAI 时显示
    document.querySelectorAll('.provider-openai-trans').forEach(el => {
        el.style.display = (tl === 'openai') ? '' : 'none';
    });
    // Soniox：仅当识别引擎为 Soniox 时显示
    document.querySelectorAll('.provider-soniox').forEach(el => {
        el.style.display = (rec === 'soniox') ? '' : 'none';
    });
    // Qwen3-ASR：仅当识别引擎为 Qwen3-ASR 时显示
    document.querySelectorAll('.provider-qwen3-asr').forEach(el => {
        el.style.display = (rec === 'qwen3-asr') ? '' : 'none';
    });
}

function validateApiKey() {
    const apiKey = document.getElementById('apiKey').value;
    const indicator = document.getElementById('apiKeyIndicator');
    const submitBtn = document.querySelector('.submit-btn');
    
    if (!apiKey) {
        indicator.textContent = '';
        indicator.className = '';
        return;
    }
    
    if (apiKey.startsWith('sk-') && apiKey.length > 20) {
        indicator.textContent = 'Valid format';
        indicator.className = 'valid';
    } else {
        indicator.textContent = 'Invalid format';
        indicator.className = 'invalid';
    }
}

function autoSave() {
    // Clear existing timeout to debounce
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }
    
    // Set new timeout
    autoSaveTimeout = setTimeout(() => {
        saveSettingsInternal(true); // Silent save
    }, 1000); // 1 second delay
}

async function saveSettings(event) {
    if (event) {
        event.preventDefault();
    }
    
    await saveSettingsInternal(false); // Non-silent save
}

async function saveSettingsInternal(silent = false) {
    try {
        const config = collectFormData();
        
        // Validate required fields
        if (config.enable_translation) {
            const targetLang = document.getElementById('targetLanguage').value === '__custom__' 
                ? document.getElementById('customLanguage').value 
                : document.getElementById('targetLanguage').value;
            
            if (!targetLang.trim()) {
                if (!silent) {
                    showTopNotification('Please set the target translation language', 'error');
                }
                return false;
            }
        }
        
        await window.electronAPI.saveConfig(config);
        currentConfig = config;
        
        if (!silent) {
            showTopNotification('Settings saved', 'success');
        }
        return true;
        
    } catch (error) {
        if (!silent) {
            showTopNotification(`Save failed: ${error.message}`, 'error');
        }
        console.error('Save settings error:', error);
        return false;
    }
}

function collectFormData() {
    const config = {};
    
    // 寮曟搸閰嶇疆
    config.recognition_engine = (document.getElementById('recognitionEngine') || { value: 'openai' }).value;
    config.translation_engine = (document.getElementById('translationEngine') || { value: 'openai' }).value;
    // 鍚戝悗鍏煎瀛楁
    config.transcribe_source = config.recognition_engine;
    config.openai_api_key = document.getElementById('apiKey').value.trim();
    config.openai_base_url = document.getElementById('apiUrl').value.trim();
    const sonioxEl = document.getElementById('sonioxApiKey');
    if (sonioxEl) config.soniox_api_key = sonioxEl.value.trim();
    
    const dashscopeEl = document.getElementById('dashscopeApiKey');
    if (dashscopeEl) config.dashscope_api_key = dashscopeEl.value.trim();
    const qwenModelEl = document.getElementById('qwen3AsrModel');
    if (qwenModelEl) config.qwen3_asr_model = (qwenModelEl.value || '').trim();
    
    // OpenAI models
    const oaiTrModel = document.getElementById('openaiTranscribeModel');
    if (oaiTrModel) config.openai_transcribe_model = (oaiTrModel.value || '').trim();
    const oaiTlModel = document.getElementById('openaiTranslateModel');
    if (oaiTlModel) config.openai_translate_model = (oaiTlModel.value || '').trim();
    
    // Translation settings
    config.enable_translation = document.getElementById('enableTranslation').checked;
    
    if (config.enable_translation) {
        const targetLanguage = document.getElementById('targetLanguage');
        const customLanguage = document.getElementById('customLanguage');
        
        config.translate_language = targetLanguage.value === '__custom__' 
            ? customLanguage.value.trim() 
            : targetLanguage.value;
    }
    
    // Translation mode
    config.translation_mode = document.getElementById('translationMode').value;
    
    // Smart translation languages
    config.smart_language1 = document.getElementById('language1').value.trim();
    config.smart_language2 = document.getElementById('language2').value.trim();
    
    // Recording settings
    config.transcribe_language = document.getElementById('transcribeLanguage').value;
    
    // Advanced settings
    const silenceThreshold = parseFloat(document.getElementById('silenceThreshold').value);
    const silenceDuration = parseFloat(document.getElementById('silenceDuration').value);
    
    if (!isNaN(silenceThreshold)) {
        config.silence_rms_threshold = silenceThreshold;
    }
    if (!isNaN(silenceDuration)) {
        config.min_silence_seconds = silenceDuration;
    }
    
    config.theater_mode = document.getElementById('theaterMode').checked;

    // Voice input
    try {
        const viEnabledEl = document.getElementById('voiceInputEnabled');
        const viHotkeyEl = document.getElementById('voiceInputHotkey');
        const viEngineEl = document.getElementById('voiceInputEngine');
        const viLangEl = document.getElementById('voiceInputLanguage');
        const viTlChk = document.getElementById('voiceInputTranslate');
        const viTlLang = document.getElementById('voiceInputTranslateLanguage');
        if (viEnabledEl) config.voice_input_enabled = viEnabledEl.checked;
        if (viHotkeyEl) config.voice_input_hotkey = (viHotkeyEl.value || '').trim() || 'F3';
        if (viEngineEl) config.voice_input_engine = viEngineEl.value;
        if (viLangEl) config.voice_input_language = viLangEl.value;
        if (viTlChk) config.voice_input_translate = viTlChk.checked;
        if (viTlLang) config.voice_input_translate_language = (viTlLang.value || '').trim();
        // Always use global toggle; no extra field needed
    } catch {}

    return config;
}

// Extend populateForm to handle voice input UI
// (Removed duplicate function definitions added later)

function showTopNotification(message, type = 'info') {
    // Remove existing notifications
    const existingNotifications = document.querySelectorAll('.top-notification');
    existingNotifications.forEach(n => n.remove());
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `top-notification ${type}`;
    notification.textContent = message;
    
    // Style the notification
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${type === 'error' ? '#ff4757' : type === 'success' ? '#2ed573' : '#5352ed'};
        color: white;
        padding: 12px 24px;
        border-radius: 6px;
        font-size: 14px;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideDown 0.3s ease-out;
    `;
    
    // Add CSS animation
    if (!document.querySelector('#notification-styles')) {
        const styles = document.createElement('style');
        styles.id = 'notification-styles';
        styles.textContent = `
            @keyframes slideDown {
                from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
        `;
        document.head.appendChild(styles);
    }
    
    // Add to page
    document.body.appendChild(notification);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideUp 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }
    }, 3000);
}





