// src/llm/AnthropicAdapter.ts

import { 
  LLMMessage, 
  LLMOptions, 
  LLMProvider, 
  LLMConfig, 
  LLMAdapter,
  LLMResponse,
  ToolCall,
  ToolDefinition
} from '../types/llm';
import { BaseLLMAdapter } from './BaseLLMAdapter';

type MessageRole = 'user' | 'assistant';

interface AnthropicMessage {
  role: MessageRole;
  content: string | Array<{ type: string; [key: string]: unknown }>;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

interface AnthropicResponse {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

/**
 * Anthropic 适配器（支持函数调用）
 */
export class AnthropicAdapter extends BaseLLMAdapter {
  private baseApiUrl: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    super(apiKey, model, baseUrl);
    this.baseApiUrl = baseUrl || 'https://api.anthropic.com';
  }

  supportsNativeTools(): boolean {
    return true;
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
      }),
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
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
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

    const response = await this.withRetry(() =>
      fetch(`${this.baseApiUrl}/v1/messages`, {
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
        }),
      })
    );

    if (!response.ok) {
      throw new Error(`Anthropic API 错误: ${response.status}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    const textBlock = data.content.find((block) => block.type === 'text');
    return (textBlock as { text: string })?.text || '';
  }

  /**
   * 支持原生工具调用的完成方法
   */
  async completeWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    const { systemMessage, chatMessages } = this.prepareMessages(messages);

    const requestBody: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: AnthropicMessage[];
      tools?: AnthropicTool[];
      stop_sequences?: string[];
    } = {
      model: this.model,
      max_tokens: options?.maxTokens || 4096,
      system: systemMessage,
      messages: chatMessages,
      stop_sequences: options?.stopSequences,
    };

    // 如果提供了工具定义，转换为 Anthropic 格式
    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools.map((tool) =>
        this.convertToAnthropicTool(tool)
      );
    }

    const response = await this.withRetry(() =>
      fetch(`${this.baseApiUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(requestBody),
      })
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API 错误: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as AnthropicResponse;

    // 提取文本内容
    let content = '';
    const textBlocks = data.content.filter((block) => block.type === 'text');
    content = textBlocks.map((block) => (block as { text: string }).text).join('\n');

    // 提取工具调用
    const toolCalls: ToolCall[] = [];
    const toolUseBlocks = data.content.filter((block) => block.type === 'tool_use');
    
    for (const block of toolUseBlocks) {
      const toolUse = block as { id: string; name: string; input: Record<string, unknown> };
      toolCalls.push({
        id: toolUse.id,
        type: 'function',
        function: {
          name: toolUse.name,
          arguments: JSON.stringify(toolUse.input),
        },
      });
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapStopReason(data.stop_reason),
    };
  }

  /**
   * 流式工具调用支持
   */
  async *streamCompleteWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): AsyncIterable<{ type: 'content' | 'tool_call'; data: string | ToolCall }> {
    const { systemMessage, chatMessages } = this.prepareMessages(messages);

    const requestBody: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: AnthropicMessage[];
      tools?: AnthropicTool[];
      stream: boolean;
    } = {
      model: this.model,
      max_tokens: options?.maxTokens || 4096,
      system: systemMessage,
      messages: chatMessages,
      stream: true,
    };

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools.map((tool) =>
        this.convertToAnthropicTool(tool)
      );
    }

    const response = await fetch(`${this.baseApiUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
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
    const toolCallsBuffer: Map<string, Partial<ToolCall>> = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            // 处理文本内容
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield { type: 'content', data: parsed.delta.text };
            }

            // 处理工具调用开始
            if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
              const toolUse = parsed.content_block;
              toolCallsBuffer.set(toolUse.id, {
                id: toolUse.id,
                type: 'function',
                function: {
                  name: toolUse.name,
                  arguments: '',
                },
              });
            }

            // 处理工具调用输入累积
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') {
              const blockIndex = parsed.index;
              const partialJson = parsed.delta.partial_json;
              
              // 找到对应的工具调用并累积 JSON
              const toolCallEntries = Array.from(toolCallsBuffer.entries());
              if (blockIndex < toolCallEntries.length) {
                const [toolId, toolCall] = toolCallEntries[blockIndex];
                if (toolCall.function) {
                  toolCall.function.arguments += partialJson;
                  toolCallsBuffer.set(toolId, toolCall);
                }
              }
            }
          } catch {
            // 忽略解析错误
          }
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
   * 转换工具定义为 Anthropic 格式
   */
  private convertToAnthropicTool(tool: ToolDefinition): AnthropicTool {
    return {
      name: tool.function.name,
      description: tool.function.description,
      input_schema: {
        type: 'object',
        properties: tool.function.parameters.properties,
        required: tool.function.parameters.required,
      },
    };
  }

  /**
   * 准备消息（分离系统消息）
   */
  private prepareMessages(messages: LLMMessage[]): {
    systemMessage?: string;
    chatMessages: AnthropicMessage[];
  } {
    const systemMsg = messages.find((m) => m.role === 'system');
    const chatMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m): AnthropicMessage => {
        // 如果包含工具调用
        if (m.toolCalls) {
          return {
            role: 'assistant',
            content: [
              ...(m.content ? [{ type: 'text', text: m.content }] : []),
              ...m.toolCalls.map((tc) => ({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments),
              })),
            ],
          };
        }

        // 如果是工具响应
        if (m.toolCallId) {
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: m.toolCallId,
                content: m.content,
              },
            ],
          };
        }

        // 普通消息
        return {
          role: m.role as MessageRole,
          content: m.content,
        };
      });

    return {
      systemMessage: systemMsg?.content,
      chatMessages,
    };
  }

  /**
   * 映射停止原因
   */
  private mapStopReason(
    reason: string
  ): 'stop' | 'tool_calls' | 'length' | 'content_filter' {
    switch (reason) {
      case 'tool_use':
        return 'tool_calls';
      case 'max_tokens':
        return 'length';
      case 'stop_sequence':
      case 'end_turn':
      default:
        return 'stop';
    }
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