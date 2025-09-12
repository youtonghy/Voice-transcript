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
  
  onPythonMessage: (callback) => {
    ipcRenderer.on('python-message', (event, message) => callback(message));
  },
  
  onMediaProgress: (callback) => {
    ipcRenderer.on('media-progress', (event, message) => callback(message));
  },
  
  removePythonMessageListener: () => {
    ipcRenderer.removeAllListeners('python-message');
  },
  
  removeMediaProgressListener: () => {
    ipcRenderer.removeAllListeners('media-progress');
  }
});
