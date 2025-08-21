let isRecording = false;
let lastTranscription = '';
let lastTranslation = '';
let pythonServiceStatus = 'unknown'; // 'starting', 'running', 'error', 'stopped'
let isVoiceActive = false; // 新增：跟踪语音活动状态
let openaiConfigured = false; // 用于显示"是否配置openai转写"
let translationEnabled = true; // 从配置读取，用于控制组合显示
let currentResultNode = null; // 当前组合结果气泡
let resultNodes = new Map(); // 结果节点映射表，key为result_id，value为DOM元素
let currentConfig = {}; // 存储当前配置
let configCheckInterval = null; // 定时检查配置的定时器

// DOM元素
const recordButton = document.getElementById('recordButton');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const logContainer = document.getElementById('logContainer');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    // 初始化服务状态，不输出日志
    updateServiceStatus('starting');

    // 立即检查配置并开始定时检查
    checkOpenAIConfig();
    startConfigMonitoring();
});

// 检查OpenAI配置状态
async function checkOpenAIConfig() {
    if (window.electronAPI && window.electronAPI.getConfig) {
        try {
            const cfg = await window.electronAPI.getConfig();
            currentConfig = cfg || {};
            
            const newOpenaiConfigured = !!(cfg && cfg.openai_api_key && cfg.openai_api_key.trim() && 
                                           cfg.openai_api_key.startsWith('sk-') && cfg.openai_api_key.length > 20);
            const newTranslationEnabled = cfg && cfg.enable_translation !== false;
            
            // 只有状态变化时才更新日志
            if (openaiConfigured !== newOpenaiConfigured) {
                openaiConfigured = newOpenaiConfigured;
                addLogEntry('info', `OpenAI转写: ${openaiConfigured ? '已配置' : '未配置'}`);
            }
            
            translationEnabled = newTranslationEnabled;
            
        } catch (error) {
            // 配置加载失败时，只有状态变化才更新
            if (openaiConfigured !== false) {
                openaiConfigured = false;
                translationEnabled = true;
                addLogEntry('info', 'OpenAI转写: 未配置');
            }
        }
    }
}

// 开始配置监控
function startConfigMonitoring() {
    // 每隔3秒检查一次配置变化
    configCheckInterval = setInterval(checkOpenAIConfig, 3000);
}

// 停止配置监控
function stopConfigMonitoring() {
    if (configCheckInterval) {
        clearInterval(configCheckInterval);
        configCheckInterval = null;
    }
}

function setupEventListeners() {
    // 录音按钮点击事件
    recordButton.addEventListener('click', toggleRecording);
    
    // 监听Python消息
    if (window.electronAPI) {
        window.electronAPI.onPythonMessage(handlePythonMessage);
    } else {
        // 不输出到实时日志
    }
    
    // 键盘快捷键
    document.addEventListener('keydown', (event) => {
        if (event.key === 'F1') {
            event.preventDefault();
            if (!isRecording && pythonServiceStatus === 'running') {
                startRecording();
            } else {
                addLogEntry('warning', 'Python服务未就绪，无法开始录音');
            }
        } else if (event.key === 'F2') {
            event.preventDefault();
            if (isRecording) stopRecording();
        }
    });
}

function updateServiceStatus(status) {
    pythonServiceStatus = status;
    const serviceStatusText = {
        'starting': '正在启动Python服务...',
        'running': '服务运行中',
        'error': '服务错误',
        'stopped': '服务已停止'
    };
    // 仅在最终状态写入日志：后端连接 成功/失败
    if (status === 'running') {
        addLogEntry('info', '后端连接: 成功');
    } else if (status === 'error' || status === 'stopped') {
        addLogEntry('info', '后端连接: 失败');
    }

    // 更新UI状态
    if (status !== 'running') {
        recordButton.disabled = true;
        recordButton.textContent = '🔧';
        recordButton.title = '服务启动中...';
        recordButton.className = 'control-bar-btn record-btn start disabled';
    } else {
        recordButton.disabled = false;
        updateUI();
    }
}

async function toggleRecording() {
    if (pythonServiceStatus !== 'running') {
        addLogEntry('error', 'Python服务未就绪，无法录音');
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
            isVoiceActive = false; // 开始录音时重置语音活动状态
            updateUI();
        } else {
            // 不输出实时日志
        }
    } catch (error) {
        console.error('开始录音错误:', error);
    }
}

