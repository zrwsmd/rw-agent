import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import { ToolParameter, ToolResult } from '../types/tool';
import { BaseTool } from './BaseTool';

const execAsync = promisify(exec);

/**
 * Linux 命令到 Windows 命令的映射
 */
const LINUX_TO_WINDOWS_COMMANDS: Record<string, string | ((args: string) => string)> = {
  'ls': (args) => args ? `dir ${args}` : 'dir',
  'cat': (args) => `type ${args}`,
  'rm': (args) => args.includes('-r') ? `rmdir /s /q ${args.replace(/-r[f]?\s*/g, '')}` : `del ${args.replace(/-f\s*/g, '')}`,
  'cp': (args) => `copy ${args.replace(/-r\s*/g, '')}`,
  'mv': (args) => `move ${args}`,
  'mkdir': (args) => `mkdir ${args.replace(/-p\s*/g, '')}`,
  'pwd': () => 'cd',
  'clear': () => 'cls',
  'touch': (args) => `type nul > ${args}`,
  'grep': (args) => `findstr ${args}`,
  'head': (args) => {
    const match = args.match(/-n\s*(\d+)\s+(.+)/);
    if (match) {
      return `powershell -Command "Get-Content ${match[2]} -Head ${match[1]}"`;
    }
    return `powershell -Command "Get-Content ${args} -Head 10"`;
  },
  'tail': (args) => {
    const match = args.match(/-n\s*(\d+)\s+(.+)/);
    if (match) {
      return `powershell -Command "Get-Content ${match[2]} -Tail ${match[1]}"`;
    }
    return `powershell -Command "Get-Content ${args} -Tail 10"`;
  },
  'which': (args) => `where ${args}`,
  'whoami': () => 'whoami',
  'echo': (args) => `echo ${args}`,
};

/**
 * 将 Linux 命令转换为 Windows 命令
 */
function convertLinuxToWindows(command: string): string {
  // 提取命令名和参数
  const trimmed = command.trim();
  const spaceIndex = trimmed.indexOf(' ');
  const cmdName = spaceIndex > 0 ? trimmed.substring(0, spaceIndex) : trimmed;
  const args = spaceIndex > 0 ? trimmed.substring(spaceIndex + 1).trim() : '';
  
  const converter = LINUX_TO_WINDOWS_COMMANDS[cmdName];
  if (converter) {
    if (typeof converter === 'function') {
      return converter(args);
    }
    return args ? `${converter} ${args}` : converter;
  }
  
  return command;
}

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
    let command = params.command as string;
    const cwd = (params.cwd as string) || '.';
    const timeout = (params.timeout as number) || 30000;

    if (!command) {
      return this.failure('缺少必需参数: command');
    }

    // Windows 系统自动转换 Linux 命令
    if (os.platform() === 'win32') {
      const originalCommand = command;
      command = convertLinuxToWindows(command);
      if (command !== originalCommand) {
        console.log(`[ShellCommandTool] 命令转换: ${originalCommand} -> ${command}`);
      }
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
