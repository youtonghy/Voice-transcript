import 'dart:io';
import 'dart:typed_data';

class WavInfo {
  WavInfo({
    required this.sampleRate,
    required this.numChannels,
    required this.bitsPerSample,
    required this.dataOffset,
    required this.dataSize,
  });
  final int sampleRate;
  final int numChannels;
  final int bitsPerSample;
  final int dataOffset;
  final int dataSize;
}

Future<WavInfo> _parseWav(Uint8List bytes) async {
  final bd = ByteData.sublistView(bytes);
  if (bytes.length < 44 || String.fromCharCodes(bytes.sublist(0, 4)) != 'RIFF') {
    throw const FormatException('Not a RIFF file');
  }
  if (String.fromCharCodes(bytes.sublist(8, 12)) != 'WAVE') {
    throw const FormatException('Not a WAVE file');
  }
  int pos = 12; // after RIFF header
  int? sampleRate;
  int? numChannels;
  int? bitsPerSample;
  int? dataOffset;
  int? dataSize;

  while (pos + 8 <= bytes.length) {
    final id = String.fromCharCodes(bytes.sublist(pos, pos + 4));
    final size = bd.getUint32(pos + 4, Endian.little);
    final chunkStart = pos + 8;
    if (id == 'fmt ') {
      if (size < 16) throw const FormatException('Invalid fmt chunk');
      final fmt = ByteData.sublistView(bytes, chunkStart, chunkStart + size);
      numChannels = fmt.getUint16(2, Endian.little);
      sampleRate = fmt.getUint32(4, Endian.little);
      bitsPerSample = fmt.getUint16(14, Endian.little);
    } else if (id == 'data') {
      dataOffset = chunkStart;
      dataSize = size;
      break;
    }
    pos = chunkStart + size;
  }

  if (sampleRate == null || numChannels == null || bitsPerSample == null || dataOffset == null || dataSize == null) {
    throw const FormatException('Missing required WAV chunks');
  }
  return WavInfo(
    sampleRate: sampleRate!,
    numChannels: numChannels!,
    bitsPerSample: bitsPerSample!,
    dataOffset: dataOffset!,
    dataSize: dataSize!,
  );
}

Future<String> trimWav(String srcPath, {required int startMs, int? endMs}) async {
  final file = File(srcPath);
  final bytes = await file.readAsBytes();
  final info = await _parseWav(bytes);

  final bytesPerSample = (info.bitsPerSample ~/ 8) * info.numChannels;
  final totalSamples = info.dataSize ~/ bytesPerSample;

  int startSample = ((startMs / 1000) * info.sampleRate).floor();
  int endSample = endMs == null ? totalSamples : ((endMs / 1000) * info.sampleRate).floor();
  if (startSample < 0) startSample = 0;
  if (endSample > totalSamples) endSample = totalSamples;
  if (endSample <= startSample) {
    // nothing to trim; return original path
    return srcPath;
  }

  final startByte = info.dataOffset + startSample * bytesPerSample;
  final endByte = info.dataOffset + endSample * bytesPerSample;
  final newDataSize = endByte - startByte;

  final preHeader = bytes.sublist(0, info.dataOffset - 8); // up to 'data' id
  final dataId = 'data'.codeUnits;

  final out = BytesBuilder();
  out.add(preHeader);
  out.add(dataId);
  out.add(Uint8List(4)); // placeholder for data size
  out.add(bytes.sublist(startByte, endByte));
  final output = out.toBytes();

  final bd = ByteData.sublistView(output);
  // RIFF size at offset 4
  bd.setUint32(4, output.length - 8, Endian.little);
  // data size after preHeader + 4 bytes for 'data'
  bd.setUint32(preHeader.length + 4, newDataSize, Endian.little);

  final outPath = srcPath.replaceFirst(RegExp(r'\.wav$', caseSensitive: false), '.trim.wav');
  await File(outPath).writeAsBytes(output);
  return outPath;
}

Future<String> concatWav(String aPath, String bPath) async {
  final aBytes = await File(aPath).readAsBytes();
  final bBytes = await File(bPath).readAsBytes();
  final aInfo = await _parseWav(aBytes);
  final bInfo = await _parseWav(bBytes);
  if (aInfo.sampleRate != bInfo.sampleRate ||
      aInfo.numChannels != bInfo.numChannels ||
      aInfo.bitsPerSample != bInfo.bitsPerSample) {
    throw const FormatException('WAV formats do not match for concat');
  }

  final preHeader = aBytes.sublist(0, aInfo.dataOffset - 8);
  final dataId = 'data'.codeUnits;
  final aData = aBytes.sublist(aInfo.dataOffset, aInfo.dataOffset + aInfo.dataSize);
  final bData = bBytes.sublist(bInfo.dataOffset, bInfo.dataOffset + bInfo.dataSize);
  final newDataSize = aData.length + bData.length;

  final out = BytesBuilder();
  out.add(preHeader);
  out.add(dataId);
  out.add(Uint8List(4)); // placeholder for data size
  out.add(aData);
  out.add(bData);
  final output = out.toBytes();

  final bd = ByteData.sublistView(output);
  bd.setUint32(4, output.length - 8, Endian.little); // RIFF size
  bd.setUint32(preHeader.length + 4, newDataSize, Endian.little); // data size

  final outPath = aPath.replaceFirst(RegExp(r'\.wav$', caseSensitive: false), '.concat.wav');
  await File(outPath).writeAsBytes(output);
  return outPath;
}
