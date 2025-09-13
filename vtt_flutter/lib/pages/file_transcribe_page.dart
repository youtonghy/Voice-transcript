import 'package:flutter/material.dart';

class FileTranscribePage extends StatelessWidget {
  const FileTranscribePage({super.key});

  static const String routeName = '/file';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('文件转录'),
      ),
      body: const Center(
        child: Text('文件转录页面内容待添加'),
      ),
    );
  }
}

