import { QuickCommand } from '../types/quickCommand';

/**
 * 内置快捷命令定义
 */
export const BUILTIN_COMMANDS: QuickCommand[] = [
    {
        name: 'review',
        aliases: ['r'],
        description: '审查代码质量、潜在问题和改进建议',
        icon: '🔍',
        category: 'code',
        requiresSelection: true,
        requiresClipboard: false,
        requiresGit: false,
        promptTemplate: `请审查以下代码，指出潜在的问题、bug、性能问题和改进建议：

文件：{{fileName}}
\`\`\`{{fileExtension}}
{{selectedCode}}
\`\`\`

请提供：
1. 代码质量评估
2. 潜在的 bug 和问题
3. 性能优化建议
4. 最佳实践建议
5. 安全性问题（如果有）`,
        examples: ['/review', '/r'],
        builtin: true,
    },
    {
        name: 'explain',
        aliases: ['e'],
        description: '详细解释代码的功能和逻辑',
        icon: '📖',
        category: 'code',
        requiresSelection: true,
        requiresClipboard: false,
        requiresGit: false,
        promptTemplate: `请详细解释以下代码的功能、逻辑和实现原理：

文件：{{fileName}}
\`\`\`{{fileExtension}}
{{selectedCode}}
\`\`\`

请包括：
1. 代码的主要功能
2. 实现逻辑和算法
3. 关键代码段的解释
4. 使用的设计模式（如果有）
5. 注意事项和边界情况`,
        examples: ['/explain', '/e'],
        builtin: true,
    },
    {
        name: 'test',
        aliases: ['t'],
        description: '为代码生成单元测试',
        icon: '🧪',
        category: 'code',
        requiresSelection: true,
        requiresClipboard: false,
        requiresGit: false,
        promptTemplate: `请为以下代码编写完整的单元测试，覆盖主要功能和边界情况：

文件：{{fileName}}
\`\`\`{{fileExtension}}
{{selectedCode}}
\`\`\`

请生成：
1. 完整的测试代码（使用合适的测试框架）
2. 测试用例覆盖正常情况
3. 测试用例覆盖边界情况
4. 测试用例覆盖异常情况
5. Mock 数据和依赖（如果需要）`,
        examples: ['/test', '/t'],
        builtin: true,
    },
    {
        name: 'fix',
        aliases: ['f'],
        description: '分析并修复代码中的问题',
        icon: '🐛',
        category: 'code',
        requiresSelection: true,
        requiresClipboard: true,
        requiresGit: false,
        promptTemplate: `以下代码存在问题，请分析原因并提供修复方案：

文件：{{fileName}}
\`\`\`{{fileExtension}}
{{selectedCode}}
\`\`\`

{{#if clipboardContent}}
错误信息：
\`\`\`
{{clipboardContent}}
\`\`\`
{{/if}}

请提供：
1. 问题分析
2. 根本原因
3. 修复方案（提供修复后的完整代码）
4. 预防措施`,
        examples: ['/fix', '/f'],
        builtin: true,
    },
    {
        name: 'refactor',
        aliases: ['rf'],
        description: '提供代码重构和优化建议',
        icon: '♻️',
        category: 'code',
        requiresSelection: true,
        requiresClipboard: false,
        requiresGit: false,
        promptTemplate: `请分析以下代码，提供重构建议以提高可读性、可维护性和性能：

文件：{{fileName}}
\`\`\`{{fileExtension}}
{{selectedCode}}
\`\`\`

请提供：
1. 代码结构改进建议
2. 命名优化建议
3. 设计模式应用建议
4. 重构后的代码示例
5. 重构的优缺点分析`,
        examples: ['/refactor', '/rf'],
        builtin: true,
    },
    {
        name: 'optimize',
        aliases: ['opt'],
        description: '优化代码性能',
        icon: '⚡',
        category: 'code',
        requiresSelection: true,
        requiresClipboard: false,
        requiresGit: false,
        promptTemplate: `请分析以下代码的性能问题，并提供优化方案：

文件：{{fileName}}
\`\`\`{{fileExtension}}
{{selectedCode}}
\`\`\`

请提供：
1. 性能瓶颈分析
2. 时间复杂度和空间复杂度分析
3. 优化方案和优化后的代码
4. 性能提升预估
5. 优化的权衡考虑`,
        examples: ['/optimize', '/opt'],
        builtin: true,
    },
    {
        name: 'doc',
        aliases: ['d'],
        description: '生成代码文档和注释',
        icon: '📝',
        category: 'doc',
        requiresSelection: true,
        requiresClipboard: false,
        requiresGit: false,
        promptTemplate: `请为以下代码生成详细的文档和注释：

文件：{{fileName}}
\`\`\`{{fileExtension}}
{{selectedCode}}
\`\`\`

请生成：
1. 函数/类的 JSDoc/TSDoc 注释
2. 参数说明
3. 返回值说明
4. 使用示例
5. 注意事项和警告`,
        examples: ['/doc', '/d'],
        builtin: true,
    },
    {
        name: 'comment',
        aliases: ['c'],
        description: '为代码添加详细注释',
        icon: '💬',
        category: 'doc',
        requiresSelection: true,
        requiresClipboard: false,
        requiresGit: false,
        promptTemplate: `请为以下代码添加详细的中文注释，解释每个函数、类和关键逻辑：

文件：{{fileName}}
\`\`\`{{fileExtension}}
{{selectedCode}}
\`\`\`

请提供：
1. 添加注释后的完整代码
2. 注释应该清晰易懂
3. 注释应该解释"为什么"而不仅仅是"做什么"
4. 对复杂逻辑添加详细说明`,
        examples: ['/comment', '/c'],
        builtin: true,
    },
    {
        name: 'convert',
        aliases: [],
        description: '将代码转换为其他编程语言',
        icon: '🔄',
        category: 'code',
        requiresSelection: true,
        requiresClipboard: false,
        requiresGit: false,
        promptTemplate: `请将以下代码转换为 {{args.0 || 'TypeScript'}}：

原始语言：{{fileExtension}}
\`\`\`{{fileExtension}}
{{selectedCode}}
\`\`\`

请提供：
1. 转换后的完整代码
2. 语法差异说明
3. 需要注意的兼容性问题
4. 依赖库的对应关系`,
        examples: ['/convert ts', '/convert python', '/convert'],
        builtin: true,
    },
    {
        name: 'commit',
        aliases: [],
        description: '生成 Git commit 消息',
        icon: '📝',
        category: 'git',
        requiresSelection: false,
        requiresClipboard: false,
        requiresGit: true,
        promptTemplate: `请根据以下 Git 变更生成符合规范的 commit 消息：

\`\`\`diff
{{gitDiff}}
\`\`\`

请生成：
1. 符合 Conventional Commits 规范的 commit 消息
2. 类型（feat/fix/refactor/docs/test/chore）
3. 简短的标题（50字符以内）
4. 详细的描述（如果需要）
5. Breaking changes 说明（如果有）

格式：
\`\`\`
<type>(<scope>): <subject>

<body>

<footer>
\`\`\``,
        examples: ['/commit'],
        builtin: true,
    },
    {
        name: 'help',
        aliases: ['h'],
        description: '显示所有可用的快捷命令',
        icon: '❓',
        category: 'util',
        requiresSelection: false,
        requiresClipboard: false,
        requiresGit: false,
        promptTemplate: `# 快捷命令帮助

以下是所有可用的快捷命令：

## 代码相关
- \`/review\` 或 \`/r\` - 代码审查
- \`/explain\` 或 \`/e\` - 解释代码
- \`/test\` 或 \`/t\` - 生成测试
- \`/fix\` 或 \`/f\` - 修复问题
- \`/refactor\` 或 \`/rf\` - 重构建议
- \`/optimize\` 或 \`/opt\` - 性能优化
- \`/convert [语言]\` - 语言转换

## 文档相关
- \`/doc\` 或 \`/d\` - 生成文档
- \`/comment\` 或 \`/c\` - 添加注释

## Git 相关
- \`/commit\` - 生成 commit 消息

## 工具
- \`/help\` 或 \`/h\` - 显示此帮助

使用方法：在输入框中输入命令，系统会自动获取上下文并执行。`,
        examples: ['/help', '/h'],
        builtin: true,
    },
];

