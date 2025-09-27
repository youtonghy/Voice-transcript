const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyIfExists(src, dest) {
  if (!src || !dest) return false;
  if (!fs.existsSync(src)) {
    return false;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

function main() {
  const targetDir = process.argv[2];
  if (!targetDir) {
    console.error('[copy-runtime] Missing target directory argument');
    process.exit(1);
  }

  const resolvedTarget = path.resolve(targetDir);
  ensureDir(resolvedTarget);

  const candidates = [
    { src: 'ffmpeg.exe', dest: path.join(resolvedTarget, 'ffmpeg.exe') },
    { src: path.join('ffmpeg', 'ffmpeg.exe'), dest: path.join(resolvedTarget, 'ffmpeg.exe') },
    { src: 'ffmpeg', dest: path.join(resolvedTarget, 'ffmpeg') },
    { src: path.join('ffmpeg', 'ffmpeg'), dest: path.join(resolvedTarget, 'ffmpeg') }
  ];

  let copied = false;
  for (const { src, dest } of candidates) {
    const absSrc = path.resolve(src);
    if (copyIfExists(absSrc, dest)) {
      console.log(`[copy-runtime] Copied ${absSrc} -> ${dest}`);
      copied = true;
      break;
    }
  }

  if (!copied) {
    console.log('[copy-runtime] No ffmpeg binary found to copy (optional).');
  }
}

main();
