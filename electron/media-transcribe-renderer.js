// Media transcription renderer process script

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
  document.title = t('media.pageTitle');
  if (typeof window.appI18n.onChange === 'function') {
    window.appI18n.onChange(() => {
      registerMediaTranslations();
      window.appI18n.apply();
      document.title = t('media.pageTitle');
    });
  }
}

function registerMediaTranslations() {
  if (!window.appI18n) {
    return;
  }

  const navTitle = document.querySelector('.nav-title');
  if (navTitle) {
    navTitle.dataset.i18n = 'media.nav.title';
  }

  const backButton = document.querySelector('.back-btn');
  if (backButton) {
    backButton.dataset.i18n = 'common.backNav';
    backButton.dataset.i18nTitle = 'media.nav.backTooltip';
  }

  const uploadPrimary = document.querySelector('.upload-text .primary');
  if (uploadPrimary) {
    uploadPrimary.dataset.i18n = 'media.upload.select';
  }
  const uploadLines = document.querySelectorAll('.upload-text div');
  if (uploadLines[1]) {
    uploadLines[1].dataset.i18n = 'media.upload.supportVideo';
  }
  if (uploadLines[2]) {
    uploadLines[2].dataset.i18n = 'media.upload.supportAudio';
  }

  const panelTitleKeys = ['media.panel.file', 'media.panel.processing', 'media.panel.output'];
  document.querySelectorAll('.panel-title').forEach((element, index) => {
    const key = panelTitleKeys[index];
    if (key) {
      element.dataset.i18n = key;
    }
  });

  const recognitionGroup = document.getElementById('recognitionEngine')?.closest('.input-group');
  if (recognitionGroup) {
    const label = recognitionGroup.querySelector('.input-label');
    const hint = recognitionGroup.querySelector('.input-hint');
    if (label) label.dataset.i18n = 'media.labels.recognitionEngine';
    if (hint) hint.dataset.i18n = 'media.hints.recognitionEngine';
  }

  const translationGroup = document.getElementById('translationEngine')?.closest('.input-group');
  if (translationGroup) {
    const label = translationGroup.querySelector('.input-label');
    const hint = translationGroup.querySelector('.input-hint');
    if (label) label.dataset.i18n = 'media.labels.translationEngine';
    if (hint) hint.dataset.i18n = 'media.hints.translationEngine';
  }

  const targetGroup = document.getElementById('languageGroup');
  if (targetGroup) {
    const label = targetGroup.querySelector('.input-label');
    if (label) label.dataset.i18n = 'media.setting.targetLanguage';
  }

  const theaterLabel = document.querySelector('.setting-label:last-of-type');
  if (theaterLabel) {
    theaterLabel.dataset.i18n = 'media.setting.theaterMode';
  }

  const enableTranslationLabel = document.querySelector('.setting-item .setting-label');
  if (enableTranslationLabel) {
    enableTranslationLabel.dataset.i18n = 'media.setting.enableTranslation';
  }

  const outputGroup = document.getElementById('outputPath')?.closest('.input-group');
  if (outputGroup) {
    const label = outputGroup.querySelector('.input-label');
    if (label) label.dataset.i18n = 'media.labels.outputPath';
    const input = outputGroup.querySelector('input');
    if (input) input.dataset.i18nPlaceholder = 'media.actions.choosePathPlaceholder';
  }

  const customLanguageInput = document.getElementById('customLanguage');
  if (customLanguageInput) {
    customLanguageInput.dataset.i18nPlaceholder = 'settings.placeholders.customLanguage';
  }

  const browseButton = document.getElementById('browseOutputBtn');
  if (browseButton) {
    browseButton.dataset.i18n = 'media.actions.browse';
  }

  const startButton = document.getElementById('startProcessBtn');
  if (startButton) {
    startButton.dataset.i18n = 'media.actions.start';
  }

  const clearButton = document.getElementById('clearBtn');
  if (clearButton) {
    clearButton.dataset.i18n = 'media.actions.clear';
  }

  const exportButton = document.getElementById('exportBtn');
  if (exportButton) {
    exportButton.dataset.i18n = 'media.actions.export';
  }

  const emptyStateText = document.querySelector('.empty-state div:last-child');
  if (emptyStateText) {
    emptyStateText.dataset.i18n = 'media.results.empty';
  }

  const resultsTitle = document.querySelector('.results-title');
  if (resultsTitle) {
    resultsTitle.dataset.i18n = 'media.results.title';
  }
}

