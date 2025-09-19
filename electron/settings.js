let currentConfig = {};
let autoSaveTimeout = null; // Debounce timer

const DEFAULT_GEMINI_PROMPT = [
    'You are a professional translation assistant.',
    'Translate user text into {{TARGET_LANGUAGE}}.',
    'Requirements:',
    '1) Preserve the tone and intent of the original text.',
    '2) Ensure the translation is natural and fluent.',
    '3) If the input is already in {{TARGET_LANGUAGE}}, return it unchanged.',
    '4) Respond with translation only without extra commentary.'
].join('\n');

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
    document.title = t('settings.nav.title');
    if (typeof window.appI18n.onChange === 'function') {
        window.appI18n.onChange(() => {
            registerSettingsTranslations();
            window.appI18n.apply();
            document.title = t('settings.nav.title');
        });
    }
}


function registerSettingsTranslations() {
    if (!window.appI18n) {
        return;
    }

    const navTitle = document.querySelector('.nav-title');
    if (navTitle) {
        navTitle.dataset.i18n = 'settings.nav.title';
    }

    const backButton = document.querySelector('.back-btn');
    if (backButton) {
        backButton.dataset.i18n = 'common.backNav';
        backButton.dataset.i18nTitle = 'settings.nav.backTooltip';
    }

    const headerTitle = document.querySelector('.settings-header h1');
    if (headerTitle) {
        headerTitle.dataset.i18n = 'settings.header.title';
    }
    const headerSubtitle = document.querySelector('.settings-header p');
    if (headerSubtitle) {
        headerSubtitle.dataset.i18n = 'settings.header.subtitle';
    }

    const sectionTitleKeys = [
        'settings.section.recognitionEngine',
        'settings.section.translationEngine',
        'settings.section.openaiCommon',
        'settings.section.translation',
        'settings.section.transcription',
        'settings.section.recording',
        'settings.section.interfaceLanguage'
    ];
    document.querySelectorAll('.section-title').forEach((element, index) => {
        const key = sectionTitleKeys[index];
        if (key) {
            element.dataset.i18n = key;
        }
    });

    const labelKeys = {
        recognitionEngine: 'settings.labels.recognitionEngine',
        openaiTranscribeModel: 'settings.labels.openaiTranscribeModel',
        sonioxApiKey: 'settings.labels.sonioxApiKey',
        dashscopeApiKey: 'settings.labels.dashscopeApiKey',
        qwen3AsrModel: 'settings.labels.qwen3AsrModel',
        translationEngine: 'settings.labels.translationEngine',
        geminiApiKey: 'settings.labels.geminiApiKey',
        geminiTranslateModel: 'settings.labels.geminiTranslateModel',
        openaiTranslateModel: 'settings.labels.openaiTranslateModel',
        apiKey: 'settings.labels.apiKey',
        apiUrl: 'settings.labels.apiUrl',
        enableTranslation: 'settings.labels.enableTranslation',
        translationMode: 'settings.labels.translationMode',
        targetLanguage: 'settings.labels.targetLanguage',
        language1: 'settings.labels.language1',
        language2: 'settings.labels.language2',
        transcribeLanguage: 'settings.labels.transcribeLanguage',
        silenceThreshold: 'settings.labels.silenceThreshold',
        silenceDuration: 'settings.labels.silenceDuration',
        theaterMode: 'settings.labels.theaterMode',
        appLanguage: 'settings.labels.appLanguage'
    };
    Object.entries(labelKeys).forEach(([id, key]) => {
        const label = document.querySelector('label[for="' + id + '"]');
        if (label) {
            label.dataset.i18n = key;
        }
    });


    const customLanguageInput = document.getElementById('customLanguage');
    if (customLanguageInput) {
        customLanguageInput.dataset.i18nPlaceholder = 'settings.placeholders.customLanguage';
    }

    const noteMappings = [
        { labelFor: 'recognitionEngine', key: 'settings.notes.recognitionEngine' },
        { labelFor: 'openaiTranscribeModel', key: 'settings.notes.openaiTranscribeModel' },
        { labelFor: 'sonioxApiKey', key: 'settings.notes.sonioxApiKey' },
        { labelFor: 'dashscopeApiKey', key: 'settings.notes.dashscopeApiKey' },
        { labelFor: 'qwen3AsrModel', key: 'settings.notes.qwen3AsrModel' },
        { labelFor: 'translationEngine', key: 'settings.notes.translationEngine' },
        { labelFor: 'geminiApiKey', key: 'settings.notes.geminiApiKey' },
        { labelFor: 'geminiTranslateModel', key: 'settings.notes.geminiTranslateModel' },
        { labelFor: 'openaiTranslateModel', key: 'settings.notes.openaiTranslateModel' },
        { labelFor: 'apiKey', key: 'settings.notes.apiKey' },
        { labelFor: 'apiUrl', key: 'settings.notes.apiUrl' },
        { labelFor: 'translationMode', key: 'settings.notes.translationMode' },
        { labelFor: 'targetLanguage', key: 'settings.notes.targetLanguage' },
        { labelFor: 'transcribeLanguage', key: 'settings.notes.transcribeLanguage', mode: 'html' },
        { inputId: 'theaterMode', key: 'settings.notes.theaterMode', relative: 'next' },
        { selector: '#appLanguage', key: 'settings.notes.appLanguage', type: 'parent' }
    ];

    noteMappings.forEach(({ labelFor, selector, inputId, key, mode, relative, type }) => {
        let note = null;
        if (labelFor) {
            const label = document.querySelector('label[for="' + labelFor + '"]');
            if (label) {
                const group = label.closest('.form-group') || label.closest('.checkbox-group');
                if (group) {
                    note = group.querySelector('.form-note');
                }
            }
        } else if (selector) {
            const element = document.querySelector(selector);
            if (element) {
                if (type === 'parent') {
                    note = element.closest('.form-group')?.querySelector('.form-note');
                } else {
                    note = element;
                }
            }
        } else if (inputId) {
            const input = document.getElementById(inputId);
            if (input && relative === 'next') {
                note = input.closest('.checkbox-group')?.nextElementSibling;
            }
        }
        if (note) {
            note.dataset.i18n = key;
            if (mode === 'html') {
                note.dataset.i18nMode = 'html';
            }
        }
    });

    const backLink = document.querySelector('.button-group .btn.btn-secondary');
    if (backLink) {
        backLink.dataset.i18n = 'common.backLink';
    }
}



