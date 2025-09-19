let isRecording = false;
let lastTranscription = '';
let lastTranslation = '';
let pythonServiceStatus = 'unknown'; // 'starting', 'running', 'error', 'stopped'
let isVoiceActive = false; // Added: track voice activity status
let openaiConfigured = false; // Whether OpenAI is configured (when required)
let sonioxConfigured = false; // Whether Soniox is configured (when required)
let geminiConfigured = false; // Whether Gemini is configured when selected
// Qwen3-ASR removed
let translationEnabled = true; // Read from config, used to control combined display
let currentResultNode = null; // Current combined result bubble
let resultNodes = new Map(); // Result node mapping table, key is result_id, value is DOM element
let currentConfig = {}; // Store current configuration
let configCheckInterval = null; // Timer for periodic configuration checks

// DOM elements
const recordButton = document.getElementById('recordButton');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const logContainer = document.getElementById('logContainer');
const volumePanel = document.getElementById('volumePanel');
const volumeLevelEl = document.getElementById('volumeLevel');
const volumeSilenceEl = document.getElementById('volumeSilence');
const volumeDbValue = document.getElementById('volumeDbValue');
const volumeRmsValue = document.getElementById('volumeRmsValue');
const volumeStatusText = document.getElementById('volumeStatusText');
const volumeToggleBtn = document.getElementById('volumeToggleBtn');
const mainContent = document.querySelector('.main-content');

const VOLUME_MIN_DB = -60;
const VOLUME_MAX_DB = 0;
let silenceMarkerDb = null;

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
    document.title = t('index.title');
}

function initializeLanguage() {
    if (!window.appI18n) {
        return;
    }
    window.appI18n.setLanguage(DEFAULT_LANGUAGE);
    document.title = t('index.title');
    if (typeof window.appI18n.onChange === 'function') {
        window.appI18n.onChange(() => {
            document.title = t('index.title');
            updateServiceStatus(pythonServiceStatus);
            updateUI();
            if (volumePanel && volumeToggleBtn) {
                const expanded = !volumePanel.classList.contains('collapsed');
                updateVolumeToggleState(expanded);
            }
        });
    }
}

