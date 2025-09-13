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
  final SettingsRepository _settingsRepo = SettingsRepository();
  AppSettings? _settings;

  // Recorder
  final AudioRecorder _recorder = AudioRecorder();
  StreamSubscription<Amplitude>? _ampSub;
  bool _isRecording = false;
  bool _cutting = false;
  String? _currentPath;
  DateTime? _segmentStartAt;
  int _silenceAccumMs = 0;
  // VAD state
  double? _noiseFloorDb; // calibrated noise floor (dB)
  double? _emaDb; // smoothed dB level
  DateTime? _calibrationUntil; // until when to collect noise floor
  bool _speechActive = false; // are we currently in speech
  DateTime? _lastVoiceAt; // last time we detected voice
  DateTime? _firstVoiceAt; // first voice time in current segment
  DateTime? _firstVoiceCandidateAt; // first above-threshold time before confirmation
  int _speechOnsetMsAccum = 0; // accumulated ms above speech threshold
  String? _preRollCachePath; // last segment's tail for pre-roll bridging

  // Messages
  int _nextMsgId = 1;
  final List<_TranscribeMessage> _messages = [];

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  @override
  void dispose() {
    _ampSub?.cancel();
    _scrollController.dispose();
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
    // Finalize last segment if any
    await _finalizeSegment(force: true);
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

  Future<void> _startNewSegment() async {
    final vad = _settings?.vad ?? VADSettings();
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
    _silenceAccumMs = 0;
    _noiseFloorDb = null;
    _emaDb = null;
    _speechActive = false;
    _lastVoiceAt = _segmentStartAt;
    _firstVoiceAt = null;
    _firstVoiceCandidateAt = null;
    _speechOnsetMsAccum = 0;
    // Calibrate noise floor for a short time
    _calibrationUntil = _segmentStartAt!.add(Duration(milliseconds: 600));

    _ampSub?.cancel();
    _ampSub = _recorder
        .onAmplitudeChanged(Duration(milliseconds: vad.amplitudeWindowMs))
        .listen((amp) => _onAmplitude(amp, vad));
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

      // If too short and not forced, drop.
      if (!force && durationMs < max(300, (_settings?.vad.minChunkMs ?? 1500) ~/ 3)) {
        if (stoppedPath != null) {
          // cleanup
          try {
            await File(stoppedPath).delete();
          } catch (_) {}
        }
      } else {
        final filePath = stoppedPath ?? path;
        // Prepare pre-roll cache (tail of this segment) for next segment bridging
        try {
          final s = _settings ?? await _settingsRepo.load();
          final preStart = (durationMs - s.vad.preRollMs).clamp(0, durationMs);
          _preRollCachePath = await trimWav(filePath, startMs: preStart, endMs: durationMs);
        } catch (_) {}
        final messageId = _nextMsgId++;
        setState(() {
          _messages.add(_TranscribeMessage(id: messageId, status: _MsgStatus.processing));
        });
        _scrollToBottom();
        // Process transcription + translation in background
        unawaited(_processFile(messageId, filePath, segStartAt, finalizeAt, firstAt));
      }
    } finally {
      _cutting = false;
      if (_isRecording) {
        await _startNewSegment();
      }
    }
  }

  void _onAmplitude(Amplitude amp, VADSettings vad) {
    final now = DateTime.now();
    final segStart = _segmentStartAt ?? now;
    final segDuration = now.difference(segStart).inMilliseconds;

    // Normalize level to decibels (approximately)
    final ln10 = log(10);
    double db = amp.current;
    final isDb = db <= 0 && db >= -200; // heuristic
    if (!isDb) {
      // Convert linear amplitude to dB scale best-effort
      if (db > 0 && db <= 1) {
        db = 20 * (log(db) / ln10);
      } else if (db > 1) {
        db = 20 * (log(db / 32767.0) / ln10);
      } else {
        db = -120;
      }
    }
    db = (db.clamp(-120.0, -0.0001)) as double;

    // Smooth with exponential moving average
    _emaDb = _emaDb == null ? db : (0.2 * db + 0.8 * _emaDb!);

    // Calibrate noise floor for a short time at start of each segment
    if (_calibrationUntil != null && now.isBefore(_calibrationUntil!)) {
      _noiseFloorDb = _noiseFloorDb == null
          ? _emaDb
          : min(_noiseFloorDb!, _emaDb!); // take minimum (quietest) as floor
      _lastVoiceAt = now;
      return; // don't cut during calibration window
    }
    _noiseFloorDb ??= _emaDb;

    // Dynamic thresholds with hysteresis
    // Convert configured threshold to dB if using RMS mode
    double configuredSilenceDb;
    if (vad.useRms) {
      final rms = vad.silenceRms.clamp(1e-6, 1.0);
      configuredSilenceDb = 20 * (log(rms) / ln10);
    } else {
      configuredSilenceDb = vad.silenceDb;
    }
    // Silence threshold slightly above noise floor; speech threshold a bit higher
    const double noiseMarginDb = 8.0; // adjustable margin above noise
    const double hysteresisDb = 3.0; // separation between start/stop
    final double base = _noiseFloorDb ?? configuredSilenceDb;
    final double silenceThreshold = max(configuredSilenceDb, base + noiseMarginDb);
    final double speechThreshold = silenceThreshold + hysteresisDb;

    final bool speakingNow = _emaDb! > speechThreshold;
    if (speakingNow) {
      // Above speech threshold: treat as speaking
      _lastVoiceAt = now;
      _silenceAccumMs = 0;
      // If not yet active, confirm immediately or by onset window
      if (!_speechActive) {
        if (vad.onsetMs <= 0) {
          _speechActive = true;
          _firstVoiceAt ??= now;
        } else {
          _firstVoiceCandidateAt ??= now;
          _speechOnsetMsAccum += vad.amplitudeWindowMs;
          if (_speechOnsetMsAccum >= vad.onsetMs) {
            _speechActive = true;
            _firstVoiceAt ??= _firstVoiceCandidateAt ?? now;
          }
        }
      }
    } else if (_emaDb! > silenceThreshold) {
      // Crossed the silence threshold (but not speech): immediate speech start if requested
      _silenceAccumMs = 0;
      if (!_speechActive) {
        // 立即标记为语音活动开始
        _speechActive = true;
        _firstVoiceAt ??= now;
      }
      // reset onset tracking
      _speechOnsetMsAccum = 0;
      _firstVoiceCandidateAt = null;
    } else {
      // Below silence threshold: count silence, reset onset candidate
      _speechOnsetMsAccum = 0;
      _firstVoiceCandidateAt = null;
      _silenceAccumMs += vad.amplitudeWindowMs;
    }

    final bool longEnough = segDuration >= vad.minChunkMs;
    if (_speechActive && _silenceAccumMs >= vad.minSilenceMs && longEnough) {
      // Consider this a sentence boundary
      unawaited(_finalizeSegment());
    }
  }

  Future<void> _processFile(int messageId, String filePath, DateTime? segStartAt, DateTime finalizeAt, DateTime? firstVoiceAt) async {
    var pathForUpload = filePath;
    try {
      final s = _settings ?? await _settingsRepo.load();
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
      if (s.provider == ProviderType.openai) {
        final client = OpenAIClient(s.openAI);
        final text = await client.transcribeBytes(bytes, filename: pathForUpload.split(Platform.pathSeparator).last);
        _updateMessage(messageId, transcript: text, status: _MsgStatus.done);
        if (s.translation.enabled) {
          try {
            final translated = await client.translateText(text, targetLanguage: s.translation.targetLanguage);
            _updateMessage(messageId, translation: translated);
          } catch (e) {
            _updateMessage(messageId, translation: '[翻译失败] $e');
          }
        }
      }
    } catch (e) {
      _updateMessage(messageId, status: _MsgStatus.error, error: '$e');
    } finally {
      // Cleanup temp file
      try { await File(filePath).delete(); } catch (_) {}
      if (pathForUpload != filePath) {
        try { await File(pathForUpload).delete(); } catch (_) {}
      }
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
