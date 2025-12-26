/**
 * Token 计数器
 * 用于估算和统计 Token 使用量
 */

/**
 * 不同模型的 Token 限制
 */
export const MODEL_TOKEN_LIMITS: Record<string, number> = {
  // OpenAI
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16385,
  
  // Anthropic
  'claude-sonnet-4-20250514': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-opus-20240229': 200000,
  'claude-3-haiku-20240307': 200000,
  
  // Gemini
  'gemini-2.5-flash': 1000000,
  'gemini-2.5-pro': 1000000,
  'gemini-2.0-flash': 1000000,
  'gemini-1.5-flash': 1000000,
  'gemini-1.5-pro': 2000000,
  
  // 百炼平台 - qwen-max设置很小的限制用于测试智能上下文管理
  'qwen-max': 32768, // 测试用：只能问2个问题左右
  'qwen-plus': 32768,
  'qwen-turbo': 8192,
  'qwen2.5-72b-instruct': 32768,
  'qwen2.5-32b-instruct': 32768,
  'qwen2.5-14b-instruct': 32768,
  'qwen2.5-7b-instruct': 32768,
  'qwen2.5-3b-instruct': 32768,
  'qwen2.5-1.5b-instruct': 32768,
  'qwen2.5-0.5b-instruct': 32768,
  'qwen2-72b-instruct': 32768,
  'qwen2-57b-a14b-instruct': 32768,
  'qwen2-7b-instruct': 32768,
  'qwen2-1.5b-instruct': 32768,
  'qwen2-0.5b-instruct': 32768,
  'qwen1.5-110b-chat': 32768,
  'qwen1.5-72b-chat': 32768,
  'qwen1.5-32b-chat': 32768,
  'qwen1.5-14b-chat': 32768,
  'qwen1.5-7b-chat': 32768,
  'qwen1.5-4b-chat': 32768,
  'qwen1.5-1.8b-chat': 32768,
  'qwen1.5-0.5b-chat': 32768,
  'qwen-72b-chat': 32768,
  'qwen-14b-chat': 8192,
  'qwen-7b-chat': 8192,
  'qwen-1.8b-chat': 8192,
  'deepseek-chat': 32768,
  'deepseek-coder': 32768,
  'deepseek-v3': 64000,
  'deepseek-v3.2': 200,
  'deepseek-v3.2-exp': 64000,
  'llama2-7b-chat-v2': 4096,
  'llama2-13b-chat-v2': 4096,
  'llama3-8b-instruct': 8192,
  'llama3-70b-instruct': 8192,
  'llama3.1-8b-instruct': 128000,
  'llama3.1-70b-instruct': 128000,
  'llama3.1-405b-instruct': 128000,
  'llama3.2-1b-instruct': 128000,
  'llama3.2-3b-instruct': 128000,
  'llama3.2-11b-vision-instruct': 128000,
  'llama3.2-90b-vision-instruct': 128000,
  'baichuan2-13b-chat-v1': 4096,
  'baichuan2-7b-chat-v1': 4096,
  'chatglm3-6b': 32768,
  'chatglm-6b-v2': 32768,
  'qwen3-omni-flash-2025-12-01': 32768,
  'qwen-omni-turbo': 32768,
  'qwen-omni-turbo-realtime': 32768,
  'qwen-omni-turbo-realtime-latest': 32768,
  'qwen3-coder-plus': 32768,
  'qwen-coder-plus': 32768,
};

/**
 * 默认 Token 限制（未知模型）
 */
export const DEFAULT_TOKEN_LIMIT = 8192;

/**
 * Token 使用统计
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Token 计数器类
 */
export class TokenCounter {
  private totalPromptTokens = 0;
  private totalCompletionTokens = 0;
  private sessionStartTime: number;

  constructor() {
    this.sessionStartTime = Date.now();
  }

  /**
   * 估算文本的 Token 数
   * 简单启发式：英文约 4 字符/token，中文约 1.5 字符/token
   */
  static estimateTokens(text: string): number {
    if (!text) return 0;
    
    // 统计中文字符
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const otherChars = text.length - chineseChars;
    
    // 中文约 1.5 字符/token，其他约 4 字符/token
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }

  /**
   * 估算消息数组的 Token 数
   */
  static estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
    let total = 0;
    for (const msg of messages) {
      // 每条消息有额外开销（角色标记等），约 4 tokens
      total += 4;
      total += TokenCounter.estimateTokens(msg.content);
    }
    // 消息数组有额外开销，约 3 tokens
    total += 3;
    return total;
  }

  /**
   * 获取模型的 Token 限制
   */
  static getModelLimit(model: string): number {
    console.log('[TokenCounter] 检查模型限制:', model);
    
    // 尝试精确匹配
    if (MODEL_TOKEN_LIMITS[model]) {
      console.log('[TokenCounter] 精确匹配到限制:', MODEL_TOKEN_LIMITS[model]);
      return MODEL_TOKEN_LIMITS[model];
    }
    
    // 尝试前缀匹配
    for (const [key, limit] of Object.entries(MODEL_TOKEN_LIMITS)) {
      if (model.startsWith(key)) {
        console.log('[TokenCounter] 前缀匹配到限制:', key, limit);
        return limit;
      }
    }
    
    console.log('[TokenCounter] 使用默认限制:', DEFAULT_TOKEN_LIMIT);
    return DEFAULT_TOKEN_LIMIT;
  }

  /**
   * 记录 Token 使用
   */
  recordUsage(usage: TokenUsage): void {
    this.totalPromptTokens += usage.promptTokens;
    this.totalCompletionTokens += usage.completionTokens;
  }

  /**
   * 记录提示 Token
   */
  recordPromptTokens(tokens: number): void {
    this.totalPromptTokens += tokens;
  }

  /**
   * 记录完成 Token
   */
  recordCompletionTokens(tokens: number): void {
    this.totalCompletionTokens += tokens;
  }

  /**
   * 获取当前会话的 Token 使用统计
   */
  getSessionUsage(): TokenUsage & { sessionDuration: number } {
    return {
      promptTokens: this.totalPromptTokens,
      completionTokens: this.totalCompletionTokens,
      totalTokens: this.totalPromptTokens + this.totalCompletionTokens,
      sessionDuration: Date.now() - this.sessionStartTime,
    };
  }

  /**
   * 重置统计
   */
  reset(): void {
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.sessionStartTime = Date.now();
  }

  /**
   * 检查是否接近 Token 限制
   */
  static isNearLimit(currentTokens: number, model: string, threshold = 0.9): boolean {
    const limit = TokenCounter.getModelLimit(model);
    return currentTokens >= limit * threshold;
  }

  /**
   * 计算剩余可用 Token
   */
  static getRemainingTokens(currentTokens: number, model: string): number {
    const limit = TokenCounter.getModelLimit(model);
    return Math.max(0, limit - currentTokens);
  }

  /**
   * 格式化 Token 数量显示
   */
  static formatTokens(tokens: number): string {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
  }
}

/**
 * 创建 Token 计数器实例
 */
export function createTokenCounter(): TokenCounter {
  return new TokenCounter();
}
