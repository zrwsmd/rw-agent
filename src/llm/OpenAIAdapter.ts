import OpenAI from 'openai';
import { LLMMessage, LLMOptions, LLMProvider, LLMConfig } from '../types/llm';
import { BaseLLMAdapter } from './BaseLLMAdapter';

/**
 * OpenAI 适配器
 */
export class OpenAIAdapter extends BaseLLMAdapter {
  private client: OpenAI;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    super(apiKey, model, baseUrl);
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl || undefined,
    });
  }

  async *streamComplete(
    messages: LLMMessage[],
    options?: LLMOptions
  ): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
      stop: options?.stopSequences,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
      stop: options?.stopSequences,
    });

    return response.choices[0]?.message?.content || '';
  }
}

/**
 * OpenAI 提供商
 */
export class OpenAIProvider implements LLMProvider {
  name = 'openai';

  createAdapter(config: LLMConfig): OpenAIAdapter {
    return new OpenAIAdapter(config.apiKey, config.model, config.baseUrl);
  }

  async validateConfig(config: LLMConfig): Promise<boolean> {
    try {
      const adapter = this.createAdapter(config);
      // 发送一个简单请求验证配置
      await adapter.complete([{ role: 'user', content: 'hi' }], {
        maxTokens: 5,
      });
      return true;
    } catch {
      return false;
    }
  }
}
