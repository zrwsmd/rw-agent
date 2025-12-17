/**
 * LLM 消息
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM 调用选项
 */
export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

/**
 * LLM 配置
 */
export interface LLMConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/**
 * LLM 适配器接口
 */
export interface LLMAdapter {
  streamComplete(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<string>;
  complete(messages: LLMMessage[], options?: LLMOptions): Promise<string>;
  estimateTokens(text: string): number;
}

/**
 * LLM 提供商接口
 */
export interface LLMProvider {
  name: string;
  createAdapter(config: LLMConfig): LLMAdapter;
  validateConfig(config: LLMConfig): Promise<boolean>;
}
