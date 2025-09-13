import 'package:flutter/material.dart';
import 'package:vtt_flutter/models/app_settings.dart';
import 'package:vtt_flutter/services/settings_repository.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  static const String routeName = '/settings';

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final _repo = SettingsRepository();
  AppSettings? _settings;
  bool _obscureApiKey = true;

  // Controllers for OpenAI fields
  final _apiKeyCtrl = TextEditingController();
  final _baseUrlCtrl = TextEditingController();
  final _transcribeModelCtrl = TextEditingController();
  final _translateModelCtrl = TextEditingController();
  // VAD controllers
  final _silenceDbCtrl = TextEditingController();
  final _silenceRmsCtrl = TextEditingController();
  final _minSilenceMsCtrl = TextEditingController();
  final _minChunkMsCtrl = TextEditingController();
  final _ampWindowMsCtrl = TextEditingController();
  final _preRollMsCtrl = TextEditingController();
  final _onsetMsCtrl = TextEditingController();
  bool _useRms = false;
  // Translation
  final _translateTargetCtrl = TextEditingController();
  bool _translateEnabled = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _apiKeyCtrl.dispose();
    _baseUrlCtrl.dispose();
    _transcribeModelCtrl.dispose();
    _translateModelCtrl.dispose();
    _silenceDbCtrl.dispose();
    _silenceRmsCtrl.dispose();
    _minSilenceMsCtrl.dispose();
    _minChunkMsCtrl.dispose();
    _ampWindowMsCtrl.dispose();
    _preRollMsCtrl.dispose();
    _onsetMsCtrl.dispose();
    _translateTargetCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final s = await _repo.load();
    setState(() {
      _settings = s;
      _apiKeyCtrl.text = s.openAI.apiKey;
      _baseUrlCtrl.text = s.openAI.baseUrl;
      _transcribeModelCtrl.text = s.openAI.transcribeModel;
      _translateModelCtrl.text = s.openAI.translateModel;
      _silenceDbCtrl.text = s.vad.silenceDb.toStringAsFixed(1);
      _silenceRmsCtrl.text = s.vad.silenceRms.toStringAsFixed(3);
      _minSilenceMsCtrl.text = s.vad.minSilenceMs.toString();
      _minChunkMsCtrl.text = s.vad.minChunkMs.toString();
      _ampWindowMsCtrl.text = s.vad.amplitudeWindowMs.toString();
      _preRollMsCtrl.text = s.vad.preRollMs.toString();
      _onsetMsCtrl.text = s.vad.onsetMs.toString();
      _useRms = s.vad.useRms;
      _translateEnabled = s.translation.enabled;
      _translateTargetCtrl.text = s.translation.targetLanguage;
    });
  }

  Future<void> _save(void Function(AppSettings) mutate) async {
    if (_settings == null) return;
    mutate(_settings!);
    setState(() {});
    await _repo.save(_settings!);
  }

  @override
  Widget build(BuildContext context) {
    final s = _settings;
    return Scaffold(
      appBar: AppBar(
        title: const Text('设置'),
      ),
      body: s == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text('模型', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                DropdownButtonFormField<ProviderType>(
                  value: s.provider,
                  items: const [
                    DropdownMenuItem(
                      value: ProviderType.openai,
                      child: Text('openai'),
                    ),
                  ],
                  onChanged: (val) {
                    if (val == null) return;
                    _save((x) => x.provider = val);
                  },
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                if (s.provider == ProviderType.openai) _buildOpenAISection(context, s),
                const SizedBox(height: 24),
                Text('人声检测', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: _useRms
                        ? TextField(
                            controller: _silenceRmsCtrl,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            decoration: const InputDecoration(
                              labelText: '静音阈值 (RMS 0-1)',
                              hintText: '0.010',
                              border: OutlineInputBorder(),
                            ),
                            onChanged: (v) => _save((x) => x.vad.silenceRms = double.tryParse(v.trim()) ?? x.vad.silenceRms),
                          )
                        : TextField(
                            controller: _silenceDbCtrl,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            decoration: const InputDecoration(
                              labelText: '静音阈值 (dB)',
                              hintText: '-45.0',
                              border: OutlineInputBorder(),
                            ),
                            onChanged: (v) => _save((x) => x.vad.silenceDb = double.tryParse(v.trim()) ?? x.vad.silenceDb),
                          )),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _minSilenceMsCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: '静音持续 (ms)',
                          hintText: '1000',
                          border: OutlineInputBorder(),
                        ),
                        onChanged: (v) => _save((x) => x.vad.minSilenceMs = int.tryParse(v.trim()) ?? x.vad.minSilenceMs),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _preRollMsCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: '预录时长 (ms)',
                          hintText: '1000',
                          border: OutlineInputBorder(),
                        ),
                        onChanged: (v) => _save((x) => x.vad.preRollMs = int.tryParse(v.trim()) ?? x.vad.preRollMs),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _onsetMsCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: '起始确认 (ms)',
                          hintText: '120',
                          border: OutlineInputBorder(),
                        ),
                        onChanged: (v) => _save((x) => x.vad.onsetMs = int.tryParse(v.trim()) ?? x.vad.onsetMs),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('使用 RMS 阈值'),
                  subtitle: const Text('开启后按 RMS (0~1) 判定静音，默认 0.010 ≈ -40 dB'),
                  value: _useRms,
                  onChanged: (val) {
                    setState(() => _useRms = val);
                    _save((x) => x.vad.useRms = val);
                  },
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _minChunkMsCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: '最短片段 (ms)',
                          hintText: '1500',
                          border: OutlineInputBorder(),
                        ),
                        onChanged: (v) => _save((x) => x.vad.minChunkMs = int.tryParse(v.trim()) ?? x.vad.minChunkMs),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _ampWindowMsCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: '采样间隔 (ms)',
                          hintText: '120',
                          border: OutlineInputBorder(),
                        ),
                        onChanged: (v) => _save((x) => x.vad.amplitudeWindowMs = int.tryParse(v.trim()) ?? x.vad.amplitudeWindowMs),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                Text('翻译', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('启用自动翻译'),
                  value: _translateEnabled,
                  onChanged: (val) {
                    setState(() => _translateEnabled = val);
                    _save((x) => x.translation.enabled = val);
                  },
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _translateTargetCtrl,
                  decoration: const InputDecoration(
                    labelText: '目标语言',
                    hintText: 'English / Chinese / Japanese ...',
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (v) => _save((x) => x.translation.targetLanguage = v.trim()),
                ),
              ],
            ),
    );
  }

  Widget _buildOpenAISection(BuildContext context, AppSettings s) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('OpenAI 设置', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _apiKeyCtrl,
          obscureText: _obscureApiKey,
          decoration: InputDecoration(
            labelText: 'API Key',
            border: const OutlineInputBorder(),
            suffixIcon: IconButton(
              icon: Icon(_obscureApiKey ? Icons.visibility : Icons.visibility_off),
              onPressed: () => setState(() => _obscureApiKey = !_obscureApiKey),
              tooltip: _obscureApiKey ? '显示' : '隐藏',
            ),
          ),
          onChanged: (v) => _save((x) => x.openAI.apiKey = v.trim()),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _baseUrlCtrl,
          decoration: const InputDecoration(
            labelText: 'API 地址',
            hintText: 'https://api.openai.com/v1/',
            border: OutlineInputBorder(),
          ),
          onChanged: (v) => _save((x) => x.openAI.baseUrl = v.trim()),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _transcribeModelCtrl,
          decoration: const InputDecoration(
            labelText: '转写模型',
            hintText: 'gpt-4o-transcribe',
            border: OutlineInputBorder(),
          ),
          onChanged: (v) => _save((x) => x.openAI.transcribeModel = v.trim()),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _translateModelCtrl,
          decoration: const InputDecoration(
            labelText: '翻译模型',
            hintText: 'gpt-4o-mini',
            border: OutlineInputBorder(),
          ),
          onChanged: (v) => _save((x) => x.openAI.translateModel = v.trim()),
        ),
      ],
    );
  }
}
