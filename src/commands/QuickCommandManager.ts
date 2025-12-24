import {
    QuickCommand,
    CommandContext,
    CommandResult,
    ParsedCommand,
    CommandSuggestion,
} from '../types/quickCommand';
import { BUILTIN_COMMANDS, findCommand, filterCommandSuggestions } from './builtinCommands';

/**
 * 快捷命令管理器
 */
export class QuickCommandManager {
    private commands: Map<string, QuickCommand> = new Map();
    private customCommands: QuickCommand[] = [];

    constructor() {
        this.registerBuiltinCommands();
    }

    /**
     * 注册内置命令
     */
    private registerBuiltinCommands(): void {
        for (const command of BUILTIN_COMMANDS) {
            this.registerCommand(command);
        }
    }

    /**
     * 注册命令
     */
    public registerCommand(command: QuickCommand): void {
        // 注册主命令名
        this.commands.set(command.name.toLowerCase(), command);

        // 注册别名
        for (const alias of command.aliases) {
            this.commands.set(alias.toLowerCase(), command);
        }

        // 如果是自定义命令，添加到列表
        if (!command.builtin) {
            this.customCommands.push(command);
        }
    }

    /**
     * 解析命令输入
     */
    public parseCommand(input: string): ParsedCommand {
        const trimmed = input.trim();

        // 检查是否以 / 开头
        if (!trimmed.startsWith('/')) {
            return {
                isCommand: false,
                args: [],
                rawInput: input,
            };
        }

        // 移除开头的 /
        const withoutSlash = trimmed.substring(1);

        // 分割命令和参数
        const parts = withoutSlash.split(/\s+/);
        const commandName = parts[0].toLowerCase();
        const args = parts.slice(1);

        return {
            isCommand: true,
            commandName,
            args,
            rawInput: input,
        };
    }

    /**
     * 执行命令
     */
    public async executeCommand(
        commandName: string,
        context: CommandContext,
        args: string[] = []
    ): Promise<CommandResult> {
        const command = this.commands.get(commandName.toLowerCase());

        if (!command) {
            return {
                success: false,
                error: `未找到命令: /${commandName}。输入 /help 查看所有可用命令。`,
            };
        }

        // 验证必需的上下文
        const validation = this.validateContext(command, context);
        if (!validation.valid) {
            return {
                success: false,
                error: validation.error,
                warning: validation.warning,
            };
        }

        // 填充模板
        try {
            const prompt = this.fillTemplate(command.promptTemplate, context, args);

            return {
                success: true,
                prompt,
            };
        } catch (error) {
            return {
                success: false,
                error: `执行命令失败: ${error instanceof Error ? error.message : '未知错误'}`,
            };
        }
    }

    /**
     * 验证命令所需的上下文
     */
    private validateContext(
        command: QuickCommand,
        context: CommandContext
    ): { valid: boolean; error?: string; warning?: string } {
        // 检查是否需要选中代码
        if (command.requiresSelection && !context.selectedCode) {
            return {
                valid: false,
                error: `命令 /${command.name} 需要选中代码。请先在编辑器中选中代码后再执行此命令。`,
            };
        }

        // 检查是否需要剪贴板内容
        if (command.requiresClipboard && !context.clipboardContent) {
            return {
                valid: true,
                warning: `命令 /${command.name} 建议提供剪贴板内容（如错误信息）以获得更好的结果。`,
            };
        }

        // 检查是否需要 Git 信息
        if (command.requiresGit && !context.gitDiff) {
            return {
                valid: false,
                error: `命令 /${command.name} 需要 Git 变更信息。请确保当前目录是 Git 仓库且有未提交的变更。`,
            };
        }

        return { valid: true };
    }

    /**
     * 填充模板变量
     */
    private fillTemplate(
        template: string,
        context: CommandContext,
        args: string[]
    ): string {
        let result = template;

        // 替换基本变量
        const variables: Record<string, string> = {
            selectedCode: context.selectedCode || '',
            fileName: context.fileName || '未知文件',
            fileExtension: context.fileExtension || '',
            filePath: context.filePath || '',
            clipboardContent: context.clipboardContent || '',
            gitDiff: context.gitDiff || '',
        };

        // 替换简单变量 {{variable}}
        for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            result = result.replace(regex, value);
        }

        // 替换参数 {{args.0}}, {{args.1}} 等
        args.forEach((arg, index) => {
            const regex = new RegExp(`\\{\\{args\\.${index}\\}\\}`, 'g');
            result = result.replace(regex, arg);
        });

        // 处理条件块 {{#if variable}}...{{/if}}
        result = this.processConditionals(result, context);

        // 清理未填充的变量
        result = result.replace(/\{\{[^}]+\}\}/g, '');

        return result.trim();
    }

    /**
     * 处理条件块
     */
    private processConditionals(template: string, context: CommandContext): string {
        let result = template;

        // 匹配 {{#if variable}}...{{/if}}
        const ifRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;

        result = result.replace(ifRegex, (match, variable, content) => {
            // 检查变量是否存在且非空
            const value = (context as any)[variable];
            if (value && value !== '') {
                return content;
            }
            return '';
        });

        return result;
    }

    /**
     * 获取命令建议
     */
    public getCommandSuggestions(input: string): CommandSuggestion[] {
        // 如果输入为空或只有 /，返回所有命令
        if (!input || input === '/') {
            return filterCommandSuggestions('');
        }

        // 移除开头的 /
        const query = input.startsWith('/') ? input.substring(1) : input;

        return filterCommandSuggestions(query);
    }

    /**
     * 获取所有命令
     */
    public getAllCommands(): QuickCommand[] {
        return BUILTIN_COMMANDS.concat(this.customCommands);
    }

    /**
     * 获取命令详情
     */
    public getCommand(nameOrAlias: string): QuickCommand | undefined {
        return this.commands.get(nameOrAlias.toLowerCase());
    }

    /**
     * 检查是否为命令输入
     */
    public isCommandInput(input: string): boolean {
        return input.trim().startsWith('/');
    }

    /**
     * 加载自定义命令
     */
    public loadCustomCommands(commands: QuickCommand[]): void {
        for (const command of commands) {
            command.builtin = false;
            this.registerCommand(command);
        }
    }

    /**
     * 移除自定义命令
     */
    public removeCustomCommand(name: string): boolean {
        const command = this.commands.get(name.toLowerCase());

        if (!command || command.builtin) {
            return false;
        }

        // 移除主命令名
        this.commands.delete(name.toLowerCase());

        // 移除别名
        for (const alias of command.aliases) {
            this.commands.delete(alias.toLowerCase());
        }

        // 从自定义命令列表中移除
        const index = this.customCommands.findIndex((c) => c.name === name);
        if (index !== -1) {
            this.customCommands.splice(index, 1);
        }

        return true;
    }
}

/**
 * 创建快捷命令管理器实例
 */
export function createQuickCommandManager(): QuickCommandManager {
    return new QuickCommandManager();
}
