import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type TranslationValue = string | TranslationMap;
type TranslationMap = Record<string, TranslationValue>;

type TranslationResources = Record<string, { translation: TranslationMap }>;

type InterpolationValues = Record<string, string | number | undefined>;

interface TranslateOptions {
  defaultValue?: string;
  [key: string]: unknown;
}

interface I18nInstance {
  language: string;
  changeLanguage: (language: string) => Promise<void>;
}

interface I18nContextValue {
  language: string;
  setLanguage: (language: string) => void;
  resources: TranslationResources;
}

const resources: TranslationResources = {
  en: {
    translation: {
      app: {
        title: "Voice Transcript Studio",
        tagline: "Real-time transcription, translation, and summaries in a single workspace.",
        actions: {
          refresh: "Refresh",
          settings: "Settings",
        },
        summary: {
          title: "Summary",
          description: "Generate a high-level summary for the current conversation.",
          button: "Summarize Conversation",
          mediaProgress: "Processing media… {{current}} / {{total}}",
          lastVoiceInput: "Last voice input",
        },
      },
      controlPanel: {
        statusRecording: "Recording",
        statusIdle: "Idle",
        ready: "Ready",
        mode: "Mode: {{mode}}",
        startRecording: "Start Recording",
        stopRecording: "Stop Recording",
        voiceInput: "Voice Input",
        stopVoiceInput: "Stop Voice Input",
        modes: {
          default: "Default",
          voice_input: "Voice Input",
        },
      },
      transcript: {
        title: "Transcript",
        empty: "No entries yet.",
        count: "{{count}} segments",
        translationLabel: "Translation",
        kinds: {
          transcription: "Transcription",
          translation: "Translation",
          summary: "Summary",
          optimization: "Optimization",
        },
        actions: {
          translate: "Translate",
          optimize: "Improve phrasing",
        },
      },
      history: {
        title: "History",
        expand: "Expand",
        collapse: "Collapse",
        empty: "No conversations yet.",
        pin: "Pin",
        unpin: "Unpin",
        delete: "Delete",
      },
      media: {
        title: "Media Transcription",
        description: "Transcribe audio/video files directly.",
        sourceFile: "Source File",
        placeholder: "Select audio or video file",
        browse: "Browse…",
        translateAutomatically: "Translate automatically",
        targetLanguage: "Target language",
        submit: "Process",
        processing: "Processing…",
      },
      settings: {
        title: "Settings",
        subtitle: "Configure engines, prompts, and language preferences.",
        close: "Close",
        sections: {
          credentials: "Credentials",
          models: "Models",
          language: "Language & Behaviour",
        },
        credentials: {
          openaiApiKey: "OpenAI API Key",
          openaiBaseUrl: "OpenAI Base URL",
          geminiApiKey: "Gemini API Key",
          sonioxApiKey: "Soniox API Key",
          dashscopeApiKey: "DashScope API Key",
        },
        models: {
          openaiTranscribe: "OpenAI Transcribe Model",
          openaiTranslate: "OpenAI Translate Model",
          openaiSummary: "OpenAI Summary Model",
          openaiOptimize: "OpenAI Optimize Model",
          geminiTranslate: "Gemini Translate Model",
          geminiSummary: "Gemini Summary Model",
          geminiOptimize: "Gemini Optimize Model",
          qwenAsr: "Qwen ASR Model",
        },
        language: {
          defaultTranslateLanguage: "Default Translate Language",
          transcribeLanguage: "Transcribe Language",
          silenceThreshold: "Silence Threshold",
          minSilence: "Minimum Silence (seconds)",
          enableTranslation: "Enable translation by default",
          translateVoiceInput: "Translate voice input",
        },
        placeholders: {
          openaiBaseUrl: "https://api.openai.com",
        },
        save: "Save Changes",
      },
    },
  },
  "zh-CN": {
    translation: {
      app: {
        title: "语音转写工作室",
        tagline: "实时转写、翻译与摘要，一站式工作区。",
        actions: {
          refresh: "刷新",
          settings: "设置",
        },
        summary: {
          title: "概要",
          description: "为当前会话生成高层摘要。",
          button: "生成摘要",
          mediaProgress: "媒体处理中… {{current}} / {{total}}",
          lastVoiceInput: "最近一次语音输入",
        },
      },
      controlPanel: {
        statusRecording: "录音中",
        statusIdle: "待机",
        ready: "就绪",
        mode: "模式：{{mode}}",
        startRecording: "开始录音",
        stopRecording: "停止录音",
        voiceInput: "语音输入",
        stopVoiceInput: "停止语音输入",
        modes: {
          default: "默认",
          voice_input: "语音输入",
        },
      },
      transcript: {
        title: "转写内容",
        empty: "暂无内容。",
        count: "{{count}} 个片段",
        translationLabel: "翻译",
        kinds: {
          transcription: "转写",
          translation: "翻译",
          summary: "摘要",
          optimization: "优化",
        },
        actions: {
          translate: "翻译",
          optimize: "优化表述",
        },
      },
      history: {
        title: "历史记录",
        expand: "展开",
        collapse: "收起",
        empty: "暂无会话。",
        pin: "置顶",
        unpin: "取消置顶",
        delete: "删除",
      },
      media: {
        title: "媒体转写",
        description: "直接处理音频/视频文件。",
        sourceFile: "源文件",
        placeholder: "选择音频或视频文件",
        browse: "浏览…",
        translateAutomatically: "自动翻译",
        targetLanguage: "目标语言",
        submit: "开始处理",
        processing: "处理中…",
      },
      settings: {
        title: "设置",
        subtitle: "配置引擎、提示词与语言偏好。",
        close: "关闭",
        sections: {
          credentials: "凭证",
          models: "模型",
          language: "语言与行为",
        },
        credentials: {
          openaiApiKey: "OpenAI API 密钥",
          openaiBaseUrl: "OpenAI 基础地址",
          geminiApiKey: "Gemini API 密钥",
          sonioxApiKey: "Soniox API 密钥",
          dashscopeApiKey: "DashScope API 密钥",
        },
        models: {
          openaiTranscribe: "OpenAI 转写模型",
          openaiTranslate: "OpenAI 翻译模型",
          openaiSummary: "OpenAI 摘要模型",
          openaiOptimize: "OpenAI 优化模型",
          geminiTranslate: "Gemini 翻译模型",
          geminiSummary: "Gemini 摘要模型",
          geminiOptimize: "Gemini 优化模型",
          qwenAsr: "Qwen 语音识别模型",
        },
        language: {
          defaultTranslateLanguage: "默认翻译语言",
          transcribeLanguage: "转写语言",
          silenceThreshold: "静音阈值",
          minSilence: "最小静音时长（秒）",
          enableTranslation: "默认启用翻译",
          translateVoiceInput: "语音输入时开启翻译",
        },
        placeholders: {
          openaiBaseUrl: "https://api.openai.com",
        },
        save: "保存修改",
      },
    },
  },
};