async function stopRecording() {
    try {
        const result = await window.electronAPI.stopRecording();
        if (result !== false) {
            isRecording = false;
            isVoiceActive = false; // 重置语音活动状态
            updateUI();
        } else {
            // 不输出实时日志
        }
    } catch (error) {
        console.error('停止录音错误:', error);
    }
}

function updateUI() {
    if (isRecording) {
        recordButton.textContent = '⏹️';
        recordButton.title = '停止录音';
        // 录音时变为红色，根据语音活动状态决定是否有脉冲动画
        if (isVoiceActive) {
            recordButton.className = 'control-bar-btn record-btn stop recording-active';
        } else {
            recordButton.className = 'control-bar-btn record-btn stop recording-idle';
        }
        statusDot.className = 'status-dot recording';
        statusText.textContent = '录音中...';
    } else {
        recordButton.textContent = '🎤';
        recordButton.title = '开始录音';
        recordButton.className = 'control-bar-btn record-btn start';
        statusDot.className = 'status-dot idle';
        statusText.textContent = pythonServiceStatus === 'running' ? '就绪' : '服务未就绪';
    }
}

function handlePythonMessage(message) {
    console.log('收到Python消息:', message);
    
    // 检测服务状态
    if (message.type === 'log') {
        if (message.message.includes('转写服务已启动') || message.message.includes('Python转写服务已启动')) {
            updateServiceStatus('running');
        } else if (message.message.includes('转写服务已停止') || message.level === 'error') {
            if (message.message.includes('Python进程启动失败') || 
                message.message.includes('Python错误') ||
                message.message.includes('模块导入失败')) {
                updateServiceStatus('error');
            }
        }

        // 不再通过后端日志检测OpenAI状态，改为实时配置检测
    }
    
    switch (message.type) {
        case 'log':
            // 已在上面根据需要输出，剩余日志不显示
            break;
        case 'result':
            // 处理新的结果消息类型
            if (message.transcription) {
                lastTranscription = message.transcription;
                
                if (message.translation) {
                    // 同步翻译完成：显示完整组合消息
                    lastTranslation = message.translation;
                    const resultNode = addResultBubble(message.transcription, message.translation);
                    if (message.result_id) {
                        resultNodes.set(message.result_id, resultNode);
                        console.log('存储同步翻译结果节点:', message.result_id);
                    }
                } else if (message.translation_pending) {
                    // 异步翻译待处理：先显示转写，预留翻译位置
                    const resultNode = addResultBubble(message.transcription, null, true);
                    if (message.result_id) {
                        resultNodes.set(message.result_id, resultNode);
                        console.log('存储异步翻译待处理节点:', message.result_id);
                        
                        // 添加一个数据属性来标记翻译顺序
                        if (message.translation_order) {
                            resultNode.dataset.translationOrder = message.translation_order;
                            console.log('设置翻译顺序:', message.translation_order);
                        }
                    }
                } else {
                    // 未启用翻译：只显示转写
                    const resultNode = addResultBubble(message.transcription);
                    if (message.result_id) {
                        resultNodes.set(message.result_id, resultNode);
                        console.log('存储纯转写结果节点:', message.result_id);
                    }
                }
            }
            break;
        case 'translation_update':
            // 处理异步翻译更新
            console.log('收到翻译更新:', message);
            if (message.result_id && message.translation) {
                let resultNode = resultNodes.get(message.result_id);
                console.log('查找结果节点:', message.result_id, '找到:', !!resultNode);
                
                if (!resultNode && message.order) {
                    // 如果通过result_id找不到，尝试通过翻译顺序找
                    console.log('通过result_id未找到，尝试按顺序查找，翻译顺序:', message.order);
                    const allResults = Array.from(resultNodes.entries());
                    
                    // 查找具有匹配翻译顺序的节点
                    for (const [nodeId, node] of allResults) {
                        if (node.dataset && node.dataset.translationOrder === String(message.order)) {
                            console.log('通过翻译顺序找到匹配节点:', nodeId, '顺序:', message.order);
                            resultNode = node;
                            break;
                        }
                    }
                    
                    // 如果还是没找到，按创建顺序查找
                    if (!resultNode && allResults.length >= message.order) {
                        const targetResultEntry = allResults[message.order - 1];
                        if (targetResultEntry) {
                            console.log('按创建顺序找到结果节点:', targetResultEntry[0], '顺序:', message.order);
                            resultNode = targetResultEntry[1];
                        }
                    }
                }
                
                if (resultNode) {
                    updateResultWithTranslation(resultNode, message.translation);
                    lastTranslation = message.translation;
                    console.log('翻译已更新到UI');
                } else {
                    console.error('无法找到匹配的结果节点:', {
                        result_id: message.result_id,
                        order: message.order,
                        available_nodes: Array.from(resultNodes.keys()),
                        total_nodes: resultNodes.size
                    });
                }
            } else {
                console.warn('翻译更新消息格式不正确:', message);
            }
            break;
        case 'result_final':
            // 处理最终结果（翻译失败或队列满）
            if (message.result_id) {
                const resultNode = resultNodes.get(message.result_id);
                if (resultNode) {
                    // 移除翻译占位符，只保留转写
                    removePendingTranslation(resultNode);
                }
            }
            break;
        case 'transcription':
            // 保留向后兼容性
            lastTranscription = message.text;
            addOrUpdateResultBubble({ transcription: message.text });
            break;
        case 'translation':
            // 保留向后兼容性
            lastTranslation = message.text;
            addOrUpdateResultBubble({ translation: message.text });
            break;
        case 'voice_activity':
            // 处理语音活动状态变化
            isVoiceActive = message.active;
            if (isRecording) {
                updateUI(); // 更新录音按钮样式
            }
            break;
        default:
            // 忽略未知日志输出
            console.log('未知消息类型:', message);
    }
}

