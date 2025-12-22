// src/tools/WebSearchTool.ts

import { BaseTool } from './BaseTool';
import { ToolResult } from '../types/tool';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Web 搜索工具
 * 使用 DuckDuckGo Instant Answer API (免费，无需 API Key)
 */
export class WebSearchTool extends BaseTool {
  name = 'web_search';
  description = '搜索互联网获取信息。用于查找最新资讯、技术文档、解决方案等。';

  parameters = [
    {
      name: 'query',
      type: 'string' as const,
      description: '搜索关键词',
      required: true,
    },
    {
      name: 'maxResults',
      type: 'number' as const,
      description: '最大返回结果数量，默认 5',
      required: false,
    },
  ];

  constructor() {
    super('');
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const query = params.query as string;
    const maxResults = (params.maxResults as number) || 5;

    if (!query || query.trim() === '') {
      return {
        success: false,
        output: '搜索关键词不能为空',
      };
    }

    try {
      console.log(`[WebSearch] 搜索: ${query}`);
      
      // 使用 DuckDuckGo HTML 搜索 (更可靠)
      const results = await this.searchDuckDuckGo(query, maxResults);
      
      if (results.length === 0) {
        return {
          success: true,
          output: `未找到与 "${query}" 相关的结果`,
        };
      }

      // 格式化输出
      const formattedResults = results.map((r, i) => 
        `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`
      ).join('\n\n');

      return {
        success: true,
        output: `搜索 "${query}" 的结果:\n\n${formattedResults}`,
      };
    } catch (error) {
      console.error('[WebSearch] 搜索失败:', error);
      return {
        success: false,
        output: `搜索失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  /**
   * 使用 DuckDuckGo 搜索
   */
  private async searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    
    // 方法1: 使用 DuckDuckGo Instant Answer API
    try {
      const instantResults = await this.searchDDGInstant(query);
      results.push(...instantResults);
    } catch (e) {
      console.log('[WebSearch] Instant API 失败，尝试备用方法');
    }

    // 方法2: 使用 DuckDuckGo HTML 搜索作为备用
    if (results.length < maxResults) {
      try {
        const htmlResults = await this.searchDDGHtml(query, maxResults - results.length);
        results.push(...htmlResults);
      } catch (e) {
        console.log('[WebSearch] HTML 搜索也失败');
      }
    }

    return results.slice(0, maxResults);
  }

  /**
   * DuckDuckGo Instant Answer API
   */
  private async searchDDGInstant(query: string): Promise<SearchResult[]> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'VSCode-Agent/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as {
      Abstract?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      RelatedTopics?: Array<{
        Text?: string;
        FirstURL?: string;
      }>;
    };

    const results: SearchResult[] = [];

    // 主要结果
    if (data.Abstract && data.AbstractURL) {
      results.push({
        title: data.AbstractSource || 'DuckDuckGo',
        url: data.AbstractURL,
        snippet: data.Abstract,
      });
    }

    // 相关主题
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: this.extractTitle(topic.Text),
            url: topic.FirstURL,
            snippet: topic.Text,
          });
        }
      }
    }

    return results;
  }

  /**
   * DuckDuckGo HTML 搜索 (备用方法)
   */
  private async searchDDGHtml(query: string, maxResults: number): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const results: SearchResult[] = [];

    // 简单的 HTML 解析提取搜索结果
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/gi;
    
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const [, url, title, snippet] = match;
      if (url && title) {
        results.push({
          title: this.decodeHtml(title.trim()),
          url: this.decodeUrl(url),
          snippet: this.decodeHtml(snippet?.trim() || ''),
        });
      }
    }

    // 备用正则 - 更宽松的匹配
    if (results.length === 0) {
      const altRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([^<]+)<\/a>/gi;
      while ((match = altRegex.exec(html)) !== null && results.length < maxResults) {
        const [, url, title] = match;
        if (url && title && !url.includes('duckduckgo.com')) {
          results.push({
            title: this.decodeHtml(title.trim()),
            url: url,
            snippet: '',
          });
        }
      }
    }

    return results;
  }

  /**
   * 从文本中提取标题
   */
  private extractTitle(text: string): string {
    const dashIndex = text.indexOf(' - ');
    if (dashIndex > 0) {
      return text.substring(0, dashIndex);
    }
    return text.substring(0, 50) + (text.length > 50 ? '...' : '');
  }

  /**
   * 解码 HTML 实体
   */
  private decodeHtml(html: string): string {
    return html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }

  /**
   * 解码 DuckDuckGo 重定向 URL
   */
  private decodeUrl(url: string): string {
    // DuckDuckGo 使用重定向 URL，需要提取真实 URL
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      return decodeURIComponent(uddgMatch[1]);
    }
    return url;
  }
}
