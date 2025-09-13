import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:vtt_flutter/models/app_settings.dart';

class SettingsRepository {
  static const _prefsKey = 'app_settings_v1';

  Future<AppSettings> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_prefsKey);
    if (raw == null || raw.isEmpty) {
      return AppSettings();
    }
    try {
      final map = jsonDecode(raw) as Map<String, Object?>;
      return AppSettings.fromJson(map);
    } catch (_) {
      // If parsing fails, return defaults.
      return AppSettings();
    }
  }

  Future<void> save(AppSettings settings) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = jsonEncode(settings.toJson());
    await prefs.setString(_prefsKey, raw);
  }
}

