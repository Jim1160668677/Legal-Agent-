export type LlmProviderName = 'agnes' | 'qwen';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ProviderConfig {
  apiKey: string;
  baseURL: string;
  defaultModel: string;
}

export interface LlmRuntimeConfig {
  provider: LlmProviderName;
  timeoutMs: number;
  maxRetries: number;
  baseRetryDelayMs: number;
  logLevel: LogLevel;
}

export interface AppConfig {
  llm: LlmRuntimeConfig;
  agnes: ProviderConfig;
  qwen: ProviderConfig;
}
