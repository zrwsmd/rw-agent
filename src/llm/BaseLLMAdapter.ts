// src/llm/BaseLLMAdapter.ts

import { LLMAdapter, LLMMessage, LLMOptions, LLMResponse, ToolCall } from '../types/llm';

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

  /**
   * 默认实现：不支持原生工具调用
   * 子类应该重写此方法
   */
  async completeWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    const content = await this.complete(messages, options);
    return {
      content,
      finishReason: 'stop',
    };
  }

  /**
   * 默认实现：不支持流式工具调用
   * 子类应该重写此方法
   */
  async *streamCompleteWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): AsyncIterable<{ type: 'content' | 'tool_call'; data: string | ToolCall }> {
    for await (const token of this.streamComplete(messages, options)) {
      yield { type: 'content', data: token };
    }
  }

  /**
   * 默认返回 false，子类重写
   */
  supportsNativeTools(): boolean {
    return false;
  }

  estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  /**
   * 估算消息列表的 token 数
   */
  estimateMessagesTokens(messages: LLMMessage[]): number {
    return messages.reduce((total, msg) => {
      return total + this.estimateTokens(msg.content) + 4;
    }, 0);
  }

  /**
   * 重试逻辑（带指数退避）
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 1000
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        // 如果是最后一次尝试，直接抛出错误
        if (attempt === maxRetries - 1) {
          break;
        }

        // 计算延迟时间（指数退避 + 随机抖动）
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`[LLM] 重试 ${attempt + 1}/${maxRetries}，延迟 ${delay}ms`);
        
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('未知错误');
  }
}