if (window.appI18n && typeof window.appI18n.extend === 'function') {
    window.appI18n.extend({
        en: {
            'index.title': 'Voice Transcription & Translation',
            'index.tooltips.recordStart': 'Start Recording',
            'index.tooltips.recordStop': 'Stop Recording',
            'index.tooltips.voiceInput': 'Voice Input Settings',
            'index.tooltips.settings': 'Settings',
            'index.tooltips.media': 'Media Transcription',
            'index.logTitle': 'Real-time Log',
            'index.buttons.exportLogs': 'Export Logs',
            'index.buttons.copyLatest': 'Copy Latest Result',
            'index.buttons.clearLogs': 'Clear Logs',
            'index.volume.current': 'Current Volume',
            'index.volume.waiting': 'Waiting for recording',
            'index.volume.recording': 'Recording...',
            'index.volume.expand': 'Expand',
            'index.volume.collapse': 'Collapse',
            'index.volume.expandTooltip': 'Expand volume monitor',
            'index.volume.collapseTooltip': 'Collapse volume monitor',
            'index.volume.silenceRange': 'Silence Range',
            'index.status.starting': 'Starting Python service...',
            'index.status.running': 'Service running',
            'index.status.error': 'Service error',
            'index.status.stopped': 'Service stopped',
            'index.recordButton.starting': 'Service starting...',
            'index.log.backendFailed': 'Backend connection failed',
            'index.log.openaiMissing': 'OpenAI not configured (required for selected source)',
            'index.log.sonioxMissing': 'Soniox not configured (current source: Soniox)',
            'index.log.geminiMissing': 'Gemini not configured (current translation engine: Gemini)',
            'index.log.configLoadFailed': 'Failed to load configuration',
            'index.log.notReadyStart': 'Python service not ready, cannot start recording',
            'index.log.notReadyRecord': 'Python service not ready, cannot record',
            'index.log.recordingError': 'Recording error',
            'index.statusText.recording': 'Recording...',
            'index.statusText.ready': 'Ready',
            'index.statusText.notReady': 'Service not ready',
            'index.result.transcribing': 'Transcribing...',
            'index.result.translating': 'Translating...'
        },
        zh: {
            'index.title': '语音转写翻译工具',
            'index.tooltips.recordStart': '开始录音',
            'index.tooltips.recordStop': '停止录音',
            'index.tooltips.voiceInput': '语音输入设置',
            'index.tooltips.settings': '设置',
            'index.tooltips.media': '媒体文件转写',
            'index.logTitle': '实时日志',
            'index.buttons.exportLogs': '导出日志',
            'index.buttons.copyLatest': '复制最新结果',
            'index.buttons.clearLogs': '清空日志',
            'index.volume.current': '当前音量',
            'index.volume.waiting': '等待录音',
            'index.volume.recording': '录音中',
            'index.volume.expand': '展开',
            'index.volume.collapse': '收起',
            'index.volume.expandTooltip': '展开音量监视',
            'index.volume.collapseTooltip': '收起音量监视',
            'index.volume.silenceRange': '静音范围',
            'index.status.starting': '正在启动 Python 服务...',
            'index.status.running': '服务运行中',
            'index.status.error': '服务错误',
            'index.status.stopped': '服务已停止',
            'index.recordButton.starting': '服务启动中...',
            'index.log.backendFailed': '后端连接失败',
            'index.log.openaiMissing': '未配置 OpenAI（当前识别源需要）',
            'index.log.sonioxMissing': '未配置 Soniox（当前识别源为 Soniox）',
            'index.log.geminiMissing': '未配置 Gemini（当前翻译引擎为 Gemini）',
            'index.log.configLoadFailed': '读取配置失败',
            'index.log.notReadyStart': 'Python 服务未就绪，无法开始录音',
            'index.log.notReadyRecord': 'Python 服务未就绪，无法录音',
            'index.log.recordingError': '录音错误',
            'index.statusText.recording': '录音中...',
            'index.statusText.ready': '就绪',
            'index.statusText.notReady': '服务未就绪',
            'index.result.transcribing': '转写中...',
            'index.result.translating': '翻译中...'
        }
    });
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initializeLanguage();
    setupEventListeners();
    initializeVolumePanel();
    syncVolumePanelOffset();
    // Initialize service status without logging output
    updateServiceStatus('starting');

    // Immediately check configuration and start periodic checks
    checkOpenAIConfig();
    startConfigMonitoring();

    // Query backend service status to avoid showing "waiting for service startup" when re-entering the page
    if (window.electronAPI && window.electronAPI.getServiceStatus) {
        window.electronAPI.getServiceStatus().then(status => {
            if (status && status.running) {
                updateServiceStatus(status.ready ? 'running' : 'starting');
            } else {
                updateServiceStatus('stopped');
            }
        }).catch(() => {
            // Ignore errors, maintain original state
        });
    }
});

window.addEventListener('resize', syncVolumePanelOffset);

