export { BaseLLMAdapter, estimateTokens } from './BaseLLMAdapter';
export { OpenAIAdapter, OpenAIProvider } from './OpenAIAdapter';
export { OpenAICompatibleAdapter, OpenAICompatibleProvider } from './OpenAICompatibleAdapter';
export { AnthropicAdapter, AnthropicProvider } from './AnthropicAdapter';
export { AnthropicCompatibleAdapter, AnthropicCompatibleProvider } from './AnthropicCompatibleAdapter';
export { GeminiAdapter, GeminiProvider } from './GeminiAdapter';
export { BailianAdapter, BailianProvider } from './BailianAdapter';

import { LLMProvider, LLMConfig, LLMAdapter } from '../types/llm';
import { OpenAIProvider } from './OpenAIAdapter';
import { AnthropicProvider } from './AnthropicAdapter';
import { AnthropicCompatibleProvider } from './AnthropicCompatibleAdapter';
import { GeminiProvider } from './GeminiAdapter';
import { BailianProvider } from './BailianAdapter';
import { OpenAICompatibleProvider } from './OpenAICompatibleAdapter';

/**
 * 支持的提供商
 */
const providers: Record<string, LLMProvider> = {
  openai: new OpenAIProvider(),
  'openai-compatible': new OpenAICompatibleProvider(),
  anthropic: new AnthropicProvider(),
  'anthropic-compatible': new AnthropicCompatibleProvider(),
  gemini: new GeminiProvider(),
  bailian: new BailianProvider(),
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