if (window.appI18n && typeof window.appI18n.extend === 'function') {
    window.appI18n.extend({
        en: {
            'common.backNav': '← Back',
            'common.backLink': 'Back',
            'settings.nav.title': 'Settings',
            'settings.nav.backTooltip': 'Back to main window',
            'settings.header.title': 'Settings',
            'settings.header.subtitle': 'Configure API keys and transcription/translation options.',
            'settings.section.recognitionEngine': 'Recognition Engine',
            'settings.section.translationEngine': 'Translation Engine',
            'settings.section.openaiCommon': 'OpenAI Common Settings',
            'settings.section.translation': 'Translation Settings',
            'settings.section.transcription': 'Transcription Settings',
            'settings.section.recording': 'Recording Settings',
            'settings.section.interfaceLanguage': 'Interface Language',
            'settings.labels.recognitionEngine': 'Recognition Engine',
            'settings.labels.openaiTranscribeModel': 'Transcribe Model',
            'settings.labels.sonioxApiKey': 'Soniox API Key',
            'settings.labels.dashscopeApiKey': 'DashScope API Key',
            'settings.labels.qwen3AsrModel': 'Qwen3-ASR Model',
            'settings.labels.translationEngine': 'Translation Engine',
            'settings.labels.geminiApiKey': 'Gemini API Key',
            'settings.labels.geminiTranslateModel': 'Gemini Model',
            'settings.labels.openaiTranslateModel': 'Translate Model',
            'settings.labels.apiKey': 'OpenAI API Key',
            'settings.labels.apiUrl': 'API Base URL (optional)',
            'settings.labels.enableTranslation': 'Enable Auto Translation',
            'settings.labels.translationMode': 'Translation Mode',
            'settings.labels.targetLanguage': 'Target Language',
            'settings.labels.language1': 'Language 1',
            'settings.labels.language2': 'Language 2',
            'settings.labels.transcribeLanguage': 'Transcription Language',
            'settings.labels.silenceThreshold': 'Silence Threshold',
            'settings.labels.silenceDuration': 'Silence Split Duration (seconds)',
            'settings.labels.theaterMode': 'Theater Mode',
            'settings.labels.appLanguage': 'Choose Language',
            'settings.placeholders.customLanguage': 'Enter a custom language',
            'settings.notes.recognitionEngine': 'Choose the provider for speech recognition (transcription).',
            'settings.notes.openaiTranscribeModel': 'Audio transcription model (default gpt-4o-transcribe).',
            'settings.notes.sonioxApiKey': 'Required when the recognition engine is Soniox.',
            'settings.notes.dashscopeApiKey': 'Qwen3-ASR is provided via DashScope. Enter your DashScope API Key (or set environment variable DASHSCOPE_API_KEY).',
            'settings.notes.qwen3AsrModel': 'Default is qwen3-asr-flash; change if you need another model.',
            'settings.notes.translationEngine': 'Choose the provider for text translation (OpenAI or Gemini).',
            'settings.notes.geminiApiKey': 'Gemini Developer API key stored locally for translation.',
            'settings.notes.geminiTranslateModel': 'Default system prompt is generated automatically; override the model if needed.',
            'settings.notes.openaiTranslateModel': 'Model used for text translation.',
            'settings.notes.apiKey': 'Saved to local config.json; shared by transcription and translation.',
            'settings.notes.apiUrl': 'Leave empty to use OpenAI default; if custom, end with /v1.',
            'settings.notes.translationMode': 'Fixed: always translate to the target; Smart: better for bilingual conversations.',
            'settings.notes.targetLanguage': 'Select a common language or choose "Custom..." and type a language name.',
            'settings.notes.transcribeLanguage': 'Choosing "Auto Detect" will not use a prompt; choosing a specific language will use the prompt "Please transcribe in XX language".<br><strong>Note: In Smart translation mode, transcription language will be auto-detected.</strong>',
            'settings.notes.silenceThreshold': 'Smaller is more sensitive. Recommended range: 0.005–0.02.',
            'settings.notes.silenceDuration': 'Split when continuous silence exceeds this duration.',
            'settings.notes.theaterMode': 'Amplify quiet audio to normal speech volume to improve recognition.',
            'settings.notes.appLanguage': 'Changes take effect immediately and will be saved to your configuration.',
            'settings.notify.saved': 'Settings saved',
            'settings.notify.saveFailed': 'Save failed',
            'settings.notify.loadFailed': 'Failed to load configuration',
            'settings.notify.reloaded': 'Configuration reloaded',
            'settings.error.translationLanguageRequired': 'Please set the target translation language'
        },
        zh: {
            'common.backNav': '← 返回',
            'common.backLink': '返回',
            'settings.nav.title': '设置',
            'settings.nav.backTooltip': '返回主窗口',
            'settings.header.title': '设置',
            'settings.header.subtitle': '配置 API 密钥以及转写、翻译相关选项。',
            'settings.section.recognitionEngine': '识别引擎',
            'settings.section.translationEngine': '翻译引擎',
            'settings.section.openaiCommon': 'OpenAI 通用设置',
            'settings.section.translation': '翻译设置',
            'settings.section.transcription': '转写设置',
            'settings.section.recording': '录音设置',
            'settings.section.interfaceLanguage': '界面语言',
            'settings.labels.recognitionEngine': '识别引擎',
            'settings.labels.openaiTranscribeModel': '转写模型',
            'settings.labels.sonioxApiKey': 'Soniox API 密钥',
            'settings.labels.dashscopeApiKey': 'DashScope API 密钥',
            'settings.labels.qwen3AsrModel': 'Qwen3-ASR 模型',
            'settings.labels.translationEngine': '翻译引擎',
            'settings.labels.geminiApiKey': 'Gemini API 密钥',
            'settings.labels.geminiTranslateModel': 'Gemini 模型',
            'settings.labels.openaiTranslateModel': '翻译模型',
            'settings.labels.apiKey': 'OpenAI API 密钥',
            'settings.labels.apiUrl': 'API 基础地址（可选）',
            'settings.labels.enableTranslation': '启用自动翻译',
            'settings.labels.translationMode': '翻译模式',
            'settings.labels.targetLanguage': '目标语言',
            'settings.labels.language1': '语言 1',
            'settings.labels.language2': '语言 2',
            'settings.labels.transcribeLanguage': '转写语言',
            'settings.labels.silenceThreshold': '静音阈值',
            'settings.labels.silenceDuration': '静音切分时长（秒）',
            'settings.labels.theaterMode': '剧场模式',
            'settings.labels.appLanguage': '界面语言',
            'settings.placeholders.customLanguage': '输入自定义语言',
            'settings.notes.recognitionEngine': '选择语音识别（转写）所使用的服务商。',
            'settings.notes.openaiTranscribeModel': '音频转写模型（默认 gpt-4o-transcribe）。',
            'settings.notes.sonioxApiKey': '当识别引擎选择 Soniox 时必须填写。',
            'settings.notes.dashscopeApiKey': 'Qwen3-ASR 由 DashScope 提供，请填写 DashScope API Key（或设置环境变量 DASHSCOPE_API_KEY）。',
            'settings.notes.qwen3AsrModel': '默认使用 qwen3-asr-flash，可根据需要更换模型。',
            'settings.notes.translationEngine': '选择文本翻译服务商（OpenAI 或 Gemini）。',
            'settings.notes.geminiApiKey': '用于翻译的 Gemini 开发者 API 密钥，保存在本地。',
            'settings.notes.geminiTranslateModel': '系统提示会自动生成，如需可自定义模型。',
            'settings.notes.openaiTranslateModel': '用于文本翻译的模型。',
            'settings.notes.apiKey': '保存在本地 config.json，供转写与翻译共用。',
            'settings.notes.apiUrl': '留空将使用 OpenAI 默认地址；自定义地址请以 /v1 结尾。',
            'settings.notes.translationMode': '固定模式：始终翻译为目标语言；智能模式：适合双语对话场景。',
            'settings.notes.targetLanguage': '在常用语言中选择，或选 “Custom...” 并输入自定义语言名称。',
            'settings.notes.transcribeLanguage': '选择 “Auto Detect” 时不会附带提示；指定语言则会使用 “Please transcribe in XX language”。<br><strong>注意：智能翻译模式下会自动检测转写语言。</strong>',
            'settings.notes.silenceThreshold': '数值越小越灵敏。推荐范围：0.005–0.02。',
            'settings.notes.silenceDuration': '当持续静音超过该时长时进行切分。',
            'settings.notes.theaterMode': '放大较小的音量，使其达到正常语音水平以提升识别效果。',
            'settings.notes.appLanguage': '更改后立即生效并写入配置文件。',
            'settings.notify.saved': '设置已保存',
            'settings.notify.saveFailed': '保存失败',
            'settings.notify.loadFailed': '读取配置失败',
            'settings.notify.reloaded': '配置已重新载入',
            'settings.error.translationLanguageRequired': '请设置目标翻译语言'
        }
    });
}


