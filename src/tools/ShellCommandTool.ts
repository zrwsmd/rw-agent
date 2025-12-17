import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolParameter, ToolResult } from '../types/tool';
import { BaseTool } from './BaseTool';

const execAsync = promisify(exec);

/**
 * Shell 命令执行工具
 */
export class ShellCommandTool extends BaseTool {
  name = 'shell_command';
  description = '执行 shell 命令';

  parameters: ToolParameter[] = [
    {
      name: 'command',
      type: 'string',
      description: '要执行的命令',
      required: true,
    },
    {
      name: 'cwd',
      type: 'string',
      description: '工作目录（相对于工作区，默认为工作区根目录）',
      required: false,
    },
    {
      name: 'timeout',
      type: 'number',
      description: '超时时间（毫秒，默认 30000）',
      required: false,
    },
  ];

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const command = params.command as string;
    const cwd = (params.cwd as string) || '.';
    const timeout = (params.timeout as number) || 30000;

    if (!command) {
      return this.failure('缺少必需参数: command');
    }

    try {
      const absoluteCwd = this.validatePath(cwd);

      const { stdout, stderr } = await execAsync(command, {
        cwd: absoluteCwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        encoding: 'utf-8',
      });

      let output = '';
      if (stdout) {
        output += `[stdout]\n${stdout}`;
      }
      if (stderr) {
        output += output ? '\n\n' : '';
        output += `[stderr]\n${stderr}`;
      }
      if (!output) {
        output = '命令执行成功（无输出）';
      }

      return this.success(output);
    } catch (error) {
      const execError = error as {
        code?: number;
        killed?: boolean;
        signal?: string;
        stdout?: string;
        stderr?: string;
        message?: string;
      };

      // 命令超时
      if (execError.killed && execError.signal === 'SIGTERM') {
        let output = `命令执行超时（${timeout}ms）`;
        if (execError.stdout) {
          output += `\n\n[部分 stdout]\n${execError.stdout}`;
        }
        if (execError.stderr) {
          output += `\n\n[部分 stderr]\n${execError.stderr}`;
        }
        return this.failure(output);
      }

      // 命令执行失败但有输出
      if (execError.stdout || execError.stderr) {
        let output = `命令执行失败（退出码: ${execError.code || 'unknown'}）`;
        if (execError.stdout) {
          output += `\n\n[stdout]\n${execError.stdout}`;
        }
        if (execError.stderr) {
          output += `\n\n[stderr]\n${execError.stderr}`;
        }
        return this.failure(output);
      }

      if (error instanceof Error) {
        return this.failure(error.message);
      }
      return this.failure('执行命令时发生未知错误');
    }
  }
}
