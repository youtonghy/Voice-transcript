import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

class PermissionService {
  static Future<bool> ensureMicPermission(BuildContext context) async {
    var status = await Permission.microphone.status;
    if (status.isGranted) return true;

    status = await Permission.microphone.request();
    if (status.isGranted) return true;

    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('未获麦克风权限，无法开始录音'),
          action: status.isPermanentlyDenied
              ? SnackBarAction(
                  label: '前往设置',
                  onPressed: () {
                    openAppSettings();
                  },
                )
              : null,
        ),
      );
    }
    return false;
  }
}

