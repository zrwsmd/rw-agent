/**
 * 快捷命令系统类型定义
 */

/**
 * 命令类别
 */
export type CommandCategory = 'code' | 'git' | 'doc' | 'util';

/**
 * 命令执行上下文
 */
export interface CommandContext {
    /** 当前选中的代码 */
    selectedCode?: string;
    /** 当前文件名 */
    fileName?: string;
    /** 当前文件扩展名 */
    fileExtension?: string;
    /** 当前文件完整路径 */
    filePath?: string;
    /** 剪贴板内容 */
    clipboardContent?: string;
    /** Git diff 内容 */
    gitDiff?: string;
    /** 光标位置 */
    cursorPosition?: {
        line: number;
        column: number;
    };
    /** 工作区根目录 */
    workspaceRoot?: string;
}

/**
 * 快捷命令定义
 */
export interface QuickCommand {
    /** 命令名称（不含斜杠） */
    name: string;
    /** 命令别名列表 */
    aliases: string[];
    /** 命令描述 */
    description: string;
    /** 命令图标（emoji） */
    icon: string;
    /** 命令类别 */
    category: CommandCategory;
    /** 是否需要选中代码 */
    requiresSelection: boolean;
    /** 是否需要剪贴板内容 */
    requiresClipboard: boolean;
    /** 是否需要 Git 信息 */
    requiresGit: boolean;
    /** 提示词模板 */
    promptTemplate: string;
    /** 使用示例 */
    examples: string[];
    /** 是否为内置命令 */
    builtin: boolean;
}

/**
 * 命令处理器函数
 */
export type CommandHandler = (
    context: CommandContext,
    args: string[]
) => Promise<string>;

/**
 * 命令执行结果
 */
export interface CommandResult {
    /** 是否成功 */
    success: boolean;
    /** 生成的提示词 */
    prompt?: string;
    /** 错误信息 */
    error?: string;
    /** 警告信息 */
    warning?: string;
}

/**
 * 命令建议项（用于自动补全）
 */
export interface CommandSuggestion {
    /** 命令名称 */
    name: string;
    /** 命令别名 */
    alias?: string;
    /** 命令描述 */
    description: string;
    /** 命令图标 */
    icon: string;
    /** 命令类别 */
    category: CommandCategory;
    /** 使用示例 */
    example: string;
}

/**
 * 命令解析结果
 */
export interface ParsedCommand {
    /** 是否为命令 */
    isCommand: boolean;
    /** 命令名称（不含斜杠） */
    commandName?: string;
    /** 命令参数 */
    args: string[];
    /** 原始输入 */
    rawInput: string;
}
