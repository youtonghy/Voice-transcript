(function () {
  const DEFAULT_LANGUAGE = 'en';
  const AUTO_SAVE_DELAY = 800;
  const DEFAULT_SECTION = 'engine';
  const SECTION_IDS = ['engine', 'transcription', 'translation', 'recording', 'interface'];
  const DEFAULT_GEMINI_PROMPT = [
    'You are a professional translation assistant.',
    'Translate user text into {{TARGET_LANGUAGE}}.',
    'Requirements:',
    '1) Preserve the tone and intent of the original text.',
    '2) Ensure the translation is natural and fluent.',
    '3) If the input is already in {{TARGET_LANGUAGE}}, return it unchanged.',
    '4) Respond with translation only without extra commentary.'
  ].join('\n');

  let currentConfig = {};
  let autoSaveTimer = null;
  let currentSection = DEFAULT_SECTION;

  function t(key) {
    if (window.appI18n && typeof window.appI18n.t === 'function') {
      return window.appI18n.t(key);
    }
    return key;
  }

  function resolveText(key, fallback) {
    const value = t(key);
    if (!value || value === key) {
      return fallback;
    }
    return value;
  }

  function setDocumentLanguage(lang) {
    if (!document || !document.documentElement) {
      return;
    }
    const normalized = lang === 'zh' ? 'zh-CN' : 'en';
    document.documentElement.lang = normalized;
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

    const sidebarTitle = document.querySelector('.sidebar-title');
    if (sidebarTitle) {
      sidebarTitle.dataset.i18n = 'settings.sidebar.title';
    }

    const sidebarItemMap = {
      engine: 'settings.sidebar.engine',
      transcription: 'settings.sidebar.transcription',
      translation: 'settings.sidebar.translation',
      recording: 'settings.sidebar.recording',
      interface: 'settings.sidebar.interface'
    };
    document.querySelectorAll('.sidebar-item').forEach((item) => {
      const section = item.dataset.section;
      const key = sidebarItemMap[section];
      if (key) {
        item.dataset.i18n = key;
      }
    });

    const sectionTitleMap = {
      recognition: 'settings.section.recognitionEngine',
      translationEngine: 'settings.section.translationEngine',
      summaryEngine: 'settings.section.summaryEngine',
      openaiCommon: 'settings.section.openaiCommon',
      translation: 'settings.section.translation',
      transcription: 'settings.section.transcription',
      recording: 'settings.section.recording',
      interface: 'settings.section.interfaceLanguage'
    };
    Object.entries(sectionTitleMap).forEach(([key, i18nKey]) => {
      const element = document.querySelector(`.section-title[data-section-key="${key}"]`);
      if (element) {
        element.dataset.i18n = i18nKey;
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
      summaryEngine: 'settings.labels.summaryEngine',
      openaiSummaryModel: 'settings.labels.openaiSummaryModel',
      geminiSummaryModel: 'settings.labels.geminiSummaryModel',
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

    const placeholderMap = {
      customLanguage: 'settings.placeholders.customLanguage'
    };
    Object.entries(placeholderMap).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) {
        el.dataset.i18nPlaceholder = key;
      }
    });

    const noteMappings = [
      { selector: '#recognitionEngine + .form-note', key: 'settings.notes.recognitionEngine' },
      { selector: '#openaiTranscribeModel + .form-note', key: 'settings.notes.openaiTranscribeModel' },
      { selector: '#sonioxApiKey + .form-note', key: 'settings.notes.sonioxApiKey' },
      { selector: '#dashscopeApiKey + .form-note', key: 'settings.notes.dashscopeApiKey' },
      { selector: '#qwen3AsrModel + .form-note', key: 'settings.notes.qwen3AsrModel' },
      { selector: '#translationEngine + .form-note', key: 'settings.notes.translationEngine' },
      { selector: '#geminiApiKey + .form-note', key: 'settings.notes.geminiApiKey' },
      { selector: '#geminiTranslateModel + .form-note', key: 'settings.notes.geminiTranslateModel' },
      { selector: '#openaiTranslateModel + .form-note', key: 'settings.notes.openaiTranslateModel' },
      { selector: '#summaryEngine + .form-note', key: 'settings.notes.summaryEngine' },
      { selector: '#openaiSummaryModel + .form-note', key: 'settings.notes.openaiSummaryModel' },
      { selector: '#geminiSummaryModel + .form-note', key: 'settings.notes.geminiSummaryModel' },
      { selector: '#apiKey + .form-note', key: 'settings.notes.apiKey' },
      { selector: '#apiUrl + .form-note', key: 'settings.notes.apiUrl' },
      { selector: '#translationMode + .form-note', key: 'settings.notes.translationMode' },
      { selector: '#targetLanguage + .form-note', key: 'settings.notes.targetLanguage' },
      { selector: '#language2 + .form-note', key: 'settings.notes.language2' },
      { selector: '#transcribeLanguage + .form-note', key: 'settings.notes.transcribeLanguage' },
      { selector: '#silenceThreshold + .form-note', key: 'settings.notes.silenceThreshold' },
      { selector: '#silenceDuration + .form-note', key: 'settings.notes.silenceDuration' },
      { selector: '#theaterMode', key: 'settings.notes.theaterMode', mode: 'tooltip' },
      { selector: '#appLanguage + .form-note', key: 'settings.notes.appLanguage' }
    ];

    noteMappings.forEach(({ selector, key, mode }) => {
      const el = document.querySelector(selector);
      if (!el) return;
      if (mode === 'tooltip') {
        el.dataset.i18nTitle = key;
      } else {
        el.dataset.i18n = key;
      }
    });
  }

  function activateSection(sectionId, options = {}) {
    const { updateHash = true } = options;
    let nextSection = sectionId;
    if (!SECTION_IDS.includes(nextSection)) {
      nextSection = DEFAULT_SECTION;
    }

    document.querySelectorAll('.settings-section').forEach((section) => {
      const isActive = section.dataset.section === nextSection;
      section.classList.toggle('active', isActive);
    });

    document.querySelectorAll('.sidebar-item').forEach((item) => {
      const isActive = item.dataset.section === nextSection;
      item.classList.toggle('active', isActive);
    });

    currentSection = nextSection;
    if (updateHash) {
      const targetHash = `#${nextSection}`;
      if (window.location.hash !== targetHash) {
        try {
          history.replaceState(null, '', targetHash);
        } catch (_) {
          // ignore history errors
        }
      }
    }
  }

  function setupSidebarNavigation() {
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    if (!sidebarItems.length) {
      return;
    }
    const activeItem = document.querySelector('.sidebar-item.active');
    if (activeItem && SECTION_IDS.includes(activeItem.dataset.section)) {
      currentSection = activeItem.dataset.section;
    } else {
      currentSection = DEFAULT_SECTION;
      activateSection(DEFAULT_SECTION, { updateHash: false });
    }
    sidebarItems.forEach((item) => {
      item.addEventListener('click', () => {
        const targetSection = item.dataset.section;
        if (!targetSection) {
          return;
        }
        activateSection(targetSection);
      });
    });
  }

  function applyLanguageFromConfig(cfg) {
    const lang = (cfg && cfg.app_language) || DEFAULT_LANGUAGE;
    setDocumentLanguage(lang);
    if (!window.appI18n || typeof window.appI18n.setLanguage !== 'function') {
      return;
    }
    window.appI18n.setLanguage(lang);
    registerSettingsTranslations();
    if (typeof window.appI18n.apply === 'function') {
      window.appI18n.apply();
    }
    document.title = t('settings.nav.title');
  }

  function initializeLanguage() {
    if (!window.appI18n) {
      return;
    }
    registerSettingsTranslations();
    window.appI18n.setLanguage(DEFAULT_LANGUAGE);
    if (typeof window.appI18n.apply === 'function') {
      window.appI18n.apply();
    }
    document.title = t('settings.nav.title');
    if (typeof window.appI18n.onChange === 'function') {
      window.appI18n.onChange(() => {
        registerSettingsTranslations();
        if (typeof window.appI18n.apply === 'function') {
          window.appI18n.apply();
        }
        document.title = t('settings.nav.title');
      });
    }
  }

  function setupEventListeners() {
    const form = document.getElementById('settingsForm');
    if (!form) {
      return;
    }

    form.addEventListener('submit', saveSettings);

    const enableTranslation = document.getElementById('enableTranslation');
    if (enableTranslation) {
      enableTranslation.addEventListener('change', () => {
        toggleTranslationSettings();
        updateTranscribeLanguageAvailability();
        autoSave();
      });
    }

    const translationMode = document.getElementById('translationMode');
    if (translationMode) {
      translationMode.addEventListener('change', () => {
        updateTranslationModeSettings();
        updateTranscribeLanguageAvailability();
        autoSave();
      });
    }

    const targetLanguage = document.getElementById('targetLanguage');
    if (targetLanguage) {
      targetLanguage.addEventListener('change', () => {
        updateCustomLanguageVisibility();
        autoSave();
      });
    }

    const customLanguage = document.getElementById('customLanguage');
    if (customLanguage) {
      customLanguage.addEventListener('input', autoSave);
      customLanguage.addEventListener('blur', autoSave);
    }

    const appLanguage = document.getElementById('appLanguage');
    if (appLanguage) {
      appLanguage.addEventListener('change', () => {
        const value = appLanguage.value || DEFAULT_LANGUAGE;
        applyLanguageFromConfig({ app_language: value });
        autoSave();
      });
    }

    const recognitionEngine = document.getElementById('recognitionEngine');
    if (recognitionEngine) {
      recognitionEngine.addEventListener('change', () => {
        updateProviderVisibility();
        autoSave();
      });
    }

    const translationEngine = document.getElementById('translationEngine');
    if (translationEngine) {
      translationEngine.addEventListener('change', () => {
        updateProviderVisibility();
        autoSave();
      });
    }

    const summaryEngine = document.getElementById('summaryEngine');
    if (summaryEngine) {
      summaryEngine.addEventListener('change', () => {
        updateProviderVisibility();
        autoSave();
      });
    }

    const apiKey = document.getElementById('apiKey');
    if (apiKey) {
      apiKey.addEventListener('input', () => {
        validateApiKey();
        autoSave();
      });
    }

    const apiUrl = document.getElementById('apiUrl');
    if (apiUrl) {
      apiUrl.addEventListener('input', autoSave);
    }

    ['geminiApiKey', 'geminiTranslateModel', 'openaiTranscribeModel', 'openaiTranslateModel', 'openaiSummaryModel', 'geminiSummaryModel', 'sonioxApiKey', 'dashscopeApiKey', 'qwen3AsrModel', 'language1', 'language2', 'transcribeLanguage', 'silenceThreshold', 'silenceDuration']
      .forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('change', autoSave);
          el.addEventListener('blur', autoSave);
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.addEventListener('input', autoSave);
          }
        }
      });

    const theaterMode = document.getElementById('theaterMode');
    if (theaterMode) {
      theaterMode.addEventListener('change', autoSave);
    }
  }

  function scrollToHashSection() {
    const hash = (window.location.hash || '').replace(/^#/, '');
    if (!hash) return;
    if (SECTION_IDS.includes(hash)) {
      activateSection(hash, { updateHash: false });
      return;
    }
    const el = document.getElementById(hash);
    if (el && typeof el.scrollIntoView === 'function') {
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try { el.focus({ preventScroll: true }); } catch (_) {}
      }, 80);
    }
  }

  async function loadCurrentConfig() {
    if (!window.electronAPI || typeof window.electronAPI.getConfig !== 'function') {
      return;
    }
    try {
      const cfg = await window.electronAPI.getConfig();
      currentConfig = cfg || {};
      applyLanguageFromConfig(currentConfig);
      populateForm(currentConfig);
    } catch (error) {
      showTopNotification(`${resolveText('settings.notify.loadFailed', 'Failed to load configuration')}: ${error.message}`, 'error');
    }
  }

  function populateForm(cfg) {
    const config = cfg || {};

    const rec = config.recognition_engine || config.transcribe_source || 'openai';
    const tl = config.translation_engine || 'openai';
    const summary = config.summary_engine || tl || 'openai';
    const recEl = document.getElementById('recognitionEngine');
    const tlEl = document.getElementById('translationEngine');
    const summaryEl = document.getElementById('summaryEngine');
    if (recEl) recEl.value = rec;
    if (tlEl) tlEl.value = tl;
    if (summaryEl) summaryEl.value = summary;

    const fieldMap = {
      apiKey: config.openai_api_key || '',
      apiUrl: config.openai_base_url || '',
      openaiTranscribeModel: config.openai_transcribe_model || 'gpt-4o-transcribe',
      openaiTranslateModel: config.openai_translate_model || 'gpt-4o-mini',
      openaiSummaryModel: config.openai_summary_model || config.openai_translate_model || 'gpt-4o-mini',
      geminiApiKey: config.gemini_api_key || '',
      geminiTranslateModel: config.gemini_translate_model || 'gemini-2.0-flash',
      geminiSummaryModel: config.gemini_summary_model || config.gemini_translate_model || 'gemini-2.0-flash',
      sonioxApiKey: config.soniox_api_key || '',
      dashscopeApiKey: config.dashscope_api_key || '',
      qwen3AsrModel: config.qwen3_asr_model || 'qwen3-asr-flash',
      language1: config.smart_language1 || 'Chinese',
      language2: config.smart_language2 || 'English',
      transcribeLanguage: config.transcribe_language || 'auto',
      silenceThreshold: (typeof config.silence_rms_threshold === 'number' ? config.silence_rms_threshold : 0.01).toString(),
      silenceDuration: (typeof config.min_silence_seconds === 'number' ? config.min_silence_seconds : 1).toString()
    };
    Object.entries(fieldMap).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });

    const enableTranslation = document.getElementById('enableTranslation');
    if (enableTranslation) {
      enableTranslation.checked = config.enable_translation !== false;
    }

    const translationMode = document.getElementById('translationMode');
    if (translationMode) {
      translationMode.value = config.translation_mode || 'fixed';
    }

    const targetLanguage = document.getElementById('targetLanguage');
    const customLanguage = document.getElementById('customLanguage');
    if (targetLanguage) {
      const savedLang = config.translate_language || 'Chinese';
      const options = Array.from(targetLanguage.options).map((option) => option.value);
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
    }

    const theaterMode = document.getElementById('theaterMode');
    if (theaterMode) {
      theaterMode.checked = !!config.theater_mode;
    }

    const appLanguage = document.getElementById('appLanguage');
    if (appLanguage) {
      const langValue = config.app_language === 'zh' ? 'zh' : 'en';
      appLanguage.value = langValue;
    }

    toggleTranslationSettings();
    updateCustomLanguageVisibility();
    updateTranslationModeSettings();
    updateTranscribeLanguageAvailability();
    updateProviderVisibility();
    validateApiKey();
  }

  function toggleTranslationSettings() {
    const enableTranslation = document.getElementById('enableTranslation');
    const translationSettings = document.getElementById('translationSettings');
    const enabled = enableTranslation ? enableTranslation.checked : true;
    const toggleIds = ['translationMode', 'targetLanguage', 'customLanguage', 'language1', 'language2'];

    toggleIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.disabled = !enabled;
      }
    });

    if (translationSettings) {
      translationSettings.style.opacity = enabled ? '1' : '0.5';
    }
  }

  function updateCustomLanguageVisibility() {
    const targetLanguage = document.getElementById('targetLanguage');
    const customLanguage = document.getElementById('customLanguage');
    if (!targetLanguage || !customLanguage) return;
    const isCustom = targetLanguage.value === '__custom__';
    customLanguage.style.display = isCustom ? 'block' : 'none';
    customLanguage.required = isCustom;
  }

  function updateTranslationModeSettings() {
    const modeEl = document.getElementById('translationMode');
    const mode = modeEl ? modeEl.value : 'fixed';
    const fixedSettings = document.getElementById('fixedTranslationSettings');
    const smartSettings = document.getElementById('smartTranslationSettings');
    if (fixedSettings) {
      fixedSettings.style.display = mode === 'smart' ? 'none' : 'block';
    }
    if (smartSettings) {
      smartSettings.style.display = mode === 'smart' ? 'block' : 'none';
    }
  }

  function updateTranscribeLanguageAvailability() {
    const enableTranslation = document.getElementById('enableTranslation');
    const translationMode = document.getElementById('translationMode');
    const transcribeLanguage = document.getElementById('transcribeLanguage');
    if (!enableTranslation || !translationMode || !transcribeLanguage) {
      return;
    }
    const shouldDisable = enableTranslation.checked && translationMode.value === 'smart';
    transcribeLanguage.disabled = shouldDisable;
    const container = transcribeLanguage.parentElement;
    if (container) {
      container.style.opacity = shouldDisable ? '0.5' : '1';
      const existingNote = container.querySelector('.mode-note');
      if (existingNote) {
        existingNote.remove();
      }
      if (shouldDisable) {
        const note = document.createElement('div');
        note.className = 'mode-note';
        note.style.fontSize = '12px';
        note.style.color = '#666';
        note.style.marginTop = '5px';
        note.textContent = resolveText('settings.notes.transcribeLanguage', 'In Smart translation mode, transcription language is auto-detected.');
        container.appendChild(note);
      }
    }
  }

  function updateProviderVisibility() {
    const rec = (document.getElementById('recognitionEngine') || {}).value || 'openai';
    const tl = (document.getElementById('translationEngine') || {}).value || 'openai';
    const summary = (document.getElementById('summaryEngine') || {}).value || 'openai';

    const toggleGroup = (selector, visible) => {
      document.querySelectorAll(selector).forEach((el) => {
        el.style.display = visible ? '' : 'none';
      });
    };

    toggleGroup('.provider-openai-common', rec === 'openai' || tl === 'openai' || summary === 'openai');
    toggleGroup('.provider-openai-rec', rec === 'openai');
    toggleGroup('.provider-openai-trans', tl === 'openai');
    toggleGroup('.provider-openai-summary', summary === 'openai');
    toggleGroup('.provider-gemini-trans', tl === 'gemini');
    toggleGroup('.provider-gemini-summary', summary === 'gemini');
    toggleGroup('.provider-soniox', rec === 'soniox');
    toggleGroup('.provider-qwen3-asr', rec === 'qwen3-asr');
  }

  function validateApiKey() {
    const indicator = document.getElementById('apiKeyIndicator');
    const apiKey = document.getElementById('apiKey');
    if (!indicator || !apiKey) {
      return;
    }
    const value = (apiKey.value || '').trim();
    if (!value) {
      indicator.textContent = '';
      indicator.className = '';
      return;
    }
    if (value.startsWith('sk-') && value.length > 20) {
      indicator.textContent = resolveText('settings.validation.apiKeyValid', 'Valid format');
      indicator.className = 'valid';
    } else {
      indicator.textContent = resolveText('settings.validation.apiKeyInvalid', 'Invalid format');
      indicator.className = 'invalid';
    }
  }

  function autoSave() {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }
    autoSaveTimer = setTimeout(() => {
      saveSettingsInternal(true).catch((error) => {
        console.warn('[Settings] Auto-save failed:', error);
      });
    }, AUTO_SAVE_DELAY);
  }

  async function saveSettings(event) {
    if (event) {
      event.preventDefault();
    }
    await saveSettingsInternal(false);
  }

  async function saveSettingsInternal(silent) {
    const updatedConfig = collectFormData();
    if (!window.electronAPI || typeof window.electronAPI.saveConfig !== 'function') {
      currentConfig = { ...currentConfig, ...updatedConfig };
      if (!silent) {
        showTopNotification(resolveText('settings.notify.saved', 'Settings saved'), 'success');
      }
      return;
    }

    try {
      const result = await window.electronAPI.saveConfig(updatedConfig);
      if (result && result.success === false) {
        if (!silent) {
          showTopNotification(result.error || resolveText('settings.notify.saveFailed', 'Save failed'), 'error');
        }
        return;
      }
      currentConfig = { ...currentConfig, ...updatedConfig };
      applyLanguageFromConfig(currentConfig);
      if (!silent) {
        showTopNotification(resolveText('settings.notify.saved', 'Settings saved'), 'success');
      }
    } catch (error) {
      if (!silent) {
        showTopNotification(`${resolveText('settings.notify.saveFailed', 'Save failed')}: ${error.message}`, 'error');
      }
    }
  }

  function collectFormData() {
    const config = { ...currentConfig };

    const recEl = document.getElementById('recognitionEngine');
    const tlEl = document.getElementById('translationEngine');
    const summaryEl = document.getElementById('summaryEngine');
    const rec = recEl ? recEl.value : 'openai';
    const tl = tlEl ? tlEl.value : 'openai';
    const summary = summaryEl ? summaryEl.value : 'openai';
    config.recognition_engine = rec;
    config.transcribe_source = rec;
    config.translation_engine = tl;
    config.summary_engine = summary;

    const readValue = (id, fallback = '') => {
      const el = document.getElementById(id);
      return el ? (el.value || fallback) : fallback;
    };

    config.openai_api_key = readValue('apiKey');
    config.openai_base_url = readValue('apiUrl');
    config.openai_transcribe_model = readValue('openaiTranscribeModel', 'gpt-4o-transcribe');
    config.openai_translate_model = readValue('openaiTranslateModel', 'gpt-4o-mini');
    config.openai_summary_model = readValue('openaiSummaryModel', 'gpt-4o-mini');
    config.gemini_api_key = readValue('geminiApiKey');
    config.gemini_translate_model = readValue('geminiTranslateModel', 'gemini-2.0-flash');
    config.gemini_summary_model = readValue('geminiSummaryModel', 'gemini-2.0-flash');
    config.gemini_translate_system_prompt = config.gemini_translate_system_prompt || DEFAULT_GEMINI_PROMPT;
    config.soniox_api_key = readValue('sonioxApiKey');
    config.dashscope_api_key = readValue('dashscopeApiKey');
    config.qwen3_asr_model = readValue('qwen3AsrModel', 'qwen3-asr-flash');

    const enableTranslation = document.getElementById('enableTranslation');
    config.enable_translation = enableTranslation ? enableTranslation.checked : true;

    const translationMode = document.getElementById('translationMode');
    config.translation_mode = translationMode ? translationMode.value : 'fixed';

    if (config.enable_translation) {
      const targetLanguage = document.getElementById('targetLanguage');
      const customLanguage = document.getElementById('customLanguage');
      if (targetLanguage && targetLanguage.value === '__custom__' && customLanguage) {
        config.translate_language = customLanguage.value.trim();
      } else if (targetLanguage) {
        config.translate_language = targetLanguage.value;
      }
      config.smart_language1 = readValue('language1', 'Chinese');
      config.smart_language2 = readValue('language2', 'English');
    }

    config.app_language = readValue('appLanguage', DEFAULT_LANGUAGE);
    config.transcribe_language = readValue('transcribeLanguage', 'auto');
    config.silence_rms_threshold = parseFloat(readValue('silenceThreshold', '0.01')) || 0.01;
    config.min_silence_seconds = parseFloat(readValue('silenceDuration', '1')) || 1;
    const theaterMode = document.getElementById('theaterMode');
    config.theater_mode = theaterMode ? theaterMode.checked : false;

    return config;
  }

  function showTopNotification(message, type = 'info') {
    if (!message) return;
    document.querySelectorAll('.top-notification').forEach((el) => el.remove());
    const notification = document.createElement('div');
    notification.className = `top-notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = [
      'position: fixed',
      'top: 20px',
      'left: 50%',
      'transform: translateX(-50%)',
      'padding: 12px 24px',
      'border-radius: 6px',
      'color: #fff',
      'font-size: 14px',
      'z-index: 10000',
      'box-shadow: 0 4px 12px rgba(0,0,0,0.15)'
    ].join(';');
    const background = type === 'error' ? '#ff4757' : type === 'success' ? '#2ed573' : '#5352ed';
    notification.style.background = background;
    document.body.appendChild(notification);
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 2800);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initializeLanguage();
    setupSidebarNavigation();
    setupEventListeners();
    loadCurrentConfig();
    scrollToHashSection();
  });
})();
