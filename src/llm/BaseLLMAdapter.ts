import { LLMAdapter, LLMMessage, LLMOptions } from '../types/llm';

/**
 * 简单的 token 估算
 */
export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * LLM 适配器基类
 */
export abstract class BaseLLMAdapter implements LLMAdapter {
  protected apiKey: string;
  protected model: string;
  protected baseUrl?: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  abstract streamComplete(
    messages: LLMMessage[],
    options?: LLMOptions
  ): AsyncIterable<string>;

  abstract complete(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<string>;

  estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  /**
   * 估算消息列表的 token 数
   */
  estimateMessagesTokens(messages: LLMMessage[]): number {
    return messages.reduce((total, msg) => {
      // 每条消息额外开销约 4 tokens
      return total + this.estimateTokens(msg.content) + 4;
    }, 0);
  }
}
