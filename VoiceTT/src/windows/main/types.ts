export type ConversationEntry = {
  id: string;
  resultId?: string | null;
  transcription: string;
  translation: string;
  transcriptionPending?: boolean;
  translationPending?: boolean;
  optimized?: string;
  optimizedPending?: boolean;
  optimizedError?: string | null;
  optimizationMeta?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  name: string;
  entries: ConversationEntry[];
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  orderRank?: number;
  needsTitleRefresh?: boolean;
  titleGeneratedAt?: string | null;
};

export type LogEntry = {
  id: string;
  level: "info" | "warning" | "error" | "debug";
  message: string;
  timestamp: string;
};

export type ServiceStatusState = "starting" | "running" | "error" | "stopped";
