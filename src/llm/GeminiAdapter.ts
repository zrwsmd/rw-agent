// src/llm/GeminiAdapter.ts (Fixed)

import {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMConfig,
  LLMAdapter,
  LLMResponse,
  ToolCall,
  ToolDefinition,
} from '../types/llm';
import { BaseLLMAdapter } from './BaseLLMAdapter';

interface GeminiTextPart {
  text: string;
}

interface GeminiFunctionCallPart {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
  };
  thoughtSignature?: string;
}

interface GeminiFunctionResponsePart {
  functionResponse: {
    name: string;
    response: {
      content: string;
    };
  };
}

type GeminiPart = GeminiTextPart | GeminiFunctionCallPart | GeminiFunctionResponsePart;

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: GeminiPart[];
      role: string;
    };
    finishReason: string;
  }>;
}

/**
 * Type guard for text parts
 */
function isTextPart(part: GeminiPart): part is GeminiTextPart {
  return 'text' in part;
}

/**
 * Type guard for function call parts
 */
function isFunctionCallPart(part: GeminiPart): part is GeminiFunctionCallPart {
  return 'functionCall' in part;
}

/**
 * Type guard for function response parts
 */
function isFunctionResponsePart(part: GeminiPart): part is GeminiFunctionResponsePart {
  return 'functionResponse' in part;
}

/**
 * Gemini 适配器（支持函数调用）
 */
export class GeminiAdapter extends BaseLLMAdapter {
  private baseApiUrl: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    super(apiKey, model, baseUrl);
    this.baseApiUrl = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  supportsNativeTools(): boolean {
    return true;
  }

  async *streamComplete(
    messages: LLMMessage[],
    options?: LLMOptions
  ): AsyncIterable<string> {
    const { systemInstruction, contents } = this.prepareMessages(messages);

    console.log('[Gemini] 开始流式请求, 模型:', this.model);

    const requestBody = {
      contents,
      systemInstruction: systemInstruction
        ? { parts: [{ text: systemInstruction }] }
        : undefined,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
        stopSequences: options?.stopSequences,
      },
    };

