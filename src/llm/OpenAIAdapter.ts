// src/llm/OpenAIAdapter.ts

import OpenAI from 'openai';
import { 
  LLMMessage, 
  LLMOptions, 
  LLMProvider, 
  LLMConfig, 
  LLMResponse,
  ToolCall 
} from '../types/llm';
import { BaseLLMAdapter } from './BaseLLMAdapter';

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * OpenAI 适配器（支持函数调用）
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

  supportsNativeTools(): boolean {
    return true;
  }

  async *streamComplete(
    messages: LLMMessage[],
    options?: LLMOptions
  ): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: this.convertMessages(messages),
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
    const response = await this.withRetry(() =>
      this.client.chat.completions.create({
        model: this.model,
        messages: this.convertMessages(messages),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens,
        stop: options?.stopSequences,
      })
    );

    return response.choices[0]?.message?.content || '';
  }

  /**
   * 支持原生工具调用的完成方法
   */
  async completeWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: this.model,
      messages: this.convertMessages(messages),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
      stop: options?.stopSequences,
    };

    // 如果提供了工具定义，添加到请求中
    if (options?.tools && options.tools.length > 0) {
      requestParams.tools = options.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));

      if (options.toolChoice) {
        requestParams.tool_choice = options.toolChoice;
      }
    }

    const response = await this.withRetry(() =>
      this.client.chat.completions.create(requestParams)
    );

    const message = response.choices[0]?.message;
    const toolCalls: ToolCall[] = [];

    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        });
      }
    }

    return {
      content: message?.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapFinishReason(response.choices[0]?.finish_reason),
    };
  }

  /**
   * 流式工具调用支持
   */
  async *streamCompleteWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): AsyncIterable<{ type: 'content' | 'tool_call'; data: string | ToolCall }> {
    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: this.model,
      messages: this.convertMessages(messages),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
      stop: options?.stopSequences,
      stream: true,
    };

    if (options?.tools && options.tools.length > 0) {
      requestParams.tools = options.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));

      if (options.toolChoice) {
        requestParams.tool_choice = options.toolChoice;
      }
    }

    const stream = await this.client.chat.completions.create(requestParams);

    // 累积工具调用信息
    const toolCallsBuffer: Map<number, Partial<ToolCall>> = new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      // 处理内容
      if (delta?.content) {
        yield { type: 'content', data: delta.content };
      }

      // 处理工具调用
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index;
          const existing = toolCallsBuffer.get(index) || {
            id: '',
            type: 'function' as const,
            function: { name: '', arguments: '' },
          };

          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.function!.name = tc.function.name;
          if (tc.function?.arguments) {
            existing.function!.arguments += tc.function.arguments;
          }

          toolCallsBuffer.set(index, existing);
        }
      }
    }

    // 发送完整的工具调用
    for (const toolCall of toolCallsBuffer.values()) {
      if (toolCall.id && toolCall.function?.name) {
        yield {
          type: 'tool_call',
          data: toolCall as ToolCall,
        };
      }
    }
  }

  /**
   * 转换消息格式
   */
  private convertMessages(messages: LLMMessage[]): OpenAIMessage[] {
    return messages.map((m): OpenAIMessage => {
      // 如果消息包含工具调用
      if (m.toolCalls) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        };
      }

      // 如果是工具响应
      if (m.toolCallId) {
        return {
          role: 'tool',
          content: m.content,
          tool_call_id: m.toolCallId,
        };
      }

      // 普通消息
      return {
        role: m.role,
        content: m.content,
      };
    });
  }

  /**
   * 映射完成原因
   */
  private mapFinishReason(
    reason?: string
  ): 'stop' | 'tool_calls' | 'length' | 'content_filter' {
    switch (reason) {
      case 'tool_calls':
        return 'tool_calls';
      case 'length':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
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
      await adapter.complete([{ role: 'user', content: 'hi' }], {
        maxTokens: 5,
      });
      return true;
    } catch {
      return false;
    }
  }
}