if (window.appI18n && typeof window.appI18n.extend === 'function') {
  window.appI18n.extend({
    en: {
      'common.backNav': '\u2190 Back',
      'common.backLink': 'Back',
      'media.pageTitle': 'Media Transcription & Translation',
      'media.nav.title': 'Media Transcription',
      'media.nav.backTooltip': 'Back to main window',
      'media.panel.file': 'Select File',
      'media.panel.processing': 'Processing Settings',
      'media.panel.output': 'Output Settings',
      'media.labels.recognitionEngine': 'Transcription Engine',
      'media.labels.translationEngine': 'Translation Engine',
      'media.labels.outputPath': 'Save Location',
      'settings.placeholders.customLanguage': 'Enter a custom language',
      'media.hints.recognitionEngine': 'Matches the settings page. Changes here affect only this window.',
      'media.hints.translationEngine': 'Shares the engine list with the settings page; new engines appear automatically.',
      'media.setting.enableTranslation': 'Enable Translation',
      'media.setting.targetLanguage': 'Target Language',
      'media.setting.theaterMode': 'Enable Theater Mode (audio enhancement)',
      'media.actions.choosePathPlaceholder': 'Choose a save location',
      'media.actions.browse': 'Browse',
      'media.actions.start': 'Start Processing',
      'media.actions.clear': 'Clear Selection',
      'media.actions.export': 'Export TXT',
      'media.upload.select': 'Click to choose a media file',
      'media.upload.supportVideo': 'Supported video: MP4, AVI, MOV, MKV, ...',
      'media.upload.supportAudio': 'Supported audio: WAV, MP3, FLAC, AAC, ...',
      'media.results.title': 'Results',
      'media.results.empty': 'Select a media file and start processing to view the transcription here.',
      'media.results.segmentLabel': 'Segment {index}',
      'media.file.selected': 'Selected',
      'media.progress.preparing': 'Preparing...',
      'media.progress.complete': 'Processing complete',
      'media.error.dragNotSupported': 'Please click to choose a file; drag-and-drop is not supported yet.',
      'media.error.selectFileFailed': 'Failed to select file',
      'media.error.selectOutputFailed': 'Failed to select output path',
      'media.error.missingFileOrOutput': 'Please select a file and output path.',
      'media.error.customLanguageRequired': 'Please enter a custom target language.',
      'media.error.processingFailed': 'Processing failed',
      'media.error.processingException': 'An error occurred while processing',
      'media.error.noResultsToExport': 'No results available to export.',
      'media.error.exportFailedStatus': 'Export failed',
      'media.error.exportFailed': 'Export failed'
    },
    zh: {
      'common.backNav': '\u2190 返回',
      'common.backLink': '返回',
      'media.pageTitle': '媒体文件转写翻译',
      'media.nav.title': '媒体文件转写',
      'media.nav.backTooltip': '返回主窗口',
      'media.panel.file': '选择文件',
      'media.panel.processing': '处理设置',
      'media.panel.output': '输出设置',
      'media.labels.recognitionEngine': '转写引擎',
      'media.labels.translationEngine': '翻译引擎',
      'media.labels.outputPath': '保存位置',
      'settings.placeholders.customLanguage': '输入自定义语言',
      'media.hints.recognitionEngine': '与设置页保持一致，修改后仅影响本窗口的处理流程。',
      'media.hints.translationEngine': '引擎列表与设置页同步，扩展后即可使用。',
      'media.setting.enableTranslation': '启用翻译',
      'media.setting.targetLanguage': '目标语言',
      'media.setting.theaterMode': '启用剧场模式（音频增强）',
      'media.actions.choosePathPlaceholder': '选择保存位置',
      'media.actions.browse': '浏览',
      'media.actions.start': '开始处理',
      'media.actions.clear': '清除选择',
      'media.actions.export': '导出 TXT',
      'media.upload.select': '点击选择媒体文件',
      'media.upload.supportVideo': '支持视频：MP4、AVI、MOV、MKV 等',
      'media.upload.supportAudio': '支持音频：WAV、MP3、FLAC、AAC 等',
      'media.results.title': '处理结果',
      'media.results.empty': '选择媒体文件并开始处理后，转写结果将显示在这里。',
      'media.results.segmentLabel': '段落 {index}',
      'media.file.selected': '已选择',
      'media.progress.preparing': '准备处理...',
      'media.progress.complete': '处理完成',
      'media.error.dragNotSupported': '请点击选择文件，暂不支持拖拽。',
      'media.error.selectFileFailed': '选择文件失败',
      'media.error.selectOutputFailed': '选择输出路径失败',
      'media.error.missingFileOrOutput': '请选择文件和输出路径。',
      'media.error.customLanguageRequired': '请输入自定义目标语言。',
      'media.error.processingFailed': '处理失败',
      'media.error.processingException': '处理过程中出现错误',
      'media.error.noResultsToExport': '没有可导出的结果。',
      'media.error.exportFailedStatus': '导出失败',
      'media.error.exportFailed': '导出失败'
    }
  });
}

