import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolParameter, ToolResult } from '../types/tool';
import { BaseTool } from './BaseTool';

/**
 * 文件搜索工具
 */
export class FileSearchTool extends BaseTool {
  name = 'file_search';
  description = '按名称模式搜索文件';

  parameters: ToolParameter[] = [
    {
      name: 'pattern',
      type: 'string',
      description: '文件名匹配模式（支持 * 和 ? 通配符）',
      required: true,
    },
    {
      name: 'path',
      type: 'string',
      description: '搜索路径（相对于工作区，默认为整个工作区）',
      required: false,
    },
    {
      name: 'maxResults',
      type: 'number',
      description: '最大结果数（默认 100）',
      required: false,
    },
  ];

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const pattern = params.pattern as string;
    const searchPath = (params.path as string) || '.';
    const maxResults = (params.maxResults as number) || 100;

    if (!pattern) {
      return this.failure('缺少必需参数: pattern');
    }

    try {
      const absolutePath = this.validatePath(searchPath);
      const matches: string[] = [];

      await this.searchDirectory(absolutePath, pattern, maxResults, matches);

      if (matches.length === 0) {
        return this.success(`未找到匹配 "${pattern}" 的文件`);
      }

      const output = matches.join('\n');
      const suffix =
        matches.length >= maxResults
          ? `\n\n(结果已截断，共显示 ${maxResults} 个)`
          : '';
      return this.success(output + suffix);
    } catch (error) {
      if (error instanceof Error) {
        return this.failure(error.message);
      }
      return this.failure('搜索文件时发生未知错误');
    }
  }

  private async searchDirectory(
    dir: string,
    pattern: string,
    maxResults: number,
    matches: string[]
  ): Promise<void> {
    if (matches.length >= maxResults) {
      return;
    }

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (matches.length >= maxResults) {
          break;
        }

        const fullPath = path.join(dir, entry.name);

        // 跳过 node_modules 和 .git
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }

        if (entry.isDirectory()) {
          await this.searchDirectory(fullPath, pattern, maxResults, matches);
        } else if (entry.isFile()) {
          if (this.matchPattern(entry.name, pattern)) {
            matches.push(path.relative(this.workspaceRoot, fullPath));
          }
        }
      }
    } catch {
      // 忽略无法访问的目录
    }
  }

  private matchPattern(filename: string, pattern: string): boolean {
    // 将通配符模式转换为正则表达式
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
      .replace(/\*/g, '.*') // * 匹配任意字符
      .replace(/\?/g, '.'); // ? 匹配单个字符

    return new RegExp(`^${regexPattern}$`, 'i').test(filename);
  }
}
