const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startRecording: () => ipcRenderer.invoke('start-recording'),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  startVoiceInput: () => ipcRenderer.invoke('start-voice-input'),
  stopVoiceInput: () => ipcRenderer.invoke('stop-voice-input'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getServiceStatus: () => ipcRenderer.invoke('get-service-status'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  openSettings: (section) => ipcRenderer.invoke('open-settings', section),
  openVoiceInputSettings: () => ipcRenderer.invoke('open-voice-input-settings'),
  openMediaTranscribe: () => ipcRenderer.invoke('open-media-transcribe'),
  getDevices: () => ipcRenderer.invoke('get-devices'),
  setDevice: (deviceId) => ipcRenderer.invoke('set-device', deviceId),
  testPython: (pythonPath) => ipcRenderer.invoke('test-python', pythonPath),
  restartPythonService: () => ipcRenderer.invoke('restart-python-service'),
  
  // 媒体转写相关API
  processMediaFile: (params) => ipcRenderer.invoke('process-media-file', params),
  selectMediaFile: () => ipcRenderer.invoke('select-media-file'),
  selectOutputPath: (params) => ipcRenderer.invoke('select-output-path', params),
  exportResults: (params) => ipcRenderer.invoke('export-results', params),
  exportLogs: (params) => ipcRenderer.invoke('export-logs', params),
  summarizeConversationTitle: (params) => ipcRenderer.invoke('summarize-conversation-title', params),
  generateSummary: (params) => ipcRenderer.invoke('generate-summary', params),
  requestTranslation: (params) => ipcRenderer.invoke('request-translation', params),
  optimizeText: (params) => ipcRenderer.invoke('optimize-text', params),
  writeClipboard: (text) => ipcRenderer.invoke('write-clipboard', text),

  onPythonMessage: (callback) => {
    ipcRenderer.on('python-message', (event, message) => callback(message));
  },
  
  onShowSettings: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const handler = (_event, section) => callback(section);
    ipcRenderer.on('show-settings-modal', handler);
    return () => {
      ipcRenderer.removeListener('show-settings-modal', handler);
    };
  },
  
  onShowVoiceInput: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const handler = () => callback();
    ipcRenderer.on('show-voice-input-modal', handler);
    return () => {
      ipcRenderer.removeListener('show-voice-input-modal', handler);
    };
  },
  
  onShowMediaTranscribe: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const handler = () => callback();
    ipcRenderer.on('show-media-transcribe-modal', handler);
    return () => {
      ipcRenderer.removeListener('show-media-transcribe-modal', handler);
    };
  },
  
  onMediaProgress: (callback) => {
    ipcRenderer.on('media-progress', (event, message) => callback(message));
  },
  
  removePythonMessageListener: () => {
    ipcRenderer.removeAllListeners('python-message');
  },
  
  removeMediaProgressListener: () => {
    ipcRenderer.removeAllListeners('media-progress');
  },

  windowControls: {
    minimize: () => ipcRenderer.invoke('window-control', 'minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window-control', 'toggle-maximize'),
    close: () => ipcRenderer.invoke('window-control', 'close')
  },

  onWindowStateChange: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('window-state-changed', handler);
    return () => {
      ipcRenderer.removeListener('window-state-changed', handler);
    };
  }
});