class MediaTranscribeApp {
  constructor() {
    this.selectedFile = null;
    this.results = [];
    this.isProcessing = false;
    this.outputPathValue = '';
    this.currentConfig = null;

    try {
      this.initElements();
      this.bindEvents();
      this.loadSettings().catch((err) => console.warn('Failed to load settings:', err));
    } catch (error) {
      console.error('Failed to initialize MediaTranscribeApp:', error);
      throw error;
    }
  }

  queryElement(id, label) {
    const el = document.getElementById(id);
    if (!el) {
      throw new Error(`Element "${label || id}" not found`);
    }
    return el;
  }

  initElements() {
    this.uploadArea = this.queryElement('uploadArea', 'uploadArea');
    this.fileInfo = this.queryElement('fileInfo', 'fileInfo');
    this.fileName = this.queryElement('fileName', 'fileName');
    this.fileSize = this.queryElement('fileSize', 'fileSize');
    this.enableTranslation = this.queryElement('enableTranslation', 'enableTranslation');
    this.targetLanguage = this.queryElement('targetLanguage', 'targetLanguage');
    this.customLanguage = this.queryElement('customLanguage', 'customLanguage');
    this.theaterMode = this.queryElement('theaterMode', 'theaterMode');
    this.languageGroup = this.queryElement('languageGroup', 'languageGroup');
    this.recognitionEngine = this.queryElement('recognitionEngine', 'recognitionEngine');
    this.translationEngine = this.queryElement('translationEngine', 'translationEngine');
    this.outputPath = this.queryElement('outputPath', 'outputPath');
    this.browseOutputBtn = this.queryElement('browseOutputBtn', 'browseOutputBtn');
    this.startProcessBtn = this.queryElement('startProcessBtn', 'startProcessBtn');
    this.clearBtn = this.queryElement('clearBtn', 'clearBtn');
    this.exportBtn = this.queryElement('exportBtn', 'exportBtn');
    this.resultsContent = this.queryElement('resultsContent', 'resultsContent');
  }

