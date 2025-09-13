enum ProviderType { openai }

class OpenAISettings {
  OpenAISettings({
    this.apiKey = '',
    this.baseUrl = 'https://api.openai.com/v1/',
    this.transcribeModel = 'gpt-4o-transcribe',
    this.translateModel = 'gpt-4o-mini',
  });

  String apiKey;
  String baseUrl;
  String transcribeModel;
  String translateModel;

  Map<String, Object?> toJson() => {
        'apiKey': apiKey,
        'baseUrl': baseUrl,
        'transcribeModel': transcribeModel,
        'translateModel': translateModel,
      };

  factory OpenAISettings.fromJson(Map<String, Object?> json) => OpenAISettings(
        apiKey: (json['apiKey'] as String?) ?? '',
        baseUrl: (json['baseUrl'] as String?) ?? 'https://api.openai.com/v1/',
        transcribeModel:
            (json['transcribeModel'] as String?) ?? 'gpt-4o-transcribe',
        translateModel: (json['translateModel'] as String?) ?? 'gpt-4o-mini',
      );
}

class VADSettings {
  VADSettings({
    this.silenceDb = -45.0,
    this.minSilenceMs = 1000,
    this.minChunkMs = 1500,
    this.amplitudeWindowMs = 120,
    this.useRms = true,
    this.silenceRms = 0.010,
    this.preRollMs = 1000,
    this.onsetMs = 120,
  });

  double silenceDb; // Threshold in dB, e.g., -45 means quieter than -45 dB is silence
  int minSilenceMs; // Duration of continuous silence to trigger cut
  int minChunkMs; // Minimum chunk duration to avoid too-short segments
  int amplitudeWindowMs; // Amplitude sampling interval
  bool useRms; // whether to use RMS threshold instead of dB
  double silenceRms; // RMS threshold [0,1], e.g., 0.010
  int preRollMs; // pre-record duration before speech onset
  int onsetMs; // confirmation time above speech threshold to mark speech start

  Map<String, Object?> toJson() => {
        'silenceDb': silenceDb,
        'minSilenceMs': minSilenceMs,
        'minChunkMs': minChunkMs,
        'amplitudeWindowMs': amplitudeWindowMs,
        'useRms': useRms,
        'silenceRms': silenceRms,
        'preRollMs': preRollMs,
      };

  factory VADSettings.fromJson(Map<String, Object?> json) => VADSettings(
        silenceDb: (json['silenceDb'] as num?)?.toDouble() ?? -45.0,
        minSilenceMs: (json['minSilenceMs'] as num?)?.toInt() ?? 1000,
        minChunkMs: (json['minChunkMs'] as num?)?.toInt() ?? 1500,
        amplitudeWindowMs: (json['amplitudeWindowMs'] as num?)?.toInt() ?? 120,
        useRms: (json['useRms'] as bool?) ?? true,
        silenceRms: (json['silenceRms'] as num?)?.toDouble() ?? 0.010,
        preRollMs: (json['preRollMs'] as num?)?.toInt() ?? 1000,
        onsetMs: (json['onsetMs'] as num?)?.toInt() ?? 120,
      );
}

class TranslationSettings {
  TranslationSettings({this.enabled = false, this.targetLanguage = 'English'});

  bool enabled;
  String targetLanguage;

  Map<String, Object?> toJson() => {
        'enabled': enabled,
        'targetLanguage': targetLanguage,
      };

  factory TranslationSettings.fromJson(Map<String, Object?> json) =>
      TranslationSettings(
        enabled: (json['enabled'] as bool?) ?? false,
        targetLanguage: (json['targetLanguage'] as String?) ?? 'English',
      );
}

class AppSettings {
  AppSettings({
    this.provider = ProviderType.openai,
    OpenAISettings? openAI,
    VADSettings? vad,
    TranslationSettings? translation,
  })  : openAI = openAI ?? OpenAISettings(),
        vad = vad ?? VADSettings(),
        translation = translation ?? TranslationSettings();

  ProviderType provider;
  OpenAISettings openAI;
  VADSettings vad;
  TranslationSettings translation;

  Map<String, Object?> toJson() => {
        'provider': provider.name,
        'openAI': openAI.toJson(),
        'vad': vad.toJson(),
        'translation': translation.toJson(),
      };

  factory AppSettings.fromJson(Map<String, Object?> json) {
    final providerName = (json['provider'] as String?) ?? 'openai';
    final provider = ProviderType.values.firstWhere(
      (e) => e.name == providerName,
      orElse: () => ProviderType.openai,
    );
    final openAIJson = (json['openAI'] as Map?)?.cast<String, Object?>() ?? {};
    final vadJson = (json['vad'] as Map?)?.cast<String, Object?>() ?? {};
    final translationJson =
        (json['translation'] as Map?)?.cast<String, Object?>() ?? {};
    return AppSettings(
      provider: provider,
      openAI: OpenAISettings.fromJson(openAIJson),
      vad: VADSettings.fromJson(vadJson),
      translation: TranslationSettings.fromJson(translationJson),
    );
  }
}
