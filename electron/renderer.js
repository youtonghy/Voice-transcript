﻿let isRecording = false;
let lastTranscription = '';
let lastTranslation = '';
let pythonServiceStatus = 'unknown'; // 'starting', 'running', 'error', 'stopped'
let isVoiceActive = false; // Added: track voice activity status
let openaiConfigured = false; // Whether OpenAI is configured (when required)
let sonioxConfigured = false; // Whether Soniox is configured (when required)
let geminiConfigured = false; // Whether Gemini is configured when selected
// Qwen3-ASR removed
let translationEnabled = true; // Read from config, used to control combined display
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
const SILENCE_PLACEHOLDER_DB = (VOLUME_MIN_DB + VOLUME_MAX_DB) / 2;
let silenceMarkerDb = null;

const DEFAULT_LANGUAGE = 'en';

function formatSilenceLabel(db) {
    const template = t('index.volume.silenceRangeLabel');
    if (template && template !== 'index.volume.silenceRangeLabel' && template.includes('{value}') && typeof db === 'number' && isFinite(db)) {
        return template.replace('{value}', db.toFixed(1));
    }
    const fallback = t('index.volume.silenceRange');
    if (fallback && fallback !== 'index.volume.silenceRange') {
        return fallback;
    }
    if (typeof db === 'number' && isFinite(db)) {
        return `${t('index.volume.silenceRange')} (${db.toFixed(1)} dB)`;
    }
    return t('index.volume.silenceRange');
}

function setDocumentLanguage(lang) {
    if (document && document.documentElement) {
        document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    }
}

function getCurrentLanguage() {
    if (window.appI18n && typeof window.appI18n.getLanguage === 'function') {
        return window.appI18n.getLanguage();
    }
    return DEFAULT_LANGUAGE;
}

function changeLanguage(lang) {
    let normalized = lang;

    if (!window.appI18n || typeof window.appI18n.setLanguage !== 'function') {
        setDocumentLanguage(lang);
    } else {
        normalized = window.appI18n.setLanguage(lang);
        setDocumentLanguage(normalized);
    }

    currentConfig = currentConfig || {};
    if (currentConfig.app_language !== normalized) {
        currentConfig.app_language = normalized;
    }

    document.title = t('index.title');
}

function getLocalizedList(key) {
    if (!window.appI18n || !window.appI18n.translations) {
        return [];
    }
    const lang = getCurrentLanguage();
    const values = [];
    const collect = (table) => {
        if (!table || !Object.prototype.hasOwnProperty.call(table, key)) {
            return;
        }
        const entry = table[key];
        if (Array.isArray(entry)) {
            entry.forEach((item) => {
                if (typeof item === 'string' && item.trim()) {
                    values.push(item.trim());
                }
            });
        } else if (typeof entry === 'string' && entry.trim()) {
            values.push(entry.trim());
        }
    };
    collect(window.appI18n.translations[lang]);
    if (lang !== DEFAULT_LANGUAGE) {
        collect(window.appI18n.translations[DEFAULT_LANGUAGE]);
    }
    return Array.from(new Set(values));
}

function messageMatchesKey(text, key) {
    if (typeof text !== 'string' || !text) {
        return false;
    }
    const candidates = getLocalizedList(key);
    return candidates.some((fragment) => fragment && text.includes(fragment));
}

function t(key) {
    if (window.appI18n && typeof window.appI18n.t === 'function') {
        return window.appI18n.t(key);
    }
    return key;
}

