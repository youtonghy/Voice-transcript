const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startRecording: () => ipcRenderer.invoke('start-recording'),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  openSettings: () => ipcRenderer.invoke('open-settings'),
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
