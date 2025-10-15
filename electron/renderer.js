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
let resultNodes = new Map(); // Result node mapping table, key is result_id, value is DOM element
let currentConfig = {}; // Store current configuration
let configCheckInterval = null; // Timer for periodic configuration checks
let summaryInProgress = false; // Guard against duplicate summary requests
const pendingTranslationCopyRequests = new Map();
let activeContextMenu = null;
let contextMenuTargetEntry = null;
let contextMenuTargetElement = null;
let historyContextMenu = null;
let historyContextMenuTargetId = null;

const CONVERSATION_STORAGE_KEY = 'voice_transcript_conversations_v1';
const ACTIVE_CONVERSATION_STORAGE_KEY = 'voice_transcript_active_conversation_v1';
let conversations = [];
let activeConversationId = null;
const resultConversationMap = new Map();
const HISTORY_COLLAPSED_STORAGE_KEY = 'voice_transcript_history_collapsed';
let historyCollapsed = false;
let historySearchQuery = '';
let historySearchQueryNormalized = '';
let historyDateFormatter = null;
let lastVolumeDbDisplay = { type: 'negInf', value: null };
let lastVolumeRms = 0;
const CONVERSATION_TITLE_DEBOUNCE_MS = 800;
const MAX_TITLE_SEGMENTS = 12;
const MAX_TITLE_FIELD_LENGTH = 400;
const MAX_SUMMARY_SEGMENTS = 60;
const conversationTitleTimers = new Map();
const conversationTitleRequests = new Map();
const conversationTitleRescheduleSet = new Set();
const SUPPRESSED_LOG_KEYS = [ // Hide routine status notifications from the log view
    'index.log.translationQueued',
    'index.log.translationRequestedCopy',
    'index.optimized.logQueued',
    'index.log.copySuccess'
];
const SUPPRESSED_LOG_FALLBACKS = new Set(['Copied to clipboard', '已复制到剪贴板']);
const CONTEXT_MENU_ACTIONS = [
    { action: 'copy', labelKey: 'index.context.copy' },
    { action: 'copy-translation', labelKey: 'index.context.copyTranslation' },
    { action: 'delete', labelKey: 'index.context.delete' },
    { action: 'translate', labelKey: 'index.context.translate' },
    { action: 'optimize', labelKey: 'index.context.optimize' }
];
const HISTORY_CONTEXT_MENU_ACTIONS = [
    { action: 'move-top', labelKey: 'index.history.context.moveToTop' },
    { action: 'toggle-pin', labelKey: 'index.history.context.pin' },
    { action: 'delete', labelKey: 'index.history.context.delete' }
];
let lastConversationOrderRank = Date.now();

function removeInvalidSurrogates(text) {
    if (typeof text !== 'string') {
        return '';
    }
    let result = '';
    for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF) {
            const next = text.charCodeAt(i + 1);
            if (next >= 0xDC00 && next <= 0xDFFF) {
                result += text[i] + text[i + 1];
                i += 1;
                continue;
            }
            continue;
        }
        if (code >= 0xDC00 && code <= 0xDFFF) {
            continue;
        }
        result += text[i];
    }
    return result;
}

// DOM elements
const recordButton = document.getElementById('recordButton');
const recordButtonIconEl = recordButton ? recordButton.querySelector('.record-icon') : null;
const recordButtonLabel = recordButton ? recordButton.querySelector('.record-label') : null;
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
const settingsModal = document.getElementById('settingsModal');
const settingsModalScroll = document.getElementById('settingsModalScroll');
let settingsMarkupLoaded = false;
let settingsMarkupLoadingPromise = null;
let settingsStylesInjected = false;

const windowControlMinimize = document.getElementById('windowControlMinimize');
const windowControlMaximize = document.getElementById('windowControlMaximize');
const windowControlClose = document.getElementById('windowControlClose');
let disposeWindowStateListener = null;

const historyList = document.getElementById('historyList');
const newConversationButton = document.getElementById('newConversationButton');
const activeConversationNameEl = document.getElementById('activeConversationName');
const historySearchInput = document.getElementById('historySearchInput');

const toggleHistoryButton = document.getElementById('toggleHistoryButton');
const summaryButton = document.getElementById('summaryButton');

const VOLUME_MIN_DB = -60;
const VOLUME_MAX_DB = 0;
const SILENCE_PLACEHOLDER_DB = (VOLUME_MIN_DB + VOLUME_MAX_DB) / 2;
let silenceMarkerDb = null;

const DEFAULT_LANGUAGE = 'en';
const RECORD_ICON_MIC = String.fromCodePoint(0x1F3A4);
const RECORD_ICON_STOP = String.fromCodePoint(0x23F9, 0xFE0F);
const HISTORY_TOGGLE_ICON_EXPANDED = String.fromCodePoint(0x2190);
const HISTORY_TOGGLE_ICON_COLLAPSED = String.fromCodePoint(0x2192);

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

function formatDbLessEqual(db) {
    const formatted = typeof db === 'number' && isFinite(db) ? db.toFixed(1) : '0.0';
    const template = t('index.volume.dbValueLessEqual');
    if (template && template !== 'index.volume.dbValueLessEqual' && template.includes('{value}')) {
        return template.replace('{value}', formatted);
    }
    return `<= ${formatted} dB`;
}

function formatDbExact(db) {
    const formatted = typeof db === 'number' && isFinite(db) ? db.toFixed(1) : '0.0';
    const template = t('index.volume.dbValue');
    if (template && template !== 'index.volume.dbValue' && template.includes('{value}')) {
        return template.replace('{value}', formatted);
    }
    return `${formatted} dB`;
}

function formatDbNegInf() {
    const textValue = t('index.volume.dbValueNegInf');
    if (textValue && textValue !== 'index.volume.dbValueNegInf') {
        return textValue;
    }
    return '-inf dB';
}

function formatRmsDisplay(rms) {
    const formatted = typeof rms === 'number' && isFinite(rms) ? rms.toFixed(3) : '0.000';
    const template = t('index.volume.rmsValue');
    if (template && template !== 'index.volume.rmsValue' && template.includes('{value}')) {
        return template.replace('{value}', formatted);
    }
    return `RMS ${formatted}`;
}

function renderVolumeValues() {
    if (volumeDbValue) {
        if (!lastVolumeDbDisplay || lastVolumeDbDisplay.type === 'negInf') {
            volumeDbValue.textContent = formatDbNegInf();
        } else if (lastVolumeDbDisplay.type === 'lessEqual') {
            volumeDbValue.textContent = formatDbLessEqual(lastVolumeDbDisplay.value);
        } else {
            volumeDbValue.textContent = formatDbExact(lastVolumeDbDisplay.value);
        }
    }
    if (volumeRmsValue) {
        volumeRmsValue.textContent = formatRmsDisplay(lastVolumeRms);
    }
}

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
    historyDateFormatter = null;
}

