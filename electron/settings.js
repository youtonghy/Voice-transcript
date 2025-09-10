let currentConfig = {};
let autoSaveTimeout = null; // Debounce timer

document.addEventListener('DOMContentLoaded', () => {
    loadCurrentConfig();
    setupEventListeners();
    try { updateProviderVisibility(); } catch {}
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
    
    // 引擎切换（识别/翻译）
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
    
    // Add auto-save on blur for all input fields
    const autoSaveInputs = [
        'apiKey', 'apiUrl', 'openaiTranscribeModel', 'openaiTranslateModel', 'targetLanguage', 'customLanguage', 'transcribeLanguage',
        'translationMode', 'language1', 'language2', 'recognitionEngine', 'translationEngine', 'sonioxApiKey', 'qwenApiKey',
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

async function loadCurrentConfig() {
    try {
        currentConfig = await window.electronAPI.getConfig();
        populateForm(currentConfig);
    } catch (error) {
        showTopNotification(`❌ 加载配置失败: ${error.message}`, 'error');
    }
}

function populateForm(config) {
    // 引擎配置（兼容旧字段 transcribe_source）
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
    const qwenEl = document.getElementById('qwenApiKey');
    if (qwenEl) qwenEl.value = (config.dashscope_api_key || config.qwen_api_key || '') || '';
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
    const savedLang = config.translate_language || '中文';
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
    document.getElementById('language1').value = config.smart_language1 || '中文';
    document.getElementById('language2').value = config.smart_language2 || 'English';
    
    // Advanced settings
    document.getElementById('silenceThreshold').value = config.silence_rms_threshold || 0.010;
    document.getElementById('silenceDuration').value = config.min_silence_seconds || 1.0;
    document.getElementById('theaterMode').checked = config.theater_mode === true;
    
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
        note.textContent = '智能翻译模式下，转录语言将自动检测';
        note.style.fontSize = '12px';
        note.style.color = '#666';
        note.style.marginTop = '5px';
        transcribeContainer.appendChild(note);
    }
}

function updateProviderVisibility() {
    const rec = (document.getElementById('recognitionEngine') || {}).value || 'openai';
    const tl = (document.getElementById('translationEngine') || {}).value || 'openai';
    // OpenAI 通用配置：任一引擎为 OpenAI 时显示
    document.querySelectorAll('.provider-openai-common').forEach(el => {
        el.style.display = (rec === 'openai' || tl === 'openai') ? '' : 'none';
    });
    // OpenAI 识别模型：当识别引擎为 OpenAI 时显示
    document.querySelectorAll('.provider-openai-rec').forEach(el => {
        el.style.display = (rec === 'openai') ? '' : 'none';
    });
    // OpenAI 翻译模型：当翻译引擎为 OpenAI 时显示
    document.querySelectorAll('.provider-openai-trans').forEach(el => {
        el.style.display = (tl === 'openai') ? '' : 'none';
    });
    // Soniox/Qwen3-ASR 凭据：仅识别引擎对应时显示
    document.querySelectorAll('.provider-soniox').forEach(el => {
        el.style.display = (rec === 'soniox') ? '' : 'none';
    });
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
        indicator.textContent = '✓ 格式正确';
        indicator.className = 'valid';
    } else {
        indicator.textContent = '✗ 格式无效';
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
                    showTopNotification('❌ 请设置翻译目标语言', 'error');
                }
                return false;
            }
        }
        
        await window.electronAPI.saveConfig(config);
        currentConfig = config;
        
        if (!silent) {
            showTopNotification('✅ 设置已保存', 'success');
        }
        return true;
        
    } catch (error) {
        if (!silent) {
            showTopNotification(`❌ 保存失败: ${error.message}`, 'error');
        }
        console.error('Save settings error:', error);
        return false;
    }
}

function collectFormData() {
    const config = {};
    
    // 引擎配置
    config.recognition_engine = (document.getElementById('recognitionEngine') || { value: 'openai' }).value;
    config.translation_engine = (document.getElementById('translationEngine') || { value: 'openai' }).value;
    // 向后兼容字段
    config.transcribe_source = config.recognition_engine;
    config.openai_api_key = document.getElementById('apiKey').value.trim();
    config.openai_base_url = document.getElementById('apiUrl').value.trim();
    const sonioxEl = document.getElementById('sonioxApiKey');
    if (sonioxEl) config.soniox_api_key = sonioxEl.value.trim();
    const qwenEl = document.getElementById('qwenApiKey');
    if (qwenEl) config.dashscope_api_key = qwenEl.value.trim();
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
    
    return config;
}

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