function applyLanguageFromConfig(cfg) {
    const lang = (cfg && cfg.app_language) || DEFAULT_LANGUAGE;
    changeLanguage(lang);
    if (window.appI18n && typeof window.appI18n.apply === 'function') {
        window.appI18n.apply();
    }
    document.title = t('index.title');
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
    document.title = t('index.title');
    if (typeof window.appI18n.onChange === 'function') {
        window.appI18n.onChange(() => {
            document.title = t('index.title');
            updateServiceStatus(pythonServiceStatus);
            updateUI();
            if (silenceMarkerDb !== null) {
                updateSilenceMarker(silenceMarkerDb);
            }
            if (volumePanel && volumeToggleBtn) {
                const expanded = !volumePanel.classList.contains('collapsed');
                updateVolumeToggleState(expanded);
            }
        });
    }
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

    if (statusDot && !isRecording) {
        const statusClassMap = {
            running: 'running',
            starting: 'starting',
            error: 'error',
            stopped: 'stopped'
        };
        const statusClass = statusClassMap[status] || 'idle';
        statusDot.className = `status-dot ${statusClass}`;
    }

    if (status !== 'running') {
        recordButton.disabled = true;
        recordButton.textContent = '馃敡';
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
            if (silenceMarkerDb !== null) {
                updateSilenceMarker(silenceMarkerDb);
            }
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
            if (silenceMarkerDb !== null) {
                updateSilenceMarker(silenceMarkerDb);
            }
        } else {
            // Don't output real-time log
        }
    } catch (error) {
        console.error('Stop recording error:', error);
    }
}

function updateUI() {
    if (isRecording) {
        recordButton.textContent = '鈴癸笍';
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
        recordButton.textContent = '馃帳';
        recordButton.title = t('index.tooltips.recordStart');
        recordButton.className = 'control-bar-btn record-btn start';
        if (typeof statusDot !== 'undefined' && statusDot) {
            const statusClassMap = {
                running: 'running',
                starting: 'starting',
                error: 'error',
                stopped: 'stopped'
            };
            const dotClass = statusClassMap[pythonServiceStatus] || 'idle';
            statusDot.className = `status-dot ${dotClass}`;
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
            volumeSilenceEl.style.width = '33%';
            volumeSilenceEl.textContent = formatSilenceLabel(SILENCE_PLACEHOLDER_DB);
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
            volumeSilenceEl.textContent = formatSilenceLabel(SILENCE_PLACEHOLDER_DB);
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
    volumeSilenceEl.textContent = formatSilenceLabel(clamped);
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
        const logText = typeof message.message === 'string' ? message.message : '';
        if (messageMatchesKey(logText, 'index.serviceMessages.started')) {
            updateServiceStatus('running');
        } else if (messageMatchesKey(logText, 'index.serviceMessages.stopped') || message.level === 'error') {
            if (messageMatchesKey(logText, 'index.serviceMessages.pythonError') || messageMatchesKey(logText, 'index.serviceMessages.moduleError')) {
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
                updateUI();
            if (silenceMarkerDb !== null) {
                updateSilenceMarker(silenceMarkerDb);
            } // Update UI to reflect voice activity animation
            }
            break;
        case 'recording_error':
            addLogEntry('error', `Recording error: ${message.message}`);
            // Stop recording when error occurs
            isRecording = false;
            updateUI();
            if (silenceMarkerDb !== null) {
                updateSilenceMarker(silenceMarkerDb);
            }
            break;
        case 'recording_stopped':
            // Backend confirmed recording stopped; ensure UI reflects it
            isRecording = false;
            isVoiceActive = false;
            updateUI();
            if (silenceMarkerDb !== null) {
                updateSilenceMarker(silenceMarkerDb);
            }
            break;
        case 'error':
            addLogEntry('error', message.message);
            break;
        default:
            console.log('Unhandled message type:', message.type, message);
    }
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
        if (transcription && !transcriptionPending) {
            const sep = document.createElement('div');
            sep.className = 'result-separator';
            entry.appendChild(sep);
        }
        const translationDiv = document.createElement('div');
        translationDiv.className = 'result-part translation pending';
        translationDiv.textContent = t('index.translation.loading');
        entry.appendChild(translationDiv);
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
    const container = document.getElementById('results');
    if (container) {
        container.innerHTML = '';
    }
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



















