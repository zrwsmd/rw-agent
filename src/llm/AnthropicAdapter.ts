import { LLMMessage, LLMOptions, LLMProvider, LLMConfig, LLMAdapter } from '../types/llm';
import { BaseLLMAdapter } from './BaseLLMAdapter';

type MessageRole = 'user' | 'assistant';

interface AnthropicMessage {
  role: MessageRole;
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  stop_sequences?: string[];
  stream?: boolean;
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
}

/**
 * Anthropic 适配器 - 使用 fetch API 直接调用
 */
export class AnthropicAdapter extends BaseLLMAdapter {
  private baseApiUrl: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    super(apiKey, model, baseUrl);
    this.baseApiUrl = baseUrl || 'https://api.anthropic.com';
  }

  async *streamComplete(
    messages: LLMMessage[],
    options?: LLMOptions
  ): AsyncIterable<string> {
    const { systemMessage, chatMessages } = this.prepareMessages(messages);

    const response = await fetch(`${this.baseApiUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens || 4096,
        system: systemMessage,
        messages: chatMessages,
        stop_sequences: options?.stopSequences,
        stream: true,
      } as AnthropicRequest),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API 错误: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield parsed.delta.text;
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    }
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const { systemMessage, chatMessages } = this.prepareMessages(messages);

    const response = await fetch(`${this.baseApiUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens || 4096,
        system: systemMessage,
        messages: chatMessages,
        stop_sequences: options?.stopSequences,
      } as AnthropicRequest),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API 错误: ${response.status}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    const textBlock = data.content.find((block) => block.type === 'text');
    return textBlock?.text || '';
  }

  private prepareMessages(messages: LLMMessage[]): {
    systemMessage?: string;
    chatMessages: AnthropicMessage[];
  } {
    const systemMsg = messages.find((m) => m.role === 'system');
    const chatMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as MessageRole,
        content: m.content,
      }));

    return {
      systemMessage: systemMsg?.content,
      chatMessages,
    };
  }
}

/**
 * Anthropic 提供商
 */
export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';

  createAdapter(config: LLMConfig): LLMAdapter {
    return new AnthropicAdapter(config.apiKey, config.model, config.baseUrl);
  }

  async validateConfig(config: LLMConfig): Promise<boolean> {
    try {
      const adapter = this.createAdapter(config);
      await adapter.complete([{ role: 'user', content: 'hi' }], {
        maxTokens: 5,
      });
      return true;
    } catch {
      return false;
    }
  }
}