function setRecordButtonVisual(icon, labelKey) {
    if (!recordButton) {
        return;
    }
    if (recordButtonIconEl) {
        recordButtonIconEl.textContent = icon;
    } else {
        recordButton.textContent = icon;
    }
    if (labelKey && recordButtonLabel) {
        recordButtonLabel.textContent = t(labelKey);
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
    updateHistoryToggleUI();
    if (volumeSilenceEl && silenceMarkerDb === null) {
        volumeSilenceEl.textContent = formatSilenceLabel(SILENCE_PLACEHOLDER_DB);
    }
    renderVolumeValues();
    updateUI();
}

function updateWindowControlState(state) {
    if (!windowControlMaximize) {
        return;
    }
    const shouldRestore = Boolean(state && (state.isFullScreen || state.isMaximized));
    windowControlMaximize.classList.toggle('is-maximized', shouldRestore);
    windowControlMaximize.setAttribute('title', shouldRestore ? 'Restore Window' : 'Maximize Window');
    windowControlMaximize.setAttribute('aria-label', shouldRestore ? 'Restore Window' : 'Maximize Window');
}

function initializeWindowControls() {
    if (!window || !window.electronAPI || !window.electronAPI.windowControls) {
        return;
    }
    const controls = window.electronAPI.windowControls;
    if (windowControlMinimize && !windowControlMinimize.dataset.bound) {
        windowControlMinimize.addEventListener('click', () => controls.minimize());
        windowControlMinimize.dataset.bound = 'true';
    }
    if (windowControlMaximize && !windowControlMaximize.dataset.bound) {
        windowControlMaximize.addEventListener('click', () => controls.toggleMaximize());
        windowControlMaximize.dataset.bound = 'true';
    }
    if (windowControlClose && !windowControlClose.dataset.bound) {
        windowControlClose.addEventListener('click', () => controls.close());
        windowControlClose.dataset.bound = 'true';
    }
    if (disposeWindowStateListener) {
        disposeWindowStateListener();
        disposeWindowStateListener = null;
    }
    if (typeof window.electronAPI.onWindowStateChange === 'function') {
        disposeWindowStateListener = window.electronAPI.onWindowStateChange(updateWindowControlState);
    }
}

function formatRecordedAtText(isoString) {
    if (typeof isoString !== 'string' || !isoString) {
        return '';
    }
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}`;
}

function getHistoryDateKey(isoString) {
    if (typeof isoString !== 'string' || !isoString) {
        return 'unknown';
    }
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
        return 'unknown';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getHistoryDateFormatter() {
    if (historyDateFormatter) {
        return historyDateFormatter;
    }
    try {
        const locale = (typeof navigator === 'object' && navigator && navigator.language)
            ? navigator.language
            : DEFAULT_LANGUAGE;
        historyDateFormatter = new Intl.DateTimeFormat(locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (error) {
        console.warn('Failed to create history date formatter:', error);
        historyDateFormatter = null;
    }
    return historyDateFormatter;
}

function formatHistoryDateHeading(isoString) {
    if (typeof isoString !== 'string' || !isoString) {
        return 'Unknown date';
    }
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
        return 'Unknown date';
    }
    const formatter = getHistoryDateFormatter();
    if (formatter) {
        try {
            return formatter.format(date);
        } catch (error) {
            console.warn('Failed to format history date:', error);
        }
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function createHistoryDateDivider(label) {
    const divider = document.createElement('div');
    divider.className = 'history-date-divider';
    const span = document.createElement('span');
    span.className = 'history-date-label';
    span.textContent = label && typeof label === 'string' && label ? label : 'Unknown date';
    divider.appendChild(span);
    return divider;
}

function formatDurationText(durationSeconds) {
    if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds)) {
        return '';
    }
    const totalSeconds = Math.max(0, Math.round(durationSeconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
    }
    if (minutes > 0) {
        return `${minutes}m${String(seconds).padStart(2, '0')}s`;
    }
    return `${seconds}s`;
}

function ensureRecordingMetaElement(entry) {
    if (!entry) {
        return null;
    }
    let metaDiv = entry.querySelector('.recording-meta');
    if (!metaDiv) {
        metaDiv = document.createElement('div');
        metaDiv.className = 'recording-meta';
        entry.appendChild(metaDiv);
    }
    return metaDiv;
}

function applyRecordingMeta(entry, meta = {}) {
    if (!entry || typeof entry !== 'object') {
        return;
    }

    const { recordedAt, durationSeconds } = meta;
    if (typeof recordedAt === 'string' && recordedAt) {
        entry.dataset.recordedAt = recordedAt;
    }
    if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)) {
        entry.dataset.durationSec = String(durationSeconds);
    }

    const storedRecordedAt = entry.dataset.recordedAt || '';
    const storedDuration = entry.dataset.durationSec;
    const durationValue = typeof storedDuration === 'string' && storedDuration !== '' ? Number(storedDuration) : null;

    if (!storedRecordedAt && (durationValue === null || Number.isNaN(durationValue))) {
        const existing = entry.querySelector('.recording-meta');
        if (existing) {
            existing.textContent = '';
        }
        return;
    }

    const metaDiv = ensureRecordingMetaElement(entry);
    if (!metaDiv) {
        return;
    }

    const recordedText = formatRecordedAtText(storedRecordedAt);
    const durationText = (durationValue !== null && Number.isFinite(durationValue)) ? formatDurationText(durationValue) : '';
    const parts = [];
    if (recordedText) {
        parts.push(recordedText);
    }
    if (durationText) {
        parts.push(durationText);
    }

    metaDiv.textContent = parts.join(' ').trim();
}

function extractRecordingMeta(message) {
    if (!message || typeof message !== 'object') {
        return {};
    }
    const meta = {};
    if (typeof message.recorded_at === 'string' && message.recorded_at) {
        meta.recordedAt = message.recorded_at;
    } else if (typeof message.timestamp === 'string' && message.timestamp) {
        meta.recordedAt = message.timestamp;
    }
    if (typeof message.duration_seconds === 'number' && Number.isFinite(message.duration_seconds)) {
        meta.durationSeconds = message.duration_seconds;
    } else if (typeof message.duration_ms === 'number' && Number.isFinite(message.duration_ms)) {
        meta.durationSeconds = message.duration_ms / 1000;
    }
    return meta;
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

function shouldSuppressLogMessage(text) {
    if (typeof text !== 'string' || !text) {
        return false;
    }
    const trimmed = text.trim();
    if (SUPPRESSED_LOG_FALLBACKS.has(trimmed)) {
        return true;
    }
    return SUPPRESSED_LOG_KEYS.some((key) => messageMatchesKey(trimmed, key));
}

function t(key) {
    if (window.appI18n && typeof window.appI18n.t === 'function') {
        return window.appI18n.t(key);
    }
    return key;
}


// History panel visibility management
function getStoredHistoryCollapsed() {
    if (typeof localStorage === 'undefined') {
        return null;
    }
    try {
        return localStorage.getItem(HISTORY_COLLAPSED_STORAGE_KEY);
    } catch (error) {
        console.warn('Failed to read history collapsed state:', error);
        return null;
    }
}

function storeHistoryCollapsed(collapsed) {
    if (typeof localStorage === 'undefined') {
        return;
    }
    try {
        localStorage.setItem(HISTORY_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch (error) {
        console.warn('Failed to store history collapsed state:', error);
    }
}

function updateHistoryToggleUI() {
    if (!toggleHistoryButton) {
        return;
    }
    const key = historyCollapsed ? 'index.history.show' : 'index.history.hide';
    const label = t(key);
    const icon = historyCollapsed ? HISTORY_TOGGLE_ICON_COLLAPSED : HISTORY_TOGGLE_ICON_EXPANDED;
    toggleHistoryButton.textContent = icon;
    toggleHistoryButton.title = label;
    toggleHistoryButton.setAttribute('aria-label', label);
    toggleHistoryButton.setAttribute('aria-expanded', historyCollapsed ? 'false' : 'true');
    toggleHistoryButton.setAttribute('data-collapsed', historyCollapsed ? 'true' : 'false');
}

function setHistoryCollapsed(collapsed, { persist = true } = {}) {
    historyCollapsed = Boolean(collapsed);
    if (mainContent) {
        mainContent.classList.toggle('history-collapsed', historyCollapsed);
    }
    updateHistoryToggleUI();
    if (persist) {
        storeHistoryCollapsed(historyCollapsed);
    }
}

function toggleHistoryPanel() {
    setHistoryCollapsed(!historyCollapsed);
}

function initializeHistoryCollapsedState() {
    const stored = getStoredHistoryCollapsed();
    const collapsed = stored === '1';
    setHistoryCollapsed(collapsed, { persist: false });
}

// Conversation history management
function updateLastConversationOrderRank(value) {
    const numeric = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(numeric)) {
        return;
    }
    if (!Number.isFinite(lastConversationOrderRank) || numeric > lastConversationOrderRank) {
        lastConversationOrderRank = numeric;
    }
}

function getNextConversationOrderRank() {
    const now = Date.now();
    if (!Number.isFinite(lastConversationOrderRank) || now > lastConversationOrderRank) {
        lastConversationOrderRank = now;
    } else {
        lastConversationOrderRank += 1;
    }
    return lastConversationOrderRank;
}

function bumpConversationOrder(conversation) {
    if (!conversation) {
        return;
    }
    conversation.orderRank = getNextConversationOrderRank();
}

function markConversationUpdated(conversation, timestamp = null, { bumpOrder = true } = {}) {
    const normalizedTimestamp = typeof timestamp === 'string' && timestamp
        ? timestamp
        : new Date().toISOString();
    if (conversation) {
        conversation.updatedAt = normalizedTimestamp;
        if (bumpOrder) {
            bumpConversationOrder(conversation);
        }
    }
    return normalizedTimestamp;
}

function truncateText(value, maxLength, { addEllipsis = true } = {}) {
    if (typeof value !== 'string') {
        return '';
    }
    const cleaned = removeInvalidSurrogates(value);
    const chars = Array.from(cleaned);
    if (chars.length <= maxLength) {
        return cleaned;
    }
    const sliced = chars.slice(0, Math.max(0, maxLength)).join('');
    return addEllipsis ? `${sliced}...` : sliced;
}

function getEmptyConversationTitle() {
    const text = t('index.history.emptyConversationTitle');
    if (typeof text === 'string' && text && text !== 'index.history.emptyConversationTitle') {
        return text;
    }
    return '空对话';
}

function getConversationTitleTargetLanguage() {
    const lang = (currentConfig && currentConfig.app_language) || DEFAULT_LANGUAGE;
    if (lang === 'en') {
        return 'English';
    }
    return 'Chinese';
}

function getSummaryTargetLanguage() {
    const uiLanguage = getConversationTitleTargetLanguage();
    if (typeof uiLanguage === 'string' && uiLanguage.trim()) {
        return removeInvalidSurrogates(uiLanguage.trim());
    }
    return 'English';
}

function normalizeSummaryText(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    const collapsed = removeInvalidSurrogates(trimmed.replace(/\s+/g, ' '));
    return truncateText(collapsed, MAX_TITLE_FIELD_LENGTH, { addEllipsis: false });
}

function collectSummarySegments(conversation) {
    if (!conversation || !Array.isArray(conversation.entries)) {
        return [];
    }
    const segments = [];
    for (let i = 0; i < conversation.entries.length && segments.length < MAX_TITLE_SEGMENTS; i += 1) {
        const entry = conversation.entries[i];
        if (!entry || entry.type !== 'result') {
            continue;
        }
        const transcription = normalizeSummaryText(entry.transcription && !entry.transcriptionPending ? entry.transcription : '');
        const translation = normalizeSummaryText(entry.translation && !entry.translationPending ? entry.translation : '');
        if (!transcription && !translation) {
            continue;
        }
        segments.push({
            transcription,
            translation,
            createdAt: entry.createdAt || null
        });
    }
    return segments;
}

function collectSegmentsForConversationSummary(conversation) {
    if (!conversation || !Array.isArray(conversation.entries)) {
        return [];
    }
    const segments = [];
    for (let i = 0; i < conversation.entries.length; i += 1) {
        const entry = conversation.entries[i];
        if (!entry || entry.type !== 'result') {
            continue;
        }
        const transcription = normalizeSummaryText(entry.transcription && entry.transcriptionPending !== true ? entry.transcription : '');
        const translation = normalizeSummaryText(entry.translation && entry.translationPending !== true ? entry.translation : '');
        if (!transcription && !translation) {
            continue;
        }
        segments.push({
            transcription,
            translation,
            createdAt: entry.createdAt || null
        });
        if (segments.length >= MAX_SUMMARY_SEGMENTS) {
            break;
        }
    }
    return segments;
}

function buildFallbackConversationTitle(segments) {
    if (!Array.isArray(segments) || !segments.length) {
        return getEmptyConversationTitle();
    }
    const candidate = segments.find((item) => item && item.transcription) || segments[0];
    const base = candidate && candidate.transcription ? candidate.transcription : candidate.translation;
    if (!base) {
        return getEmptyConversationTitle();
    }
    return truncateText(removeInvalidSurrogates(base), 36);
}

function applyConversationTitle(conversation, title, { save = true } = {}) {
    if (!conversation || typeof title !== 'string') {
        return;
    }
    const normalized = removeInvalidSurrogates(title).trim() || getEmptyConversationTitle();
    if (conversation.name === normalized) {
        return;
    }
    conversation.name = normalized;
    conversation.titleGeneratedAt = new Date().toISOString();
    conversation.needsTitleRefresh = false;
    if (save) {
        saveConversationsToStorage();
    }
    renderHistoryList();
    if (conversation.id === activeConversationId) {
        updateActiveConversationLabel(conversation);
    }
}

function markConversationTitleDirty(conversation) {
    if (!conversation) {
        return;
    }
    conversation.titleGeneratedAt = null;
    conversation.needsTitleRefresh = true;
}

function scheduleConversationTitleUpdate(conversationId, options = {}) {
    if (!conversationId) {
        return;
    }
    const conversation = getConversationById(conversationId);
    if (!conversation) {
        return;
    }
    const force = options.force === true;
    const delay = typeof options.delay === 'number' ? options.delay : CONVERSATION_TITLE_DEBOUNCE_MS;
    const needsRefresh = conversation.needsTitleRefresh === true;
    if (!force && !needsRefresh) {
        return;
    }
    const hasReadyResult = conversation.entries && conversation.entries.some((entry) => {
        if (!entry || entry.type !== 'result') {
            return false;
        }
        const hasTranscription = typeof entry.transcription === 'string' && entry.transcription.trim() && entry.transcriptionPending !== true;
        const hasTranslation = typeof entry.translation === 'string' && entry.translation.trim() && entry.translationPending !== true;
        return hasTranscription || hasTranslation;
    });
    if (!hasReadyResult) {
        return;
    }
    if (!force && conversation.titleGeneratedAt && !needsRefresh) {
        return;
    }
    if (conversationTitleRequests.has(conversationId)) {
        return;
    }
    if (conversationTitleTimers.has(conversationId)) {
        clearTimeout(conversationTitleTimers.get(conversationId));
    }
    const pendingResults = conversation.entries && conversation.entries.some((entry) => entry && entry.type === 'result' && (entry.transcriptionPending || entry.translationPending));
    if (pendingResults && !force) {
        const retryTimer = setTimeout(() => {
            conversationTitleTimers.delete(conversationId);
            scheduleConversationTitleUpdate(conversationId, options);
        }, Math.max(delay, 500));
        conversationTitleTimers.set(conversationId, retryTimer);
        return;
    }
    const timer = setTimeout(() => {
        conversationTitleTimers.delete(conversationId);
        requestConversationTitle(conversationId);
    }, delay);
    conversationTitleTimers.set(conversationId, timer);
}

async function requestConversationTitle(conversationId) {
    const conversation = getConversationById(conversationId);
    if (!conversation) {
        return;
    }
    const segments = collectSummarySegments(conversation);
    const emptyTitle = getEmptyConversationTitle();
    if (!segments.length) {
        applyConversationTitle(conversation, emptyTitle);
        conversationTitleRequests.delete(conversationId);
        conversationTitleRescheduleSet.delete(conversationId);
        return;
    }
    const fallbackTitle = buildFallbackConversationTitle(segments);
    const targetLanguage = getConversationTitleTargetLanguage();
    const updatedAt = conversation.updatedAt || conversation.createdAt || new Date().toISOString();
    conversationTitleRequests.set(conversationId, { updatedAt });
    if (!window.electronAPI || typeof window.electronAPI.summarizeConversationTitle !== 'function') {
        conversationTitleRequests.delete(conversationId);
        applyConversationTitle(conversation, fallbackTitle);
        conversationTitleRescheduleSet.delete(conversationId);
        return;
    }
    try {
        const response = await window.electronAPI.summarizeConversationTitle({
            conversationId,
            segments,
            targetLanguage,
            emptyTitle,
            fallbackTitle,
            updatedAt
        });
        const current = conversationTitleRequests.get(conversationId);
        const currentUpdatedAt = conversation.updatedAt || conversation.createdAt;
        if (!current || current.updatedAt !== updatedAt || (currentUpdatedAt && currentUpdatedAt !== updatedAt)) {
            return;
        }
        if (response && response.title && typeof response.title === 'string') {
            applyConversationTitle(conversation, response.title, { save: true });
        } else {
            applyConversationTitle(conversation, fallbackTitle, { save: true });
        }
    } catch (error) {
        applyConversationTitle(conversation, fallbackTitle, { save: true });
        conversationTitleRescheduleSet.delete(conversationId);
    } finally {
        conversationTitleRequests.delete(conversationId);
    }
}

function handleConversationSummaryMessage(message) {
    if (!message || !message.conversation_id) {
        return;
    }
    const conversation = getConversationById(message.conversation_id);
    if (!conversation) {
        conversationTitleRequests.delete(message.conversation_id);
        return;
    }
    const currentContext = conversationTitleRequests.get(conversation.id);
    if (currentContext && message.context_updated_at && currentContext.updatedAt && currentContext.updatedAt !== message.context_updated_at) {
        return;
    }
    if (message.title && typeof message.title === 'string') {
        applyConversationTitle(conversation, message.title, { save: true });
    }
    conversationTitleRequests.delete(conversation.id);
    if (conversationTitleRescheduleSet.has(conversation.id)) {
        conversationTitleRescheduleSet.delete(conversation.id);
        markConversationTitleDirty(conversation);
        saveConversationsToStorage();
        scheduleConversationTitleUpdate(conversation.id, { delay: 200 });
    }
}

function generateConversationName(date = new Date()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        date = new Date();
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function normalizeEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    if (entry.type === 'result') {
        const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString();
        const normalized = {
            id: typeof entry.id === 'string' ? entry.id : `result-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            type: 'result',
            resultId: typeof entry.resultId === 'string' ? entry.resultId : null,
            transcription: typeof entry.transcription === 'string' ? entry.transcription : '',
            translation: typeof entry.translation === 'string' ? entry.translation : '',
            translationPending: entry.translationPending === true,
            transcriptionPending: entry.transcriptionPending === true,
            meta: entry.meta && typeof entry.meta === 'object' ? { ...entry.meta } : {},
            optimized: typeof entry.optimized === 'string' ? entry.optimized : '',
            optimizedPending: entry.optimizedPending === true,
            optimizedError: typeof entry.optimizedError === 'string' ? entry.optimizedError : null,
            optimizationMeta: entry.optimizationMeta && typeof entry.optimizationMeta === 'object' ? { ...entry.optimizationMeta } : null,
            createdAt,
            updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : createdAt
        };
        return normalized;
    }
    if (entry.type === 'summary') {
        const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString();
        const updatedAt = typeof entry.updatedAt === 'string' ? entry.updatedAt : createdAt;
        const id = typeof entry.id === 'string' ? entry.id : `summary-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const status = entry.status === 'ready' ? 'ready' : (entry.status === 'error' ? 'error' : 'pending');
        return {
            id,
            type: 'summary',
            status,
            content: typeof entry.content === 'string' ? entry.content : '',
            engine: typeof entry.engine === 'string' ? entry.engine : null,
            model: typeof entry.model === 'string' ? entry.model : null,
            error: typeof entry.error === 'string' ? entry.error : null,
            requestId: typeof entry.requestId === 'string' ? entry.requestId : null,
            createdAt,
            updatedAt
        };
    }
    if (entry.type === 'log') {
        return {
            id: typeof entry.id === 'string' ? entry.id : `log-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            type: 'log',
            level: typeof entry.level === 'string' ? entry.level : 'info',
            message: typeof entry.message === 'string' ? entry.message : '',
            timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : '',
            createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString()
        };
    }
    return null;
}

