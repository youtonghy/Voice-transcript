// Kill potentially running Python EXEs before (re)building to avoid file locks
// Works on Windows; on other platforms it is a no-op.
const { spawnSync } = require('child_process');

function killImage(img) {
  try {
    const res = spawnSync('taskkill', ['/F', '/IM', img, '/T'], { encoding: 'utf8' });
    if (res.status === 0) {
      console.log(`[kill-python-exes] Killed ${img}`);
    } else {
      // Non-zero often means process not found; keep quiet
      const out = (res.stdout || '') + (res.stderr || '');
      if (out && !/not found|没有运行的实例|no instance/i.test(out)) {
        console.log(`[kill-python-exes] taskkill output for ${img}:`, out.trim());
      }
    }
  } catch (e) {
    console.log(`[kill-python-exes] Failed to kill ${img}: ${e.message}`);
  }
}

if (process.platform === 'win32') {
  killImage('transcribe_service.exe');
  killImage('media_transcribe.exe');
} else {
  console.log('[kill-python-exes] Non-Windows platform; nothing to do');
}