// Check provider configuration status
async function checkOpenAIConfig() {
    if (window.electronAPI && window.electronAPI.getConfig) {
        try {
            const cfg = await window.electronAPI.getConfig();
            currentConfig = cfg || {};
            applyLanguageFromConfig(currentConfig);
            const transcribeSource = (cfg && cfg.transcribe_source) || 'openai';
            const translationEngine = (cfg && cfg.translation_engine) || 'openai';
            const newTranslationEnabled = cfg && cfg.enable_translation !== false;

            // Determine which providers are required
            // When using Soniox as transcribe source, only require Soniox key in UI
            const openaiRequired = (transcribeSource === 'openai');
            const sonioxRequired = (transcribeSource === 'soniox');
            const geminiRequired = newTranslationEnabled && translationEngine === 'gemini';
            const qwenRequired = false; // removed

            const newOpenaiConfigured = !!(cfg && cfg.openai_api_key && cfg.openai_api_key.trim());
            const newSonioxConfigured = !!(cfg && cfg.soniox_api_key && cfg.soniox_api_key.trim());
            const newGeminiConfigured = !!(cfg && cfg.gemini_api_key && cfg.gemini_api_key.trim());
            const newQwenConfigured = false;

            // Only warn when required and not configured
            if (openaiRequired && openaiConfigured !== newOpenaiConfigured) {
                openaiConfigured = newOpenaiConfigured;
                if (!openaiConfigured) {
                    addLogEntry('warning', t('index.log.openaiMissing'));
                }
            }

            if (sonioxRequired && sonioxConfigured !== newSonioxConfigured) {
                sonioxConfigured = newSonioxConfigured;
                if (!sonioxConfigured) {
                    addLogEntry('warning', t('index.log.sonioxMissing'));
                }
            }

            if (geminiRequired && geminiConfigured !== newGeminiConfigured) {
                geminiConfigured = newGeminiConfigured;
                if (!geminiConfigured) {
                    addLogEntry('warning', t('index.log.geminiMissing'));
                }
            } else if (!geminiRequired) {
                geminiConfigured = newGeminiConfigured;
            }

            // Qwen3-ASR support removed

            translationEnabled = newTranslationEnabled;
            
        } catch (error) {
            // When configuration loading fails, only update if status changes
            if (openaiConfigured !== false) {
                openaiConfigured = false;
                geminiConfigured = false;
                translationEnabled = true;
                addLogEntry('warning', t('index.log.configLoadFailed'));
            }
        }
    }
}

// Start configuration monitoring
function startConfigMonitoring() {
    // Check configuration changes every 3 seconds
    configCheckInterval = setInterval(checkOpenAIConfig, 3000);
}

// Stop configuration monitoring
function stopConfigMonitoring() {
    if (configCheckInterval) {
        clearInterval(configCheckInterval);
        configCheckInterval = null;
    }
}

function setupEventListeners() {
    // Recording button click event
    recordButton.addEventListener('click', toggleRecording);

    if (volumeToggleBtn) {
        volumeToggleBtn.addEventListener('click', () => toggleVolumePanel());
    }
    
    // Listen to Python messages
    if (window.electronAPI) {
        window.electronAPI.onPythonMessage(handlePythonMessage);
    } else {
        // Don't output to real-time log
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
        if (event.key === 'F1') {
            event.preventDefault();
            if (!isRecording && pythonServiceStatus === 'running') {
                startRecording();
            } else {
                addLogEntry('warning', t('index.log.notReadyStart'));
            }
        } else if (event.key === 'F2') {
            event.preventDefault();
            if (isRecording) stopRecording();
        }
    });
}

function updateServiceStatus(status) {
    pythonServiceStatus = status;
    const statusKeyMap = {
        starting: 'index.status.starting',
        running: 'index.status.running',
        error: 'index.status.error',
        stopped: 'index.status.stopped'
    };

    if (status === 'error' || status === 'stopped') {
        addLogEntry('error', t('index.log.backendFailed'));
    }

    if (statusText && status !== 'running' && !isRecording) {
        statusText.textContent = t(statusKeyMap[status] || status);
    }

    if (status !== 'running') {
        recordButton.disabled = true;
        recordButton.textContent = '🔧';
        recordButton.title = t('index.recordButton.starting');
        recordButton.className = 'control-bar-btn record-btn start disabled';
        setVolumeRecordingState(false);
    } else {
        recordButton.disabled = false;
        updateUI();
    }
}

