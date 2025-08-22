// 简单的媒体转写测试脚本
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function testMediaTranscribe() {
    console.log('开始测试媒体转写功能...');
    
    // 检查exe文件是否存在
    const exePath = path.join(__dirname, 'dist-python', 'win', 'media_transcribe.exe');
    console.log('检查exe文件:', exePath);
    
    if (!fs.existsSync(exePath)) {
        console.error('❌ media_transcribe.exe 不存在');
        return;
    }
    
    console.log('✅ media_transcribe.exe 存在');
    
    // 检查本地 ffmpeg（项目根目录）是否存在（用于运行时指定给 MoviePy）
    const ffmpegAtRoot = path.join(__dirname, 'ffmpeg.exe');
    const ffmpegInFolder = path.join(__dirname, 'ffmpeg', 'ffmpeg.exe');
    if (fs.existsSync(ffmpegAtRoot)) {
        console.log('✅ 发现本地 ffmpeg.exe:', ffmpegAtRoot);
    } else if (fs.existsSync(ffmpegInFolder)) {
        console.log('✅ 发现本地 ffmpeg/ffmpeg.exe:', ffmpegInFolder);
    } else {
        console.warn('⚠️ 未在项目根目录找到 ffmpeg.exe（开发模式下建议放在 electron 根目录）');
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
