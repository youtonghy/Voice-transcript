let currentConfig = {};
let autoSaveTimeout = null; // 防抖定时器

document.addEventListener('DOMContentLoaded', () => {
    loadCurrentConfig();
    setupEventListeners();
});

function setupEventListeners() {
    // 表单提交
    document.getElementById('settingsForm').addEventListener('submit', saveSettings);
    
    // 翻译开关
    document.getElementById('enableTranslation').addEventListener('change', toggleTranslationSettings);
    document.getElementById('enableTranslation').addEventListener('change', autoSave);
    
    // 翻译模式切换
    document.getElementById('translationMode').addEventListener('change', () => {
        updateTranslationModeSettings();
        updateTranscribeLanguageAvailability();
        autoSave();
    });
    
    // 翻译开关切换时也需要更新转录语言可用性
    document.getElementById('enableTranslation').addEventListener('change', () => {
        updateTranscribeLanguageAvailability();
    });
    
    // 剧场模式开关
    document.getElementById('theaterMode').addEventListener('change', autoSave);
    
    // 目标语言选择与自定义
    const targetLanguage = document.getElementById('targetLanguage');
    const customLanguage = document.getElementById('customLanguage');
    targetLanguage.addEventListener('change', () => {
        updateCustomLanguageVisibility();
        autoSave();
    });
    customLanguage.addEventListener('input', autoSave);
    
    // 实时验证API密钥格式并触发主页面检测
    document.getElementById('apiKey').addEventListener('input', (event) => {
        validateApiKey();
        // API密钥输入变化时触发自动保存以便主页面实时检测
        autoSave();
    });
    
    // API URL变化也触发实时检测
    document.getElementById('apiUrl').addEventListener('input', autoSave);
    
    // 为所有输入框添加失焦自动保存
    const autoSaveInputs = [
        'apiKey', 'apiUrl', 'targetLanguage', 'customLanguage', 'transcribeLanguage',
        'translationMode', 'language1', 'language2',
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
    // API配置
    document.getElementById('apiKey').value = config.openai_api_key || '';
    document.getElementById('apiUrl').value = config.openai_base_url || '';
    
    // 翻译设置
    const enableTranslation = document.getElementById('enableTranslation');
    enableTranslation.checked = config.enable_translation !== false;
    
    // 目标语言：若不在下拉选项中，切换为自定义
    const targetLanguage = document.getElementById('targetLanguage');
    const customLanguage = document.getElementById('customLanguage');
    const savedLang = config.translate_language || '中文';
    const options = Array.from(targetLanguage.options).map(o => o.value);
    if (options.includes(savedLang)) {
        targetLanguage.value = savedLang;
        customLanguage.style.display = 'none';
        customLanguage.value = '';
    } else {
        targetLanguage.value = '__custom__';
        customLanguage.style.display = 'block';
        customLanguage.value = savedLang;
    }
    
    // 录音设置
    document.getElementById('silenceThreshold').value = config.silence_rms_threshold || 0.01;
    document.getElementById('silenceDuration').value = config.min_silence_seconds || 1.0;
    
    // 剧场模式
    document.getElementById('theaterMode').checked = config.theater_mode || false;
    
    // 转录语言设置
    const transcribeLanguage = document.getElementById('transcribeLanguage');
    transcribeLanguage.value = config.transcribe_language || 'auto';
    
    // 翻译模式设置
    const translationMode = document.getElementById('translationMode');
    translationMode.value = config.translation_mode || 'fixed';
    
    // 智能翻译语言设置
    const language1 = document.getElementById('language1');
    const language2 = document.getElementById('language2');
    language1.value = config.smart_language1 || '中文';
    language2.value = config.smart_language2 || 'English';
    
    // 更新UI状态
    toggleTranslationSettings();
    updateCustomLanguageVisibility();
    updateTranslationModeSettings();
    updateTranscribeLanguageAvailability();
}

function toggleTranslationSettings() {
    const enableTranslation = document.getElementById('enableTranslation').checked;
    const translationSettings = document.getElementById('translationSettings');
    
    if (enableTranslation) {
        translationSettings.style.opacity = '1';
        translationSettings.style.pointerEvents = 'auto';
    } else {
        translationSettings.style.opacity = '0.5';
        translationSettings.style.pointerEvents = 'none';
    }
}

function updateCustomLanguageVisibility() {
    const targetLanguage = document.getElementById('targetLanguage');
    const customLanguage = document.getElementById('customLanguage');
    const useCustom = targetLanguage.value === '__custom__';
    customLanguage.style.display = useCustom ? 'block' : 'none';
}

function updateTranslationModeSettings() {
    const translationMode = document.getElementById('translationMode');
    const fixedSettings = document.getElementById('fixedTranslationSettings');
    const smartSettings = document.getElementById('smartTranslationSettings');
    
    if (translationMode.value === 'smart') {
        fixedSettings.style.display = 'none';
        smartSettings.style.display = 'block';
    } else {
        fixedSettings.style.display = 'block';
        smartSettings.style.display = 'none';
    }
}

function updateTranscribeLanguageAvailability() {
    const enableTranslation = document.getElementById('enableTranslation').checked;
    const translationMode = document.getElementById('translationMode').value;
    const transcribeLanguage = document.getElementById('transcribeLanguage');
    
    // 如果启用了智能翻译模式，则转录语言必须是自动检测
    if (enableTranslation && translationMode === 'smart') {
        // 强制设置为自动检测并禁用选择器
        transcribeLanguage.value = 'auto';
        transcribeLanguage.disabled = true;
        transcribeLanguage.style.opacity = '0.6';
        transcribeLanguage.style.cursor = 'not-allowed';
    } else {
        // 恢复正常状态
        transcribeLanguage.disabled = false;
        transcribeLanguage.style.opacity = '1';
        transcribeLanguage.style.cursor = 'auto';
    }
}

function validateApiKey() {
    const apiKey = document.getElementById('apiKey').value;
    // 简单验证API密钥格式
    return apiKey && apiKey.startsWith('sk-') && apiKey.length > 20;
}

async function saveSettings(event) {
    event.preventDefault();
    
    // 校验翻译设置
    const enableTranslation = document.getElementById('enableTranslation').checked;
    if (enableTranslation) {
        const translationMode = document.getElementById('translationMode').value;
        
        if (translationMode === 'fixed') {
            // 校验固定翻译的自定义语言
            const targetLanguage = document.getElementById('targetLanguage');
            const customLanguage = document.getElementById('customLanguage');
            if (targetLanguage.value === '__custom__' && !customLanguage.value.trim()) {
                showTopNotification('❌ 请输入自定义目标语言', 'error');
                customLanguage.focus();
                return;
            }
        } else if (translationMode === 'smart') {
            // 校验智能翻译的语言设置
            const language1 = document.getElementById('language1').value;
            const language2 = document.getElementById('language2').value;
            if (language1 === language2) {
                showTopNotification('❌ 智能翻译的两种语言不能相同', 'error');
                document.getElementById('language2').focus();
                return;
            }
            
            // 智能翻译模式下转录语言必须为自动检测
            const transcribeLanguage = document.getElementById('transcribeLanguage');
            if (transcribeLanguage.value !== 'auto') {
                showTopNotification('❌ 智能翻译模式下，转录语言必须为"自动检测"', 'error');
                transcribeLanguage.value = 'auto';
                return;
            }
        }
    }

    const formData = new FormData(event.target);
    const newConfig = {};
    
    // 收集表单数据
    for (let [key, value] of formData.entries()) {
        if (key === 'enable_translation') {
            newConfig[key] = true;
        } else if (key === 'silence_rms_threshold' || key === 'min_silence_seconds') {
            newConfig[key] = parseFloat(value);
        } else {
            newConfig[key] = value;
        }
    }
    
    // 处理复选框
    newConfig.enable_translation = document.getElementById('enableTranslation').checked;
    newConfig.theater_mode = document.getElementById('theaterMode').checked;
    
    try {
        const success = await window.electronAPI.saveConfig(newConfig);
        
        if (success) {
            // 显示顶部成功通知（不重启，统一由后端处理配置热更新）
            showTopNotification('✅ 设置已保存（已热更新）', 'success');
            
            // 更新当前配置
            currentConfig = { ...currentConfig, ...newConfig };
        } else {
            showTopNotification('❌ 设置保存失败', 'error');
        }
    } catch (error) {
        showTopNotification(`❌ 保存设置时出错: ${error.message}`, 'error');
    }
}

async function autoRestartService() {
    try {
        const result = await window.electronAPI.restartPythonService();
        
        if (result.success) {
            showTopNotification('✅ 配置已保存，服务重启成功！', 'success');
        } else {
            showTopNotification(`⚠️ 配置已保存，但服务重启失败: ${result.error}`, 'warning');
        }
    } catch (error) {
        showTopNotification(`⚠️ 配置已保存，但自动重启出错: ${error.message}`, 'warning');
    }
}

function showStatus(type, message) {
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.className = `status-message status-${type}`;
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';
    
    // 成功消息自动消失
    if (type === 'success') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    }
}

