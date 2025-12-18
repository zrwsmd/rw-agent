import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Conversation } from '../types/conversation';
import { ConversationSerializerImpl } from '../serializer/ConversationSerializer';

/**
 * 对话列表项
 */
export interface ConversationListItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/**
 * 对话存储管理器
 */
export class ConversationStorage {
  private serializer: ConversationSerializerImpl;
  private conversationsDir: string;
  private currentIdKey = 'vscode-agent.currentConversationId';

  constructor(private context: vscode.ExtensionContext, private workspaceRoot: string) {
    this.serializer = new ConversationSerializerImpl();
    this.conversationsDir = path.join(workspaceRoot, '.vscode-agent', 'conversations');
    this.ensureDirectoryExists();
  }

  /**
   * 确保对话目录存在
   */
  private ensureDirectoryExists(): void {
    try {
      if (!fs.existsSync(this.conversationsDir)) {
        fs.mkdirSync(this.conversationsDir, { recursive: true });
      }
    } catch (error) {
      console.error('[ConversationStorage] 创建对话目录失败:', error);
    }
  }

  /**
   * 创建新对话
   */
  createConversation(title?: string): Conversation {
    const id = this.generateId();
    const now = Date.now();

    const conversation: Conversation = {
      id,
      title: title || `对话 ${new Date().toLocaleString()}`,
      messages: [],
      metadata: {
        model: 'unknown',
        totalTokens: 0,
        toolsUsed: [],
      },
      createdAt: now,
      updatedAt: now,
    };

    return conversation;
  }

  /**
   * 保存对话
   */
  async saveConversation(conversation: Conversation): Promise<void> {
    try {
      conversation.updatedAt = Date.now();
      const json = this.serializer.serialize(conversation);
      const filePath = path.join(this.conversationsDir, `${conversation.id}.json`);
      fs.writeFileSync(filePath, json, 'utf8');
    } catch (error) {
      console.error('[ConversationStorage] 保存对话失败:', error);
      throw error;
    }
  }

  /**
   * 加载对话
   */
  async loadConversation(id: string): Promise<Conversation | null> {
    try {
      const filePath = path.join(this.conversationsDir, `${id}.json`);
      if (!fs.existsSync(filePath)) {
        return null;
      }
      
      const json = fs.readFileSync(filePath, 'utf8');
      return this.serializer.deserialize(json);
    } catch (error) {
      console.error(`[ConversationStorage] 加载对话失败: ${id}`, error);
      return null;
    }
  }

  /**
   * 删除对话
   */
  async deleteConversation(id: string): Promise<void> {
    try {
      const filePath = path.join(this.conversationsDir, `${id}.json`);
      console.log(`[ConversationStorage] 尝试删除对话文件: ${filePath}`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[ConversationStorage] 对话文件删除成功: ${id}`);
      } else {
        console.log(`[ConversationStorage] 对话文件不存在: ${filePath}`);
      }
    } catch (error) {
      console.error(`[ConversationStorage] 删除对话失败: ${id}`, error);
      throw error;
    }
  }

  /**
   * 获取所有对话列表
   */
  async listConversations(): Promise<ConversationListItem[]> {
    const list: ConversationListItem[] = [];

    try {
      if (!fs.existsSync(this.conversationsDir)) {
        return list;
      }

      const files = fs.readdirSync(this.conversationsDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = path.join(this.conversationsDir, file);
          const json = fs.readFileSync(filePath, 'utf8');
          const conv = this.serializer.deserialize(json);
          
          list.push({
            id: conv.id,
            title: conv.title,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
            messageCount: conv.messages.length,
          });
        } catch (error) {
          console.error(`[ConversationStorage] 解析对话文件失败: ${file}`, error);
        }
      }
    } catch (error) {
      console.error('[ConversationStorage] 读取对话目录失败:', error);
    }

    // 按更新时间倒序排列
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * 设置当前对话 ID
   */
  async setCurrentConversationId(id: string | null): Promise<void> {
    await this.context.globalState.update(this.currentIdKey, id);
  }

  /**
   * 获取当前对话 ID
   */
  getCurrentConversationId(): string | null {
    return this.context.globalState.get<string>(this.currentIdKey) || null;
  }

  /**
   * 加载当前对话
   */
  async loadCurrentConversation(): Promise<Conversation | null> {
    const id = this.getCurrentConversationId();
    if (!id) return null;
    return this.loadConversation(id);
  }

  /**
   * 更新对话标题
   */
  async updateTitle(id: string, title: string): Promise<void> {
    const conversation = await this.loadConversation(id);
    if (conversation) {
      conversation.title = title;
      await this.saveConversation(conversation);
    }
  }

  /**
   * 从消息生成对话标题
   */
  generateTitleFromMessage(message: string): string {
    // 取前 30 个字符作为标题
    const title = message.trim().substring(0, 30);
    return title.length < message.trim().length ? title + '...' : title;
  }

  /**
   * 获取对话存储目录
   */
  getConversationsDirectory(): string {
    return this.conversationsDir;
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

/**
 * 创建对话存储实例
 */
export function createConversationStorage(context: vscode.ExtensionContext, workspaceRoot: string): ConversationStorage {
  return new ConversationStorage(context, workspaceRoot);
}