  bindEvents() {
    this.uploadArea.addEventListener('click', () => {
      this.selectFile();
    });

    this.uploadArea.addEventListener('dragover', (event) => {
      event.preventDefault();
      this.uploadArea.classList.add('dragover');
    });

    this.uploadArea.addEventListener('dragleave', () => {
      this.uploadArea.classList.remove('dragover');
    });

    this.uploadArea.addEventListener('drop', (event) => {
      event.preventDefault();
      this.uploadArea.classList.remove('dragover');
      this.showError(t('media.error.dragNotSupported'));
    });

    const enableItem = this.enableTranslation.closest('.setting-item');
    const theaterItem = this.theaterMode.closest('.setting-item');

    const onToggleTranslation = (event) => {
      if (event && event.target && event.target.id === 'targetLanguage') {
        return;
      }
      this.toggleCheckbox(this.enableTranslation);
      this.updateLanguageGroupVisibility();
      this.saveSettings();
      this.updateStartButton();
    };

    const onToggleTheater = () => {
      this.toggleCheckbox(this.theaterMode);
      this.saveSettings();
    };

    this.enableTranslation.addEventListener('click', (event) => {
      event.stopPropagation();
      onToggleTranslation(event);
    });
    this.theaterMode.addEventListener('click', (event) => {
      event.stopPropagation();
      onToggleTheater();
    });
    if (enableItem) enableItem.addEventListener('click', onToggleTranslation);
    if (theaterItem) theaterItem.addEventListener('click', onToggleTheater);

    this.browseOutputBtn.addEventListener('click', () => {
      this.selectOutputPath();
    });

    this.startProcessBtn.addEventListener('click', () => {
      this.startProcessing();
    });

    this.clearBtn.addEventListener('click', () => {
      this.clearSelection();
    });

    this.exportBtn.addEventListener('click', () => {
      this.exportResults();
    });

    this.targetLanguage.addEventListener('change', () => {
      this.updateCustomLanguageVisibility();
      this.saveSettings();
    });

    this.customLanguage.addEventListener('input', () => {
      this.saveSettings();
    });

    this.recognitionEngine.addEventListener('change', () => {
      this.saveSettings();
    });

    this.translationEngine.addEventListener('change', () => {
      this.saveSettings();
      this.updateTranslationEngineState();
    });
  }

  async selectFile() {
    try {
      const result = await window.electronAPI.selectMediaFile();
      if (result && !result.canceled && Array.isArray(result.filePaths) && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        this.handleFileSelect(filePath);
      }
    } catch (error) {
      console.error('Failed to select file:', error);
      this.showError(`${t('media.error.selectFileFailed')}: ${error.message}`);
    }
  }

  handleFileSelect(filePath) {
    this.selectedFile = {
      path: filePath,
      name: filePath.split('\\').pop().split('/').pop(),
      size: 0
    };

    this.fileName.textContent = this.selectedFile.name;
    this.fileSize.textContent = t('media.file.selected');
    this.fileInfo.style.display = 'block';
    this.uploadArea.style.display = 'none';

    this.updateStartButton();
  }

  toggleCheckbox(checkbox) {
    if (!checkbox) return;
    if (checkbox.classList.contains('checked')) {
      checkbox.classList.remove('checked');
      checkbox.innerHTML = '';
    } else {
      checkbox.classList.add('checked');
      checkbox.innerHTML = '<span>✓</span>';
    }
  }

  updateLanguageGroupVisibility() {
    const isEnabled = this.enableTranslation.classList.contains('checked');
    this.languageGroup.style.display = isEnabled ? 'flex' : 'none';
    this.updateTranslationEngineState();
  }

  updateCustomLanguageVisibility() {
    const useCustom = this.targetLanguage.value === '__custom__';
    this.customLanguage.style.display = useCustom ? 'block' : 'none';
  }

  updateTranslationEngineState() {
    const translationEnabled = this.enableTranslation.classList.contains('checked');
    if (this.translationEngine) {
      this.translationEngine.disabled = !translationEnabled;
    }
  }

