(function () {
  if (!window.appI18n || typeof window.appI18n.extend !== 'function') {
    console.warn('[i18n] index locale loader: appI18n not ready');
    return;
  }

  window.appI18n.extend({
    en: {
      'index.title': 'Voice Transcript Studio',
      'index.tooltips.recordStart': 'Start Recording',
      'index.tooltips.voiceInput': 'Voice Input Settings',
      'index.tooltips.settings': 'Settings',
      'index.tooltips.media': 'Media File Transcription',
      'index.logTitle': 'Real-Time Logs',
      'index.buttons.exportLogs': 'Export Logs',
      'index.buttons.copyLatest': 'Copy Latest Result',
      'index.buttons.clearLogs': 'Clear Logs',
      'index.volume.current': 'Current Volume',
      'index.volume.waiting': 'Waiting For Recording',
      'index.volume.expand': 'Expand',
      'index.volume.silenceRange': 'Silence Range'
    },
    zh: {
      'index.title': '语音转写工作台',
      'index.tooltips.recordStart': '开始录音',
      'index.tooltips.voiceInput': '语音输入设置',
      'index.tooltips.settings': '设置',
      'index.tooltips.media': '媒体文件转写',
      'index.logTitle': '实时日志',
      'index.buttons.exportLogs': '导出日志',
      'index.buttons.copyLatest': '复制最新结果',
      'index.buttons.clearLogs': '清除日志',
      'index.volume.current': '当前音量',
      'index.volume.waiting': '等待录音',
      'index.volume.expand': '展开',
      'index.volume.silenceRange': '静音范围'
    }
  });

  if (typeof window.appI18n.apply === 'function') {
    window.appI18n.apply();
  }
})();
