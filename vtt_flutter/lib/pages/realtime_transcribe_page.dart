import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:vtt_flutter/models/app_settings.dart';
import 'package:vtt_flutter/services/openai_client.dart';
import 'package:vtt_flutter/services/settings_repository.dart';
import 'package:vtt_flutter/services/permission_service.dart';
import 'package:vtt_flutter/utils/wav_utils.dart';

class RealtimeTranscribePage extends StatefulWidget {
  const RealtimeTranscribePage({super.key});

  static const String routeName = '/realtime';

  @override
  State<RealtimeTranscribePage> createState() => _RealtimeTranscribePageState();
}

class _RealtimeTranscribePageState extends State<RealtimeTranscribePage> {
  final ScrollController _scrollController = ScrollController();
  final ScrollController _logScrollController = ScrollController();
  final SettingsRepository _settingsRepo = SettingsRepository();
  AppSettings? _settings;

  // Recorder
  final AudioRecorder _recorder = AudioRecorder();
  StreamSubscription<Amplitude>? _ampSub;
  bool _isRecording = false;
  // Whether we are in listening-only mode (no active file being written)
  bool _isListeningOnly = false;
  // Guard flag to avoid starting multiple segments concurrently
  bool _startingSegment = false;
  bool _cutting = false;
  String? _currentPath;
  String? _listeningPath; // temp file path used while listening-only
  DateTime? _segmentStartAt;
  int _silenceAccumMs = 0;
  // VAD state (RMS-based)
  bool _speechActive = false; // whether we are inside an active speech segment
  DateTime? _lastVoiceAt; // last time voice was detected
  DateTime? _firstVoiceAt; // first above-threshold time in current segment
  DateTime? _firstVoiceCandidateAt; // above-threshold time during onset confirmation
  int _speechOnsetMsAccum = 0; // accumulated ms above threshold for onset confirmation
  // double? _emaDb; // smoothed dB value for logging only
  double? _emaDb;        // 日志用平滑电平
  double? _noiseFloorDb; // 自适应噪声底（EMA）

  String? _preRollCachePath; // last segment's tail for pre-roll bridging

  // Messages
  int _nextMsgId = 1;
  final List<_TranscribeMessage> _messages = [];

  // Ordered processing queue to ensure FIFO upload/output
  final List<_SegmentJob> _pendingJobs = [];
  bool _processingJobs = false;

  // Debug logging
  bool _logMode = false; // whether to show realtime VAD logs
  final List<String> _logLines = [];
  DateTime? _lastLogAt; // last time we emitted a periodic level log

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  @override
  void dispose() {
    _ampSub?.cancel();
    _scrollController.dispose();
    _logScrollController.dispose();
    _recorder.dispose();
    super.dispose();
  }

  Future<void> _loadSettings() async {
    final s = await _settingsRepo.load();
    if (!mounted) return;
    setState(() => _settings = s);
  }

  void _toggleRecording() {
    if (_isRecording) {
      _stopRecording();
    } else {
      _startRecording();
    }
  }

  Future<void> _startRecording() async {
    final s = _settings;
    if (s == null) {
      await _loadSettings();
    }
    // Ask runtime permission explicitly
    final ok = await PermissionService.ensureMicPermission(context);
    if (!ok) return;
    setState(() {
      _isRecording = true;
    });
    await _startNewSegment();
  }