  async selectOutputPath() {
    try {
      const baseName = this.selectedFile?.name || '';
      const result = await window.electronAPI.selectOutputPath({ baseName });
      if (result && !result.canceled && result.filePath) {
        this.outputPath.value = result.filePath;
        this.updateStartButton();
        this.saveSettings();
      }
    } catch (error) {
      console.error('Failed to select output path:', error);
      this.showError(`${t('media.error.selectOutputFailed')}: ${error.message}`);
    }
  }

  updateStartButton() {
    const hasFile = !!this.selectedFile;
    const hasOutputPath = this.outputPath.value.trim() !== '';
    const canStart = hasFile && hasOutputPath && !this.isProcessing;
    this.startProcessBtn.disabled = !canStart;
  }

  async startProcessing() {
    if (!this.selectedFile || !this.outputPath.value.trim()) {
      this.showError(t('media.error.missingFileOrOutput'));
      return;
    }

    const translationEnabled = this.enableTranslation.classList.contains('checked');
    if (translationEnabled && this.targetLanguage.value === '__custom__') {
      const customValue = (this.customLanguage.value || '').trim();
      if (!customValue) {
        this.showError(t('media.error.customLanguageRequired'));
        this.customLanguage.focus();
        return;
      }
    }

    this.isProcessing = true;
    this.startProcessBtn.disabled = true;
    this.exportBtn.disabled = true;
    this.results = [];
    this.updateResultsDisplay();

    try {
      this.showProgress(t('media.progress.preparing'));

      const recognitionEngine = this.recognitionEngine ? this.recognitionEngine.value : '';
      const translationEngine = this.translationEngine ? this.translationEngine.value : '';
      const settings = {
        enableTranslation: translationEnabled,
        targetLanguage: this.resolveTargetLanguage(),
        theaterMode: this.theaterMode.classList.contains('checked'),
        outputPath: this.outputPath.value.trim(),
        recognitionEngine,
        translationEngine
      };

      await this.ensureEngineConfigSynced(recognitionEngine, translationEngine);

      const result = await window.electronAPI.processMediaFile({
        filePath: this.selectedFile.path,
        settings
      });

      if (result && result.success) {
        this.showProgress(t('media.progress.complete'));
        this.exportBtn.disabled = false;
      } else {
        const detail = result && result.error
          ? `${t('media.error.processingFailed')}: ${result.error}`
          : t('media.error.processingFailed');
        this.showError(detail);
      }
    } catch (error) {
      console.error('Processing failed:', error);
      this.showError(`${t('media.error.processingException')}: ${error.message}`);
    } finally {
      this.isProcessing = false;
      this.updateStartButton();
    }
  }

  showProgress(message, progress = 0) {
    this.resultsContent.innerHTML = `
      <div class="progress-container">
        <div class="progress-text">${message}</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
      </div>
    `;
  }

  showError(message) {
    this.resultsContent.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">&#9888;</div>
        <div style="color: #e74c3c;">${message}</div>
      </div>
    `;
  }

  addResult(result) {
    this.results.push(result);
    this.updateResultsDisplay();
  }

  updateResultsDisplay() {
    if (this.results.length === 0) {
      this.resultsContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📄</div>
          <div>${t('media.results.empty')}</div>
        </div>
      `;
      return;
    }

