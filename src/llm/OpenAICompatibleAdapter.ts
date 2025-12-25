// src/llm/OpenAICompatibleAdapter.ts

import { 
  LLMProvider, 
  LLMConfig, 
  LLMAdapter 
} from '../types/llm';
import { OpenAIAdapter } from './OpenAIAdapter';

/**
 * OpenAI 兼容适配器
 * 用于连接任何兼容 OpenAI API 格式的服务
 */
export class OpenAICompatibleAdapter extends OpenAIAdapter {
  constructor(apiKey: string, model: string, baseUrl?: string) {
    if (!baseUrl || baseUrl.trim() === '') {
      throw new Error('OpenAI Compatible 提供商需要指定 Base URL');
    }
    super(apiKey, model, baseUrl);
  }

  /**
   * 验证模型名称（OpenAI Compatible 允许任何模型名称）
   */
  static isValidModel(model: string): boolean {
    // OpenAI Compatible 允许任何模型名称，因为不同服务有不同的模型
    return !!(model && model.trim().length > 0);
  }

  /**
   * 获取推荐参数
   */
  static getModelRecommendedParams(model: string): Partial<any> {
    // 使用通用的默认参数
    return {
      temperature: 0.7,
      maxTokens: 4096
    };
  }
}

/**
 * OpenAI Compatible 提供商
 */
export class OpenAICompatibleProvider implements LLMProvider {
  name = 'openai-compatible';

  createAdapter(config: LLMConfig): OpenAICompatibleAdapter {
    if (!config.apiKey) {
      throw new Error('API Key 是必需的');
    }
    
    if (!config.baseUrl) {
      throw new Error('OpenAI Compatible 提供商需要指定 Base URL');
    }
    
    if (!OpenAICompatibleAdapter.isValidModel(config.model)) {
      throw new Error(`无效的模型名称: ${config.model}`);
    }
    
    return new OpenAICompatibleAdapter(config.apiKey, config.model, config.baseUrl);
  }

  async validateConfig(config: LLMConfig): Promise<boolean> {
    try {
      if (!config.apiKey || !config.model || !config.baseUrl) {
        return false;
      }
      
      if (!OpenAICompatibleAdapter.isValidModel(config.model)) {
        return false;
      }
      
      // 创建适配器并测试连接
      const adapter = this.createAdapter(config);
      await adapter.complete([{ role: 'user', content: 'test' }]);
      return true;
    } catch (error) {
      console.error('OpenAI Compatible 配置验证失败:', error);
      return false;
    }
  }

  getSupportedModels(): string[] {
    // OpenAI Compatible 不预定义模型列表，用户需要手动输入
    return [];
  }

  getProviderName(): string {
    return 'openai-compatible';
  }

  getDisplayName(): string {
    return 'OpenAI Compatible';
  }
}