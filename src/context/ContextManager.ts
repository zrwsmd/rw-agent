import { ContextManager as IContextManager, Message } from '../types/context';
import { LLMMessage } from '../types/llm';
import { TokenCounter } from '../utils/TokenCounter';

/**
 * 简单的 token 估算：约 4 字符 = 1 token（英文），中文约 1.5 字符 = 1 token
 */
function estimateTokens(text: string): number {
  return TokenCounter.estimateTokens(text);
}

/**
 * 上下文管理器实现
 */
export class ContextManagerImpl implements IContextManager {
  private messages: Message[] = [];
  private systemPrompt: string | null = null;
  private tokenCounter: TokenCounter;
  private model: string = 'gpt-4o';

  constructor() {
    this.tokenCounter = new TokenCounter();
  }

  /**
   * 设置当前使用的模型
   */
  setModel(model: string): void {
    this.model = model;
  }

  /**
   * 获取当前模型
   */
  getModel(): string {
    return this.model;
  }

  /**
   * 设置系统提示
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * 添加消息到历史
   */
  addMessage(message: Message): void {
    this.messages.push(message);
  }

  /**
   * 获取适合 LLM 的上下文，在 token 限制内
   */
  getContext(maxTokens: number): LLMMessage[] {
    const result: LLMMessage[] = [];
    let currentTokens = 0;

    // 首先添加系统提示（如果有）
    if (this.systemPrompt) {
      const systemTokens = estimateTokens(this.systemPrompt);
      if (systemTokens <= maxTokens) {
        result.push({ role: 'system', content: this.systemPrompt });
        currentTokens += systemTokens;
      }
    }

    // 从最新消息开始，向前添加直到达到 token 限制
    const messagesToInclude: LLMMessage[] = [];

    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      const textContent = this.formatMessageContent(msg);
      const msgTokens = estimateTokens(textContent) + (msg.images?.length || 0) * 500; // 图片估算 500 tokens

      if (currentTokens + msgTokens > maxTokens) {
        break;
      }

      const role = this.mapRole(msg.role);
      
      // 构建消息内容（支持多模态）
      if (msg.images && msg.images.length > 0) {
        const contentParts: Array<{ type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }> = [];
        
        // 先添加图片
        for (const img of msg.images) {
          contentParts.push({
            type: 'image',
            mimeType: img.mimeType,
            data: img.data,
          });
        }
        
        // 再添加文本
        if (textContent) {
          contentParts.push({ type: 'text', text: textContent });
        }
        
        messagesToInclude.unshift({ role, content: contentParts });
      } else {
        messagesToInclude.unshift({ role, content: textContent });
      }
      
      currentTokens += msgTokens;
    }

    // 合并系统提示和消息
    return [...result, ...messagesToInclude];
  }

  /**
   * 清空上下文
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * 获取完整历史
   */
  getHistory(): Message[] {
    return [...this.messages];
  }

  /**
   * 获取消息数量
   */
  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * 移除最后一条消息（用于取消操作时清理上下文）
   */
  removeLastMessage(): Message | null {
    if (this.messages.length > 0) {
      return this.messages.pop() || null;
    }
    return null;
  }

  /**
   * 估算当前上下文的 token 数
   */
  estimateCurrentTokens(): number {
    let total = 0;
    if (this.systemPrompt) {
      total += estimateTokens(this.systemPrompt);
    }
    for (const msg of this.messages) {
      total += estimateTokens(this.formatMessageContent(msg));
    }
    return total;
  }

  /**
   * 获取模型的 Token 限制
   */
  getModelTokenLimit(): number {
    return TokenCounter.getModelLimit(this.model);
  }

  /**
   * 检查是否接近 Token 限制
   */
  isNearTokenLimit(threshold = 0.9): boolean {
    const currentTokens = this.estimateCurrentTokens();
    return TokenCounter.isNearLimit(currentTokens, this.model, threshold);
  }

  /**
   * 获取剩余可用 Token
   */
  getRemainingTokens(): number {
    const currentTokens = this.estimateCurrentTokens();
    return TokenCounter.getRemainingTokens(currentTokens, this.model);
  }

  /**
   * 获取 Token 使用统计
   */
  getTokenUsage(): {
    current: number;
    limit: number;
    remaining: number;
    percentage: number;
  } {
    const current = this.estimateCurrentTokens();
    const limit = this.getModelTokenLimit();
    const remaining = Math.max(0, limit - current);
    const percentage = Math.min(100, (current / limit) * 100);

    return { current, limit, remaining, percentage };
  }

  /**
   * 记录 Token 使用（用于统计）
   */
  recordTokenUsage(promptTokens: number, completionTokens: number): void {
    this.tokenCounter.recordPromptTokens(promptTokens);
    this.tokenCounter.recordCompletionTokens(completionTokens);
  }

  /**
   * 获取会话 Token 统计
   */
  getSessionTokenStats(): {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    sessionDuration: number;
  } {
    return this.tokenCounter.getSessionUsage();
  }

  /**
   * 自动截断旧消息以保持在 Token 限制内
   * 返回被删除的消息数量
   */
  autoTruncate(reserveTokens = 4000): number {
    const limit = this.getModelTokenLimit();
    const targetTokens = limit - reserveTokens;
    let deletedCount = 0;

    while (this.estimateCurrentTokens() > targetTokens && this.messages.length > 1) {
      // 保留最新的消息，删除最旧的
      this.messages.shift();
      deletedCount++;
    }

    return deletedCount;
  }

  /**
   * 格式化消息内容（包含工具调用信息）
   */
  private formatMessageContent(message: Message): string {
    let content = message.content;

    if (message.toolCall) {
      content += `\n\n[工具调用: ${message.toolCall.name}]`;
      content += `\n参数: ${JSON.stringify(message.toolCall.parameters)}`;
      content += `\n结果: ${message.toolCall.result.output}`;
      if (message.toolCall.result.error) {
        content += `\n错误: ${message.toolCall.result.error}`;
      }
    }

    return content;
  }

  /**
   * 映射消息角色到 LLM 角色
   */
  private mapRole(role: Message['role']): LLMMessage['role'] {
    switch (role) {
      case 'user':
        return 'user';
      case 'assistant':
        return 'assistant';
      case 'system':
        return 'system';
      case 'tool':
        // 工具消息作为助手消息处理
        return 'assistant';
      default:
        return 'user';
    }
  }
}

/**
 * 创建上下文管理器实例
 */
export function createContextManager(): ContextManagerImpl {
  return new ContextManagerImpl();
}

export { estimateTokens };