// 键盘快捷键
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        // 返回主页面而不是关闭窗口
        window.location.href = 'index.html';
    } else if (event.ctrlKey && event.key === 's') {
        event.preventDefault();
        document.getElementById('settingsForm').dispatchEvent(new Event('submit'));
    }
});

// 自动保存功能
function autoSave() {
    // 清除之前的定时器，实现防抖
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }
    
    // API相关配置变化时使用较短延迟(300ms)，其他配置使用800ms
    const newConfig = collectFormData();
    // 翻译设置验证
    if (newConfig.enable_translation) {
        const translationMode = document.getElementById('translationMode').value;
        
        if (translationMode === 'fixed') {
            // 自定义目标语言不能为空
            const targetLanguage = document.getElementById('targetLanguage').value;
            const customLanguage = document.getElementById('customLanguage').value.trim();
            if (targetLanguage === '__custom__' && !customLanguage) {
                // 不自动保存，等待填写
                return;
            }
        } else if (translationMode === 'smart') {
            // 智能翻译的两种语言不能相同
            const language1 = document.getElementById('language1').value;
            const language2 = document.getElementById('language2').value;
            if (language1 === language2) {
                // 不自动保存，等待修改
                return;
            }
            
            // 智能翻译模式下转录语言必须为自动检测
            const transcribeLanguage = document.getElementById('transcribeLanguage');
            if (transcribeLanguage.value !== 'auto') {
                // 强制设置为自动检测，不自动保存
                transcribeLanguage.value = 'auto';
                return;
            }
        }
    }
    const delay = 600;
    
    autoSaveTimeout = setTimeout(async () => {
        try {
            const success = await window.electronAPI.saveConfig(newConfig);
            
            if (success) {
                // 更新当前配置
                currentConfig = { ...currentConfig, ...newConfig };
                // 显示简单的自动保存通知（热更新）
                showTopNotification('✅ 设置已自动保存（已热更新）', 'success');
            } else {
                showTopNotification('❌ 自动保存失败', 'error');
            }
        } catch (error) {
            console.error('自动保存出错:', error);
            showTopNotification('❌ 自动保存出错: ' + error.message, 'error');
        }
    }, delay);
}

