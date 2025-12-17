import { LLMMessage, LLMOptions, LLMProvider, LLMConfig, LLMAdapter } from '../types/llm';
import { BaseLLMAdapter } from './BaseLLMAdapter';

interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
}

/**
 * Gemini 适配器
 */
export class GeminiAdapter extends BaseLLMAdapter {
  private baseApiUrl: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    super(apiKey, model, baseUrl);
    this.baseApiUrl = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  async *streamComplete(
    messages: LLMMessage[],
    options?: LLMOptions
  ): AsyncIterable<string> {
    const { systemInstruction, contents } = this.prepareMessages(messages);

    console.log('[Gemini] 开始流式请求, 模型:', this.model);

    const requestBody = {
      contents,
      systemInstruction: systemInstruction
        ? { parts: [{ text: systemInstruction }] }
        : undefined,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
        stopSequences: options?.stopSequences,
      },
    };

    const response = await fetch(
      `${this.baseApiUrl}/models/${this.model}:streamGenerateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    console.log('[Gemini] 响应状态:', response.status);

    if (!response.ok) {
      const error = await response.text();
      console.error('[Gemini] API 错误:', error);
      throw new Error(`Gemini API 错误: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
    }

    // Gemini 返回的是一个 JSON 数组，解析整个响应
    console.log('[Gemini] 完整响应长度:', buffer.length);
    
    try {
      const data = JSON.parse(buffer) as GeminiResponse[];
      
      // 遍历数组中的每个响应对象
      for (const item of data) {
        const text = item?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          console.log('[Gemini] 解析到文本:', text.substring(0, 50));
          yield text;
        }
      }
    } catch (e) {
      console.error('[Gemini] JSON 解析错误:', e);
      // 尝试作为单个对象解析
      try {
        const data = JSON.parse(buffer) as GeminiResponse;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          yield text;
        }
      } catch {
        console.error('[Gemini] 无法解析响应');
      }
    }
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const { systemInstruction, contents } = this.prepareMessages(messages);

    const response = await fetch(
      `${this.baseApiUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents,
          systemInstruction: systemInstruction
            ? { parts: [{ text: systemInstruction }] }
            : undefined,
          generationConfig: {
            temperature: options?.temperature ?? 0.7,
            maxOutputTokens: options?.maxTokens,
            stopSequences: options?.stopSequences,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API 错误: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as GeminiResponse;
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  private prepareMessages(messages: LLMMessage[]): {
    systemInstruction?: string;
    contents: GeminiContent[];
  } {
    const systemMsg = messages.find((m) => m.role === 'system');
    const contents: GeminiContent[] = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    return {
      systemInstruction: systemMsg?.content,
      contents,
    };
  }
}

/**
 * Gemini 提供商
 */
export class GeminiProvider implements LLMProvider {
  name = 'gemini';

  createAdapter(config: LLMConfig): LLMAdapter {
    return new GeminiAdapter(config.apiKey, config.model, config.baseUrl);
  }

  async validateConfig(config: LLMConfig): Promise<boolean> {
    try {
      const adapter = this.createAdapter(config);
      await adapter.complete([{ role: 'user', content: 'hi' }], {
        maxTokens: 5,
      });
      return true;
    } catch {
      return false;
    }
  }
}
