import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:vtt_flutter/models/app_settings.dart';

class OpenAIClient {
  OpenAIClient(this._settings);

  final OpenAISettings _settings;

  Uri _uri(String path) {
    // Ensure single slash handling
    final base = _settings.baseUrl.endsWith('/')
        ? _settings.baseUrl.substring(0, _settings.baseUrl.length - 1)
        : _settings.baseUrl;
    final p = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$base$p');
  }

  Map<String, String> _headers({bool json = true}) => {
        'Authorization': 'Bearer ${_settings.apiKey}',
        if (json) 'Content-Type': 'application/json',
      };

  /// Transcribe audio bytes using OpenAI Audio Transcriptions API.
  /// [bytes] should be a supported audio format (e.g., wav/m4a/webm/mp3).
  Future<String> transcribeBytes(Uint8List bytes, {String filename = 'audio.wav'}) async {
    final request = http.MultipartRequest('POST', _uri('/audio/transcriptions'))
      ..headers.addAll({'Authorization': 'Bearer ${_settings.apiKey}'})
      ..fields['model'] = _settings.transcribeModel
      ..files.add(http.MultipartFile.fromBytes('file', bytes, filename: filename));

    final streamed = await request.send();
    final resp = await http.Response.fromStream(streamed);
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      throw OpenAIException('Transcription failed: ${resp.statusCode} ${resp.body}');
    }
    final data = jsonDecode(resp.body) as Map<String, dynamic>;
    // OpenAI returns { text: "..." } for transcription
    final text = data['text'] as String?;
    if (text == null) {
      throw OpenAIException('Invalid transcription response: ${resp.body}');
    }
    return text;
  }

  /// Translate text using Chat Completions (gpt-4o-mini default).
  /// [targetLanguage] e.g. "English", "Chinese".
  Future<String> translateText(String text, {required String targetLanguage}) async {
    final body = jsonEncode({
      'model': _settings.translateModel,
      'messages': [
        {
          'role': 'system',
          'content': 'You are a professional translator. Translate the user text to $targetLanguage. Output only the translation.'
        },
        {
          'role': 'user',
          'content': text,
        }
      ],
      'temperature': 0.2,
    });

    final resp = await http.post(_uri('/chat/completions'), headers: _headers(), body: body);
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      throw OpenAIException('Translation failed: ${resp.statusCode} ${resp.body}');
    }
    final data = jsonDecode(resp.body) as Map<String, dynamic>;
    final choices = data['choices'] as List<dynamic>?;
    final content = choices != null && choices.isNotEmpty
        ? (choices.first['message']?['content'] as String?)
        : null;
    if (content == null) {
      throw OpenAIException('Invalid translation response: ${resp.body}');
    }
    return content.trim();
  }
}

class OpenAIException implements Exception {
  OpenAIException(this.message);
  final String message;
  @override
  String toString() => 'OpenAIException: $message';
}