async function toggleRecording() {
    if (pythonServiceStatus !== 'running') {
        addLogEntry('error', t('index.log.notReadyRecord'));
        return;
    }
    
    if (isRecording) {
        await stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    try {
        const result = await window.electronAPI.startRecording();
        if (result !== false) {
            isRecording = true;
            isVoiceActive = false; // Reset voice activity status when starting recording
            updateUI();
        } else {
            // Don't output real-time log
        }
    } catch (error) {
        console.error('Start recording error:', error);
    }
}

async function stopRecording() {
    try {
        const result = await window.electronAPI.stopRecording();
        if (result !== false) {
            isRecording = false;
            isVoiceActive = false; // Reset voice activity status
            updateUI();
        } else {
            // Don't output real-time log
        }
    } catch (error) {
        console.error('Stop recording error:', error);
    }
}

function updateUI() {
    if (isRecording) {
        recordButton.textContent = '⏹️';
        recordButton.title = t('index.tooltips.recordStop');
        if (isVoiceActive) {
            recordButton.className = 'control-bar-btn record-btn stop recording-active';
        } else {
            recordButton.className = 'control-bar-btn record-btn stop recording-idle';
        }
        if (typeof statusDot !== 'undefined' && statusDot) {
            statusDot.className = 'status-dot recording';
        }
        if (typeof statusText !== 'undefined' && statusText) {
            statusText.textContent = t('index.statusText.recording');
        }
    } else {
        recordButton.textContent = '🎤';
        recordButton.title = t('index.tooltips.recordStart');
        recordButton.className = 'control-bar-btn record-btn start';
        if (typeof statusDot !== 'undefined' && statusDot) {
            statusDot.className = 'status-dot idle';
        }
        if (typeof statusText !== 'undefined' && statusText) {
            statusText.textContent = pythonServiceStatus === 'running'
                ? t('index.statusText.ready')
                : t('index.statusText.notReady');
        }
    }

    setVolumeRecordingState(isRecording);
}

function setVolumeRecordingState(active) {
    if (!volumePanel) {
        return;
    }

    if (active) {
        volumePanel.classList.remove('inactive');
        volumePanel.classList.add('active');
        if (volumeStatusText) {
            volumeStatusText.textContent = t('index.volume.recording');
        }
        if (volumeLevelEl) {
            volumeLevelEl.style.width = '0%';
            volumeLevelEl.className = 'volume-level low';
        }
        if (volumeSilenceEl && silenceMarkerDb === null) {
            volumeSilenceEl.textContent = t('index.volume.silenceRange');
            volumeSilenceEl.style.width = '33%';
        }
    } else {
        volumePanel.classList.remove('active');
        volumePanel.classList.add('inactive');
        if (volumeStatusText) {
            volumeStatusText.textContent = pythonServiceStatus === 'running'
                ? t('index.volume.waiting')
                : t('index.statusText.notReady');
        }
        if (volumeDbValue) {
            volumeDbValue.textContent = '-inf dB';
        }
        if (volumeRmsValue) {
            volumeRmsValue.textContent = 'RMS 0.000';
        }
        if (volumeLevelEl) {
            volumeLevelEl.style.width = '0%';
            volumeLevelEl.className = 'volume-level idle';
        }
        if (volumeSilenceEl) {
            volumeSilenceEl.style.width = '33%';
            volumeSilenceEl.textContent = t('index.volume.silenceRange');
        }
        silenceMarkerDb = null;
    }

    syncVolumePanelOffset();
}

function initializeVolumePanel() {
    if (!volumePanel) {
        return;
    }

    const isCollapsed = volumePanel.classList.contains('collapsed');
    volumePanel.classList.toggle('expanded', !isCollapsed);
    updateVolumeToggleState(!isCollapsed);
}

function toggleVolumePanel(forceExpand) {
    if (!volumePanel || !volumeToggleBtn) {
        return;
    }

    const shouldExpand = typeof forceExpand === 'boolean'
        ? forceExpand
        : volumePanel.classList.contains('collapsed');

    if (shouldExpand) {
        volumePanel.classList.remove('collapsed');
        volumePanel.classList.add('expanded');
    } else {
        volumePanel.classList.add('collapsed');
        volumePanel.classList.remove('expanded');
    }

    updateVolumeToggleState(shouldExpand);
}

function updateVolumeToggleState(expanded) {
    if (volumeToggleBtn) {
        const expandedValue = expanded ? 'true' : 'false';
        volumeToggleBtn.setAttribute('aria-expanded', expandedValue);
        volumeToggleBtn.dataset.expanded = expandedValue;
        volumeToggleBtn.textContent = expanded ? t('index.volume.collapse') : t('index.volume.expand');
        volumeToggleBtn.title = expanded ? t('index.volume.collapseTooltip') : t('index.volume.expandTooltip');
    }

    syncVolumePanelOffset();
}

function syncVolumePanelOffset() {
    if (!mainContent || !volumePanel) {
        return;
    }

    const panelHeight = volumePanel.offsetHeight || 0;
    mainContent.style.setProperty('--volume-offset', `${panelHeight}px`);
}

function getVolumeLevelClass(db) {
    if (db <= -30) {
        return 'low';
    }
    if (db <= -15) {
        return 'medium';
    }
    return 'high';
}

function updateSilenceMarker(db) {
    if (!volumeSilenceEl) {
        return;
    }

    if (typeof db !== 'number' || !isFinite(db)) {
        return;
    }

    if (silenceMarkerDb !== null && Math.abs(silenceMarkerDb - db) < 0.01) {
        return;
    }

    silenceMarkerDb = db;
    const clamped = Math.min(VOLUME_MAX_DB, Math.max(VOLUME_MIN_DB, db));
    const percent = ((clamped - VOLUME_MIN_DB) / (VOLUME_MAX_DB - VOLUME_MIN_DB)) * 100;
    const width = Math.max(0, Math.min(100, percent));
    volumeSilenceEl.style.width = `${width}%`;
    volumeSilenceEl.textContent = `静音范围 (${clamped.toFixed(1)} dB)`;
}

function updateVolumeMeter(payload) {
    if (!volumePanel || !isRecording) {
        return;
    }

    setVolumeRecordingState(true);

    const hasDb = typeof payload.db === 'number' && isFinite(payload.db);
    const rawDb = hasDb ? payload.db : VOLUME_MIN_DB;
    const clampedDb = Math.min(VOLUME_MAX_DB, Math.max(VOLUME_MIN_DB, rawDb));
    const percent = ((clampedDb - VOLUME_MIN_DB) / (VOLUME_MAX_DB - VOLUME_MIN_DB)) * 100;
    const width = Math.max(0, Math.min(100, percent));

    if (volumeLevelEl) {
        const levelClass = getVolumeLevelClass(clampedDb);
        volumeLevelEl.style.width = `${width}%`;
        volumeLevelEl.className = `volume-level ${levelClass}`;
    }

    if (volumeDbValue) {
        if (!hasDb || rawDb <= VOLUME_MIN_DB) {
            volumeDbValue.textContent = `<= ${VOLUME_MIN_DB.toFixed(1)} dB`;
        } else {
            volumeDbValue.textContent = `${clampedDb.toFixed(1)} dB`;
        }
    }

    const hasRms = typeof payload.rms === 'number' && isFinite(payload.rms);
    const rmsValue = hasRms ? payload.rms : 0;
    if (volumeRmsValue) {
        volumeRmsValue.textContent = `RMS ${rmsValue.toFixed(3)}`;
    }

    if (volumeSilenceEl) {
        const silenceDbRaw = typeof payload.silence_db === 'number' && isFinite(payload.silence_db)
            ? payload.silence_db
            : VOLUME_MIN_DB;
        updateSilenceMarker(silenceDbRaw);
    }
}

function handlePythonMessage(message) {
    console.log('Received Python message:', message);
    
    // Detect service status
    if (message.type === 'log') {
        if (message.message.includes('转写服务已启动') || message.message.includes('Python转写服务已启动') ||
            message.message.includes('Transcription service started') || message.message.includes('Service started')) {
            updateServiceStatus('running');
        } else if (message.message.includes('转写服务已停止') || message.message.includes('Transcription service stopped') || message.level === 'error') {
            if (message.message.includes('Python进程启动失败') || message.message.includes('Python process start failed') ||
                message.message.includes('Python错误') || message.message.includes('Python error') ||
                message.message.includes('模块导入失败') || message.message.includes('Module import failed')) {
                updateServiceStatus('error');
            }
        }

        // No longer detect OpenAI status through backend logs, changed to real-time configuration detection
    }
    
    switch (message.type) {
        case 'log':
            // Already output as needed above, remaining logs not displayed
            break;
        case 'result':
        case 'result_final':
            // Handle new result message type
            if (message.transcription) {
                lastTranscription = message.transcription;
                
                if (message.translation) {
                    // Synchronous translation completed: display complete combined message
                    lastTranslation = message.translation;
                    const resultNode = renderResultEntry(message.transcription, message.translation);
                    if (message.result_id) {
                        resultNodes.set(message.result_id, resultNode);
                        console.log('Store synchronous translation result node:', message.result_id);
                    }
                } else if (message.translation_pending) {
                    // Asynchronous translation pending: first display transcription, reserve translation position
                    const resultNode = renderResultEntry(message.transcription, null, true);
                    if (message.result_id) {
                        resultNodes.set(message.result_id, resultNode);
                        console.log('Store asynchronous translation pending node:', message.result_id);
                        
                        // Add a data attribute to mark translation order
                        if (message.translation_order) {
                            resultNode.dataset.translationOrder = message.translation_order;
                            console.log(`Translation order marked: ${message.translation_order}`);
                        }
                        
                        // Smart translation mode: add additional information
                        if (message.smart_translation) {
                            const detectedLang = message.detected_language || 'Unknown';
                            const targetLang = message.target_language || 'Unknown';
                            console.log(`Smart translation: detected ${detectedLang}, target ${targetLang}`);
                        }
                    }
                } else {
                    // No translation: only display transcription
                    const resultNode = renderResultEntry(message.transcription);
                    if (message.result_id) {
                        resultNodes.set(message.result_id, resultNode);
                    }
                }
            } else if (message.transcription_pending && message.result_id) {
                // Placeholder for transcription; ensure order by creating an empty bubble
                const resultNode = renderResultEntry(null /* transcription */, null /* translation */, false /* translationPending */, true /* transcriptionPending */);
                resultNodes.set(message.result_id, resultNode);
                if (message.transcription_order) {
                    resultNode.dataset.transcriptionOrder = message.transcription_order;
                }
            }
            break;
        case 'transcription_update':
            if (message.result_id && resultNodes.has(message.result_id)) {
                const resultNode = resultNodes.get(message.result_id);
                updateTranscriptionInBubble(resultNode, message.transcription);
                console.log('Updated transcription:', message.result_id);
            } else {
                console.warn('Transcription update received but result node not found:', message.result_id);
            }
            break;
        case 'translation_update':
            // Handle asynchronous translation update
            if (message.result_id && resultNodes.has(message.result_id)) {
                const resultNode = resultNodes.get(message.result_id);
                updateTranslationInBubble(resultNode, message.translation);
                console.log('Updated asynchronous translation:', message.result_id);
            } else {
                console.warn('Translation update received but result node not found:', message.result_id);
            }
            break;
        case 'volume_level':
            updateVolumeMeter(message);
            break;
        case 'voice_activity':
            // Handle voice activity status updates
            isVoiceActive = message.active;
            if (isRecording) {
                updateUI(); // Update UI to reflect voice activity animation
            }
            break;
        case 'recording_error':
            addLogEntry('error', `Recording error: ${message.message}`);
            // Stop recording when error occurs
            isRecording = false;
            updateUI();
            break;
        case 'recording_stopped':
            // Backend confirmed recording stopped; ensure UI reflects it
            isRecording = false;
            isVoiceActive = false;
            updateUI();
            break;
        case 'error':
            addLogEntry('error', message.message);
            break;
        default:
            console.log('Unhandled message type:', message.type, message);
    }
}

function addResultBubble(transcription, translation = null, translationPending = false) {
    const container = document.getElementById('results');
    const bubble = document.createElement('div');
    bubble.className = 'result-bubble';
    
    const transcriptionDiv = document.createElement('div');
    transcriptionDiv.className = 'transcription';
    transcriptionDiv.textContent = transcription;
    bubble.appendChild(transcriptionDiv);
    
    if (translation) {
        const translationDiv = document.createElement('div');
        translationDiv.className = 'translation';
        translationDiv.textContent = translation;
        bubble.appendChild(translationDiv);
    } else if (translationPending) {
        const translationDiv = document.createElement('div');
        translationDiv.className = 'translation pending';
        translationDiv.innerHTML = '<span class="translation-loading">翻译中...</span>';
        bubble.appendChild(translationDiv);
    }
    
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    
    return bubble;
}

function updateTranslationInBubble(bubble, translation) {
    let translationDiv = bubble.querySelector('.result-part.translation') || bubble.querySelector('.translation');
    if (translationDiv) {
        translationDiv.className = 'result-part translation';
        translationDiv.textContent = translation;
    } else {
        // Ensure a separator and translation block exist
        const sep = document.createElement('div');
        sep.className = 'result-separator';
        bubble.appendChild(sep);
        translationDiv = document.createElement('div');
        translationDiv.className = 'result-part translation';
        translationDiv.textContent = translation;
        bubble.appendChild(translationDiv);
    }
    logContainer.scrollTop = logContainer.scrollHeight;
}

function updateTranscriptionInBubble(bubble, transcription) {
    let transDiv = bubble.querySelector('.result-part.transcription');
    if (transDiv) {
        transDiv.className = 'result-part transcription';
        transDiv.textContent = transcription;
    } else {
        transDiv = document.createElement('div');
        transDiv.className = 'result-part transcription';
        transDiv.textContent = transcription;
        bubble.insertBefore(transDiv, bubble.firstChild);
    }
    logContainer.scrollTop = logContainer.scrollHeight;
}

function renderResultEntry(transcription, translation = null, translationPending = false, transcriptionPending = false) {
    const entry = document.createElement('div');
    entry.className = 'log-entry result-entry';

    const transDiv = document.createElement('div');
    if (transcriptionPending || !transcription) {
        transDiv.className = 'result-part transcription pending';
        transDiv.textContent = t('index.result.transcribing');
    } else {
        transDiv.className = 'result-part transcription';
        transDiv.textContent = transcription;
    }
    entry.appendChild(transDiv);

    if (translation) {
        const sep = document.createElement('div');
        sep.className = 'result-separator';
        entry.appendChild(sep);

        const tranDiv = document.createElement('div');
        tranDiv.className = 'result-part translation';
        tranDiv.textContent = translation;
        entry.appendChild(tranDiv);
    } else if (translationPending) {
        const sep = document.createElement('div');
        sep.className = 'result-separator';
        entry.appendChild(sep);

        const tranDiv = document.createElement('div');
        tranDiv.className = 'result-part translation pending';
        tranDiv.textContent = t('index.result.translating');
        entry.appendChild(tranDiv);
    }

    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
    return entry;
}

function addLogEntry(level, message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${level}`;
    logEntry.innerHTML = `
        <span class="timestamp">${timestamp}</span>
        <span class="level">[${level.toUpperCase()}]</span>
        <span class="message">${message}</span>
    `;
    
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Keep only last 50 log entries
    while (logContainer.children.length > 50) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

function clearResults() {
    document.getElementById('results').innerHTML = '';
    resultNodes.clear();
    lastTranscription = '';
    lastTranslation = '';
}

function clearLogs() {
    logContainer.innerHTML = '';
}

// Window cleanup when closing
window.addEventListener('beforeunload', () => {
    stopConfigMonitoring();
});

// Helpers for top-bar buttons
function openSettings() {
  try {
    if (window.electronAPI && window.electronAPI.openSettings) {
      window.electronAPI.openSettings();
    } else {
      console.warn('Electron API not available');
    }
  } catch (error) {
    console.error('Failed to open settings:', error);
  }
}

function openMediaTranscribe() {
  try {
    if (window.electronAPI && window.electronAPI.openMediaTranscribe) {
      window.electronAPI.openMediaTranscribe();
    } else {
      console.warn('Electron API not available');
    }
  } catch (error) {
    console.error('Failed to open media transcribe:', error);
  }
}

// Quick entry to voice input settings (dedicated page)
function openKeyboardSettings() {
  try {
    if (window.electronAPI && window.electronAPI.openVoiceInputSettings) {
      window.electronAPI.openVoiceInputSettings();
    } else {
      console.warn('Electron API not available');
    }
  } catch (error) {
    console.error('Failed to open keyboard/voice settings:', error);
  }
}