  Future<void> _stopRecording() async {
    setState(() {
      _isRecording = false;
    });
    // Finalize last segment if any, otherwise stop listening-only recorder
    if (_currentPath != null) {
      await _finalizeSegment(force: true);
    } else {
      try {
        _ampSub?.cancel();
        _ampSub = null;
      } catch (_) {}
      try {
        if (await _recorder.isRecording()) {
          await _recorder.stop();
        }
      } catch (_) {}
      if (_listeningPath != null) {
        try { await File(_listeningPath!).delete(); } catch (_) {}
        _listeningPath = null;
      }
      _isListeningOnly = false;
      _speechActive = false;
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    });
  }

  void _scrollLogsToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_logScrollController.hasClients) return;
      _logScrollController.jumpTo(
        _logScrollController.position.maxScrollExtent,
      );
    });
  }

  String _two(int n) => n.toString().padLeft(2, '0');

  void _appendLog(String line) {
    final now = DateTime.now();
    final ts = '${_two(now.hour)}:${_two(now.minute)}:${_two(now.second)}.${now.millisecond.toString().padLeft(3, '0')}';
    final entry = '[$ts] $line';
    if (_logMode) {
      setState(() {
        _logLines.add(entry);
        if (_logLines.length > 300) {
          _logLines.removeRange(0, _logLines.length - 300);
        }
      });
      _scrollLogsToBottom();
    } else {
      // Accumulate logs even when hidden so that once shown, history is available
      _logLines.add(entry);
      if (_logLines.length > 300) {
        _logLines.removeRange(0, _logLines.length - 300);
      }
    }
  }

  Future<void> _startNewSegment() async {
    final vad = _settings?.vad ?? VADSettings();
    // Start listening-only: no active file, just amplitude monitoring
    _isListeningOnly = true;
    _currentPath = null;
    _segmentStartAt = null;
    _silenceAccumMs = 0;
    _emaDb = null;
    _speechActive = false;
    _lastVoiceAt = null;
    _firstVoiceAt = null;
    _firstVoiceCandidateAt = null;
    _speechOnsetMsAccum = 0;
    _lastLogAt = null;

    _ampSub?.cancel();
    final dir = await getTemporaryDirectory();
    final listenName = 'listen_${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(1 << 16)}.wav';
    final listenPath = '${dir.path}/$listenName';
    _listeningPath = listenPath;

    // await _recorder.start(
    //   RecordConfig(
    //     encoder: AudioEncoder.wav,
    //     sampleRate: 16000,
    //     numChannels: 1,
    //   ),
    //   path: listenPath,
    // );

     await _recorder.start(
         RecordConfig(
               encoder: AudioEncoder.wav,
                sampleRate: 16000,
                 numChannels: 1,
                 autoGain: false,
                 echoCancel: false,
                 noiseSuppress: false,
                 androidConfig: const AndroidRecordConfig(
                   audioSource: AndroidAudioSource.voiceRecognition,
                   audioManagerMode: AudioManagerMode.modeInCommunication,
                   useLegacy: false,
                   manageBluetooth: true,
                   speakerphone: false,
                 ),
           ),
       path: listenPath,
     );


    _ampSub = _recorder
        .onAmplitudeChanged(Duration(milliseconds: vad.amplitudeWindowMs))
        .listen((amp) => _onAmplitudeRmsSimplified(amp, vad));
  }

  Future<void> _beginSegmentRecording() async {
    if (_startingSegment) return;
    _startingSegment = true;
    try {
      // Stop listening-only recorder if running
      try {
        _ampSub?.cancel();
        _ampSub = null;
      } catch (_) {}
      try {
        if (await _recorder.isRecording()) {
          await _recorder.stop();
        }
      } catch (_) {}
      // Cleanup listening-only temp file if present
      if (_listeningPath != null) {
        try { await File(_listeningPath!).delete(); } catch (_) {}
        _listeningPath = null;
      }

      final dir = await getTemporaryDirectory();
      final filename = 'segment_${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(1 << 16)}.wav';
      final path = '${dir.path}/$filename';

      await _recorder.start(
        RecordConfig(
          encoder: AudioEncoder.wav,
          sampleRate: 16000,
          numChannels: 1,
        ),
        path: path,
      );
      _currentPath = path;
      _segmentStartAt = DateTime.now();
      _firstVoiceAt = _segmentStartAt; // start from onset
      _speechActive = true;
      _isListeningOnly = false;
      _silenceAccumMs = 0;

      final vad = _settings?.vad ?? VADSettings();
      _ampSub = _recorder
          .onAmplitudeChanged(Duration(milliseconds: vad.amplitudeWindowMs))
          .listen((amp) => _onAmplitudeRmsSimplified(amp, vad));
      _appendLog('[VAD] 检测到语音，开始录音');
    } finally {
      _startingSegment = false;
    }
  }

  Future<void> _finalizeSegment({bool force = false}) async {
    if (_cutting) return;
    final path = _currentPath;
    if (path == null) return;
    _cutting = true;
    try {
      final DateTime finalizeAt = DateTime.now();
      final DateTime? segStartAt = _segmentStartAt;
      final DateTime? firstAt = _firstVoiceAt;
      final stoppedPath = await _recorder.stop();
      _ampSub?.cancel();
      _ampSub = null;
      _currentPath = null;
      final startAt = _segmentStartAt;
      _segmentStartAt = null;
      final durationMs = startAt == null
          ? 0
          : DateTime.now().difference(startAt).inMilliseconds;

      // If too short and not forced, drop. In forced stop, always process.
      final bool silentOnly = firstAt == null;
      if (!force && (silentOnly || durationMs < max(300, (_settings?.vad.minChunkMs ?? 1500) ~/ 3))) {
        if (stoppedPath != null) {
          // cleanup
          try {
            await File(stoppedPath).delete();
          } catch (_) {}
        }
      } else {
        final filePath = stoppedPath ?? path;
        // Prepare pre-roll cache (tail of this segment) for next segment bridging
        if (!silentOnly) {
          try {
            final s = _settings ?? await _settingsRepo.load();
            final preStart = (durationMs - s.vad.preRollMs).clamp(0, durationMs);
            _preRollCachePath = await trimWav(filePath, startMs: preStart, endMs: durationMs);
          } catch (_) {}
        }

        final bool shouldProcess = !silentOnly || force;
        if (shouldProcess) {
          final messageId = _nextMsgId++;
          setState(() {
            _messages.add(_TranscribeMessage(id: messageId, status: _MsgStatus.processing));
          });
          _scrollToBottom();
          // Enqueue for ordered processing (transcription + translation)
          _enqueueSegment(messageId, filePath, segStartAt, finalizeAt, firstAt);
          _appendLog('片段 #$messageId 已生成，开始转写队列处理');
        } else {
          // Silent-only and not forced: cleanup
          try { await File(filePath).delete(); } catch (_) {}
        }
      }
    } finally {
      _cutting = false;
      if (_isRecording) {
        await _startNewSegment();
      }
    }
  }

  

  // Simplified RMS-based segmentation aligned with transcribe_service.py
  void _onAmplitudeRmsSimplified(Amplitude amp, VADSettings vad) {
    final now = DateTime.now();
    final segStart = _segmentStartAt ?? now;
    final ln10 = log(10);

    // 统一把各种输入转成 RMS 和 dBFS
    double raw = amp.current;
    if (raw.isNaN || raw.isInfinite) raw = 0.0;

    double curRms, curDb;
    if (raw < 0) {
      // dBFS -> RMS
      curDb = raw;
      curRms = pow(10, raw / 20).toDouble();
    } else if (raw <= 1.0) {
      curRms = raw.clamp(0.0, 1.0);
      curDb = curRms > 0 ? 20 * (log(curRms) / ln10) : -120.0;
    } else {
      // 16-bit PCM 振幅
      curRms = (raw / 32767.0).clamp(0.0, 1.0);
      curDb = curRms > 0 ? 20 * (log(curRms) / ln10) : -120.0;
    }

    _emaDb = _emaDb == null ? curDb : (0.2 * curDb + 0.8 * _emaDb!);

    // 静态阈值统一转 dB
    final double staticThrDb = vad.useRms
        ? (vad.silenceRms > 0 ? 20 * (log(vad.silenceRms) / ln10) : -120.0)
        : vad.silenceDb;

    // 仅在“静音侧”更新噪声底（EMA）
    if (curDb < staticThrDb) {
      _noiseFloorDb = _noiseFloorDb == null ? curDb : (0.95 * _noiseFloorDb! + 0.05 * curDb);
    }

    // 自适应阈值：max(静态阈值, 噪声底+10 dB)
    final double thrDb = max(staticThrDb, (_noiseFloorDb ?? staticThrDb) + 10);
    final double thrRms = pow(10, thrDb / 20).toDouble();

    final bool above = vad.useRms
        ? (curRms >= max(vad.silenceRms, thrRms))
        : (curDb >= thrDb);

    // 监听阶段：只负责拉起录音
    if (_currentPath == null) {
      if (above) {
        _appendLog('[VAD] 达到阈值，准备开始录音 (RMS=${curRms.toStringAsFixed(3)}, dB=${curDb.toStringAsFixed(1)}, thr=${thrDb.toStringAsFixed(1)} dB)');
        unawaited(_beginSegmentRecording());
      }
      return;
    }

    // 已在录音：维护说话/静音状态并断句
    if (above) {
      _lastVoiceAt = now;
      _silenceAccumMs = 0;
      if (!_speechActive) {
        _speechActive = true;
        _firstVoiceAt ??= now;
        _appendLog('[VAD] 识别说话开始 (dB=${curDb.toStringAsFixed(1)}, thr=${thrDb.toStringAsFixed(1)})');
      }
    } else {
      _silenceAccumMs += vad.amplitudeWindowMs;
      if (_speechActive && _silenceAccumMs == vad.amplitudeWindowMs) {
        _appendLog('[VAD] 进入静音窗口 (dB=${curDb.toStringAsFixed(1)}, thr=${thrDb.toStringAsFixed(1)})');
      }
      // 从未检测到语音且持续静音太久，直接滚动新片段，避免“死段”
      if (!_speechActive) {
        final int silentSinceStart = now.difference(segStart).inMilliseconds;
        if (silentSinceStart >= vad.minSilenceMs) {
          _appendLog('[cut] 长时间静音 (>= ${vad.minSilenceMs} ms)，分段');
          unawaited(_finalizeSegment());
          return;
        }
      }
    }

    // 语音结束：静音累计达到阈值就切段
    if (_speechActive && _silenceAccumMs >= vad.minSilenceMs) {
      _appendLog('[cut] 语音结束，静音 ${_silenceAccumMs} ms，分段');
      unawaited(_finalizeSegment());
    }
  }


  // void _onAmplitudeRmsSimplified(Amplitude amp, VADSettings vad) {
  //   final now = DateTime.now();
  //   final segStart = _segmentStartAt ?? now;
  //   final ln10 = log(10);
  //
  //   // Convert amplitude to RMS [0,1] and dB for logging only
  //   double raw = amp.current;
  //   double curRms;
  //   if (raw < 0) {
  //     curRms = pow(10, raw / 20).toDouble(); // raw is dBFS
  //   } else if (raw <= 1.0) {
  //     curRms = raw; // normalized amplitude
  //   } else {
  //     curRms = (raw / 32767.0); // PCM magnitude
  //   }
  //   if (curRms.isNaN || curRms.isInfinite) curRms = 0.0;
  //   curRms = curRms.clamp(0.0, 1.0);
  //   final double curDb = curRms > 0 ? 20 * (log(curRms) / ln10) : -120.0;
  //   _emaDb = _emaDb == null ? curDb : (0.2 * curDb + 0.8 * _emaDb!);
  //
  //   // Periodic level log (once per second)
  //   if (_logMode) {
  //     if (_lastLogAt == null || now.difference(_lastLogAt!).inMilliseconds >= 1000) {
  //       _lastLogAt = now;
  //       final thrStr = vad.useRms
  //           ? '阈RMS=${vad.silenceRms.toStringAsFixed(3)}'
  //           : '阈dB=${vad.silenceDb.toStringAsFixed(1)}';
  //       _appendLog('电平 dB=${(_emaDb ?? curDb).toStringAsFixed(1)}  RMS=${curRms.toStringAsFixed(3)}  $thrStr  活动=${_speechActive ? "是" : "否"}');
  //     }
  //   }
  //
  //   // Voice activity by chosen threshold (RMS or dB)
  //   final bool above = vad.useRms ? (curRms >= vad.silenceRms) : (curDb >= vad.silenceDb);
  //   // Listening-only: only start a segment when threshold is met
  //   if (_currentPath == null) {
  //     if (above) {
  //       _appendLog('[VAD] 达到阈值，准备开始录音 (RMS=${curRms.toStringAsFixed(3)}, dB=${curDb.toStringAsFixed(1)})');
  //       unawaited(_beginSegmentRecording());
  //     }
  //     return;
  //   }
  //   if (above) {
  //     _lastVoiceAt = now;
  //     _silenceAccumMs = 0;
  //     if (!_speechActive) {
  //       // Immediate speech onset when crossing threshold (no extra confirmation),
  //       // consistent with transcribe_service.py
  //       _speechActive = true;
  //       _firstVoiceAt ??= now;
  //       _appendLog('[VAD] 识别说话开始 (RMS=${curRms.toStringAsFixed(3)}, dB=${curDb.toStringAsFixed(1)})');
  //     }
  //   } else {
  //     _speechOnsetMsAccum = 0;
  //     _firstVoiceCandidateAt = null;
  //     _silenceAccumMs += vad.amplitudeWindowMs;
  //     if (_speechActive && _silenceAccumMs == vad.amplitudeWindowMs) {
  //       // First tick of going below threshold while active
  //       _appendLog('[VAD] 进入静音窗口 (RMS=${curRms.toStringAsFixed(3)}, dB=${curDb.toStringAsFixed(1)})');
  //     }
  //
  //     // If never detected speech and long silent, rotate silently
  //     if (!_speechActive) {
  //       final int silentSinceStart = now.difference(segStart).inMilliseconds;
  //       if (silentSinceStart >= vad.minSilenceMs) {
  //         _appendLog('[cut] 长时间静音 (>= ${vad.minSilenceMs} ms)，分段');
  //         unawaited(_finalizeSegment());
  //         return;
  //       }
  //     }
  //   }
  //
  //   // Finalize when inside speech and silence sustained (no min-chunk gating),
  //   // consistent with transcribe_service.py
  //   if (_speechActive && _silenceAccumMs >= vad.minSilenceMs) {
  //     _appendLog('[cut] 语音结束，静音 ${_silenceAccumMs} ms (阈值 ${vad.minSilenceMs} ms)，分段');
  //     unawaited(_finalizeSegment());
  //   }
  // }

  Future<void> _processFile(int messageId, String filePath, DateTime? segStartAt, DateTime finalizeAt, DateTime? firstVoiceAt) async {
    var pathForUpload = filePath;
    try {
      final s = _settings ?? await _settingsRepo.load();
      _appendLog('片段 #$messageId 开始转写');
      // Trim by pre-roll if we detected speech onset within this segment
      pathForUpload = filePath;
      if (segStartAt != null && firstVoiceAt != null) {
        final startMs = firstVoiceAt.difference(segStartAt).inMilliseconds - (s.vad.preRollMs);
        final endMs = finalizeAt.difference(segStartAt).inMilliseconds;
        try {
          if (startMs >= 0) {
            // Enough pre-roll within current segment
            pathForUpload = await trimWav(filePath, startMs: startMs, endMs: endMs);
          } else if (_preRollCachePath != null) {
            // Need to bridge pre-roll from previous segment
            final currTrim = await trimWav(filePath, startMs: 0, endMs: endMs);
            final merged = await concatWav(_preRollCachePath!, currTrim);
            pathForUpload = merged;
            // cleanup temp currTrim but keep preRoll cache for next time until replaced
            try { await File(currTrim).delete(); } catch (_) {}
          } else {
            // No cache available; fall back to current segment only
            pathForUpload = await trimWav(filePath, startMs: 0, endMs: endMs);
          }
        } catch (_) {
          // Fallback to original file on parse failure
          pathForUpload = filePath;
        }
      }
      final bytes = await File(pathForUpload).readAsBytes();
      _appendLog('片段 #$messageId 上传中，大小 ${(bytes.lengthInBytes / 1024).toStringAsFixed(1)} KB');
      if (s.provider == ProviderType.openai) {
        final client = OpenAIClient(s.openAI);
        final text = await client.transcribeBytes(bytes, filename: pathForUpload.split(Platform.pathSeparator).last);
        _appendLog('片段 #$messageId 转写完成');
        _updateMessage(messageId, transcript: text, status: _MsgStatus.done);
        if (s.translation.enabled) {
          try {
            final translated = await client.translateText(text, targetLanguage: s.translation.targetLanguage);
            _updateMessage(messageId, translation: translated);
            _appendLog('片段 #$messageId 翻译完成');
          } catch (e) {
            _updateMessage(messageId, translation: '[翻译失败] $e');
            _appendLog('片段 #$messageId 翻译失败: $e');
          }
        } else {
          _appendLog('片段 #$messageId 未启用翻译');
        }
      }
    } catch (e) {
      _updateMessage(messageId, status: _MsgStatus.error, error: '$e');
      _appendLog('片段 #$messageId 处理失败: $e');
    } finally {
      // Cleanup temp file
      try { await File(filePath).delete(); } catch (_) {}
      if (pathForUpload != filePath) {
        try { await File(pathForUpload).delete(); } catch (_) {}
      }
    }
  }

  // Enqueue a finalized segment to process in FIFO order
  void _enqueueSegment(int messageId, String filePath, DateTime? segStartAt, DateTime finalizeAt, DateTime? firstVoiceAt) {
    _pendingJobs.add(_SegmentJob(
      messageId: messageId,
      filePath: filePath,
      segStartAt: segStartAt,
      finalizeAt: finalizeAt,
      firstVoiceAt: firstVoiceAt,
    ));
    // Kick worker without awaiting to keep UI reactive
    unawaited(_pumpJobs());
  }

  // Process queued segments sequentially so results follow recording order
  Future<void> _pumpJobs() async {
    if (_processingJobs) return;
    _processingJobs = true;
    try {
      while (_pendingJobs.isNotEmpty) {
        final job = _pendingJobs.removeAt(0);
        await _processFile(job.messageId, job.filePath, job.segStartAt, job.finalizeAt, job.firstVoiceAt);
      }
    } finally {
      _processingJobs = false;
    }
  }

  void _updateMessage(int id, {String? transcript, String? translation, _MsgStatus? status, String? error}) {
    final idx = _messages.indexWhere((m) => m.id == id);
    if (idx == -1) return;
    setState(() {
      final m = _messages[idx];
      if (transcript != null) m.transcript = transcript;
      if (translation != null) m.translation = translation;
      if (status != null) m.status = status;
      if (error != null) m.error = error;
    });
    _scrollToBottom();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('实时转录'),
        actions: [
          IconButton(
            onPressed: () {
              setState(() {
                _logMode = !_logMode;
                if (_logMode) {
                  _lastLogAt = null; // force immediate periodic update on next tick
                  _appendLog('日志已开启');
                } else {
                  _appendLog('日志已关闭');
                }
              });
            },
            tooltip: _logMode ? '隐藏日志' : '显示日志',
            icon: Icon(_logMode ? Icons.article : Icons.article_outlined),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Theme.of(context).dividerColor),
                  color: Theme.of(context).colorScheme.surface,
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: _messages.isEmpty
                      ? Center(
                          child: Text(
                            _isRecording
                                ? '正在录音，等待语音断句…'
                                : '点击下方“开始录音”开始实时转写',
                            style: Theme.of(context)
                                .textTheme
                                .bodyLarge
                                ?.copyWith(color: Theme.of(context).hintColor),
                          ),
                        )
                      : Scrollbar(
                          child: ListView.builder(
                            controller: _scrollController,
                            padding: const EdgeInsets.all(12),
                            itemCount: _messages.length,
                            itemBuilder: (context, index) {
                              final m = _messages[index];
                              return _MessageTile(message: m);
                            },
                          ),
                        ),
                ),
              ),
            ),
          ),
          if (_logMode)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Theme.of(context).dividerColor),
                  color: Theme.of(context).colorScheme.surface,
                ),
                child: SizedBox(
                  height: 160,
                  child: Scrollbar(
                    child: ListView.builder(
                      controller: _logScrollController,
                      padding: const EdgeInsets.all(8),
                      itemCount: _logLines.length,
                      itemBuilder: (context, i) => Text(
                        _logLines[i],
                        style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton.icon(
                  icon: Icon(_isRecording ? Icons.stop : Icons.mic),
                  label: Text(_isRecording ? '停止录音' : '开始录音'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _isRecording ? Colors.redAccent : null,
                  ),
                  onPressed: _toggleRecording,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

enum _MsgStatus { processing, done, error }

class _TranscribeMessage {
  _TranscribeMessage({required this.id, this.status = _MsgStatus.processing});

  final int id;
  _MsgStatus status;
  String? transcript;
  String? translation;
  String? error;
}

class _SegmentJob {
  _SegmentJob({
    required this.messageId,
    required this.filePath,
    required this.segStartAt,
    required this.finalizeAt,
    required this.firstVoiceAt,
  });
  final int messageId;
  final String filePath;
  final DateTime? segStartAt;
  final DateTime finalizeAt;
  final DateTime? firstVoiceAt;
}

class _MessageTile extends StatelessWidget {
  const _MessageTile({required this.message});

  final _TranscribeMessage message;

  @override
  Widget build(BuildContext context) {
    final statusText = switch (message.status) {
      _MsgStatus.processing => '识别中…',
      _MsgStatus.done => '完成',
      _MsgStatus.error => '出错',
    };
    final isError = message.status == _MsgStatus.error;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('#${message.id}', style: Theme.of(context).textTheme.labelMedium),
              const SizedBox(width: 8),
              Icon(
                isError
                    ? Icons.error_outline
                    : (message.status == _MsgStatus.processing
                        ? Icons.schedule
                        : Icons.check_circle_outline),
                size: 16,
                color: isError
                    ? Colors.redAccent
                    : (message.status == _MsgStatus.processing
                        ? Theme.of(context).hintColor
                        : Colors.green),
              ),
              const SizedBox(width: 4),
              Text(statusText, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: Theme.of(context).hintColor)),
            ],
          ),
          const SizedBox(height: 8),
          if (isError)
            Text(message.error ?? '未知错误', style: TextStyle(color: Colors.redAccent))
          else ...[
            SelectableText(
              message.transcript ?? '等待识别结果…',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            if ((message.translation ?? '').isNotEmpty) ...[
              const SizedBox(height: 8),
              const _DashedDivider(),
              const SizedBox(height: 8),
              SelectableText(
                message.translation!,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).textTheme.bodySmall?.color),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _DashedDivider extends StatelessWidget {
  const _DashedDivider({this.color, this.dashWidth = 4, this.gap = 4});
  final Color? color;
  final double dashWidth;
  final double gap;

  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).dividerColor.withOpacity(0.7);
    return LayoutBuilder(
      builder: (context, constraints) {
        final n = (constraints.maxWidth / (dashWidth + gap)).floor();
        return Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: List.generate(n, (_) => Container(width: dashWidth, height: 1, color: c)),
        );
      },
    );
  }
}
