export { BaseLLMAdapter, estimateTokens } from './BaseLLMAdapter';
export { OpenAIAdapter, OpenAIProvider } from './OpenAIAdapter';
export { AnthropicAdapter, AnthropicProvider } from './AnthropicAdapter';
export { GeminiAdapter, GeminiProvider } from './GeminiAdapter';

import { LLMProvider, LLMConfig, LLMAdapter } from '../types/llm';
import { OpenAIProvider } from './OpenAIAdapter';
import { AnthropicProvider } from './AnthropicAdapter';
import { GeminiProvider } from './GeminiAdapter';

/**
 * 支持的提供商
 */
const providers: Record<string, LLMProvider> = {
  openai: new OpenAIProvider(),
  bailian: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  gemini: new GeminiProvider(),
};

/**
 * 根据配置创建 LLM 适配器
 */
export function createLLMAdapter(config: LLMConfig): LLMAdapter {
  const provider = providers[config.provider];
  if (!provider) {
    throw new Error(`不支持的 LLM 提供商: ${config.provider}`);
  }
  return provider.createAdapter(config);
}

/**
 * 验证 LLM 配置
 */
export async function validateLLMConfig(config: LLMConfig): Promise<boolean> {
  const provider = providers[config.provider];
  if (!provider) {
    return false;
  }
  return provider.validateConfig(config);
}

/**
 * 获取支持的提供商列表
 */
export function getSupportedProviders(): string[] {
  return Object.keys(providers);
}