function normalizeConversation(conversation) {
    if (!conversation || typeof conversation !== 'object') {
        return null;
    }
    const createdAt = typeof conversation.createdAt === 'string' ? conversation.createdAt : new Date().toISOString();
    const updatedAt = typeof conversation.updatedAt === 'string' ? conversation.updatedAt : createdAt;
    const pinned = conversation.pinned === true;
    const pinnedAt = pinned
        ? (typeof conversation.pinnedAt === 'string' && conversation.pinnedAt ? conversation.pinnedAt : updatedAt)
        : null;
    const rawOrderRank = typeof conversation.orderRank === 'number'
        ? conversation.orderRank
        : Number(conversation.orderRank);
    const fallbackRank = Number.isFinite(Date.parse(updatedAt)) ? Date.parse(updatedAt) : Date.now();
    const orderRank = Number.isFinite(rawOrderRank) ? rawOrderRank : fallbackRank;
    updateLastConversationOrderRank(orderRank);
    const normalized = {
        id: typeof conversation.id === 'string' ? conversation.id : `conv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name: typeof conversation.name === 'string' && conversation.name ? conversation.name : generateConversationName(new Date(createdAt)),
        createdAt,
        updatedAt,
        titleGeneratedAt: typeof conversation.titleGeneratedAt === 'string' ? conversation.titleGeneratedAt : null,
        needsTitleRefresh: conversation.needsTitleRefresh === true,
        pinned,
        pinnedAt,
        orderRank,
        entries: Array.isArray(conversation.entries) ? conversation.entries.map(normalizeEntry).filter(Boolean) : []
    };
    return normalized;
}

function loadConversationsFromStorage() {
    if (typeof localStorage === 'undefined') {
        return [];
    }
    try {
        const raw = localStorage.getItem(CONVERSATION_STORAGE_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.map(normalizeConversation).filter(Boolean);
    } catch (error) {
        console.warn('Failed to load conversations from storage:', error);
        return [];
    }
}

function saveConversationsToStorage() {
    if (typeof localStorage === 'undefined') {
        return;
    }
    try {
        localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(conversations));
    } catch (error) {
        console.warn('Failed to save conversations to storage:', error);
    }
}

function loadActiveConversationId() {
    if (typeof localStorage === 'undefined') {
        return null;
    }
    try {
        const stored = localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
        if (typeof stored === 'string' && stored) {
            return stored;
        }
        return null;
    } catch (error) {
        console.warn('Failed to load active conversation id from storage:', error);
        return null;
    }
}

function saveActiveConversationId(conversationId) {
    if (typeof localStorage === 'undefined') {
        return;
    }
    try {
        if (conversationId) {
            localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, conversationId);
        } else {
            localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
        }
    } catch (error) {
        console.warn('Failed to save active conversation id to storage:', error);
    }
}

function conversationMatchesSearch(conversation, normalizedQuery) {
    if (!conversation) {
        return false;
    }
    if (!normalizedQuery) {
        return true;
    }
    const name = typeof conversation.name === 'string' ? removeInvalidSurrogates(conversation.name).toLowerCase() : '';
    if (name && name.includes(normalizedQuery)) {
        return true;
    }
    if (!Array.isArray(conversation.entries) || !conversation.entries.length) {
        return false;
    }
    for (let i = 0; i < conversation.entries.length; i += 1) {
        const entry = conversation.entries[i];
        if (!entry || entry.type !== 'result') {
            continue;
        }
        if (typeof entry.transcription === 'string' && entry.transcription) {
            const transcription = removeInvalidSurrogates(entry.transcription).toLowerCase();
            if (transcription.includes(normalizedQuery)) {
                return true;
            }
        }
        if (typeof entry.translation === 'string' && entry.translation) {
            const translation = removeInvalidSurrogates(entry.translation).toLowerCase();
            if (translation.includes(normalizedQuery)) {
                return true;
            }
        }
    }
    return false;
}

function applyHistorySearch(query) {
    const safeInput = typeof query === 'string' ? removeInvalidSurrogates(query) : '';
    const trimmed = safeInput.trim();
    historySearchQuery = trimmed;
    historySearchQueryNormalized = trimmed ? trimmed.toLowerCase() : '';
    renderHistoryList();
    if (historySearchInput && historySearchInput.value !== trimmed) {
        historySearchInput.value = trimmed;
    }
}

function registerConversationEntries(conversation) {
    if (!conversation || !Array.isArray(conversation.entries)) {
        return;
    }
    conversation.entries.forEach((entry) => {
        if (entry && entry.type === 'result' && entry.resultId) {
            resultConversationMap.set(entry.resultId, { conversationId: conversation.id, entryId: entry.id });
        }
    });
}

function rebuildResultConversationMap() {
    resultConversationMap.clear();
    conversations.forEach((conversation) => registerConversationEntries(conversation));
}

function getConversationById(conversationId) {
    if (!conversationId) {
        return null;
    }
    return conversations.find((item) => item && item.id === conversationId) || null;
}

function getActiveConversation() {
    return getConversationById(activeConversationId);
}

function setActiveConversation(conversationId) {
    const conversation = getConversationById(conversationId);
    if (!conversation) {
        return;
    }
    activeConversationId = conversationId;
    saveActiveConversationId(conversationId);
    renderHistoryList();
    renderConversationLogs();
}

function getMostRecentConversationId() {
    if (!Array.isArray(conversations) || !conversations.length) {
        return null;
    }
    const sorted = getSortedConversations();
    if (!sorted.length) {
        return null;
    }
    return sorted[0].id;
}

function updateActiveConversationLabel(conversation) {
    if (!activeConversationNameEl) {
        return;
    }
    if (conversation) {
        const prefix = t('index.history.currentPrefix');
        activeConversationNameEl.textContent = prefix ? `${prefix} ${conversation.name}` : conversation.name;
        activeConversationNameEl.title = conversation.name;
    } else {
        activeConversationNameEl.textContent = '';
        activeConversationNameEl.title = '';
    }
}

function getConversationPinnedTimestamp(conversation) {
    if (!conversation || !conversation.pinned) {
        return 0;
    }
    const value = Date.parse(conversation.pinnedAt || conversation.updatedAt || conversation.createdAt || '') || 0;
    return Number.isFinite(value) ? value : 0;
}

function getConversationOrderRank(conversation) {
    if (!conversation) {
        return 0;
    }
    const raw = typeof conversation.orderRank === 'number' ? conversation.orderRank : Number(conversation.orderRank);
    if (Number.isFinite(raw)) {
        return raw;
    }
    const fallback = Date.parse(conversation.updatedAt || conversation.createdAt || '') || 0;
    return Number.isFinite(fallback) ? fallback : 0;
}

function getSortedConversations() {
    if (!Array.isArray(conversations)) {
        return [];
    }
    return [...conversations].sort((a, b) => {
        const pinnedA = Boolean(a && a.pinned);
        const pinnedB = Boolean(b && b.pinned);
        if (pinnedA && !pinnedB) {
            return -1;
        }
        if (!pinnedA && pinnedB) {
            return 1;
        }
        if (pinnedA && pinnedB) {
            const pinnedTimeA = getConversationPinnedTimestamp(a);
            const pinnedTimeB = getConversationPinnedTimestamp(b);
            if (pinnedTimeA !== pinnedTimeB) {
                return pinnedTimeB - pinnedTimeA;
            }
        }
        const rankA = getConversationOrderRank(a);
        const rankB = getConversationOrderRank(b);
        if (rankA !== rankB) {
            return rankB - rankA;
        }
        const updatedA = Date.parse(a && (a.updatedAt || a.createdAt) || '') || 0;
        const updatedB = Date.parse(b && (b.updatedAt || b.createdAt) || '') || 0;
        if (updatedA !== updatedB) {
            return updatedB - updatedA;
        }
        const nameA = removeInvalidSurrogates((a && a.name) || '');
        const nameB = removeInvalidSurrogates((b && b.name) || '');
        return nameA.localeCompare(nameB);
    });
}

function renderHistoryList() {
    if (!historyList) {
        return;
    }
    hideHistoryContextMenu();
    historyList.innerHTML = '';
    if (!conversations.length) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'history-empty';
        emptyDiv.textContent = t('index.history.empty');
        historyList.appendChild(emptyDiv);
        return;
    }
    const sorted = getSortedConversations();
    const filtered = historySearchQueryNormalized
        ? sorted.filter((conversation) => conversationMatchesSearch(conversation, historySearchQueryNormalized))
        : sorted;

    if (!filtered.length) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'history-empty';
        emptyDiv.textContent = t('index.history.searchEmpty');
        historyList.appendChild(emptyDiv);
        return;
    }

    let currentDateKey = '';
    filtered.forEach((conversation) => {
        const timestamp = typeof conversation.createdAt === 'string' && conversation.createdAt
            ? conversation.createdAt
            : conversation.updatedAt;
        const dateKey = getHistoryDateKey(timestamp);
        if (dateKey !== currentDateKey) {
            currentDateKey = dateKey;
            const divider = createHistoryDateDivider(formatHistoryDateHeading(timestamp));
            historyList.appendChild(divider);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-item';
        if (conversation.id === activeConversationId) {
            button.classList.add('active');
        }
        if (conversation.pinned) {
            button.classList.add('pinned');
            button.dataset.pinned = 'true';
        } else {
            button.dataset.pinned = 'false';
        }
        button.dataset.conversationId = conversation.id;
        const header = document.createElement('div');
        header.className = 'history-item-header';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'history-name';
        nameSpan.textContent = conversation.name;
        header.appendChild(nameSpan);
        if (conversation.pinned) {
            const pinSpan = document.createElement('span');
            pinSpan.className = 'history-pin';
            pinSpan.textContent = '📌';
            const tooltip = t('index.history.tooltipPinned');
            pinSpan.title = tooltip && tooltip !== 'index.history.tooltipPinned' ? tooltip : 'Pinned';
            pinSpan.setAttribute('aria-hidden', 'true');
            header.appendChild(pinSpan);
        }
        button.appendChild(header);
        const detailSpan = document.createElement('span');
        detailSpan.className = 'history-detail';
        detailSpan.textContent = formatRecordedAtText(conversation.createdAt) || '';
        button.appendChild(detailSpan);
        historyList.appendChild(button);
    });
}


function createResultSeparator() {
    const separator = document.createElement('div');
    separator.className = 'result-separator';
    return separator;
}

function createResultEntryElement(entry) {
    const container = document.createElement('div');
    container.className = 'log-entry result-entry';
    container.dataset.entryId = entry.id;
    if (entry.resultId) {
        container.dataset.resultId = entry.resultId;
    }
    const transcriptionDiv = document.createElement('div');
    if (entry.transcription && !entry.transcriptionPending) {
        transcriptionDiv.className = 'result-part transcription';
        transcriptionDiv.textContent = entry.transcription;
    } else {
        transcriptionDiv.className = 'result-part transcription pending';
        transcriptionDiv.textContent = t('index.result.transcribing');
    }
    container.appendChild(transcriptionDiv);
    if (entry.translation && !entry.translationPending) {
        container.appendChild(createResultSeparator());
        const translationDiv = document.createElement('div');
        translationDiv.className = 'result-part translation';
        translationDiv.textContent = entry.translation;
        container.appendChild(translationDiv);
    } else if (entry.translationPending) {
        if (entry.transcription && !entry.transcriptionPending) {
            container.appendChild(createResultSeparator());
        }
        const pendingDiv = document.createElement('div');
        pendingDiv.className = 'result-part translation pending';
        pendingDiv.textContent = t('index.translation.loading');
        container.appendChild(pendingDiv);
    }
    if (entry.optimized && !entry.optimizedPending && !entry.optimizedError) {
        container.appendChild(createResultSeparator());
        const optimizedDiv = document.createElement('div');
        optimizedDiv.className = 'result-part optimized';
        optimizedDiv.textContent = entry.optimized;
        container.appendChild(optimizedDiv);
    } else if (entry.optimizedPending) {
        container.appendChild(createResultSeparator());
        const pendingDiv = document.createElement('div');
        pendingDiv.className = 'result-part optimized pending';
        pendingDiv.textContent = t('index.optimized.pending');
        container.appendChild(pendingDiv);
    } else if (entry.optimizedError) {
        container.appendChild(createResultSeparator());
        const errorDiv = document.createElement('div');
        errorDiv.className = 'result-part optimized error';
        errorDiv.textContent = entry.optimizedError;
        container.appendChild(errorDiv);
    }
    applyRecordingMeta(container, entry.meta || {});
    return container;
}

function buildSummaryMeta(entry) {
    const parts = [];
    if (entry && entry.engine) {
        const engine = String(entry.engine).trim();
        if (engine) {
            if (engine.toLowerCase() === 'openai') {
                parts.push('OpenAI');
            } else if (engine.toLowerCase() === 'gemini') {
                parts.push('Gemini');
            } else {
                parts.push(engine);
            }
        }
    }
    if (entry && entry.model) {
        const model = String(entry.model).trim();
        if (model) {
            parts.push(model);
        }
    }
    return parts.join(' · ');
}

function applySummaryEntryState(node, entry) {
    if (!node || !entry) {
        return;
    }
    const status = entry.status === 'error' ? 'error' : (entry.status === 'ready' ? 'ready' : 'pending');
    node.classList.toggle('pending', status === 'pending');
    node.classList.toggle('error', status === 'error');

    const contentNode = node.querySelector('.summary-content');
    if (contentNode) {
        const hasContent = typeof entry.content === 'string' && entry.content.trim();
        if (status === 'error') {
            const fallback = entry.error || entry.content || '';
            contentNode.textContent = fallback || t('index.summary.failed');
        } else if (status === 'pending' && hasContent) {
            contentNode.textContent = entry.content.trim();
        } else if (status === 'pending') {
            contentNode.textContent = t('index.summary.generating');
        } else {
            contentNode.textContent = hasContent ? entry.content.trim() : t('index.summary.empty');
        }
    }

    const metaNode = node.querySelector('.summary-meta');
    if (metaNode) {
        const metaText = buildSummaryMeta(entry);
        metaNode.textContent = metaText;
        metaNode.style.display = metaText ? '' : 'none';
    }
}

function createSummaryEntryElement(entry) {
    const container = document.createElement('div');
    container.className = 'log-entry summary-entry';
    container.dataset.entryId = entry.id;

    const header = document.createElement('div');
    header.className = 'summary-header';

    const icon = document.createElement('span');
    icon.className = 'summary-icon';
    icon.textContent = String.fromCodePoint(0x1F4AB);
    header.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'summary-label';
    label.textContent = t('index.summary.title');
    header.appendChild(label);

    const meta = document.createElement('span');
    meta.className = 'summary-meta';
    const metaText = buildSummaryMeta(entry);
    meta.textContent = metaText;
    if (!metaText) {
        meta.style.display = 'none';
    }
    header.appendChild(meta);

    container.appendChild(header);

    const content = document.createElement('div');
    content.className = 'summary-content';
    container.appendChild(content);

    applySummaryEntryState(container, entry);
    return container;
}

function updateSummaryEntryDom(entry) {
    if (!entry || !logContainer) {
        return;
    }
    const node = logContainer.querySelector(`[data-entry-id="${entry.id}"]`);
    if (!node) {
        return;
    }
    applySummaryEntryState(node, entry);
}

function createLogEntryElement(entry) {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${entry.level || 'info'}`;
    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'timestamp';
    timestampSpan.textContent = entry.timestamp || '';
    logEntry.appendChild(timestampSpan);
    const levelSpan = document.createElement('span');
    levelSpan.className = 'level';
    levelSpan.textContent = `[${(entry.level || 'info').toUpperCase()}]`;
    logEntry.appendChild(levelSpan);
    const messageSpan = document.createElement('span');
    messageSpan.className = 'message';
    messageSpan.textContent = entry.message || '';
    logEntry.appendChild(messageSpan);
    return logEntry;
}

function renderConversationLogs() {
    if (!logContainer) {
        return;
    }
    hideResultContextMenu();
    logContainer.innerHTML = '';
    resultNodes = new Map();
    const conversation = getActiveConversation();
    if (!conversation) {
        updateActiveConversationLabel(null);
        return;
    }
    const fragment = document.createDocumentFragment();
    conversation.entries.forEach((entry) => {
        let node = null;
        if (entry.type === 'result') {
            node = createResultEntryElement(entry);
            const key = entry.resultId || entry.id;
            resultNodes.set(key, node);
        } else if (entry.type === 'summary') {
            node = createSummaryEntryElement(entry);
        } else if (entry.type === 'log') {
            node = createLogEntryElement(entry);
        }
        if (node) {
            fragment.appendChild(node);
        }
    });
    logContainer.appendChild(fragment);
    logContainer.scrollTop = logContainer.scrollHeight;
    updateActiveConversationLabel(conversation);
}

function appendEntryDom(entry) {
    if (!logContainer) {
        return;
    }
    let node = null;
    if (entry.type === 'result') {
        node = createResultEntryElement(entry);
        const key = entry.resultId || entry.id;
        resultNodes.set(key, node);
    } else if (entry.type === 'summary') {
        node = createSummaryEntryElement(entry);
    } else if (entry.type === 'log') {
        node = createLogEntryElement(entry);
    }
    if (!node) {
        return;
    }
    logContainer.appendChild(node);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function removeResultMappingsForConversation(conversationId) {
    resultConversationMap.forEach((value, key) => {
        if (value && value.conversationId === conversationId) {
            resultConversationMap.delete(key);
        }
    });
}

function getResultEntryContext(resultId) {
    if (!resultId) {
        return null;
    }
    const mapping = resultConversationMap.get(resultId);
    if (!mapping) {
        return null;
    }
    const conversation = getConversationById(mapping.conversationId);
    if (!conversation) {
        resultConversationMap.delete(resultId);
        return null;
    }
    const entry = conversation.entries.find((item) => item && item.id === mapping.entryId);
    if (!entry) {
        resultConversationMap.delete(resultId);
        return null;
    }
    return { conversation, entry, mapping };
}

function resolveEntryContextByIdentifiers({ conversationId = null, entryId = null, resultId = null }) {
    if (resultId) {
        const context = getResultEntryContext(resultId);
        if (context) {
            return context;
        }
    }
    let conversation = null;
    if (conversationId) {
        conversation = getConversationById(conversationId);
    }
    if (conversation && entryId) {
        const entry = conversation.entries.find((item) => item && item.id === entryId);
        if (entry) {
            return { conversation, entry };
        }
    }
    if (entryId) {
        for (let i = 0; i < conversations.length; i += 1) {
            const candidateConversation = conversations[i];
            if (!candidateConversation || !Array.isArray(candidateConversation.entries)) {
                continue;
            }
            const candidateEntry = candidateConversation.entries.find((item) => item && item.id === entryId);
            if (candidateEntry) {
                return { conversation: candidateConversation, entry: candidateEntry };
            }
        }
    }
    return conversation ? { conversation, entry: null } : null;
}

function getEntryContextForElement(element) {
    if (!element) {
        return null;
    }
    const entryId = element.dataset ? element.dataset.entryId : null;
    const resultId = element.dataset ? element.dataset.resultId : null;
    return resolveEntryContextByIdentifiers({
        conversationId: activeConversationId,
        entryId: entryId || null,
        resultId: resultId || null
    });
}

function updateResultEntryDom(entry) {
    if (!entry || !logContainer) {
        return;
    }
    const key = entry.resultId || entry.id;
    const node = resultNodes.get(key);
    if (!node) {
        return;
    }
    if (entry.transcription && !entry.transcriptionPending) {
        updateTranscriptionInBubble(node, entry.transcription);
    } else {
        let transcriptionNode = node.querySelector('.result-part.transcription');
        if (!transcriptionNode) {
            transcriptionNode = document.createElement('div');
            node.insertBefore(transcriptionNode, node.firstChild);
        }
        transcriptionNode.className = 'result-part transcription pending';
        transcriptionNode.textContent = t('index.result.transcribing');
    }
    if (entry.translation && !entry.translationPending) {
        updateTranslationInBubble(node, entry.translation);
    } else if (entry.translationPending) {
        let translationNode = node.querySelector('.result-part.translation');
        if (!translationNode) {
            if (!node.querySelector('.result-separator')) {
                const separator = document.createElement('div');
                separator.className = 'result-separator';
                node.appendChild(separator);
            }
            translationNode = document.createElement('div');
            translationNode.className = 'result-part translation pending';
            translationNode.textContent = t('index.translation.loading');
            node.appendChild(translationNode);
        } else {
            translationNode.className = 'result-part translation pending';
            translationNode.textContent = t('index.translation.loading');
        }
    } else {
        const translationNode = node.querySelector('.result-part.translation');
        if (translationNode) {
            const separator = translationNode.previousElementSibling;
            translationNode.remove();
            if (separator && separator.classList.contains('result-separator')) {
                separator.remove();
            }
        }
    }
    if (entry.optimized && !entry.optimizedPending && !entry.optimizedError) {
        updateOptimizedInBubble(node, entry.optimized, entry.optimizationMeta || {});
    } else if (entry.optimizedPending) {
        setOptimizedPendingInBubble(node);
    } else if (entry.optimizedError) {
        setOptimizedErrorInBubble(node, entry.optimizedError);
    } else {
        removeOptimizedFromBubble(node);
    }
    applyRecordingMeta(node, entry.meta || {});
    logContainer.scrollTop = logContainer.scrollHeight;
}

function createConversation(config = {}, options = {}) {
    const createdAt = config.createdAt || new Date().toISOString();
    const normalizedEntries = Array.isArray(config.entries) ? config.entries.map(normalizeEntry).filter(Boolean) : [];
    const hasEntries = normalizedEntries.length > 0;
    let name = (typeof config.name === 'string' && config.name) ? config.name : generateConversationName(new Date(createdAt));
    if (!hasEntries && options.forceEmptyName) {
        name = getEmptyConversationTitle();
    }
    const pinned = config.pinned === true;
    const pinnedAt = pinned
        ? (typeof config.pinnedAt === 'string' && config.pinnedAt ? config.pinnedAt : createdAt)
        : null;
    const rawOrderRank = typeof config.orderRank === 'number' ? config.orderRank : Number(config.orderRank);
    const orderRank = Number.isFinite(rawOrderRank) ? rawOrderRank : getNextConversationOrderRank();
    updateLastConversationOrderRank(orderRank);
    const conversation = {
        id: config.id || `conv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name,
        createdAt,
        updatedAt: typeof config.updatedAt === 'string' ? config.updatedAt : createdAt,
        titleGeneratedAt: typeof config.titleGeneratedAt === 'string' ? config.titleGeneratedAt : null,
        needsTitleRefresh: Boolean(config.needsTitleRefresh),
        pinned,
        pinnedAt,
        orderRank,
        entries: normalizedEntries
    };
    conversations.push(conversation);
    registerConversationEntries(conversation);
    if (!options.skipSave) {
        saveConversationsToStorage();
    }
    if (options.activate === false) {
        renderHistoryList();
    } else {
        setActiveConversation(conversation.id);
    }
    return conversation;
}

function handleNewConversationClick() {
    createConversation({}, { forceEmptyName: true });
}

function handleHistoryListClick(event) {
    hideHistoryContextMenu();
    const target = event.target.closest('.history-item');
    if (!target || !target.dataset || !target.dataset.conversationId) {
        return;
    }
    if (target.dataset.conversationId === activeConversationId) {
        return;
    }
    setActiveConversation(target.dataset.conversationId);
}

function deleteConversation(conversationId) {
    if (!conversationId) {
        return;
    }
    const index = conversations.findIndex((item) => item && item.id === conversationId);
    if (index === -1) {
        return;
    }
    const [removed] = conversations.splice(index, 1);
    if (removed) {
        removeResultMappingsForConversation(removed.id);
    }
    if (activeConversationId === conversationId) {
        activeConversationId = null;
        saveActiveConversationId(null);
        renderConversationLogs();
    }
    saveConversationsToStorage();
    if (!conversations.length) {
        createConversation({}, { forceEmptyName: true });
        return;
    }
    const nextActiveId = activeConversationId && getConversationById(activeConversationId)
        ? activeConversationId
        : getMostRecentConversationId();
    if (nextActiveId) {
        if (nextActiveId === activeConversationId && nextActiveId !== null) {
            renderHistoryList();
        } else {
            setActiveConversation(nextActiveId);
        }
    } else {
        renderHistoryList();
    }
}

function moveConversationToTop(conversationId) {
    const conversation = getConversationById(conversationId);
    if (!conversation) {
        return;
    }
    bumpConversationOrder(conversation);
    if (conversation.pinned) {
        conversation.pinnedAt = new Date().toISOString();
    }
    saveConversationsToStorage();
    renderHistoryList();
}

function toggleConversationPin(conversationId) {
    const conversation = getConversationById(conversationId);
    if (!conversation) {
        return;
    }
    const now = new Date().toISOString();
    if (conversation.pinned) {
        conversation.pinned = false;
        conversation.pinnedAt = null;
        bumpConversationOrder(conversation);
    } else {
        conversation.pinned = true;
        conversation.pinnedAt = now;
        bumpConversationOrder(conversation);
    }
    saveConversationsToStorage();
    renderHistoryList();
}

function initializeHistoryContextMenu() {
    if (historyContextMenu) {
        return;
    }
    const menu = document.createElement('div');
    menu.className = 'history-context-menu hidden';
    HISTORY_CONTEXT_MENU_ACTIONS.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-context-menu-item';
        button.dataset.action = item.action;
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            handleHistoryContextMenuAction(item.action);
        });
        menu.appendChild(button);
    });
    document.body.appendChild(menu);
    historyContextMenu = menu;
    document.addEventListener('click', (event) => {
        if (!historyContextMenu || historyContextMenu.classList.contains('hidden')) {
            return;
        }
        if (historyContextMenu.contains(event.target)) {
            return;
        }
        hideHistoryContextMenu();
    });
    document.addEventListener('contextmenu', (event) => {
        if (!historyContextMenu || historyContextMenu.classList.contains('hidden')) {
            return;
        }
        if (historyContextMenu.contains(event.target)) {
            event.preventDefault();
            return;
        }
        hideHistoryContextMenu();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideHistoryContextMenu();
        }
    });
    window.addEventListener('resize', hideHistoryContextMenu);
    window.addEventListener('blur', hideHistoryContextMenu);
    if (historyList) {
        historyList.addEventListener('scroll', hideHistoryContextMenu);
    }
}

function updateHistoryContextMenuLabels(conversation) {
    if (!historyContextMenu) {
        return;
    }
    HISTORY_CONTEXT_MENU_ACTIONS.forEach((item) => {
        const button = historyContextMenu.querySelector(`[data-action="${item.action}"]`);
        if (!button) {
            return;
        }
        if (item.action === 'toggle-pin') {
            const key = conversation && conversation.pinned
                ? 'index.history.context.unpin'
                : 'index.history.context.pin';
            button.textContent = t(key);
        } else {
            button.textContent = t(item.labelKey);
        }
    });
}

function showHistoryContextMenu(clientX, clientY, conversation) {
    if (!historyContextMenu || !conversation) {
        return;
    }
    updateHistoryContextMenuLabels(conversation);
    historyContextMenu.classList.remove('hidden');
    historyContextMenu.style.visibility = 'hidden';
    historyContextMenu.style.display = 'block';
    const { innerWidth, innerHeight } = window;
    const rect = historyContextMenu.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rect.width > innerWidth) {
        left = Math.max(0, innerWidth - rect.width - 8);
    }
    if (top + rect.height > innerHeight) {
        top = Math.max(0, innerHeight - rect.height - 8);
    }
    historyContextMenu.style.left = `${left}px`;
    historyContextMenu.style.top = `${top}px`;
    historyContextMenu.style.visibility = 'visible';
}

function hideHistoryContextMenu() {
    if (!historyContextMenu) {
        return;
    }
    historyContextMenu.classList.add('hidden');
    historyContextMenu.style.display = 'none';
    historyContextMenu.style.visibility = 'hidden';
    historyContextMenuTargetId = null;
}

function handleHistoryListContextMenu(event) {
    const target = event.target.closest('.history-item');
    if (!target || !target.dataset || !target.dataset.conversationId) {
        hideHistoryContextMenu();
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    initializeHistoryContextMenu();
    const conversation = getConversationById(target.dataset.conversationId);
    if (!conversation) {
        hideHistoryContextMenu();
        return;
    }
    historyContextMenuTargetId = conversation.id;
    showHistoryContextMenu(event.clientX, event.clientY, conversation);
}

function handleHistoryContextMenuAction(action) {
    const conversation = historyContextMenuTargetId ? getConversationById(historyContextMenuTargetId) : null;
    hideHistoryContextMenu();
    if (!conversation) {
        return;
    }
    switch (action) {
        case 'move-top':
            moveConversationToTop(conversation.id);
            break;
        case 'toggle-pin':
            toggleConversationPin(conversation.id);
            break;
        case 'delete':
            deleteConversation(conversation.id);
            break;
        default:
            break;
    }
}

function initializeConversationHistory() {
    conversations = loadConversationsFromStorage();
    rebuildResultConversationMap();
    let mutated = false;
    conversations.forEach((conversation) => {
        if (!conversation || !conversation.id) {
            return;
        }
        if (!conversation.entries || !conversation.entries.length) {
            const emptyTitle = getEmptyConversationTitle();
            if (conversation.name !== emptyTitle) {
                conversation.name = emptyTitle;
                mutated = true;
            }
            conversation.needsTitleRefresh = false;
            if (conversation.titleGeneratedAt !== null) {
                conversation.titleGeneratedAt = null;
                mutated = true;
            }
        } else {
            const desiredNeeds = Boolean(conversation.needsTitleRefresh && !conversation.titleGeneratedAt);
            if (conversation.needsTitleRefresh !== desiredNeeds) {
                conversation.needsTitleRefresh = desiredNeeds;
                mutated = true;
            }
            if (conversation.needsTitleRefresh) {
                scheduleConversationTitleUpdate(conversation.id, { delay: 500 });
            }
        }
    });
    if (mutated) {
        saveConversationsToStorage();
    }
    if (!conversations.length) {
        createConversation({}, { forceEmptyName: true });
        return;
    }

    const storedActiveId = loadActiveConversationId();
    const storedConversation = storedActiveId ? getConversationById(storedActiveId) : null;
    if (storedConversation) {
        setActiveConversation(storedConversation.id);
        return;
    }

    const fallbackId = getMostRecentConversationId();
    if (fallbackId) {
        setActiveConversation(fallbackId);
    } else {
        renderHistoryList();
        renderConversationLogs();
    }
}

function handleResultMessage(message) {
    const meta = extractRecordingMeta(message);
    const resultId = message && message.result_id ? message.result_id : null;
    const context = resultId ? getResultEntryContext(resultId) : null;
    let conversation = context ? context.conversation : getActiveConversation();
    if (!conversation) {
        conversation = createConversation({}, { forceEmptyName: true });
    }
    let entry = context ? context.entry : null;
    let isNewEntry = false;
    if (!entry) {
        const entryId = resultId || `result-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        entry = {
            id: entryId,
            type: 'result',
            resultId,
            transcription: '',
            translation: '',
            translationPending: false,
            transcriptionPending: false,
            optimized: '',
            optimizedPending: false,
            optimizedError: null,
            optimizationMeta: null,
            meta: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        conversation.entries.push(entry);
        isNewEntry = true;
        if (resultId) {
            resultConversationMap.set(resultId, { conversationId: conversation.id, entryId });
        }
    }
    if (message && typeof message.transcription === 'string' && message.transcription) {
        entry.transcription = message.transcription;
        entry.transcriptionPending = false;
        lastTranscription = message.transcription;
    } else if (message && message.transcription_pending) {
        entry.transcriptionPending = true;
    }
    if (message && typeof message.translation === 'string' && message.translation) {
        entry.translation = message.translation;
        entry.translationPending = false;
        lastTranslation = message.translation;
    } else if (message && message.translation_pending) {
        entry.translationPending = true;
    }
    entry.meta = Object.assign({}, entry.meta, meta);
    const entryTimestamp = markConversationUpdated(conversation);
    entry.updatedAt = entryTimestamp;
    const hasReadyContent = (typeof entry.transcription === 'string' && entry.transcription.trim() && entry.transcriptionPending !== true)
        || (typeof entry.translation === 'string' && entry.translation.trim() && entry.translationPending !== true);
    if (hasReadyContent) {
        markConversationTitleDirty(conversation);
    }
    saveConversationsToStorage();
    if (activeConversationId === conversation.id) {
        if (isNewEntry) {
            appendEntryDom(entry);
        }
        updateResultEntryDom(entry);
    }
    if (!isRecording) {
        if (conversationTitleRequests.has(conversation.id)) {
            conversationTitleRescheduleSet.add(conversation.id);
        } else {
            scheduleConversationTitleUpdate(conversation.id, { delay: 0 });
        }
    }
    if (historySearchQueryNormalized) {
        renderHistoryList();
    }
}

function handleTranscriptionUpdateMessage(message) {
    if (!message || !message.result_id) {
        console.warn('Transcription update received without result ID');
        return;
    }
    const context = getResultEntryContext(message.result_id);
    if (!context) {
        console.warn('Transcription update received but result entry not found:', message.result_id);
        return;
    }
    const { conversation, entry } = context;
    if (typeof message.transcription === 'string') {
        const sanitized = removeInvalidSurrogates(message.transcription);
        entry.transcription = sanitized;
        if (sanitized) {
            lastTranscription = sanitized;
        }
    } else if (typeof message.transcription_partial === 'string') {
        const partial = removeInvalidSurrogates(message.transcription_partial);
        if (partial) {
            entry.transcription = (entry.transcription || '') + partial;
        }
    }
    if (message.transcription_pending === true) {
        entry.transcriptionPending = true;
    } else if (message.transcription_pending === false || message.is_final === true) {
        entry.transcriptionPending = false;
    }
    entry.meta = Object.assign({}, entry.meta, extractRecordingMeta(message));
    const entryTimestamp = markConversationUpdated(conversation);
    entry.updatedAt = entryTimestamp;
    const hasReadyContent = (typeof entry.transcription === 'string' && entry.transcription.trim() && entry.transcriptionPending !== true)
        || (typeof entry.translation === 'string' && entry.translation.trim() && entry.translationPending !== true);
    if (hasReadyContent) {
        markConversationTitleDirty(conversation);
    }
    saveConversationsToStorage();
    if (activeConversationId === conversation.id) {
        updateResultEntryDom(entry);
    }
    if (!isRecording) {
        if (conversationTitleRequests.has(conversation.id)) {
            conversationTitleRescheduleSet.add(conversation.id);
        } else {
            scheduleConversationTitleUpdate(conversation.id, { delay: 0 });
        }
    }
    if (historySearchQueryNormalized) {
        renderHistoryList();
    }
}

function handleTranslationUpdateMessage(message) {
    if (!message || !message.result_id) {
        console.warn('Translation update received without result ID');
        return;
    }
    const context = getResultEntryContext(message.result_id);
    if (!context) {
        console.warn('Translation update received but result entry not found:', message.result_id);
        return;
    }
    const { conversation, entry } = context;
    if (typeof message.error === 'string' && message.error) {
        if (typeof message.translation === 'string') {
            entry.translation = removeInvalidSurrogates(message.translation);
        }
        entry.translationPending = false;
        const errorText = removeInvalidSurrogates(message.error);
        saveConversationsToStorage();
        if (activeConversationId === conversation.id) {
            updateResultEntryDom(entry);
        }
        if (pendingTranslationCopyRequests.has(entry.id)) {
            pendingTranslationCopyRequests.delete(entry.id);
        }
        addLogEntry('error', `${t('index.log.translationFailed')}: ${errorText}`);
        return;
    }
    if (typeof message.translation === 'string') {
        const sanitizedTranslation = removeInvalidSurrogates(message.translation);
        entry.translation = sanitizedTranslation;
        if (sanitizedTranslation) {
            lastTranslation = sanitizedTranslation;
        }
    } else if (typeof message.translation_partial === 'string') {
        const partialTranslation = removeInvalidSurrogates(message.translation_partial);
        if (partialTranslation) {
            entry.translation = (entry.translation || '') + partialTranslation;
        }
    }
    if (message.translation_pending === true) {
        entry.translationPending = true;
    } else if (message.translation_pending === false || message.is_final === true) {
        entry.translationPending = false;
    }
    const translationReady = typeof entry.translation === 'string' && entry.translation && entry.translationPending !== true;
    if (translationReady && pendingTranslationCopyRequests.has(entry.id)) {
        copyTextToClipboard(entry.translation).catch((error) => {
            console.warn('Failed to copy translation:', error);
            addLogEntry('error', `${t('index.log.copyFailed')}: ${error && error.message ? error.message : error}`);
        }).finally(() => {
            pendingTranslationCopyRequests.delete(entry.id);
        });
    }
    const entryTimestamp = markConversationUpdated(conversation);
    entry.updatedAt = entryTimestamp;
    const hasReadyContent = (typeof entry.transcription === 'string' && entry.transcription.trim() && entry.transcriptionPending !== true)
        || (typeof entry.translation === 'string' && entry.translation.trim() && entry.translationPending !== true);
    if (hasReadyContent) {
        markConversationTitleDirty(conversation);
    }
    saveConversationsToStorage();
    if (activeConversationId === conversation.id) {
        updateResultEntryDom(entry);
    }
    if (!isRecording) {
        if (conversationTitleRequests.has(conversation.id)) {
            conversationTitleRescheduleSet.add(conversation.id);
        } else {
            scheduleConversationTitleUpdate(conversation.id, { delay: 0 });
        }
    }
    if (historySearchQueryNormalized) {
        renderHistoryList();
    }
}

function handleSummaryUpdateMessage(message) {
    if (!message || typeof message.request_id !== 'string') {
        console.warn('Summary update received without request ID');
        return;
    }
    const conversationId = typeof message.conversation_id === 'string' ? message.conversation_id : null;
    const context = resolveEntryContextByIdentifiers({
        conversationId,
        entryId: message.request_id,
        resultId: null,
    });
    if (!context || !context.conversation || !context.entry) {
        console.warn('Summary update received but entry not found:', message.request_id);
        return;
    }
    const { conversation, entry } = context;
    if (!entry || entry.type !== 'summary') {
        return;
    }
    if (typeof message.content === 'string') {
        entry.content = removeInvalidSurrogates(message.content);
    } else if (typeof message.content_partial === 'string') {
        const partial = removeInvalidSurrogates(message.content_partial);
        if (partial) {
            entry.content = (entry.content || '') + partial;
        }
    }
    if (typeof message.engine === 'string' && message.engine) {
        entry.engine = message.engine;
    }
    if (typeof message.model === 'string' && message.model) {
        entry.model = message.model;
    }
    if (message.summary_pending === true) {
        entry.status = 'pending';
    } else if (message.summary_pending === false || message.is_final === true) {
        if (!entry.error) {
            entry.status = 'ready';
        }
    }
    const entryTimestamp = markConversationUpdated(conversation);
    entry.updatedAt = entryTimestamp;
    saveConversationsToStorage();
    if (activeConversationId === conversation.id) {
        updateSummaryEntryDom(entry);
    }
}

function handleOptimizationResultMessage(message) {
    if (!message) {
        return;
    }
    const context = resolveEntryContextByIdentifiers({
        conversationId: typeof message.conversation_id === 'string' ? message.conversation_id : null,
        entryId: typeof message.entry_id === 'string' ? message.entry_id : null,
        resultId: typeof message.result_id === 'string' ? message.result_id : null
    });
    if (!context || !context.conversation || !context.entry) {
        console.warn('Optimization result received but entry not found:', message);
        return;
    }
    const { conversation, entry } = context;
    const success = message.success !== false && typeof message.optimized_text === 'string' && message.optimized_text.trim();
    if (success) {
        entry.optimized = removeInvalidSurrogates(message.optimized_text.trim());
        entry.optimizedPending = false;
        entry.optimizedError = null;
        entry.optimizationMeta = {
            engine: typeof message.engine === 'string' ? message.engine : null,
            model: typeof message.model === 'string' ? message.model : null,
            requestId: typeof message.request_id === 'string' ? message.request_id : null
        };
    } else {
        entry.optimized = '';
        entry.optimizedPending = false;
        const errorText = typeof message.error === 'string' && message.error.trim()
            ? removeInvalidSurrogates(message.error.trim())
            : t('index.optimized.failed');
        entry.optimizedError = errorText;
        entry.optimizationMeta = {
            engine: typeof message.engine === 'string' ? message.engine : null,
            model: typeof message.model === 'string' ? message.model : null,
            requestId: typeof message.request_id === 'string' ? message.request_id : null
        };
        addLogEntry('warning', `${t('index.optimized.logFailed')}: ${errorText}`);
    }
    const entryTimestamp = markConversationUpdated(conversation);
    entry.updatedAt = entryTimestamp;
    saveConversationsToStorage();
    if (activeConversationId === conversation.id) {
        updateResultEntryDom(entry);
    }
}

function applyLanguageFromConfig(cfg) {
    const lang = (cfg && cfg.app_language) || DEFAULT_LANGUAGE;
    changeLanguage(lang);
    if (window.appI18n && typeof window.appI18n.apply === 'function') {
        window.appI18n.apply();
    }
    document.title = t('index.title');
    updateHistoryToggleUI();
    if (volumeSilenceEl && silenceMarkerDb === null) {
        volumeSilenceEl.textContent = formatSilenceLabel(SILENCE_PLACEHOLDER_DB);
    }
    renderVolumeValues();
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
    updateHistoryToggleUI();
    if (volumeSilenceEl && silenceMarkerDb === null) {
        volumeSilenceEl.textContent = formatSilenceLabel(SILENCE_PLACEHOLDER_DB);
    }
    renderVolumeValues();
    if (typeof window.appI18n.onChange === 'function') {
        window.appI18n.onChange(() => {
            document.title = t('index.title');
            updateServiceStatus(pythonServiceStatus);
            updateUI();
            updateHistoryToggleUI();
            renderHistoryList();
            if (silenceMarkerDb !== null) {
                updateSilenceMarker(silenceMarkerDb);
            } else if (volumeSilenceEl) {
                volumeSilenceEl.textContent = formatSilenceLabel(SILENCE_PLACEHOLDER_DB);
            }
            if (volumePanel && volumeToggleBtn) {
                const expanded = !volumePanel.classList.contains('collapsed');
                updateVolumeToggleState(expanded);
            }
            renderVolumeValues();
        });
    }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initializeWindowControls();
    initializeLanguage();
    initializeConversationHistory();
    initializeHistoryCollapsedState();
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

window.addEventListener('beforeunload', () => {
    if (disposeWindowStateListener) {
        disposeWindowStateListener();
        disposeWindowStateListener = null;
    }
});

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

    if (newConversationButton) {
        newConversationButton.addEventListener('click', handleNewConversationClick);
    }

    if (historyList) {
        historyList.addEventListener('click', handleHistoryListClick);
        historyList.addEventListener('contextmenu', handleHistoryListContextMenu);
    }

    initializeResultContextMenu();
    if (logContainer) {
        logContainer.addEventListener('contextmenu', handleResultEntryContextMenu);
    }

    if (historySearchInput) {
        historySearchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                applyHistorySearch(event.target.value);
            } else if (event.key === 'Escape') {
                if (historySearchInput.value || historySearchQuery) {
                    event.preventDefault();
                    historySearchInput.value = '';
                    applyHistorySearch('');
                }
            }
        });
    }

    if (toggleHistoryButton) {
        toggleHistoryButton.addEventListener('click', toggleHistoryPanel);
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
        setRecordButtonVisual(RECORD_ICON_MIC, 'index.buttons.recordPreparing');
        recordButton.title = t('index.recordButton.starting');
        recordButton.setAttribute('aria-label', recordButton.title);
        recordButton.className = 'record-control record-btn start disabled';
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
        setRecordButtonVisual(RECORD_ICON_STOP, 'index.buttons.recordActive');
        recordButton.title = t('index.tooltips.recordStop');
        recordButton.setAttribute('aria-label', recordButton.title);
        if (isVoiceActive) {
            recordButton.className = 'record-control record-btn stop recording-active';
        } else {
            recordButton.className = 'record-control record-btn stop recording-idle';
        }
        if (typeof statusDot !== 'undefined' && statusDot) {
            statusDot.className = 'status-dot recording';
        }
        if (typeof statusText !== 'undefined' && statusText) {
            statusText.textContent = t('index.statusText.recording');
        }
    } else {
        setRecordButtonVisual(RECORD_ICON_MIC, 'index.buttons.recordIdle');
        recordButton.title = t('index.tooltips.recordStart');
        recordButton.setAttribute('aria-label', recordButton.title);
        recordButton.className = 'record-control record-btn start';
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
        lastVolumeDbDisplay = { type: 'negInf', value: null };
        lastVolumeRms = 0;
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

    renderVolumeValues();
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

    if (!hasDb || rawDb <= VOLUME_MIN_DB) {
        lastVolumeDbDisplay = { type: 'lessEqual', value: VOLUME_MIN_DB };
    } else {
        lastVolumeDbDisplay = { type: 'value', value: clampedDb };
    }

    const hasRms = typeof payload.rms === 'number' && isFinite(payload.rms);
    const rmsValue = hasRms ? payload.rms : 0;
    lastVolumeRms = rmsValue;
    renderVolumeValues();

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
            handleResultMessage(message);
            break;
        case 'transcription_update':
            handleTranscriptionUpdateMessage(message);
            break;
        case 'translation_update':
            handleTranslationUpdateMessage(message);
            break;
        case 'summary_update':
            handleSummaryUpdateMessage(message);
            break;
        case 'optimization_result':
            handleOptimizationResultMessage(message);
            break;
        case 'conversation_summary':
            handleConversationSummaryMessage(message);
            break;
        case 'summary_result':
            // Handled via invoke response in summarizeConversation
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
            conversations.forEach((conversation) => {
                if (conversation && conversation.needsTitleRefresh) {
                    scheduleConversationTitleUpdate(conversation.id, { delay: 0 });
                }
            });
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
        const metaDiv = bubble.querySelector('.recording-meta');
        const insertBeforeNode = metaDiv || null;

        const sep = document.createElement('div');
        sep.className = 'result-separator';
        bubble.insertBefore(sep, insertBeforeNode);
        translationDiv = document.createElement('div');
        translationDiv.className = 'result-part translation';
        translationDiv.textContent = translation;
        bubble.insertBefore(translationDiv, insertBeforeNode);
    }
    logContainer.scrollTop = logContainer.scrollHeight;
}

