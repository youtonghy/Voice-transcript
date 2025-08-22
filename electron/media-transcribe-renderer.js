// 媒体转写页面渲染进程脚本

class MediaTranscribeApp {
    constructor() {
        this.selectedFile = null;
        this.results = [];
        this.isProcessing = false;
        this.outputPathValue = ''; // 重命名避免冲突
        
        try {
            console.log('初始化DOM元素...');
            this.initElements();
            console.log('绑定事件...');
            this.bindEvents();
            console.log('加载设置...');
            this.loadSettings();
            console.log('MediaTranscribeApp构造完成');
        } catch (error) {
            console.error('MediaTranscribeApp构造失败:', error);
            throw error;
        }
    }

    initElements() {
        try {
            // 文件上传相关
            this.uploadArea = document.getElementById('uploadArea');
            if (!this.uploadArea) throw new Error('uploadArea元素未找到');
            
            this.fileInfo = document.getElementById('fileInfo');
            if (!this.fileInfo) throw new Error('fileInfo元素未找到');
            
            this.fileName = document.getElementById('fileName');
            if (!this.fileName) throw new Error('fileName元素未找到');
            
            this.fileSize = document.getElementById('fileSize');
            if (!this.fileSize) throw new Error('fileSize元素未找到');

            // 设置相关
            this.enableTranslation = document.getElementById('enableTranslation');
            if (!this.enableTranslation) throw new Error('enableTranslation元素未找到');
            
            this.targetLanguage = document.getElementById('targetLanguage');
            if (!this.targetLanguage) throw new Error('targetLanguage元素未找到');
            this.customLanguage = document.getElementById('customLanguage');
            if (!this.customLanguage) throw new Error('customLanguage元素未找到');
            
            this.theaterMode = document.getElementById('theaterMode');
            if (!this.theaterMode) throw new Error('theaterMode元素未找到');
            
            this.languageGroup = document.getElementById('languageGroup');
            if (!this.languageGroup) throw new Error('languageGroup元素未找到');

            // 输出设置
            this.outputPath = document.getElementById('outputPath');
            if (!this.outputPath) throw new Error('outputPath元素未找到');
            
            this.browseOutputBtn = document.getElementById('browseOutputBtn');
            if (!this.browseOutputBtn) throw new Error('browseOutputBtn元素未找到');

            // 按钮
            this.startProcessBtn = document.getElementById('startProcessBtn');
            if (!this.startProcessBtn) throw new Error('startProcessBtn元素未找到');
            
            this.clearBtn = document.getElementById('clearBtn');
            if (!this.clearBtn) throw new Error('clearBtn元素未找到');
            
            this.exportBtn = document.getElementById('exportBtn');
            if (!this.exportBtn) throw new Error('exportBtn元素未找到');

            // 结果显示
            this.resultsContent = document.getElementById('resultsContent');
            if (!this.resultsContent) throw new Error('resultsContent元素未找到');

            console.log('所有元素初始化完成');
        } catch (error) {
            console.error('元素初始化失败:', error);
            throw error;
        }
    }

    bindEvents() {
        try {
            // 文件上传事件 - 使用Electron原生对话框
            this.uploadArea.addEventListener('click', () => {
                this.selectFile();
            });

            this.uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                this.uploadArea.classList.add('dragover');
            });

            this.uploadArea.addEventListener('dragleave', () => {
                this.uploadArea.classList.remove('dragover');
            });

