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
  
  onPythonMessage: (callback) => {
    ipcRenderer.on('python-message', (event, message) => callback(message));
  },
  
  removePythonMessageListener: () => {
    ipcRenderer.removeAllListeners('python-message');
  }
});