function ensureOptimizedBlock(bubble) {
    if (!bubble) {
        return null;
    }
    let optimizedDiv = bubble.querySelector('.result-part.optimized');
    const metaDiv = bubble.querySelector('.recording-meta');
    const insertBeforeNode = metaDiv || null;
    if (!optimizedDiv) {
        bubble.insertBefore(createResultSeparator(), insertBeforeNode);
        optimizedDiv = document.createElement('div');
        optimizedDiv.className = 'result-part optimized';
        bubble.insertBefore(optimizedDiv, insertBeforeNode);
    } else if (!optimizedDiv.previousElementSibling || !optimizedDiv.previousElementSibling.classList.contains('result-separator')) {
        bubble.insertBefore(createResultSeparator(), optimizedDiv);
    }
    return optimizedDiv;
}

function updateOptimizedInBubble(bubble, optimizedText, meta = {}) {
    const optimizedDiv = ensureOptimizedBlock(bubble);
    if (!optimizedDiv) {
        return;
    }
    optimizedDiv.className = 'result-part optimized';
    optimizedDiv.textContent = optimizedText;
    optimizedDiv.dataset.label = t('index.optimized.label');
    const engine = meta && typeof meta.engine === 'string' ? meta.engine : '';
    const model = meta && typeof meta.model === 'string' ? meta.model : '';
    if (engine) {
        optimizedDiv.dataset.engine = engine;
    } else {
        delete optimizedDiv.dataset.engine;
    }
    if (model) {
        optimizedDiv.dataset.model = model;
    } else {
        delete optimizedDiv.dataset.model;
    }
    const tooltip = engine && model ? `${engine}/${model}` : engine || model || '';
    optimizedDiv.title = tooltip;
    logContainer.scrollTop = logContainer.scrollHeight;
}