    const response = await this.withRetry(() =>
      fetch(
        `${this.baseApiUrl}/models/${this.model}:streamGenerateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      )
    );

    console.log('[Gemini] 响应状态:', response.status);

    if (!response.ok) {
      const error = await response.text();
      console.error('[Gemini] API 错误:', error);
      throw new Error(`Gemini API 错误: ${response.status} - ${error}`);
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
    }

    console.log('[Gemini] 完整响应长度:', buffer.length);

    try {
      const data = JSON.parse(buffer) as GeminiResponse[];

      for (const item of data) {
        const parts = item?.candidates?.[0]?.content?.parts;
        if (parts) {
          for (const part of parts) {
            if (isTextPart(part)) {
              console.log('[Gemini] 解析到文本:', part.text.substring(0, 50));
              yield part.text;
            }
          }
        }
      }
    } catch (e) {
      console.error('[Gemini] JSON 解析错误:', e);
      try {
        const data = JSON.parse(buffer) as GeminiResponse;
        const parts = data?.candidates?.[0]?.content?.parts;
        if (parts) {
          for (const part of parts) {
            if (isTextPart(part)) {
              yield part.text;
            }
          }
        }
      } catch {
        console.error('[Gemini] 无法解析响应');
      }
    }
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const { systemInstruction, contents } = this.prepareMessages(messages);

    const response = await this.withRetry(() =>
      fetch(
        `${this.baseApiUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents,
            systemInstruction: systemInstruction
              ? { parts: [{ text: systemInstruction }] }
              : undefined,
            generationConfig: {
              temperature: options?.temperature ?? 0.7,
              maxOutputTokens: options?.maxTokens,
              stopSequences: options?.stopSequences,
            },
          }),
        }
      )
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API 错误: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const parts = data.candidates?.[0]?.content?.parts;
    
    if (!parts) return '';
    
    return parts
      .filter(isTextPart)
      .map(part => part.text)
      .join('');
  }

  /**
   * 支持原生工具调用的完成方法
   */
  async completeWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    const { systemInstruction, contents } = this.prepareMessages(messages);

    const requestBody: {
      contents: GeminiContent[];
      systemInstruction?: { parts: Array<{ text: string }> };
      tools?: GeminiTool[];
      generationConfig: {
        temperature: number;
        maxOutputTokens?: number;
        stopSequences?: string[];
      };
    } = {
      contents,
      systemInstruction: systemInstruction
        ? { parts: [{ text: systemInstruction }] }
        : undefined,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
        stopSequences: options?.stopSequences,
      },
    };

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = [
        {
          functionDeclarations: options.tools.map((tool) =>
            this.convertToGeminiTool(tool)
          ),
        },
      ];
    }

    const response = await this.withRetry(() =>
      fetch(
        `${this.baseApiUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      )
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API 错误: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];

    if (!candidate) {
      return {
        content: '',
        finishReason: 'stop',
      };
    }

    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const part of candidate.content.parts) {
      if (isTextPart(part)) {
        content += part.text;
      } else if (isFunctionCallPart(part)) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
          thoughtSignature: part.thoughtSignature, // Gemini 3 requires this
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapFinishReason(candidate.finishReason),
    };
  }

  /**
   * 流式工具调用支持
   */
  async *streamCompleteWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): AsyncIterable<{ type: 'content' | 'tool_call'; data: string | ToolCall }> {
    const { systemInstruction, contents } = this.prepareMessages(messages);

    const requestBody: {
      contents: GeminiContent[];
      systemInstruction?: { parts: Array<{ text: string }> };
      tools?: GeminiTool[];
      generationConfig: {
        temperature: number;
        maxOutputTokens?: number;
        stopSequences?: string[];
      };
    } = {
      contents,
      systemInstruction: systemInstruction
        ? { parts: [{ text: systemInstruction }] }
        : undefined,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
        stopSequences: options?.stopSequences,
      },
    };

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = [
        {
          functionDeclarations: options.tools.map((tool) =>
            this.convertToGeminiTool(tool)
          ),
        },
      ];
    }

    const response = await this.withRetry(() =>
      fetch(
        `${this.baseApiUrl}/models/${this.model}:streamGenerateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      )
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API 错误: ${response.status} - ${error}`);
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
    }

    try {
      const items = JSON.parse(buffer) as GeminiResponse[];

      for (const item of items) {
        const candidate = item?.candidates?.[0];
        if (!candidate) continue;

        for (const part of candidate.content.parts) {
          if (isTextPart(part) && part.text) {
            yield { type: 'content', data: part.text };
          } else if (isFunctionCallPart(part)) {
            const toolCall: ToolCall = {
              id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
              type: 'function',
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args),
              },
              thoughtSignature: part.thoughtSignature, // Gemini 3 requires this
            };
            yield { type: 'tool_call', data: toolCall };
          }
        }
      }
    } catch (e) {
      console.error('[Gemini] 流式解析错误:', e);
      try {
        const data = JSON.parse(buffer) as GeminiResponse;
        const candidate = data?.candidates?.[0];
        if (candidate) {
          for (const part of candidate.content.parts) {
            if (isTextPart(part) && part.text) {
              yield { type: 'content', data: part.text };
            } else if (isFunctionCallPart(part)) {
              const toolCall: ToolCall = {
                id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                type: 'function',
                function: {
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args),
                },
                thoughtSignature: part.thoughtSignature, // Gemini 3 requires this
              };
              yield { type: 'tool_call', data: toolCall };
            }
          }
        }
      } catch {
        console.error('[Gemini] 无法解析响应');
      }
    }
  }

  /**
   * 转换工具定义为 Gemini 格式
   */
  private convertToGeminiTool(tool: ToolDefinition) {
    return {
      name: tool.function.name,
      description: tool.function.description,
      parameters: {
        type: 'object' as const,
        properties: tool.function.parameters.properties,
        required: tool.function.parameters.required,
      },
    };
  }

  /**
   * 准备消息（处理工具调用和响应）
   */
  private prepareMessages(messages: LLMMessage[]): {
    systemInstruction?: string;
    contents: GeminiContent[];
  } {
    const systemMsg = messages.find((m) => m.role === 'system');
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue;

      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: GeminiPart[] = [];

      if (msg.content) {
        parts.push({ text: msg.content });
      }

      if (msg.toolCalls) {
        for (const toolCall of msg.toolCalls) {
          const fcPart: GeminiFunctionCallPart = {
            functionCall: {
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments),
            },
          };
          // Gemini 3 requires thoughtSignature to be passed back
          if (toolCall.thoughtSignature) {
            fcPart.thoughtSignature = toolCall.thoughtSignature;
          }
          parts.push(fcPart);
        }
      }

      if (msg.toolCallId) {
        const prevMsg = messages[messages.indexOf(msg) - 1];
        const toolCall = prevMsg?.toolCalls?.find((tc) => tc.id === msg.toolCallId);
        
        if (toolCall) {
          parts.push({
            functionResponse: {
              name: toolCall.function.name,
              response: {
                content: msg.content,
              },
            },
          });
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    return {
      systemInstruction: systemMsg?.content,
      contents,
    };
  }

  /**
   * 映射完成原因
   */
  private mapFinishReason(
    reason?: string
  ): 'stop' | 'tool_calls' | 'length' | 'content_filter' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
        return 'content_filter';
      case 'RECITATION':
        return 'content_filter';
      case 'OTHER':
      default:
        return 'stop';
    }
  }
}

/**
 * Gemini 提供商
 */
export class GeminiProvider implements LLMProvider {
  name = 'gemini';

  createAdapter(config: LLMConfig): LLMAdapter {
    return new GeminiAdapter(config.apiKey, config.model, config.baseUrl);
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