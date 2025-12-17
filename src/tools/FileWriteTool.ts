import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolParameter, ToolResult } from '../types/tool';
import { BaseTool } from './BaseTool';

/**
 * 文件写入工具
 */
export class FileWriteTool extends BaseTool {
  name = 'write_file';
  description = '写入内容到文件，如果文件不存在则创建';

  parameters: ToolParameter[] = [
    {
      name: 'path',
      type: 'string',
      description: '要写入的文件路径（相对于工作区根目录）',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: '要写入的内容',
      required: true,
    },
    {
      name: 'append',
      type: 'boolean',
      description: '是否追加模式（默认为覆盖）',
      required: false,
    },
  ];

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const filePath = params.path as string;
    const content = params.content as string;
    const append = (params.append as boolean) || false;

    if (!filePath) {
      return this.failure('缺少必需参数: path');
    }
    if (content === undefined || content === null) {
      return this.failure('缺少必需参数: content');
    }

    try {
      const absolutePath = this.validatePath(filePath);

      // 确保父目录存在
      const dir = path.dirname(absolutePath);
      await fs.mkdir(dir, { recursive: true });

      // 写入文件
      if (append) {
        await fs.appendFile(absolutePath, content, 'utf-8');
      } else {
        await fs.writeFile(absolutePath, content, 'utf-8');
      }

      const action = append ? '追加' : '写入';
      return this.success(`成功${action}文件: ${filePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        return this.failure(`无权限写入文件: ${filePath}`);
      }
      if (error instanceof Error) {
        return this.failure(error.message);
      }
      return this.failure('写入文件时发生未知错误');
    }
  }
}
