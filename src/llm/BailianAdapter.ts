// src/llm/BailianAdapter.ts

import { 
  LLMMessage, 
  LLMOptions, 
  LLMProvider, 
  LLMConfig, 
  LLMResponse 
} from '../types/llm';
import { OpenAIAdapter } from './OpenAIAdapter';

/**
 * 阿里百炼适配器（基于OpenAI兼容API）
 */
export class BailianAdapter extends OpenAIAdapter {
  constructor(apiKey: string, model: string) {
    // 百炼平台的API端点
    const baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    super(apiKey, model, baseUrl);
  }

  /**
   * 百炼平台支持的模型验证
   */
  static isValidModel(model: string): boolean {
    const supportedModels = [
      // 通义千问系列
      'qwen-max', 'qwen-max-0428', 'qwen-max-0403', 'qwen-max-0107', 'qwen-max-longcontext',
      'qwen-plus', 'qwen-plus-0828', 'qwen-plus-0723',
      'qwen-turbo', 'qwen-turbo-0624', 'qwen-turbo-0206',
      
      // 全模态模型系列
      'qwen3-omni-flash-2025-12-01', 'qwen-omni-turbo', 'qwen-omni-turbo-realtime', 'qwen-omni-turbo-realtime-latest',
      
      // 通义千问2.5系列
      'qwen2.5-72b-instruct', 'qwen2.5-32b-instruct', 'qwen2.5-14b-instruct',
      'qwen2.5-7b-instruct', 'qwen2.5-3b-instruct', 'qwen2.5-1.5b-instruct', 'qwen2.5-0.5b-instruct',
      
      // 通义千问2系列
      'qwen2-72b-instruct', 'qwen2-57b-a14b-instruct', 'qwen2-7b-instruct',
      'qwen2-1.5b-instruct', 'qwen2-0.5b-instruct',
      
      // 通义千问1.5系列
      'qwen1.5-110b-chat', 'qwen1.5-72b-chat', 'qwen1.5-32b-chat', 'qwen1.5-14b-chat',
      'qwen1.5-7b-chat', 'qwen1.5-4b-chat', 'qwen1.5-1.8b-chat', 'qwen1.5-0.5b-chat',
      
      // 代码专用模型
      'qwen3-coder-plus', 'qwen-coder-plus',
      'qwen2.5-coder-32b-instruct', 'qwen2.5-coder-14b-instruct', 'qwen2.5-coder-7b-instruct',
      'qwen2.5-coder-1.5b-instruct', 'codeqwen1.5-7b-chat',
      
      // 数学专用模型
      'qwen2.5-math-72b-instruct', 'qwen2.5-math-7b-instruct', 'qwen2.5-math-1.5b-instruct',
      
      // DeepSeek系列
      'deepseek-v3.2-exp', 'deepseek-v3.2', 'deepseek-v3', 'deepseek-r1', 'deepseek-chat', 'deepseek-coder',
      
      // 其他开源模型
      'llama3.1-405b-instruct', 'llama3.1-70b-instruct', 'llama3.1-8b-instruct',
      'llama3-70b-instruct', 'llama3-8b-instruct',
      'baichuan2-13b-chat-v1', 'baichuan2-7b-chat-v1',
      'chatglm3-6b', 'yi-34b-chat-0205', 'yi-6b-chat'
    ];
    
    return supportedModels.includes(model);
  }

  /**
   * 获取模型的推荐参数
   */
  static getModelRecommendedParams(model: string): Partial<LLMOptions> {
    // 根据不同模型返回推荐参数
    if (model.includes('qwen-max') || model.includes('qwen3-omni')) {
      return {
        temperature: 0.7,
        maxTokens: 8192
      };
    } else if (model.includes('qwen-plus') || model.includes('qwen-omni')) {
      return {
        temperature: 0.7,
        maxTokens: 8192
      };
    } else if (model.includes('qwen-turbo')) {
      return {
        temperature: 0.7,
        maxTokens: 8192
      };
    } else if (model.includes('coder') || model.includes('qwen3-coder-plus') || model.includes('qwen-coder-plus')) {
      return {
        temperature: 0.1, // 代码模型使用较低温度
        maxTokens: 8192
      };
    } else if (model.includes('math')) {
      return {
        temperature: 0.1, // 数学模型使用较低温度
        maxTokens: 4096
      };
    } else if (model.includes('deepseek')) {
      return {
        temperature: 0.7,
        maxTokens: 8192
      };
    }
    
    // 默认参数
    return {
      temperature: 0.7,
      maxTokens: 4096
    };
  }
}

/**
 * 百炼提供商
 */
export class BailianProvider implements LLMProvider {
  name = 'bailian';

  createAdapter(config: LLMConfig): BailianAdapter {
    if (!config.apiKey) {
      throw new Error('百炼 API Key 是必需的');
    }
    
    if (!BailianAdapter.isValidModel(config.model)) {
      throw new Error(`不支持的百炼模型: ${config.model}`);
    }
    
    return new BailianAdapter(config.apiKey, config.model);
  }

  async validateConfig(config: LLMConfig): Promise<boolean> {
    try {
      if (!config.apiKey || !config.model) {
        return false;
      }
      
      if (!BailianAdapter.isValidModel(config.model)) {
        return false;
      }
      
      // 创建适配器并测试连接
      const adapter = this.createAdapter(config);
      await adapter.complete([{ role: 'user', content: 'test' }]);
      return true;
    } catch (error) {
      console.error('百炼配置验证失败:', error);
      return false;
    }
  }

  getSupportedModels(): string[] {
    return [
      'qwen-max', 'qwen-plus', 'qwen-turbo',
      'qwen3-omni-flash-2025-12-01', 'qwen-omni-turbo', 'qwen-omni-turbo-realtime', 'qwen-omni-turbo-realtime-latest',
      'qwen3-coder-plus', 'qwen-coder-plus',
      'qwen2.5-72b-instruct', 'qwen2.5-32b-instruct', 'qwen2.5-14b-instruct',
      'qwen2.5-coder-32b-instruct', 'qwen2.5-math-72b-instruct',
      'deepseek-v3.2-exp', 'deepseek-v3.2', 'deepseek-v3', 'deepseek-r1', 'llama3.1-405b-instruct'
    ];
  }

  getProviderName(): string {
    return 'bailian';
  }

  getDisplayName(): string {
    return '阿里百炼';
  }
}