function deepGet(map: TranslationMap, path: string[]): TranslationValue | undefined {
  let current: TranslationValue = map;
  for (const key of path) {
    if (typeof current === "string") {
      return undefined;
    }
    if (!(key in current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function interpolate(template: string, values?: InterpolationValues): string {
  if (!values) return template;
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, token: string) => {
    const value = values[token];
    return value === undefined || value === null ? "" : String(value);
  });
}

function translateKey(
  resourcesMap: TranslationResources,
  language: string,
  key: string,
  options?: TranslateOptions,
): string {
  const segments = key.split(".");
  const primary = resourcesMap[language]?.translation;
  const fallback = resourcesMap.en.translation;

  const lookup = (map?: TranslationMap) => {
    if (!map) return undefined;
    const value = deepGet(map, segments);
    return typeof value === "string" ? value : undefined;
  };

  const raw = lookup(primary) ?? lookup(fallback) ?? options?.defaultValue ?? key;
  const interpolationValues = Object.fromEntries(
    Object.entries(options ?? {}).filter(([token]) => token !== "defaultValue"),
  );
  return interpolate(raw, interpolationValues);
}

const I18nContext = createContext<I18nContextValue>({
  language: "zh-CN",
  setLanguage: () => {},
  resources,
});

export function I18nProvider({
  children,
  defaultLanguage = "zh-CN",
}: {
  children: ReactNode;
  defaultLanguage?: string;
}) {
  const [language, setLanguage] = useState<string>(defaultLanguage);

  useEffect(() => {
    setLanguage(defaultLanguage);
  }, [defaultLanguage]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      resources,
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(I18nContext);

  const t = useCallback(
    (key: string, options?: TranslateOptions) =>
      translateKey(ctx.resources, ctx.language, key, options),
    [ctx.language, ctx.resources],
  );

  const i18n = useMemo<I18nInstance>(
    () => ({
      language: ctx.language,
      changeLanguage: async (language: string) => {
        ctx.setLanguage(language);
      },
    }),
    [ctx],
  );

  return { t, i18n };
}

export function createFixedT(language: string) {
  return (key: string, options?: TranslateOptions) =>
    translateKey(resources, language, key, options);
}

export const availableLanguages = Object.keys(resources);