function setOptimizedPendingInBubble(bubble) {
    const optimizedDiv = ensureOptimizedBlock(bubble);
    if (!optimizedDiv) {
        return;
    }
    optimizedDiv.className = 'result-part optimized pending';
    optimizedDiv.textContent = t('index.optimized.pending');
    optimizedDiv.dataset.label = t('index.optimized.label');
    optimizedDiv.title = '';
    delete optimizedDiv.dataset.engine;
    delete optimizedDiv.dataset.model;
    logContainer.scrollTop = logContainer.scrollHeight;
}

function setOptimizedErrorInBubble(bubble, errorText) {
    const optimizedDiv = ensureOptimizedBlock(bubble);
    if (!optimizedDiv) {
        return;
    }
    optimizedDiv.className = 'result-part optimized error';
    optimizedDiv.textContent = errorText || t('index.optimized.failed');
    optimizedDiv.dataset.label = t('index.optimized.label');
    optimizedDiv.title = '';
    delete optimizedDiv.dataset.engine;
    delete optimizedDiv.dataset.model;
    logContainer.scrollTop = logContainer.scrollHeight;
}

function removeOptimizedFromBubble(bubble) {
    if (!bubble) {
        return;
    }
    const optimizedDiv = bubble.querySelector('.result-part.optimized');
    if (!optimizedDiv) {
        return;
    }
    const separator = optimizedDiv.previousElementSibling;
    optimizedDiv.remove();
    if (separator && separator.classList.contains('result-separator')) {
        separator.remove();
    }
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

function renderResultEntry(transcription, translation = null, translationPending = false, transcriptionPending = false, meta = {}) {
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

    applyRecordingMeta(entry, meta);

    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
    return entry;
}


function addLogEntry(level, message) {
    const timestamp = new Date().toLocaleTimeString();
    const normalizedMessage = typeof message === 'string' ? message : String(message);
    if (shouldSuppressLogMessage(normalizedMessage)) {
        return;
    }
    const entry = {
        id: `log-$${Date.now()}-$${Math.random().toString(16).slice(2, 8)}`,
        type: 'log',
        level: typeof level === 'string' ? level : 'info',
        message: normalizedMessage,
        timestamp,
        createdAt: new Date().toISOString()
    };
    const conversation = getActiveConversation();
    if (!conversation) {
        return;
    }
    conversation.entries.push(entry);
    saveConversationsToStorage();
    if (activeConversationId === conversation.id && logContainer) {
        const node = createLogEntryElement(entry);
        if (node) {
            logContainer.appendChild(node);
            logContainer.scrollTop = logContainer.scrollHeight;
        }
    }
}



function setSummaryButtonLoading(isLoading) {
    if (!summaryButton) {
        return;
    }
    if (isLoading) {
        summaryButton.classList.add('loading');
        summaryButton.disabled = true;
    } else {
        summaryButton.classList.remove('loading');
        summaryButton.disabled = false;
    }
}

function applySummaryResult(conversation, entry, response) {
    if (!conversation || !entry) {
        return;
    }
    const normalizedResponse = response && typeof response === 'object' ? response : null;
    const success = normalizedResponse && normalizedResponse.success !== false && typeof normalizedResponse.content === 'string' && normalizedResponse.content.trim();
    entry.engine = normalizedResponse && normalizedResponse.engine ? normalizedResponse.engine : entry.engine;
    entry.model = normalizedResponse && normalizedResponse.model ? normalizedResponse.model : entry.model;
    entry.requestId = normalizedResponse && normalizedResponse.request_id ? normalizedResponse.request_id : entry.requestId;

    if (success) {
        entry.status = 'ready';
        entry.content = removeInvalidSurrogates(normalizedResponse.content.trim());
        entry.error = null;
    } else {
        entry.status = 'error';
        const errorMessage = normalizedResponse && normalizedResponse.error
            ? normalizedResponse.error
            : normalizedResponse && normalizedResponse.reason === 'credentials_missing'
                ? t('index.summary.missingCredentials')
                : normalizedResponse && normalizedResponse.reason === 'empty'
                    ? t('index.summary.empty')
                    : t('index.summary.failed');
        entry.content = errorMessage;
        entry.error = errorMessage;
    }
    const entryTimestamp = markConversationUpdated(conversation);
    entry.updatedAt = entryTimestamp;
    updateSummaryEntryDom(entry);
}

function handleSummaryError(conversation, entry, error) {
    if (!conversation || !entry) {
        return;
    }
    const message = error && error.message ? error.message : String(error || '');
    entry.status = 'error';
    entry.error = message;
    entry.content = t('index.summary.failed');
    const entryTimestamp = markConversationUpdated(conversation);
    entry.updatedAt = entryTimestamp;
    updateSummaryEntryDom(entry);
    addLogEntry('error', `${t('index.summary.errorLogPrefix')}: ${message}`);
}

async function summarizeConversation() {
    if (summaryInProgress) {
        return;
    }
    const conversation = getActiveConversation();
    if (!conversation) {
        addLogEntry('warning', t('index.summary.noConversation'));
        return;
    }
    const segments = collectSegmentsForConversationSummary(conversation);
    if (!segments.length) {
        addLogEntry('warning', t('index.summary.noContent'));
        return;
    }
    if (!window.electronAPI || typeof window.electronAPI.generateSummary !== 'function') {
        addLogEntry('error', t('index.summary.apiUnavailable'));
        return;
    }

    const requestId = `summary-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const now = new Date().toISOString();
    const summaryEntry = {
        id: requestId,
        type: 'summary',
        status: 'pending',
        content: '',
        engine: null,
        model: null,
        error: null,
        requestId,
        createdAt: now,
        updatedAt: now
    };

    conversation.entries.push(summaryEntry);
    const entryTimestamp = markConversationUpdated(conversation, now);
    summaryEntry.createdAt = entryTimestamp;
    summaryEntry.updatedAt = entryTimestamp;
    saveConversationsToStorage();
    if (activeConversationId === conversation.id) {
        appendEntryDom(summaryEntry);
    }

    summaryInProgress = true;
    setSummaryButtonLoading(true);

    try {
        const targetLanguage = getSummaryTargetLanguage();
        const response = await window.electronAPI.generateSummary({
            conversationId: conversation.id,
            requestId,
            segments,
            targetLanguage
        });
        applySummaryResult(conversation, summaryEntry, response);
    } catch (error) {
        handleSummaryError(conversation, summaryEntry, error);
    } finally {
        summaryInProgress = false;
        setSummaryButtonLoading(false);
        saveConversationsToStorage();
    }
}

function collectExportEntries() {
    const conversation = getActiveConversation();
    if (!conversation) {
        return [];
    }
    const entries = [];

    conversation.entries.forEach((entry) => {
        if (!entry || entry.type !== 'result') {
            return;
        }
        if (!entry.transcription || entry.transcriptionPending) {
            return;
        }
        const includeTranslation = Boolean(translationEnabled && entry.translation && !entry.translationPending);
        const meta = entry.meta || {};
        const recordedText = typeof meta.recordedAt === 'string' ? formatRecordedAtText(meta.recordedAt) : '';
        const durationText = (typeof meta.durationSeconds === 'number' && Number.isFinite(meta.durationSeconds))
            ? formatDurationText(meta.durationSeconds)
            : '';
        let timeText = recordedText;
        if (timeText && durationText) {
            timeText = `$${timeText} $${durationText}`;
        } else if (!timeText && durationText) {
            timeText = durationText;
        }
        entries.push({
            transcription: entry.transcription,
            translation: includeTranslation ? entry.translation : '',
            includeTranslation,
            timeText: timeText || ''
        });
    });

    return entries;
}


async function exportLogs() {
    try {
        const entries = collectExportEntries();
        if (!entries.length) {
            addLogEntry('warning', t('index.log.exportNoResults'));
            return;
        }
        if (!window.electronAPI || typeof window.electronAPI.exportLogs !== 'function') {
            addLogEntry('error', t('index.log.exportUnsupported'));
            return;
        }

        const result = await window.electronAPI.exportLogs({ entries });
        if (result && result.success) {
            addLogEntry('info', t('index.log.exportSuccess'));
        } else if (result && result.canceled) {
            return;
        } else {
            const baseMessage = t('index.log.exportFailed');
            if (result && result.error) {
                addLogEntry('error', baseMessage + ': ' + result.error);
            } else {
                addLogEntry('error', baseMessage);
            }
        }
    } catch (error) {
        const baseMessage = t('index.log.exportFailed');
        addLogEntry('error', baseMessage + ': ' + (error.message || error));
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


async function copyTextToClipboard(text, { silent = false } = {}) {
    const normalized = typeof text === 'string' ? text : '';
    if (!normalized) {
        if (!silent) {
            addLogEntry('warning', t('index.log.copyEmpty'));
        }
        return false;
    }
    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(normalized);
        } else if (window.electronAPI && typeof window.electronAPI.writeClipboard === 'function') {
            const result = await window.electronAPI.writeClipboard(normalized);
            if (!result || result.success === false) {
                const message = result && result.error ? result.error : 'Clipboard write failed';
                throw new Error(message);
            }
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = normalized;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            textarea.style.pointerEvents = 'none';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const successful = document.execCommand('copy');
            textarea.remove();
            if (!successful) {
                throw new Error('Copy command rejected');
            }
        }
        return true;
    } catch (error) {
        if (!silent) {
            addLogEntry('error', `${t('index.log.copyFailed')}: ${error && error.message ? error.message : error}`);
        }
        throw error;
    }
}

function getManualTranslationTargetLanguage() {
    if (currentConfig && typeof currentConfig.translate_language === 'string' && currentConfig.translate_language.trim()) {
        return currentConfig.translate_language.trim();
    }
    if (currentConfig && currentConfig.translation_mode === 'smart') {
        const candidate = typeof currentConfig.smart_language2 === 'string' && currentConfig.smart_language2.trim()
            ? currentConfig.smart_language2.trim()
            : null;
        if (candidate) {
            return candidate;
        }
    }
    return 'Chinese';
}

async function requestTranslationForEntry(entry, conversation, { autoCopy = false } = {}) {
    if (!entry || !conversation) {
        return;
    }
    if (!entry.transcription || entry.transcriptionPending) {
        addLogEntry('warning', t('index.log.translationNoText'));
        return;
    }
    if (entry.translationPending) {
        if (autoCopy) {
            pendingTranslationCopyRequests.set(entry.id, true);
        }
        addLogEntry('info', t('index.log.translationInProgress'));
        return;
    }
    if (autoCopy) {
        pendingTranslationCopyRequests.set(entry.id, true);
    }
    entry.translationPending = true;
    entry.optimizedError = entry.optimizedError; // keep existing value
    const entryTimestamp = markConversationUpdated(conversation);
    entry.updatedAt = entryTimestamp;
    saveConversationsToStorage();
    if (activeConversationId === conversation.id) {
        updateResultEntryDom(entry);
    }
    try {
        const payload = await window.electronAPI.requestTranslation({
            transcription: entry.transcription,
            resultId: entry.resultId || entry.id,
            conversationId: conversation.id,
            entryId: entry.id,
            targetLanguage: getManualTranslationTargetLanguage(),
            context: 'manual'
        });
        if (!payload || payload.success === false) {
            if (autoCopy) {
                pendingTranslationCopyRequests.delete(entry.id);
            }
            entry.translationPending = false;
            saveConversationsToStorage();
            if (activeConversationId === conversation.id) {
                updateResultEntryDom(entry);
            }
            const reason = payload && payload.error ? payload.error : t('index.log.translationFailed');
            addLogEntry('error', `${t('index.log.translationFailed')}: ${reason}`);
        }
    } catch (error) {
        if (autoCopy) {
            pendingTranslationCopyRequests.delete(entry.id);
        }
        entry.translationPending = false;
        saveConversationsToStorage();
        if (activeConversationId === conversation.id) {
            updateResultEntryDom(entry);
        }
        addLogEntry('error', `${t('index.log.translationFailed')}: ${error && error.message ? error.message : error}`);
    }
}

async function requestOptimizationForEntry(entry, conversation) {
    if (!entry || !conversation) {
        return;
    }
    if (!entry.transcription || entry.transcriptionPending) {
        addLogEntry('warning', t('index.optimized.noText'));
        return;
    }
    entry.optimizedPending = true;
    entry.optimized = '';
    entry.optimizedError = null;
    entry.optimizationMeta = null;
    const entryTimestamp = markConversationUpdated(conversation);
    entry.updatedAt = entryTimestamp;
    saveConversationsToStorage();
    if (activeConversationId === conversation.id) {
        updateResultEntryDom(entry);
    }
    try {
        const response = await window.electronAPI.optimizeText({
            text: entry.transcription,
            conversationId: conversation.id,
            entryId: entry.id,
            resultId: entry.resultId || null,
            context: 'manual'
        });
        if (response && response.success === false) {
            entry.optimizedPending = false;
            let messageText = null;
            if (response.error && typeof response.error === 'string') {
                messageText = removeInvalidSurrogates(response.error);
            } else if (response.reason === 'timeout') {
                messageText = t('index.optimized.timeout');
            }
            entry.optimizedError = messageText || t('index.optimized.failed');
            saveConversationsToStorage();
            if (activeConversationId === conversation.id) {
                updateResultEntryDom(entry);
            }
            addLogEntry('error', `${t('index.optimized.logFailed')}: ${entry.optimizedError}`);
        }
    } catch (error) {
        entry.optimizedPending = false;
        entry.optimizedError = error && error.message ? error.message : t('index.optimized.failed');
        saveConversationsToStorage();
        if (activeConversationId === conversation.id) {
            updateResultEntryDom(entry);
        }
        addLogEntry('error', `${t('index.optimized.logFailed')}: ${entry.optimizedError}`);
    }
}

function deleteResultEntry(entry, conversation) {
    if (!entry || !conversation) {
        return;
    }
    const index = conversation.entries.findIndex((item) => item && item.id === entry.id);
    if (index === -1) {
        return;
    }
    conversation.entries.splice(index, 1);
    const key = entry.resultId || entry.id;
    if (key) {
        resultConversationMap.delete(key);
        resultNodes.delete(key);
    }
    pendingTranslationCopyRequests.delete(entry.id);
    if (logContainer) {
        const node = logContainer.querySelector(`[data-entry-id="${entry.id}"]`);
        if (node) {
            node.remove();
        }
    }
    if (conversation.entries.length === 0) {
        conversation.name = getEmptyConversationTitle();
        conversation.titleGeneratedAt = null;
        conversation.needsTitleRefresh = false;
    } else {
        markConversationTitleDirty(conversation);
    }
    markConversationUpdated(conversation);
    saveConversationsToStorage();
    renderHistoryList();
    addLogEntry('info', t('index.log.entryDeleted'));
}

async function copyLastResult() {
    const conversation = getActiveConversation();
    if (!conversation || !Array.isArray(conversation.entries) || !conversation.entries.length) {
        addLogEntry('warning', t('index.log.copyEmpty'));
        return;
    }
    for (let i = conversation.entries.length - 1; i >= 0; i -= 1) {
        const entry = conversation.entries[i];
        if (!entry || entry.type !== 'result') {
            continue;
        }
        if (!entry.transcription || entry.transcriptionPending) {
            continue;
        }
        const parts = [entry.transcription];
        if (entry.translation && !entry.translationPending) {
            parts.push(entry.translation);
        }
        await copyTextToClipboard(parts.join('\n'));
        return;
    }
    addLogEntry('warning', t('index.log.copyEmpty'));
}


function initializeResultContextMenu() {
    if (activeContextMenu) {
        return;
    }
    const menu = document.createElement('div');
    menu.className = 'result-context-menu hidden';
    CONTEXT_MENU_ACTIONS.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'result-context-menu-item';
        button.dataset.action = item.action;
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            handleContextMenuAction(item.action);
        });
        menu.appendChild(button);
    });
    document.body.appendChild(menu);
    activeContextMenu = menu;
    document.addEventListener('click', (event) => {
        if (!activeContextMenu || activeContextMenu.classList.contains('hidden')) {
            return;
        }
        if (activeContextMenu.contains(event.target)) {
            return;
        }
        hideResultContextMenu();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideResultContextMenu();
        }
    });
    window.addEventListener('resize', hideResultContextMenu);
    window.addEventListener('blur', hideResultContextMenu);
    if (logContainer) {
        logContainer.addEventListener('scroll', hideResultContextMenu);
    }
}

function updateContextMenuLabels() {
    if (!activeContextMenu) {
        return;
    }
    CONTEXT_MENU_ACTIONS.forEach((item) => {
        const button = activeContextMenu.querySelector(`[data-action="${item.action}"]`);
        if (button) {
            button.textContent = t(item.labelKey);
        }
    });
}

function setContextMenuItemState(action, disabled) {
    if (!activeContextMenu) {
        return;
    }
    const button = activeContextMenu.querySelector(`[data-action="${action}"]`);
    if (!button) {
        return;
    }
    if (disabled) {
        button.classList.add('disabled');
        button.setAttribute('aria-disabled', 'true');
    } else {
        button.classList.remove('disabled');
        button.removeAttribute('aria-disabled');
    }
}

function handleResultEntryContextMenu(event) {
    const entryEl = event.target.closest('.result-entry');
    if (!entryEl) {
        hideResultContextMenu();
        return;
    }
    const context = getEntryContextForElement(entryEl);
    if (!context || !context.entry || !context.conversation) {
        hideResultContextMenu();
        return;
    }
    event.preventDefault();
    initializeResultContextMenu();
    contextMenuTargetEntry = context;
    contextMenuTargetElement = entryEl;
    showResultContextMenu(event.clientX, event.clientY, context.entry);
}

function showResultContextMenu(clientX, clientY, entry) {
    if (!activeContextMenu || !entry) {
        return;
    }
    updateContextMenuLabels();
    const hasTranscription = typeof entry.transcription === 'string' && entry.transcription.trim() && entry.transcriptionPending !== true;
    const canTranslate = hasTranscription;
    const canOptimize = hasTranscription;
    setContextMenuItemState('copy', !hasTranscription);
    setContextMenuItemState('copy-translation', !canTranslate);
    setContextMenuItemState('translate', !canTranslate);
    setContextMenuItemState('optimize', !canOptimize);
    setContextMenuItemState('delete', false);

    activeContextMenu.classList.remove('hidden');
    activeContextMenu.style.visibility = 'hidden';
    activeContextMenu.style.display = 'block';

    const { innerWidth, innerHeight } = window;
    const menuRect = activeContextMenu.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + menuRect.width > innerWidth) {
        left = Math.max(0, innerWidth - menuRect.width - 8);
    }
    if (top + menuRect.height > innerHeight) {
        top = Math.max(0, innerHeight - menuRect.height - 8);
    }
    activeContextMenu.style.left = `${left}px`;
    activeContextMenu.style.top = `${top}px`;
    activeContextMenu.style.visibility = 'visible';
}

function hideResultContextMenu() {
    if (!activeContextMenu) {
        return;
    }
    activeContextMenu.classList.add('hidden');
    activeContextMenu.style.display = 'none';
    contextMenuTargetEntry = null;
    contextMenuTargetElement = null;
}

async function handleContextMenuAction(action) {
    if (!contextMenuTargetEntry || !contextMenuTargetEntry.entry || !contextMenuTargetEntry.conversation) {
        hideResultContextMenu();
        return;
    }
    const { entry, conversation } = contextMenuTargetEntry;
    hideResultContextMenu();
    try {
        switch (action) {
            case 'copy':
                await copyTextToClipboard(entry.transcription || '');
                break;
            case 'copy-translation':
                if (entry.translation && !entry.translationPending) {
                    await copyTextToClipboard(entry.translation);
                } else {
                    await requestTranslationForEntry(entry, conversation, { autoCopy: true });
                }
                break;
            case 'translate':
                await requestTranslationForEntry(entry, conversation, { autoCopy: false });
                break;
            case 'optimize':
                await requestOptimizationForEntry(entry, conversation);
                break;
            case 'delete':
                deleteResultEntry(entry, conversation);
                break;
            default:
                break;
        }
    } catch (error) {
        console.error('Context menu action failed:', action, error);
    }
}


function clearLogs() {
    const conversation = getActiveConversation();
    if (!conversation) {
        if (logContainer) {
            logContainer.innerHTML = '';
        }
        resultNodes.clear();
        return;
    }
    removeResultMappingsForConversation(conversation.id);
    conversation.entries = [];
    saveConversationsToStorage();
    renderConversationLogs();
}


// Window cleanup when closing
window.addEventListener('beforeunload', () => {
    stopConfigMonitoring();
});
const modalManagers = {};
const bodyModalClass = 'modal-open';
let activeModalName = null;

function getModalManager(name) {
    return modalManagers[name] || null;
}

function bindModalDismissHandlers(root, modalName, hideFn) {
    if (!root || typeof hideFn !== 'function') {
        return;
    }
    root.querySelectorAll('[data-modal-dismiss]').forEach((element) => {
        if (element.dataset.modalDismissBound === 'true') {
            return;
        }
        const target = element.dataset.modalDismiss;
        if (target && target !== modalName) {
            return;
        }
        element.addEventListener('click', (event) => {
            event.preventDefault();
            hideFn();
        });
        element.dataset.modalDismissBound = 'true';
    });
}

function createRemoteModal(name, config) {
    const modalElement = document.getElementById(config.modalId);
    const scrollElement = document.getElementById(config.scrollId);
    if (!modalElement || !scrollElement) {
        console.warn(`Modal "${name}" elements not found.`);
        return null;
    }
    const styleAttribute = config.styleAttribute || `data-${name}-style`;
    let markupLoaded = false;
    let loadingPromise = null;
    let stylesInjected = false;

    function hide(focusOrigin = true) {
        if (!modalElement.classList.contains('active')) {
            return;
        }
        modalElement.classList.remove('active');
        modalElement.setAttribute('aria-hidden', 'true');
        document.body.classList.remove(bodyModalClass);
        if (activeModalName === name) {
            activeModalName = null;
        }
        if (typeof config.onHide === 'function') {
            try {
                config.onHide();
            } catch (error) {
                console.warn(`Modal "${name}" onHide failed:`, error);
            }
        }
        if (focusOrigin && config.triggerSelector) {
            const trigger = document.querySelector(config.triggerSelector);
            if (trigger && typeof trigger.focus === 'function') {
                requestAnimationFrame(() => {
                    try {
                        trigger.focus({ preventScroll: true });
                    } catch (_) {
                        trigger.focus();
                    }
                });
            }
        }
    }

    async function ensureContent(params) {
        if (markupLoaded) {
            if (typeof config.init === 'function') {
                await config.init(params);
            }
            return;
        }
        if (loadingPromise) {
            await loadingPromise;
            if (typeof config.init === 'function') {
                await config.init(params);
            }
            return;
        }
        loadingPromise = (async () => {
            const response = await fetch(config.htmlPath, { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(`Failed to load ${config.htmlPath} (${response.status})`);
            }
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            if (!stylesInjected) {
                const styleNode = doc.head ? doc.head.querySelector('style') : null;
                if (styleNode && !document.head.querySelector(`style[${styleAttribute}]`)) {
                    const clone = styleNode.cloneNode(true);
                    clone.setAttribute(styleAttribute, 'true');
                    document.head.appendChild(clone);
                }
                stylesInjected = true;
            }

            doc.querySelectorAll('script').forEach((script) => script.remove());

            const wrapper = document.createElement('div');
            wrapper.className = config.wrapperClass;
            if (doc.body) {
                while (doc.body.firstChild) {
                    wrapper.appendChild(doc.body.firstChild);
                }
            }
            if (typeof config.prepare === 'function') {
                try {
                    config.prepare(wrapper);
                } catch (error) {
                    console.warn(`Modal "${name}" prepare failed:`, error);
                }
            }

            scrollElement.innerHTML = '';
            scrollElement.appendChild(wrapper);
            bindModalDismissHandlers(wrapper, name, hide);
            markupLoaded = true;
        })();

        try {
            await loadingPromise;
        } finally {
            loadingPromise = null;
        }

        if (typeof config.init === 'function') {
            await config.init(params);
        }
    }

    function focusInitial() {
        let target = null;
        if (config.initialFocusSelector) {
            target = modalElement.querySelector(config.initialFocusSelector);
        }
        if (!target) {
            target = modalElement.querySelector('[autofocus]');
        }
        if (!target) {
            target = modalElement.querySelector("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
        }
        if (target && typeof target.focus === 'function') {
            requestAnimationFrame(() => {
                try {
                    target.focus({ preventScroll: true });
                } catch (_) {
                    target.focus();
                }
            });
        }
    }

    async function show(params) {
        try {
            await ensureContent(params);
        } catch (error) {
            console.error(`Failed to display "${name}" modal:`, error);
            return;
        }
        if (activeModalName && activeModalName !== name) {
            const previous = getModalManager(activeModalName);
            if (previous) {
                previous.hide(false);
            }
        }
        if (scrollElement) {
            scrollElement.scrollTop = 0;
        }
        modalElement.classList.add('active');
        modalElement.setAttribute('aria-hidden', 'false');
        document.body.classList.add(bodyModalClass);
        activeModalName = name;
        if (typeof config.onShow === 'function') {
            try {
                config.onShow();
            } catch (error) {
                console.warn(`Modal "${name}" onShow failed:`, error);
            }
        }
        focusInitial();
    }

    modalElement.addEventListener('click', (event) => {
        if (event.target === modalElement) {
            hide();
        }
    });

    const manager = {
        show,
        hide,
        isOpen: () => modalElement.classList.contains('active')
    };
    modalManagers[name] = manager;
    return manager;
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeModalName) {
        const manager = getModalManager(activeModalName);
        if (manager) {
            manager.hide();
        }
    }
});

const settingsModalManager = createRemoteModal('settings', {
    modalId: 'settingsModal',
    scrollId: 'settingsModalScroll',
    htmlPath: 'settings.html',
    wrapperClass: 'settings-page settings-page-embedded',
    styleAttribute: 'data-settings-style',
    triggerSelector: '.settings-btn',
    initialFocusSelector: '.sidebar-item.active',
    init: async (section) => {
        if (window.SettingsPage && typeof window.SettingsPage.init === 'function') {
            await window.SettingsPage.init({ embedded: true, section });
        }
    }
});

const voiceModalManager = createRemoteModal('voice', {
    modalId: 'voiceModal',
    scrollId: 'voiceModalScroll',
    htmlPath: 'voice-input.html',
    wrapperClass: 'voice-page voice-page-embedded',
    styleAttribute: 'data-voice-style',
    triggerSelector: '.keyboard-btn',
    initialFocusSelector: '#voiceInputHotkey',
    init: async () => {
        if (window.VoiceInputPage && typeof window.VoiceInputPage.init === 'function') {
            await window.VoiceInputPage.init({ embedded: true });
        }
    }
});

const mediaModalManager = createRemoteModal('media', {
    modalId: 'mediaModal',
    scrollId: 'mediaModalScroll',
    htmlPath: 'media-transcribe.html',
    wrapperClass: 'media-page media-page-embedded',
    styleAttribute: 'data-media-style',
    triggerSelector: '.media-btn',
    init: async () => {
        if (window.MediaTranscribePage && typeof window.MediaTranscribePage.init === 'function') {
            await window.MediaTranscribePage.init({ embedded: true });
        }
    }
});

function showSettingsModal(section) {
    if (settingsModalManager) {
        settingsModalManager.show(section);
    } else {
        console.warn('Settings modal unavailable');
    }
}

function hideSettingsModal() {
    if (settingsModalManager) {
        settingsModalManager.hide();
    }
}

function showVoiceModal() {
    if (voiceModalManager) {
        voiceModalManager.show();
    } else {
        console.warn('Voice input modal unavailable');
    }
}

function showMediaModal() {
    if (mediaModalManager) {
        mediaModalManager.show();
    } else {
        console.warn('Media modal unavailable');
    }
}

if (window.electronAPI && typeof window.electronAPI.onShowSettings === 'function') {
    window.electronAPI.onShowSettings((section) => {
        showSettingsModal(section);
    });
}

if (window.electronAPI && typeof window.electronAPI.onShowVoiceInput === 'function') {
    window.electronAPI.onShowVoiceInput(() => {
        showVoiceModal();
    });
}

if (window.electronAPI && typeof window.electronAPI.onShowMediaTranscribe === 'function') {
    window.electronAPI.onShowMediaTranscribe(() => {
        showMediaModal();
    });
}


// Helpers for top-bar buttons
function openSettings() {
  try {
    if (window.electronAPI && window.electronAPI.openSettings) {
      window.electronAPI.openSettings();
    } else {
      console.warn('Electron API not available');
      showSettingsModal();
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
      showMediaModal();
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
      showVoiceModal();
    }
  } catch (error) {
    console.error('Failed to open keyboard/voice settings:', error);
  }
}

window.copyLastResult = copyLastResult;














