import { ToolResult } from './tool';
import { LLMMessage } from './llm';

/**
 * 消息角色
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * 工具调用信息
 */
export interface ToolCallInfo {
  name: string;
  parameters: Record<string, unknown>;
  result: ToolResult;
}

/**
 * 消息
 */
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCall?: ToolCallInfo;
}

/**
 * 上下文管理器接口
 */
export interface ContextManager {
  addMessage(message: Message): void;
  getContext(maxTokens: number): LLMMessage[];
  clear(): void;
  getHistory(): Message[];
  removeLastMessage(): Message | null;
}