/**
 * 根据命令名称或别名查找命令
 */
export function findCommand(nameOrAlias: string): QuickCommand | undefined {
    const normalized = nameOrAlias.toLowerCase().trim();
    return BUILTIN_COMMANDS.find(
        (cmd) =>
            cmd.name === normalized ||
            cmd.aliases.some((alias) => alias === normalized)
    );
}

/**
 * 获取所有命令建议
 */
export function getAllCommandSuggestions() {
    return BUILTIN_COMMANDS.map((cmd) => ({
        name: cmd.name,
        alias: cmd.aliases[0],
        description: cmd.description,
        icon: cmd.icon,
        category: cmd.category,
        example: cmd.examples[0],
    }));
}

/**
 * 根据输入过滤命令建议
 */
export function filterCommandSuggestions(input: string) {
    const normalized = input.toLowerCase().trim();

    if (!normalized) {
        return getAllCommandSuggestions();
    }

    return BUILTIN_COMMANDS.filter((cmd) => {
        return (
            cmd.name.startsWith(normalized) ||
            cmd.aliases.some((alias) => alias.startsWith(normalized)) ||
            cmd.description.toLowerCase().includes(normalized)
        );
    }).map((cmd) => ({
        name: cmd.name,
        alias: cmd.aliases[0],
        description: cmd.description,
        icon: cmd.icon,
        category: cmd.category,
        example: cmd.examples[0],
    }));
}