    const resultsHtml = this.results.map((result, index) => {
      const segmentLabel = t('media.results.segmentLabel').replace('{index}', index + 1);
      return `
        <div class="result-item">
          <div class="result-header">
            <div class="segment-number">${segmentLabel}</div>
          </div>
          <div class="result-text">
            <div class="transcription">${result.transcription || ''}</div>
            ${result.translation ? `<div class="translation">${result.translation}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    this.resultsContent.innerHTML = resultsHtml;
  }

  async exportResults() {
    if (this.results.length === 0) {
      this.showError(t('media.error.noResultsToExport'));
      return;
    }

    try {
      const result = await window.electronAPI.exportResults({
        results: this.results,
        outputPath: this.outputPath.value
      });

      if (result && result.success) {
        console.log('Export successful:', result.exportPath);
      } else {
        const detail = result && result.error
          ? `${t('media.error.exportFailedStatus')}: ${result.error}`
          : t('media.error.exportFailedStatus');
        this.showError(detail);
      }
    } catch (error) {
      console.error('Export failed:', error);
      this.showError(`${t('media.error.exportFailed')}: ${error.message}`);
    }
  }

  clearSelection() {
    this.selectedFile = null;
    this.results = [];
    this.fileInfo.style.display = 'none';
    this.uploadArea.style.display = 'block';
    this.updateResultsDisplay();
    this.exportBtn.disabled = true;
    this.updateStartButton();
  }

  applySelectValue(selectEl, value, fallback) {
    if (!selectEl) return;
    const options = Array.from(selectEl.options).map((option) => option.value);
    if (value && options.includes(value)) {
      selectEl.value = value;
    } else if (fallback && options.includes(fallback)) {
      selectEl.value = fallback;
    } else if (options.length > 0) {
      selectEl.value = options[0];
    }
  }

  async loadSettings() {
    let savedSettings = {};
    try {
      const saved = localStorage.getItem('mediaTranscribeSettings');
      if (saved) {
        savedSettings = JSON.parse(saved) || {};
      }
    } catch (error) {
      console.warn('Failed to read saved settings:', error);
    }

    if (!this.currentConfig && window.electronAPI && typeof window.electronAPI.getConfig === 'function') {
      try {
        this.currentConfig = await window.electronAPI.getConfig();
        applyLanguageFromConfig(this.currentConfig);
      } catch (error) {
        console.warn('Failed to load config:', error);
        this.currentConfig = {};
      }
    }

    const config = this.currentConfig || {};
    applyLanguageFromConfig(config);

    const recognitionValue = savedSettings.recognitionEngine || config.recognition_engine || config.transcribe_source || 'openai';
    this.applySelectValue(this.recognitionEngine, recognitionValue, 'openai');

    const translationValue = savedSettings.translationEngine || config.translation_engine || 'openai';
    this.applySelectValue(this.translationEngine, translationValue, 'openai');

    const enableTranslation = (typeof savedSettings.enableTranslation !== 'undefined')
      ? !!savedSettings.enableTranslation
      : config.enable_translation !== false;
    if (enableTranslation) {
      this.enableTranslation.classList.add('checked');
      this.enableTranslation.innerHTML = '<span>✓</span>';
    } else {
      this.enableTranslation.classList.remove('checked');
      this.enableTranslation.innerHTML = '';
    }

    if (savedSettings.targetLanguage) {
      if (savedSettings.targetLanguage === '__custom__') {
        this.targetLanguage.value = '__custom__';
        this.customLanguage.value = savedSettings.customLanguage || '';
      } else {
        this.targetLanguage.value = savedSettings.targetLanguage;
        this.customLanguage.value = savedSettings.customLanguage || '';
      }
    } else if (config.translate_language) {
      const options = Array.from(this.targetLanguage.options).map((option) => option.value);
      if (options.includes(config.translate_language)) {
        this.targetLanguage.value = config.translate_language;
      } else {
        this.targetLanguage.value = '__custom__';
        this.customLanguage.value = config.translate_language;
      }
    }

    const savedOutputPath = savedSettings.outputPath || '';
    if (savedOutputPath) {
      this.outputPath.value = savedOutputPath;
    }

    const savedCustomLanguage = savedSettings.customLanguage || '';
    if (savedCustomLanguage) {
      this.customLanguage.value = savedCustomLanguage;
    }

    const theaterEnabled = (typeof savedSettings.theaterMode !== 'undefined') ? !!savedSettings.theaterMode : !!config.theater_mode;
    if (theaterEnabled) {
      this.theaterMode.classList.add('checked');
      this.theaterMode.innerHTML = '<span>✓</span>';
    } else {
      this.theaterMode.classList.remove('checked');
      this.theaterMode.innerHTML = '';
    }

    this.updateLanguageGroupVisibility();
    this.updateCustomLanguageVisibility();
    this.updateStartButton();
    this.exportBtn.disabled = this.results.length === 0;
  }

  saveSettings() {
    try {
      const settings = {
        enableTranslation: this.enableTranslation.classList.contains('checked'),
        targetLanguage: this.targetLanguage.value,
        customLanguage: this.customLanguage.value.trim(),
        theaterMode: this.theaterMode.classList.contains('checked'),
        outputPath: this.outputPath.value.trim(),
        recognitionEngine: this.recognitionEngine ? this.recognitionEngine.value : undefined,
        translationEngine: this.translationEngine ? this.translationEngine.value : undefined
      };
      localStorage.setItem('mediaTranscribeSettings', JSON.stringify(settings));
    } catch (error) {
      console.warn('Failed to save settings:', error);
    }
  }

  resolveTargetLanguage() {
    if (this.targetLanguage.value === '__custom__') {
      return (this.customLanguage.value || '').trim() || '中文';
    }
    return this.targetLanguage.value || '中文';
  }

  async ensureEngineConfigSynced(recognitionEngine, translationEngine) {
    if (!window.electronAPI || typeof window.electronAPI.saveConfig !== 'function') {
      return;
    }

    if (!this.currentConfig && window.electronAPI.getConfig) {
      try {
        this.currentConfig = await window.electronAPI.getConfig();
      } catch (error) {
        console.warn('Failed to reload config for sync:', error);
        this.currentConfig = {};
      }
    }

    const current = this.currentConfig || {};
    const updates = {};
    let changed = false;

    if (recognitionEngine && recognitionEngine !== current.recognition_engine && recognitionEngine !== current.transcribe_source) {
      updates.recognition_engine = recognitionEngine;
      updates.transcribe_source = recognitionEngine;
      changed = true;
    }

    if (translationEngine && translationEngine !== current.translation_engine) {
      updates.translation_engine = translationEngine;
      changed = true;
    }

    if (!changed) {
      return;
    }

    try {
      const result = await window.electronAPI.saveConfig(updates);
      if (result && result.success) {
        this.currentConfig = { ...current, ...updates };
      } else if (result && result.error) {
        console.warn('Failed to save config updates:', result.error);
      }
    } catch (error) {
      console.warn('Failed to sync engine configuration:', error);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initializeLanguage();
  registerMediaTranslations();
  if (window.appI18n) {
    window.appI18n.apply();
  }

  if (typeof window.electronAPI === 'undefined') {
    console.error('Electron API unavailable');
    document.body.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; color: #e74c3c;">
        <div>
          <h2>${t('media.error.processingFailed')}</h2>
          <p>Electron environment required.</p>
        </div>
      </div>
    `;
    return;
  }

  try {
    const app = new MediaTranscribeApp();

    if (window.electronAPI.onMediaProgress) {
      window.electronAPI.onMediaProgress((message) => {
        if (!message || !message.type) {
          return;
        }

        if (message.type === 'progress') {
          app.showProgress(message.message || '', message.progress || 0);
        } else if (message.type === 'result') {
          app.addResult({
            transcription: message.transcription,
            translation: message.translation
          });
        } else if (message.type === 'error') {
          app.showError(message.message || t('media.error.processingFailed'));
        } else if (message.type === 'complete') {
          app.showProgress(t('media.progress.complete'), 100);
          app.exportBtn.disabled = false;
        }
      });
    }

    window.addEventListener('beforeunload', () => {
      app.saveSettings();
    });
  } catch (error) {
    console.error('Failed to bootstrap media transcribe app:', error);
    document.body.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; color: #e74c3c;">
        <div>
          <h2>Initialization error</h2>
          <p>${error.message}</p>
        </div>
      </div>
    `;
  }
});