// 检查是否需要重启服务
function checkIfRestartNeeded(newConfig) {
    // API相关配置变更需要重启
    const apiRelatedKeys = ['openai_api_key', 'openai_base_url', 'enable_translation', 'translate_language', 'theater_mode'];
    
    for (const key of apiRelatedKeys) {
        if (currentConfig[key] !== newConfig[key]) {
            return true;
        }
    }
    
    return false;
}

// 收集表单数据
function collectFormData() {
    const formData = new FormData(document.getElementById('settingsForm'));
    const newConfig = {};
    
    // 收集表单数据
    for (let [key, value] of formData.entries()) {
        if (key === 'enable_translation') {
            newConfig[key] = true;
        } else if (key === 'silence_rms_threshold' || key === 'min_silence_seconds') {
            newConfig[key] = parseFloat(value);
        } else {
            newConfig[key] = value;
        }
    }
    
    // 处理复选框
    newConfig.enable_translation = document.getElementById('enableTranslation').checked;
    newConfig.theater_mode = document.getElementById('theaterMode').checked;
    
    // 处理翻译设置
    const translationMode = document.getElementById('translationMode').value;
    newConfig.translation_mode = translationMode;
    
    if (translationMode === 'fixed') {
        // 统一解析目标语言：自定义优先
        const targetLanguage = document.getElementById('targetLanguage').value;
        const customLanguage = document.getElementById('customLanguage').value.trim();
        newConfig.translate_language = (targetLanguage === '__custom__') ? customLanguage : targetLanguage;
    } else if (translationMode === 'smart') {
        // 智能翻译设置
        newConfig.smart_language1 = document.getElementById('language1').value;
        newConfig.smart_language2 = document.getElementById('language2').value;
    }
    
    return newConfig;
}

// 显示顶部通知
function showTopNotification(message, type = 'success') {
    const notification = document.getElementById('topNotification');
    notification.textContent = message;
    notification.className = `top-notification ${type}`;
    
    // 显示通知
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);
    
    // 4秒后自动隐藏
    setTimeout(() => {
        hideTopNotification();
    }, 4000);
}

// 隐藏顶部通知
function hideTopNotification() {
    const notification = document.getElementById('topNotification');
    notification.classList.remove('show');
}