function addLogEntry(level, message) {
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    
    const timestamp = new Date().toLocaleTimeString();
    
    logEntry.innerHTML = `
        <span class="timestamp">[${timestamp}]</span>
        ${message}
    `;
    
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // 限制日志条目数量，避免内存占用过多
    const maxEntries = 1000;
    while (logContainer.children.length > maxEntries) {
        logContainer.removeChild(logContainer.firstChild);
    }
    
    // 错误级别消息额外处理
    if (level === 'error') {
        console.error('错误消息:', message);
    }
}

// 统一的结果气泡显示函数
function addResultBubble(transcription, translation = null, translationPending = false) {
    const resultEntry = document.createElement('div');
    resultEntry.className = 'log-entry result-entry';

    const transDiv = document.createElement('div');
    transDiv.className = 'result-part transcription';
    transDiv.textContent = transcription;
    resultEntry.appendChild(transDiv);

    // 如果启用翻译（有翻译内容或翻译待处理），添加分隔线和翻译部分
    if (translation || translationPending) {
        const sepDiv = document.createElement('div');
        sepDiv.className = 'result-separator';
        resultEntry.appendChild(sepDiv);

        const tranDiv = document.createElement('div');
        tranDiv.className = 'result-part translation';
        
        if (translation) {
            tranDiv.textContent = translation;
        } else if (translationPending) {
            tranDiv.textContent = '翻译中...';
            tranDiv.classList.add('pending');
        }
        
        resultEntry.appendChild(tranDiv);
    }

    logContainer.appendChild(resultEntry);
    logContainer.scrollTop = logContainer.scrollHeight;

    // 限制数量
    const maxEntries = 1000;
    while (logContainer.children.length > maxEntries) {
        const removedNode = logContainer.removeChild(logContainer.firstChild);
        // 从映射表中移除对应的节点
        for (const [key, value] of resultNodes.entries()) {
            if (value === removedNode) {
                resultNodes.delete(key);
                break;
            }
        }
    }

    // 更新当前结果节点引用
    currentResultNode = resultEntry;
    return resultEntry;
}

// 更新结果气泡的翻译内容
function updateResultWithTranslation(resultNode, translation) {
    const translationDiv = resultNode.querySelector('.result-part.translation');
    if (translationDiv) {
        translationDiv.textContent = translation;
        translationDiv.classList.remove('pending');
    }
    logContainer.scrollTop = logContainer.scrollHeight;
}

// 移除翻译占位符
function removePendingTranslation(resultNode) {
    const sepDiv = resultNode.querySelector('.result-separator');
    const translationDiv = resultNode.querySelector('.result-part.translation');
    
    if (sepDiv) {
        resultNode.removeChild(sepDiv);
    }
    if (translationDiv) {
        resultNode.removeChild(translationDiv);
    }
}

