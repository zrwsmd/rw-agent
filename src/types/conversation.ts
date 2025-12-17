import { Message } from './context';

/**
 * 对话元数据
 */
export interface ConversationMetadata {
  model: string;
  totalTokens: number;
  toolsUsed: string[];
}

/**
 * 对话
 */
export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  metadata: ConversationMetadata;
  createdAt: number;
  updatedAt: number;
}

/**
 * 对话序列化器接口
 */
export interface ConversationSerializer {
  serialize(conversation: Conversation): string;
  deserialize(json: string): Conversation;
  exportReadable(conversation: Conversation): string;
}
