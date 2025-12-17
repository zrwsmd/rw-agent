import * as path from 'path';
import { Tool, ToolParameter, ToolResult } from '../types/tool';

/**
 * 工作区边界错误
 */
export class WorkspaceBoundaryError extends Error {
  constructor(targetPath: string, workspaceRoot: string) {
    super(`路径 "${targetPath}" 超出工作区边界 "${workspaceRoot}"`);
    this.name = 'WorkspaceBoundaryError';
  }
}

/**
 * 基础工具类
 */
export abstract class BaseTool implements Tool {
  abstract name: string;
  abstract description: string;
  abstract parameters: ToolParameter[];

  protected workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  abstract execute(params: Record<string, unknown>): Promise<ToolResult>;

  /**
   * 验证路径是否在工作区内
   */
  protected validatePath(targetPath: string): string {
    const absolutePath = path.isAbsolute(targetPath)
      ? targetPath
      : path.resolve(this.workspaceRoot, targetPath);

    const normalizedPath = path.normalize(absolutePath);
    const normalizedRoot = path.normalize(this.workspaceRoot);

    if (!normalizedPath.startsWith(normalizedRoot)) {
      throw new WorkspaceBoundaryError(targetPath, this.workspaceRoot);
    }

    return normalizedPath;
  }

  /**
   * 创建成功结果
   */
  protected success(output: string): ToolResult {
    return { success: true, output };
  }

  /**
   * 创建失败结果
   */
  protected failure(error: string): ToolResult {
    return { success: false, output: '', error };
  }
}
