// 简单的媒体转写测试脚本
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function testMediaTranscribe() {
    console.log('开始测试媒体转写功能...');

    const platform = process.platform;
    const platformDir = platform === 'win32' ? 'win' : (platform === 'darwin' ? 'mac' : 'linux');
    const binaryCandidates = [
        path.join(__dirname, 'dist-python', platformDir, platform === 'win32' ? 'media_transcribe.exe' : 'media_transcribe'),
        path.join(__dirname, 'dist-python', platformDir, 'media_transcribe.bin')
    ];
    const exePath = binaryCandidates.find(fs.existsSync);

    console.log('检查媒体转写可执行文件:', binaryCandidates.join(' | '));

    if (!exePath) {
        console.error('❌ 未找到 media_transcribe 可执行文件');
        return;
    }

    console.log('✅ 已找到媒体转写可执行文件:', exePath);

    const ffmpegCandidates = [
        path.join(__dirname, 'ffmpeg.exe'),
        path.join(__dirname, 'ffmpeg', 'ffmpeg.exe'),
        path.join(__dirname, 'ffmpeg'),
        path.join(__dirname, 'ffmpeg', 'ffmpeg')
    ];
    const ffmpegPath = ffmpegCandidates.find(fs.existsSync);
    if (ffmpegPath) {
        console.log('✅ 发现本地 ffmpeg:', ffmpegPath);
    } else {
        console.warn('⚠️ 未在项目根目录找到 ffmpeg，可使用系统内置版本');
    }

    // 测试命令行参数
    console.log('测试命令行参数...');

    try {
        const testProcess = spawn(exePath, ['--help'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1',
                PYTHONIOENCODING: 'utf-8'
            }
        });
        
        let output = '';
        let error = '';
        
        testProcess.stdout.on('data', (data) => {
            output += data.toString('utf8');
        });
        
        testProcess.stderr.on('data', (data) => {
            error += data.toString('utf8');
        });
        
        testProcess.on('close', (code) => {
            console.log(`进程退出代码: ${code}`);
            if (output) {
                console.log('标准输出:');
                console.log(output);
            }
            if (error) {
                console.log('错误输出:');
                console.log(error);
            }
            
            if (output.includes('usage:')) {
                console.log('✅ 命令行参数解析正常');
            } else {
                console.log('❌ 命令行参数解析异常');
            }
        });
        
        testProcess.on('error', (err) => {
            console.error('❌ 进程启动失败:', err);
        });
        
    } catch (error) {
        console.error('❌ 测试失败:', error);
    }
}

// 运行测试
testMediaTranscribe();
