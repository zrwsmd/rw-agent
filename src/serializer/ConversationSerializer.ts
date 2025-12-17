import {
  Conversation,
  ConversationSerializer as IConversationSerializer,
  ConversationMetadata,
} from '../types/conversation';
import { Message, MessageRole, ToolCallInfo } from '../types/context';

/**
 * 序列化模式版本
 */
const SCHEMA_VERSION = 1;

/**
 * 序列化后的对话格式
 */
interface SerializedConversation {
  version: number;
  id: string;
  title: string;
  messages: SerializedMessage[];
  metadata: ConversationMetadata;
  createdAt: number;
  updatedAt: number;
}

/**
 * 序列化后的消息格式
 */
interface SerializedMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCall?: ToolCallInfo;
}

/**
 * 对话序列化器实现
 */
export class ConversationSerializerImpl implements IConversationSerializer {
  /**
   * 将对话序列化为 JSON 字符串
   */
  serialize(conversation: Conversation): string {
    const serialized: SerializedConversation = {
      version: SCHEMA_VERSION,
      id: conversation.id,
      title: conversation.title,
      messages: conversation.messages.map((msg) => this.serializeMessage(msg)),
      metadata: { ...conversation.metadata },
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
    return JSON.stringify(serialized, null, 2);
  }

  /**
   * 从 JSON 字符串反序列化为对话
   */
  deserialize(json: string): Conversation {
    const parsed = JSON.parse(json) as SerializedConversation;

    // 处理版本兼容性
    const migrated = this.migrateIfNeeded(parsed);

    return {
      id: migrated.id,
      title: migrated.title,
      messages: migrated.messages.map((msg) => this.deserializeMessage(msg)),
      metadata: migrated.metadata,
      createdAt: migrated.createdAt,
      updatedAt: migrated.updatedAt,
    };
  }

  /**
   * 导出为人类可读格式
   */
  exportReadable(conversation: Conversation): string {
    const lines: string[] = [];

    lines.push(`# ${conversation.title}`);
    lines.push(`ID: ${conversation.id}`);
    lines.push(`创建时间: ${new Date(conversation.createdAt).toLocaleString()}`);
    lines.push(`更新时间: ${new Date(conversation.updatedAt).toLocaleString()}`);
    lines.push(`模型: ${conversation.metadata.model}`);
    lines.push(`总 Token 数: ${conversation.metadata.totalTokens}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const message of conversation.messages) {
      const roleLabel = this.getRoleLabel(message.role);
      const time = new Date(message.timestamp).toLocaleTimeString();

      lines.push(`## [${time}] ${roleLabel}`);
      lines.push('');
      lines.push(message.content);

      if (message.toolCall) {
        lines.push('');
        lines.push(`> 工具调用: ${message.toolCall.name}`);
        lines.push(`> 参数: ${JSON.stringify(message.toolCall.parameters)}`);
        lines.push(
          `> 结果: ${message.toolCall.result.success ? '成功' : '失败'}`
        );
        if (message.toolCall.result.output) {
          lines.push(`> 输出: ${message.toolCall.result.output}`);
        }
        if (message.toolCall.result.error) {
          lines.push(`> 错误: ${message.toolCall.result.error}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 序列化单条消息
   */
  private serializeMessage(message: Message): SerializedMessage {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      toolCall: message.toolCall ? { ...message.toolCall } : undefined,
    };
  }

  /**
   * 反序列化单条消息
   */
  private deserializeMessage(serialized: SerializedMessage): Message {
    return {
      id: serialized.id,
      role: serialized.role,
      content: serialized.content,
      timestamp: serialized.timestamp,
      toolCall: serialized.toolCall ? { ...serialized.toolCall } : undefined,
    };
  }

  /**
   * 版本迁移处理
   */
  private migrateIfNeeded(
    data: SerializedConversation
  ): SerializedConversation {
    let current = data;

    // 处理没有版本号的旧数据（版本 0）
    if (!current.version) {
      current = this.migrateV0ToV1(current);
    }

    // 未来版本迁移可以在这里添加
    // if (current.version === 1) {
    //   current = this.migrateV1ToV2(current);
    // }

    return current;
  }

  /**
   * 从版本 0 迁移到版本 1
   */
  private migrateV0ToV1(
    data: SerializedConversation
  ): SerializedConversation {
    return {
      ...data,
      version: 1,
      metadata: data.metadata || {
        model: 'unknown',
        totalTokens: 0,
        toolsUsed: [],
      },
    };
  }

  /**
   * 获取角色显示标签
   */
  private getRoleLabel(role: MessageRole): string {
    const labels: Record<MessageRole, string> = {
      user: '用户',
      assistant: '助手',
      system: '系统',
      tool: '工具',
    };
    return labels[role] || role;
  }
}

/**
 * 创建序列化器实例
 */
export function createConversationSerializer(): IConversationSerializer {
  return new ConversationSerializerImpl();
}
