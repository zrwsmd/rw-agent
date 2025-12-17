import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolParameter, ToolResult } from '../types/tool';
import { BaseTool } from './BaseTool';

interface SearchMatch {
  file: string;
  line: number;
  content: string;
  context: string[];
}

/**
 * Grep 搜索工具
 */
export class GrepSearchTool extends BaseTool {
  name = 'grep_search';
  description = '在文件中搜索匹配正则表达式的内容';

  parameters: ToolParameter[] = [
    {
      name: 'pattern',
      type: 'string',
      description: '要搜索的正则表达式模式',
      required: true,
    },
    {
      name: 'path',
      type: 'string',
      description: '搜索路径（相对于工作区，默认为整个工作区）',
      required: false,
    },
    {
      name: 'include',
      type: 'string',
      description: '文件匹配模式（如 *.ts）',
      required: false,
    },
    {
      name: 'contextLines',
      type: 'number',
      description: '上下文行数（默认 2）',
      required: false,
    },
    {
      name: 'maxResults',
      type: 'number',
      description: '最大结果数（默认 50）',
      required: false,
    },
  ];

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const pattern = params.pattern as string;
    const searchPath = (params.path as string) || '.';
    const include = params.include as string | undefined;
    const contextLines = (params.contextLines as number) || 2;
    const maxResults = (params.maxResults as number) || 50;

    if (!pattern) {
      return this.failure('缺少必需参数: pattern');
    }

    try {
      const absolutePath = this.validatePath(searchPath);
      const regex = new RegExp(pattern, 'gi');
      const matches: SearchMatch[] = [];

      await this.searchDirectory(
        absolutePath,
        regex,
        include,
        contextLines,
        maxResults,
        matches
      );

      if (matches.length === 0) {
        return this.success(`未找到匹配 "${pattern}" 的内容`);
      }

      const output = this.formatMatches(matches);
      return this.success(output);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return this.failure(`无效的正则表达式: ${pattern}`);
      }
      if (error instanceof Error) {
        return this.failure(error.message);
      }
      return this.failure('搜索时发生未知错误');
    }
  }

  private async searchDirectory(
    dir: string,
    regex: RegExp,
    include: string | undefined,
    contextLines: number,
    maxResults: number,
    matches: SearchMatch[]
  ): Promise<void> {
    if (matches.length >= maxResults) {
      return;
    }

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
        await this.searchDirectory(
          fullPath,
          regex,
          include,
          contextLines,
          maxResults,
          matches
        );
      } else if (entry.isFile()) {
        if (include && !this.matchPattern(entry.name, include)) {
          continue;
        }

        await this.searchFile(
          fullPath,
          regex,
          contextLines,
          maxResults,
          matches
        );
      }
    }
  }

  private async searchFile(
    filePath: string,
    regex: RegExp,
    contextLines: number,
    maxResults: number,
    matches: SearchMatch[]
  ): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          const start = Math.max(0, i - contextLines);
          const end = Math.min(lines.length, i + contextLines + 1);
          const context = lines.slice(start, end);

          matches.push({
            file: path.relative(this.workspaceRoot, filePath),
            line: i + 1,
            content: lines[i],
            context,
          });
        }
      }
    } catch {
      // 忽略无法读取的文件（如二进制文件）
    }
  }

  private matchPattern(filename: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regexPattern}$`).test(filename);
  }

  private formatMatches(matches: SearchMatch[]): string {
    return matches
      .map((m) => {
        const header = `${m.file}:${m.line}`;
        const contextStr = m.context
          .map((line, idx) => {
            const lineNum = m.line - Math.floor(m.context.length / 2) + idx;
            const marker = lineNum === m.line ? '>' : ' ';
            return `${marker} ${lineNum}: ${line}`;
          })
          .join('\n');
        return `${header}\n${contextStr}`;
      })
      .join('\n\n');
  }
}
