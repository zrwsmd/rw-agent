import { ContextManager as IContextManager, Message } from '../types/context';
import { LLMMessage } from '../types/llm';

/**
 * 简单的 token 估算：约 4 字符 = 1 token（英文），中文约 1.5 字符 = 1 token
 */
function estimateTokens(text: string): number {
  // 简单启发式：英文约 4 字符/token，中文约 1.5 字符/token
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 上下文管理器实现
 */
export class ContextManagerImpl implements IContextManager {
  private messages: Message[] = [];
  private systemPrompt: string | null = null;

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
      const content = this.formatMessageContent(msg);
      const msgTokens = estimateTokens(content);

      if (currentTokens + msgTokens > maxTokens) {
        break;
      }

      const role = this.mapRole(msg.role);
      messagesToInclude.unshift({ role, content });
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
