import * as vscode from 'vscode';
import * as path from 'path';
import { ToolParameter, ToolResult } from '../types/tool';
import { BaseTool } from './BaseTool';

/**
 * LSP 相关工具，提供精确的代码导航和分析能力
 */
export class LSPTool extends BaseTool {
    name = 'lsp_query';
    description = '分析代码结构：获取文件中的函数、类、变量等符号信息，查找定义和引用位置。比简单读取文件更精确，适用于代码分析任务';

    parameters: ToolParameter[] = [
        {
            name: 'action',
            type: 'string',
            description: 'LSP 操作类型: symbols (获取文档符号), definitions (找定义), references (找引用), workspace_symbols (全局搜索符号)',
            required: true,
        },
        {
            name: 'path',
            type: 'string',
            description: '文件路径（相对于工作区根目录，symbols/definitions/references 必需）',
            required: false,
        },
        {
            name: 'line',
            type: 'number',
            description: '行号（从 1 开始，definitions/references 必需）',
            required: false,
        },
        {
            name: 'character',
            type: 'number',
            description: '字符位置（从 0 开始，definitions/references 必需）',
            required: false,
        },
        {
            name: 'query',
            type: 'string',
            description: '搜索关键词（workspace_symbols 必需）',
            required: false,
        },
    ];

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
        const action = params.action as string;
        const filePath = params.path as string;
        const line = params.line as number;
        const character = params.character as number;
        const query = params.query as string;

        try {
            switch (action) {
                case 'symbols':
                    return await this.getDocumentSymbols(filePath);
                case 'definitions':
                    return await this.getDefinitions(filePath, line, character);
                case 'references':
                    return await this.getReferences(filePath, line, character);
                case 'workspace_symbols':
                    return await this.getWorkspaceSymbols(query);
                default:
                    return this.failure(`不支持的 LSP 操作: ${action}`);
            }
        } catch (error) {
            if (error instanceof Error) {
                return this.failure(`LSP 操作失败: ${error.message}`);
            }
            return this.failure('LSP 操作发生未知错误');
        }
    }

    /**
     * 获取文档内部符号（类、函数、变量等）
     */
    private async getDocumentSymbols(filePath: string): Promise<ToolResult> {
        if (!filePath) return this.failure('缺少参数: path');
        const absolutePath = this.validatePath(filePath);

        // 检查文件是否存在
        const fs = require('fs');
        if (!fs.existsSync(absolutePath)) {
            return this.failure(`文件不存在: ${filePath} (解析路径: ${absolutePath})`);
        }

        const uri = vscode.Uri.file(absolutePath);
        try {
            // 确保文档已加载
            const document = await vscode.workspace.openTextDocument(uri);
            console.log(`[LSPTool] 文档已加载: ${document.languageId} 语言`);

            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | vscode.SymbolInformation[]>(
                'vscode.executeDocumentSymbolProvider',
                uri
            );

            console.log(`[LSPTool] 文件 ${filePath} 获取到符号数量:`, symbols?.length || 0);

            if (!symbols || symbols.length === 0) {
                // 检查是否是语言服务器问题
                const languageId = document.languageId;
                return this.success(`未在文件中找到符号。可能原因：
1. 该 ${languageId} 文件没有可识别的符号
2. 对应的语言服务器未启动或不支持
3. 文件语法有错误

建议：确保安装了 ${languageId} 相关的 VSCode 扩展。`);
            }

            const output = this.formatSymbols(symbols);
            return this.success(output);
        } catch (e) {
            const error = e instanceof Error ? e.message : '未知错误';
            return this.failure(`LSP 符号提取失败: ${error}
可能需要安装对应语言的 VSCode 扩展来支持语言服务器功能。`);
        }
    }

    /**
     * 获取定义
     */
    private async getDefinitions(filePath: string, line: number, character: number): Promise<ToolResult> {
        if (!filePath || line === undefined || character === undefined) {
            return this.failure('定义查询需要 path, line, character');
        }

        const absolutePath = this.validatePath(filePath);
        const uri = vscode.Uri.file(absolutePath);
        const position = new vscode.Position(line - 1, character);

        const locations = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
            'vscode.executeDefinitionProvider',
            uri,
            position
        );

        if (!locations || (Array.isArray(locations) && locations.length === 0)) {
            return this.success('未找到定义。');
        }

        const output = this.formatLocations(locations);
        return this.success(output);
    }

    /**
     * 获取引用
     */
    private async getReferences(filePath: string, line: number, character: number): Promise<ToolResult> {
        if (!filePath || line === undefined || character === undefined) {
            return this.failure('引用查询需要 path, line, character');
        }

        const absolutePath = this.validatePath(filePath);
        const uri = vscode.Uri.file(absolutePath);
        const position = new vscode.Position(line - 1, character);

        const locations = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            uri,
            position
        );

        if (!locations || locations.length === 0) {
            return this.success('未找到引用。');
        }

        const output = this.formatLocations(locations);
        return this.success(output);
    }

    /**
     * 全局搜索符号
     */
    private async getWorkspaceSymbols(query: string): Promise<ToolResult> {
        if (!query) return this.failure('搜索符号需要 query');

        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeWorkspaceSymbolProvider',
            query
        );

        if (!symbols || symbols.length === 0) {
            return this.success(`在工作区中未找到匹配 "${query}" 的符号。`);
        }

        const output = this.formatSymbolInformation(symbols.slice(0, 50)); // 限制返回数量
        return this.success(output);
    }

    /**
     * 格式化文档符号
     */
    private formatSymbols(symbols: vscode.DocumentSymbol[] | vscode.SymbolInformation[], indent = ''): string {
        let result = '';

        // 按范围排序
        const sortedSymbols = [...symbols].sort((a, b) => {
            const rangeA = (a as vscode.DocumentSymbol).range || (a as vscode.SymbolInformation).location.range;
            const rangeB = (b as vscode.DocumentSymbol).range || (b as vscode.SymbolInformation).location.range;
            return rangeA.start.line - rangeB.start.line;
        });

        for (const symbol of sortedSymbols) {
            let kind = vscode.SymbolKind[symbol.kind];
            let lineRange = '';

            if ('range' in symbol) { // DocumentSymbol
                lineRange = ` (L${symbol.range.start.line + 1}-L${symbol.range.end.line + 1})`;
                result += `${indent}- [${kind}] ${symbol.name}${lineRange}\n`;
                if (symbol.children && symbol.children.length > 0) {
                    result += this.formatSymbols(symbol.children, indent + '  ');
                }
            } else { // SymbolInformation
                lineRange = ` (L${symbol.location.range.start.line + 1})`;
                result += `${indent}- [${kind}] ${symbol.name}${lineRange}\n`;
            }
        }
        return result;
    }

    /**
     * 格式化位置信息
     */
    private formatLocations(locations: vscode.Location[] | vscode.LocationLink[]): string {
        return locations.map(loc => {
            const uri = 'uri' in loc ? loc.uri : loc.targetUri;
            const range = 'range' in loc ? loc.range : loc.targetRange;
            const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
            return `- ${relativePath} [L${range.start.line + 1}, C${range.start.character}]`;
        }).join('\n');
    }

    /**
     * 格式化工作区符号
     */
    private formatSymbolInformation(symbols: vscode.SymbolInformation[]): string {
        return symbols.map(s => {
            const relativePath = path.relative(this.workspaceRoot, s.location.uri.fsPath);
            const kind = vscode.SymbolKind[s.kind];
            return `- [${kind}] ${s.name} (in ${relativePath} L${s.location.range.start.line + 1})`;
        }).join('\n');
    }
}
