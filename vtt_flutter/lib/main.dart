import 'package:flutter/material.dart';
import 'package:vtt_flutter/pages/about_page.dart';
import 'package:vtt_flutter/pages/file_transcribe_page.dart';
import 'package:vtt_flutter/pages/realtime_transcribe_page.dart';
import 'package:vtt_flutter/pages/settings_page.dart';

void main() {
  runApp(const VttApp());
}

class VttApp extends StatelessWidget {
  const VttApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '语音转写',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        useMaterial3: true,
      ),
      home: const HomePage(),
      routes: {
        RealtimeTranscribePage.routeName: (_) => const RealtimeTranscribePage(),
        FileTranscribePage.routeName: (_) => const FileTranscribePage(),
        SettingsPage.routeName: (_) => const SettingsPage(),
        AboutPage.routeName: (_) => const AboutPage(),
      },
    );
  }
}

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('语音转写'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.pushNamed(
                  context,
                  RealtimeTranscribePage.routeName,
                ),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                ),
                child: const Text('实时转录'),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.pushNamed(
                  context,
                  FileTranscribePage.routeName,
                ),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                ),
                child: const Text('文件转录'),
              ),
            ),
            const Spacer(),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                OutlinedButton(
                  onPressed: () => Navigator.pushNamed(
                    context,
                    SettingsPage.routeName,
                  ),
                  child: const Text('设置'),
                ),
                const SizedBox(width: 12),
                OutlinedButton(
                  onPressed: () => Navigator.pushNamed(
                    context,
                    AboutPage.routeName,
                  ),
                  child: const Text('关于'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