// 生成或更新"转写+翻译"的组合气泡
function addOrUpdateResultBubble({ transcription, translation }) {
    // 如果有新的转写，则创建一个新的结果气泡
    if (typeof transcription === 'string' && transcription.trim()) {
        currentResultNode = document.createElement('div');
        currentResultNode.className = 'log-entry result-entry';

        const transDiv = document.createElement('div');
        transDiv.className = 'result-part transcription';
        transDiv.textContent = transcription;

        const sepDiv = document.createElement('div');
        sepDiv.className = 'result-separator';

        const tranDiv = document.createElement('div');
        tranDiv.className = 'result-part translation';
        tranDiv.textContent = translationEnabled ? '' : '';

        // 如果启用翻译：带分隔线和下半部分；否则只显示上半部分
        if (translationEnabled) {
            currentResultNode.appendChild(transDiv);
            currentResultNode.appendChild(sepDiv);
            currentResultNode.appendChild(tranDiv);
        } else {
            currentResultNode.appendChild(transDiv);
        }

        logContainer.appendChild(currentResultNode);
        logContainer.scrollTop = logContainer.scrollHeight;

        // 限制数量
        const maxEntries = 1000;
        while (logContainer.children.length > maxEntries) {
            logContainer.removeChild(logContainer.firstChild);
        }
        return;
    }

    // 如果是翻译消息，填充到当前结果气泡的下半部分
    if (typeof translation === 'string' && translation.trim()) {
        // 如果没有当前气泡，创建一个空的结构以放置翻译（极少发生）
        if (!currentResultNode) {
            currentResultNode = document.createElement('div');
            currentResultNode.className = 'log-entry result-entry';

            const transDiv = document.createElement('div');
            transDiv.className = 'result-part transcription';
            transDiv.textContent = '';

            const sepDiv = document.createElement('div');
            sepDiv.className = 'result-separator';

            const tranDiv = document.createElement('div');
            tranDiv.className = 'result-part translation';
            tranDiv.textContent = translation;

            currentResultNode.appendChild(transDiv);
            currentResultNode.appendChild(sepDiv);
            currentResultNode.appendChild(tranDiv);
            logContainer.appendChild(currentResultNode);
        } else {
            // 找到翻译区块（最后一个 .result-part.translation）
            const tranDiv = currentResultNode.querySelector('.result-part.translation');
            if (tranDiv) {
                tranDiv.textContent = translation;
            } else if (translationEnabled) {
                // 如果之前未创建翻译区块（例如状态切换），则创建
                const sepDiv = document.createElement('div');
                sepDiv.className = 'result-separator';
                const newTranDiv = document.createElement('div');
                newTranDiv.className = 'result-part translation';
                newTranDiv.textContent = translation;
                currentResultNode.appendChild(sepDiv);
                currentResultNode.appendChild(newTranDiv);
            }
        }
        logContainer.scrollTop = logContainer.scrollHeight;
    }
}

async function openSettings() {
    try {
        await window.electronAPI.openSettings();
    } catch (error) {
        console.error('打开设置失败:', error);
    }
}

function clearLogs() {
    if (confirm('确定要清空所有日志吗？')) {
        logContainer.innerHTML = '';
        // 重新输出当前状态
        if (pythonServiceStatus === 'running') {
            addLogEntry('info', '后端连接: 成功');
        } else if (pythonServiceStatus === 'error' || pythonServiceStatus === 'stopped') {
            addLogEntry('info', '后端连接: 失败');
        }
        // 重新检查并输出OpenAI配置状态
        checkOpenAIConfig();
    }
}

function copyLastResult() {
    let textToCopy = '';
    
    if (lastTranscription) {
        textToCopy += lastTranscription;
    }
    
    if (lastTranslation) {
        if (textToCopy) textToCopy += '\n';
        textToCopy += lastTranslation;
    }
    
    if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            // 不输出实时日志
        }).catch(err => {
            console.error('复制失败:', err);
        });
    } else {
        console.warn('没有可复制的结果');
    }
}

function exportLogs() {
    const logs = Array.from(logContainer.children).map(entry => {
        return entry.textContent;
    }).join('\n');
    
    const blob = new Blob([logs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `voice-transcript-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
    // 不输出实时日志
}

// 页面关闭时清理定时器
window.addEventListener('beforeunload', () => {
    stopConfigMonitoring();
});