            this.uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                this.uploadArea.classList.remove('dragover');
                // 拖拽文件暂时不支持，显示提示
                this.showError('请点击选择文件，暂不支持拖拽');
            });

            // 设置事件（复选框与整行均可点击）
            const enableItem = this.enableTranslation.closest('.setting-item');
            const theaterItem = this.theaterMode.closest('.setting-item');

            const onToggleTranslation = (e) => {
                // 避免在编辑目标语言时误触
                if (e && e.target && (e.target.id === 'targetLanguage')) return;
                this.toggleCheckbox(this.enableTranslation);
                this.updateLanguageGroupVisibility();
                this.saveSettings();
                this.updateStartButton();
            };
            const onToggleTheater = () => {
                this.toggleCheckbox(this.theaterMode);
                this.saveSettings();
            };

            this.enableTranslation.addEventListener('click', (e) => { e.stopPropagation(); onToggleTranslation(e); });
            this.theaterMode.addEventListener('click', (e) => { e.stopPropagation(); onToggleTheater(); });
            if (enableItem) enableItem.addEventListener('click', onToggleTranslation);
            if (theaterItem) theaterItem.addEventListener('click', onToggleTheater);

            // 输出路径选择
            this.browseOutputBtn.addEventListener('click', () => {
                this.selectOutputPath();
            });

            // 按钮事件
            this.startProcessBtn.addEventListener('click', () => {
                this.startProcessing();
            });

            this.clearBtn.addEventListener('click', () => {
                this.clearSelection();
            });

            this.exportBtn.addEventListener('click', () => {
                this.exportResults();
            });

            // 监听设置变化
            // 语言选择变化时保存，并切换自定义输入框
            this.targetLanguage.addEventListener('change', () => {
                this.updateCustomLanguageVisibility();
                this.saveSettings();
            });
            this.customLanguage.addEventListener('input', () => {
                this.saveSettings();
            });

            console.log('所有事件绑定完成');
        } catch (error) {
            console.error('事件绑定失败:', error);
        }
    }

    async selectFile() {
        try {
            const result = await window.electronAPI.selectMediaFile();
            if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
                const filePath = result.filePaths[0];
                this.handleFileSelect(filePath);
            }
        } catch (error) {
            console.error('选择文件失败:', error);
            this.showError('选择文件失败: ' + error.message);
        }
    }

    handleFileSelect(filePath) {
        this.selectedFile = {
            path: filePath,
            name: filePath.split('\\').pop().split('/').pop(), // 提取文件名
            size: 0 // 文件大小暂时设为0，可以在主进程中获取
        };

        // 显示文件信息
        this.fileName.textContent = this.selectedFile.name;
        this.fileSize.textContent = '已选择'; // 暂时不显示大小
        this.fileInfo.style.display = 'block';

        // 更新上传区域
        this.uploadArea.style.display = 'none';

        // 启用开始按钮
        this.updateStartButton();

        console.log('文件已选择:', filePath);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    toggleCheckbox(checkbox) {
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
    }

    updateCustomLanguageVisibility() {
        const useCustom = this.targetLanguage.value === '__custom__';
        this.customLanguage.style.display = useCustom ? 'block' : 'none';
    }

    async selectOutputPath() {
        try {
            const baseName = this.selectedFile?.name || '';
            const result = await window.electronAPI.selectOutputPath({ baseName });
            if (result && !result.canceled && result.filePath) {
                this.outputPath.value = result.filePath;
                this.updateStartButton();
            }
        } catch (error) {
            console.error('选择输出路径失败:', error);
            this.showError('选择输出路径失败: ' + error.message);
        }
    }

    updateStartButton() {
        const hasFile = this.selectedFile !== null;
        const hasOutputPath = this.outputPath.value.trim() !== '';
        const canStart = hasFile && hasOutputPath && !this.isProcessing;
        
        this.startProcessBtn.disabled = !canStart;
    }

    async startProcessing() {
        if (!this.selectedFile || !this.outputPath.value.trim()) {
            this.showError('请选择文件和输出路径');
            return;
        }

        // 校验自定义语言
        const translationEnabled = this.enableTranslation.classList.contains('checked');
        if (translationEnabled && this.targetLanguage && this.targetLanguage.value === '__custom__') {
            const custom = (this.customLanguage?.value || '').trim();
            if (!custom) {
                this.showError('请输入自定义目标语言');
                this.customLanguage?.focus();
                return;
            }
        }

        this.isProcessing = true;
        this.startProcessBtn.disabled = true;
        this.results = [];
        this.updateResultsDisplay();

        try {
            // 显示进度
            this.showProgress('准备处理...');

            // 获取设置
            const settings = {
                enableTranslation: this.enableTranslation.classList.contains('checked'),
                targetLanguage: this.resolveTargetLanguage(),
                theaterMode: this.theaterMode.classList.contains('checked'),
                outputPath: this.outputPath.value.trim()
            };

            console.log('开始处理文件:', this.selectedFile.name, settings);

            // 调用主进程处理文件
            const result = await window.electronAPI.processMediaFile({
                filePath: this.selectedFile.path,
                settings: settings
            });

            if (result.success) {
                console.log('文件处理完成');
                this.showProgress('处理完成');
                this.exportBtn.disabled = false;
            } else {
                console.error('文件处理失败:', result.error);
                this.showError('处理失败: ' + result.error);
            }

        } catch (error) {
            console.error('处理过程中出现错误:', error);
            this.showError('处理过程中出现错误: ' + error.message);
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
                <div class="empty-icon">❌</div>
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
                    <div>处理结果将显示在这里</div>
                </div>
            `;
            return;
        }

        const resultsHtml = this.results.map((result, index) => `
            <div class="result-item">
                <div class="result-header">
                    <div class="segment-number">段落 ${index + 1}</div>
                </div>
                <div class="result-text">
                    <div class="transcription">${result.transcription || ''}</div>
                    ${result.translation ? `<div class="translation">${result.translation}</div>` : ''}
                </div>
            </div>
        `).join('');

        this.resultsContent.innerHTML = resultsHtml;
    }

    async exportResults() {
        if (this.results.length === 0) {
            this.showError('没有可导出的结果');
            return;
        }

        try {
            const result = await window.electronAPI.exportResults({
                results: this.results,
                outputPath: this.outputPath.value
            });

            if (result.success) {
                console.log('导出成功:', result.exportPath);
                // 可以显示成功提示
            } else {
                this.showError('导出失败: ' + result.error);
            }
        } catch (error) {
            console.error('导出失败:', error);
            this.showError('导出失败: ' + error.message);
        }
    }

    clearSelection() {
        this.selectedFile = null;
        this.results = [];
        
        // 重置文件选择
        this.fileInfo.style.display = 'none';
        this.uploadArea.style.display = 'block';

        // 重置结果显示
        this.updateResultsDisplay();

        // 重置按钮状态
        this.exportBtn.disabled = true;
        this.updateStartButton();

        console.log('已清除选择');
    }

    loadSettings() {
        // 从本地存储加载设置
        try {
            const savedSettings = localStorage.getItem('mediaTranscribeSettings');
            if (savedSettings) {
                const settings = JSON.parse(savedSettings);
                
                // 应用设置
                if (settings.enableTranslation !== undefined) {
                    if (settings.enableTranslation) {
                        this.enableTranslation.classList.add('checked');
                        this.enableTranslation.innerHTML = '<span>✓</span>';
                    } else {
                        this.enableTranslation.classList.remove('checked');
                        this.enableTranslation.innerHTML = '';
                    }
                }

                if (settings.targetLanguage) {
                    // 如果目标语言不在下拉选项中，切换为自定义
                    const options = Array.from(this.targetLanguage.options).map(o => o.value);
                    if (options.includes(settings.targetLanguage)) {
                        this.targetLanguage.value = settings.targetLanguage;
                        this.customLanguage.style.display = 'none';
                    } else {
                        this.targetLanguage.value = '__custom__';
                        this.customLanguage.value = settings.targetLanguage;
                        this.customLanguage.style.display = 'block';
                    }
                }

                if (settings.theaterMode !== undefined) {
                    if (settings.theaterMode) {
                        this.theaterMode.classList.add('checked');
                        this.theaterMode.innerHTML = '<span>✓</span>';
                    } else {
                        this.theaterMode.classList.remove('checked');
                        this.theaterMode.innerHTML = '';
                    }
                }

                if (settings.outputPath) {
                    this.outputPath.value = settings.outputPath;
                }
            }
        } catch (error) {
            console.warn('加载设置失败:', error);
        }

        this.updateLanguageGroupVisibility();
        this.updateCustomLanguageVisibility();
        this.updateStartButton();
    }

    saveSettings() {
        try {
            const settings = {
                enableTranslation: this.enableTranslation.classList.contains('checked'),
                targetLanguage: (this.targetLanguage.value === '__custom__' ? this.customLanguage.value.trim() : this.targetLanguage.value.trim()),
                theaterMode: this.theaterMode.classList.contains('checked'),
                outputPath: this.outputPath.value.trim()
            };

            localStorage.setItem('mediaTranscribeSettings', JSON.stringify(settings));
        } catch (error) {
            console.warn('保存设置失败:', error);
        }
    }

    resolveTargetLanguage() {
        return (this.targetLanguage.value === '__custom__'
            ? (this.customLanguage.value || '').trim() || '中文'
            : (this.targetLanguage.value || '中文'));
    }
}

// 等待DOM加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM加载完成，开始初始化媒体转写应用');
    
    // 检查是否支持Electron API
    if (typeof window.electronAPI === 'undefined') {
        console.error('Electron API 不可用');
        document.body.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; color: #e74c3c;">
                <div>
                    <h2>错误</h2>
                    <p>此页面需要在 Electron 环境中运行</p>
                </div>
            </div>
        `;
        return;
    }

    try {
        // 初始化应用
        console.log('创建MediaTranscribeApp实例');
        const app = new MediaTranscribeApp();
        console.log('MediaTranscribeApp初始化成功');

        // 监听主进程消息
        if (window.electronAPI.onMediaProgress) {
            window.electronAPI.onMediaProgress((message) => {
                console.log('收到进度消息:', message);
                
                if (message.type === 'progress') {
                    app.showProgress(message.message, message.progress || 0);
                } else if (message.type === 'result') {
                    app.addResult({
                        transcription: message.transcription,
                        translation: message.translation
                    });
                } else if (message.type === 'error') {
                    app.showError(message.message);
                } else if (message.type === 'complete') {
                    app.showProgress('处理完成', 100);
                    app.exportBtn.disabled = false;
                }
            });
        }

        // 保存设置当页面卸载时
        window.addEventListener('beforeunload', () => {
            app.saveSettings();
        });

        console.log('媒体转写应用已初始化');
        
    } catch (error) {
        console.error('初始化应用失败:', error);
        document.body.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; color: #e74c3c;">
                <div>
                    <h2>初始化错误</h2>
                    <p>应用初始化失败: ${error.message}</p>
                </div>
            </div>
        `;
    }
});
