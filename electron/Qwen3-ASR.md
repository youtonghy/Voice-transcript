请根据下方提供的示例代码,完成对Qwen3-ASR转写引擎调用模型的支持.
import os
import dashscope

# 请用您的本地音频的绝对路径替换 ABSOLUTE_PATH/welcome.mp3
audio_file_path = "file://ABSOLUTE_PATH/welcome.mp3"

messages = [
    {
        "role": "system",
        "content": [
            # 此处用于配置定制化识别的Context
            {"text": ""},
        ]
    },
    {
        "role": "user",
        "content": [
            {"audio": audio_file_path},
        ]
    }
]
response = dashscope.MultiModalConversation.call(
    # 若没有配置环境变量，请用百炼API Key将下行替换为：api_key = "sk-xxx",
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    model="qwen3-asr-flash",
    messages=messages,
    result_format="message",
    asr_options={
        # "language": "zh", # 可选，若已知音频的语种，可通过该参数指定待识别语种，以提升识别准确率
        "enable_lid":True,
        "enable_itn":False
    }
)
print(response)

完整结果以JSON格式输出到控制台。完整结果包含状态码、唯一的请求ID、识别后的内容以及本次调用的token信息。
{
    "output": {
        "choices": [
            {
                "finish_reason": "stop",
                "message": {
                    "annotations": [
                        {
                            "language": "zh",
                            "type": "audio_info"
                        }
                    ],
                    "content": [
                        {
                            "text": "欢迎使用阿里云。"
                        }
                    ],
                    "role": "assistant"
                }
            }
        ]
    },
    "usage": {
        "input_tokens_details": {
            "text_tokens": 0
        },
        "output_tokens_details": {
            "text_tokens": 6
        },
        "seconds": 1
    },
    "request_id": "568e2bf0-d6f2-97f8-9f15-a57b11dc6977"
}

注意事项:
1.注意录音文件在Windows下的路径问题,格式为file://{文件的绝对路径},示例:file:///home/images/test.png
2.根据转录设置中设置的转录语言,填写"language": "zh"字段,若为自动识别则不需要填写该字段
3.预留配置定制化识别的Context的接口,Context内容不超过 10000 Token,保留注释以便后期调用