document.addEventListener('DOMContentLoaded', () => {
    initializeLanguage();
    registerSettingsTranslations();
    if (window.appI18n) { window.appI18n.apply(); }
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

    const appLanguageSelect = document.getElementById('appLanguage');
    if (appLanguageSelect) {
        appLanguageSelect.addEventListener('change', () => {
            const value = appLanguageSelect.value || DEFAULT_LANGUAGE;
            if (window.appI18n && typeof window.appI18n.setLanguage === 'function') {
                window.appI18n.setLanguage(value);
            }
            autoSave();
        });
        appLanguageSelect.addEventListener('blur', autoSave);
    }

    
    // Real-time validation of API key format and trigger home page detection
    document.getElementById('apiKey').addEventListener('input', (event) => {
        try { validateApiKey(); } catch {}
        // Trigger auto-save when API key input changes for real-time detection on main page
        autoSave();
    });
    
    // API URL changes also trigger real-time detection
    document.getElementById('apiUrl').addEventListener('input', autoSave);
    const geminiApiKey = document.getElementById('geminiApiKey');
    if (geminiApiKey) {
        geminiApiKey.addEventListener('input', autoSave);
    }
    
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
        'apiKey', 'apiUrl', 'openaiTranscribeModel', 'openaiTranslateModel', 'geminiApiKey', 'geminiTranslateModel', 'targetLanguage', 'customLanguage', 'transcribeLanguage',
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

async function loadCurrentConfig() {
    try {
        currentConfig = await window.electronAPI.getConfig();
        applyLanguageFromConfig(currentConfig);
        populateForm(currentConfig);
    } catch (error) {
        showTopNotification(`${t('settings.notify.loadFailed')}: ${error.message}`, 'error');
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
    const geminiKeyEl = document.getElementById('geminiApiKey');
    if (geminiKeyEl) geminiKeyEl.value = config.gemini_api_key || '';
    const geminiModelEl = document.getElementById('geminiTranslateModel');
    if (geminiModelEl) geminiModelEl.value = config.gemini_translate_model || 'gemini-2.0-flash';
    if (!config.gemini_translate_system_prompt || !String(config.gemini_translate_system_prompt).trim()) {
        config.gemini_translate_system_prompt = DEFAULT_GEMINI_PROMPT;
    }

    
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
    const appLanguageSelect = document.getElementById('appLanguage');
    if (appLanguageSelect) {
        const langValue = (config.app_language === 'zh' || config.app_language === 'en') ? config.app_language : DEFAULT_LANGUAGE;
        appLanguageSelect.value = langValue;
    }

    
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
    document.querySelectorAll('.provider-gemini-trans').forEach(el => {
        el.style.display = (tl === 'gemini') ? '' : 'none';
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
                    showTopNotification(t('settings.error.translationLanguageRequired'), 'error');
                }
                return false;
            }
        }
        
        await window.electronAPI.saveConfig(config);
        currentConfig = config;
        
        if (!silent) {
            showTopNotification(t('settings.notify.saved'), 'success');
        }
        return true;
        
    } catch (error) {
        if (!silent) {
            showTopNotification(`${t('settings.notify.saveFailed')}: ${error.message}`, 'error');
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
    const geminiKeyEl = document.getElementById('geminiApiKey');
    if (geminiKeyEl) config.gemini_api_key = geminiKeyEl.value.trim();
    const geminiModelEl = document.getElementById('geminiTranslateModel');
    if (geminiModelEl) {
        const geminiModelValue = (geminiModelEl.value || '').trim();
        config.gemini_translate_model = geminiModelValue || 'gemini-2.0-flash';
    } else {
        config.gemini_translate_model = config.gemini_translate_model || 'gemini-2.0-flash';
    }
    const previousGeminiPrompt = (currentConfig && typeof currentConfig.gemini_translate_system_prompt === 'string')
        ? currentConfig.gemini_translate_system_prompt
        : '';
    const trimmedPrompt = previousGeminiPrompt ? previousGeminiPrompt.trim() : '';
    config.gemini_translate_system_prompt = trimmedPrompt || DEFAULT_GEMINI_PROMPT;

    
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

    const appLanguageSelect = document.getElementById('appLanguage');

    config.app_language = (appLanguageSelect ? appLanguageSelect.value : DEFAULT_LANGUAGE) || DEFAULT_LANGUAGE;
    
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









