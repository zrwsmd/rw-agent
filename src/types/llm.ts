// src/types/llm.ts

/**
 * 图片内容
 */
export interface ImageContent {
  type: 'image';
  mimeType: string; // e.g., 'image/png', 'image/jpeg'
  data: string; // base64 encoded
}

/**
 * 文本内容
 */
export interface TextContent {
  type: 'text';
  text: string;
}

/**
 * 消息内容（支持多模态）
 */
export type MessageContent = string | (TextContent | ImageContent)[];

/**
 * LLM 消息
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: MessageContent;
  toolCalls?: ToolCall[];
  toolCallId?: string; // For tool response messages
}

/**
 * 工具调用
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
  thoughtSignature?: string; // Gemini 3 requires this for function calling
}

/**
 * 工具定义（OpenAI/Anthropic 格式）
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, ParameterSchema>;
      required: string[];
    };
  };
}

/**
 * 参数 Schema
 */
export interface ParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: ParameterSchema;
}

/**
 * LLM 调用选项
 */
export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  tools?: ToolDefinition[]; // Native tool definitions
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

/**
 * LLM 响应
 */
export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
}

/**
 * LLM 配置
 */
export interface LLMConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  supportsNativeTools?: boolean; // Flag for capability
}

/**
 * LLM 适配器接口
 */
export interface LLMAdapter {
  streamComplete(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<string>;
  complete(messages: LLMMessage[], options?: LLMOptions): Promise<string>;
  
  // New methods for function calling
  completeWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse>;
  
  streamCompleteWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): AsyncIterable<{ type: 'content' | 'tool_call'; data: string | ToolCall }>;
  
  supportsNativeTools(): boolean;
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