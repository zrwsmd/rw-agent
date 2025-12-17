import * as fs from 'fs/promises';
import { ToolParameter, ToolResult } from '../types/tool';
import { BaseTool } from './BaseTool';

/**
 * 文件读取工具
 */
export class FileReadTool extends BaseTool {
  name = 'read_file';
  description = '读取文件内容，返回带行号的文本';

  parameters: ToolParameter[] = [
    {
      name: 'path',
      type: 'string',
      description: '要读取的文件路径（相对于工作区根目录）',
      required: true,
    },
    {
      name: 'startLine',
      type: 'number',
      description: '起始行号（从 1 开始，可选）',
      required: false,
    },
    {
      name: 'endLine',
      type: 'number',
      description: '结束行号（可选）',
      required: false,
    },
  ];

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const filePath = params.path as string;
    const startLine = (params.startLine as number) || 1;
    const endLine = params.endLine as number | undefined;

    if (!filePath) {
      return this.failure('缺少必需参数: path');
    }

    try {
      const absolutePath = this.validatePath(filePath);
      const content = await fs.readFile(absolutePath, 'utf-8');
      const lines = content.split('\n');

      // 计算实际的行范围
      const start = Math.max(1, startLine) - 1;
      const end = endLine ? Math.min(endLine, lines.length) : lines.length;

      // 添加行号
      const numberedLines = lines
        .slice(start, end)
        .map((line, index) => {
          const lineNum = start + index + 1;
          const padding = String(end).length;
          return `${String(lineNum).padStart(padding, ' ')} | ${line}`;
        });

      const output = numberedLines.join('\n');
      return this.success(output);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return this.failure(`文件不存在: ${filePath}`);
      }
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        return this.failure(`无权限访问文件: ${filePath}`);
      }
      if (error instanceof Error) {
        return this.failure(error.message);
      }
      return this.failure('读取文件时发生未知错误');
    }
  }
}
