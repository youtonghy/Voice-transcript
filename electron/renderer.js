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

const CONVERSATION_STORAGE_KEY = 'voice_transcript_conversations_v1';
const ACTIVE_CONVERSATION_STORAGE_KEY = 'voice_transcript_active_conversation_v1';
let conversations = [];
let activeConversationId = null;
const resultConversationMap = new Map();
const HISTORY_COLLAPSED_STORAGE_KEY = 'voice_transcript_history_collapsed';
let historyCollapsed = false;
const CONVERSATION_TITLE_DEBOUNCE_MS = 800;
const MAX_TITLE_SEGMENTS = 12;
const MAX_TITLE_FIELD_LENGTH = 400;
const conversationTitleTimers = new Map();
const conversationTitleRequests = new Map();
const conversationTitleRescheduleSet = new Set();

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

const historyList = document.getElementById('historyList');
const newConversationButton = document.getElementById('newConversationButton');
const activeConversationNameEl = document.getElementById('activeConversationName');

const toggleHistoryButton = document.getElementById('toggleHistoryButton');

const VOLUME_MIN_DB = -60;
const VOLUME_MAX_DB = 0;
const SILENCE_PLACEHOLDER_DB = (VOLUME_MIN_DB + VOLUME_MAX_DB) / 2;
let silenceMarkerDb = null;

const DEFAULT_LANGUAGE = 'en';
const RECORD_ICON_MIC = String.fromCodePoint(0x1F3A4);
const RECORD_ICON_STOP = String.fromCodePoint(0x23F9, 0xFE0F);

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

function setRecordButtonIcon(icon) {
    if (!recordButton) {
        return;
    }
    recordButton.textContent = icon;
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
    toggleHistoryButton.textContent = label;
    toggleHistoryButton.title = label;
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
            createdAt,
            updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : createdAt
        };
        return normalized;
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
    const normalized = {
        id: typeof conversation.id === 'string' ? conversation.id : `conv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name: typeof conversation.name === 'string' && conversation.name ? conversation.name : generateConversationName(new Date(createdAt)),
        createdAt,
        updatedAt,
        titleGeneratedAt: typeof conversation.titleGeneratedAt === 'string' ? conversation.titleGeneratedAt : null,
        needsTitleRefresh: conversation.needsTitleRefresh === true,
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
    const sorted = [...conversations].sort((a, b) => {
        const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
        const normalizedA = Number.isFinite(timeA) ? timeA : 0;
        const normalizedB = Number.isFinite(timeB) ? timeB : 0;
        if (normalizedA === normalizedB) {
            return (b.name || '').localeCompare(a.name || '');
        }
        return normalizedB - normalizedA;
    });
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

function renderHistoryList() {
    if (!historyList) {
        return;
    }
    historyList.innerHTML = '';
    if (!conversations.length) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'history-empty';
        emptyDiv.textContent = t('index.history.empty');
        historyList.appendChild(emptyDiv);
        return;
    }
    const sorted = [...conversations].sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        if (timeA === timeB) {
            return (b.name || '').localeCompare(a.name || '');
        }
        return timeB - timeA;
    });
    sorted.forEach((conversation) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-item';
        if (conversation.id === activeConversationId) {
            button.classList.add('active');
        }
        button.dataset.conversationId = conversation.id;
        const nameSpan = document.createElement('span');
        nameSpan.className = 'history-name';
        nameSpan.textContent = conversation.name;
        button.appendChild(nameSpan);
        const detailSpan = document.createElement('span');
        detailSpan.className = 'history-detail';
        detailSpan.textContent = formatRecordedAtText(conversation.createdAt) || '';
        button.appendChild(detailSpan);
        historyList.appendChild(button);
    });
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
        const separator = document.createElement('div');
        separator.className = 'result-separator';
        container.appendChild(separator);
        const translationDiv = document.createElement('div');
        translationDiv.className = 'result-part translation';
        translationDiv.textContent = entry.translation;
        container.appendChild(translationDiv);
    } else if (entry.translationPending) {
        if (entry.transcription && !entry.transcriptionPending) {
            const separator = document.createElement('div');
            separator.className = 'result-separator';
            container.appendChild(separator);
        }
        const pendingDiv = document.createElement('div');
        pendingDiv.className = 'result-part translation pending';
        pendingDiv.textContent = t('index.translation.loading');
        container.appendChild(pendingDiv);
    }
    applyRecordingMeta(container, entry.meta || {});
    return container;
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
    const conversation = {
        id: config.id || `conv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name,
        createdAt,
        updatedAt: typeof config.updatedAt === 'string' ? config.updatedAt : createdAt,
        titleGeneratedAt: typeof config.titleGeneratedAt === 'string' ? config.titleGeneratedAt : null,
        needsTitleRefresh: Boolean(config.needsTitleRefresh),
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
    const target = event.target.closest('.history-item');
    if (!target || !target.dataset || !target.dataset.conversationId) {
        return;
    }
    if (target.dataset.conversationId === activeConversationId) {
        return;
    }
    setActiveConversation(target.dataset.conversationId);
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
    entry.updatedAt = new Date().toISOString();
    conversation.updatedAt = entry.updatedAt;
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
    if (typeof message.transcription === 'string' && message.transcription) {
        entry.transcription = message.transcription;
        entry.transcriptionPending = false;
        lastTranscription = message.transcription;
    } else if (message.transcription_pending) {
        entry.transcriptionPending = true;
    }
    entry.meta = Object.assign({}, entry.meta, extractRecordingMeta(message));
    entry.updatedAt = new Date().toISOString();
    conversation.updatedAt = entry.updatedAt;
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
    if (typeof message.translation === 'string' && message.translation) {
        entry.translation = message.translation;
        entry.translationPending = false;
        lastTranslation = message.translation;
    } else if (message.translation_pending) {
        entry.translationPending = true;
    }
    entry.updatedAt = new Date().toISOString();
    conversation.updatedAt = entry.updatedAt;
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
}


function applyLanguageFromConfig(cfg) {
    const lang = (cfg && cfg.app_language) || DEFAULT_LANGUAGE;
    changeLanguage(lang);
    if (window.appI18n && typeof window.appI18n.apply === 'function') {
        window.appI18n.apply();
    }
    document.title = t('index.title');
    updateHistoryToggleUI();
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
    if (typeof window.appI18n.onChange === 'function') {
        window.appI18n.onChange(() => {
            document.title = t('index.title');
            updateServiceStatus(pythonServiceStatus);
            updateUI();
            updateHistoryToggleUI();
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
        setRecordButtonIcon(RECORD_ICON_MIC);
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
        setRecordButtonIcon(RECORD_ICON_STOP);
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
        setRecordButtonIcon(RECORD_ICON_MIC);
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
            handleResultMessage(message);
            break;
        case 'transcription_update':
            handleTranscriptionUpdateMessage(message);
            break;
        case 'translation_update':
            handleTranslationUpdateMessage(message);
            break;
        case 'conversation_summary':
            handleConversationSummaryMessage(message);
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
    const entry = {
        id: `log-$${Date.now()}-$${Math.random().toString(16).slice(2, 8)}`,
        type: 'log',
        level: typeof level === 'string' ? level : 'info',
        message: typeof message === 'string' ? message : String(message),
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



















