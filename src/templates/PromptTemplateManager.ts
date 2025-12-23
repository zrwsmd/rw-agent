import * as fs from 'fs';
import * as path from 'path';

/**
 * 提示词模板
 */
export interface PromptTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  prompt: string;
  category: 'builtin' | 'custom';
}

/**
 * 内置模板
 */
const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: 'code-review',
    name: '代码审查',
    icon: '🔍',
    description: '审查代码质量、潜在问题和改进建议',
    prompt: '请审查以下代码，指出潜在的问题、bug、性能问题和改进建议：\n\n```{{file_extension}}\n{{selected_code}}\n```',
    category: 'builtin',
  },
  {
    id: 'explain-code',
    name: '解释代码',
    icon: '📖',
    description: '详细解释代码的功能和逻辑',
    prompt: '请详细解释以下代码的功能、逻辑和实现原理：\n\n```{{file_extension}}\n{{selected_code}}\n```',
    category: 'builtin',
  },
  {
    id: 'write-tests',
    name: '写单元测试',
    icon: '🧪',
    description: '为代码生成单元测试',
    prompt: '请为以下代码编写完整的单元测试，覆盖主要功能和边界情况：\n\n文件：{{file_name}}\n```{{file_extension}}\n{{selected_code}}\n```',
    category: 'builtin',
  },
  {
    id: 'refactor',
    name: '重构建议',
    icon: '♻️',
    description: '提供代码重构和优化建议',
    prompt: '请分析以下代码，提供重构建议以提高可读性、可维护性和性能：\n\n```{{file_extension}}\n{{selected_code}}\n```',
    category: 'builtin',
  },
  {
    id: 'add-comments',
    name: '添加注释',
    icon: '💬',
    description: '为代码添加详细注释',
    prompt: '请为以下代码添加详细的中文注释，解释每个函数、类和关键逻辑：\n\n```{{file_extension}}\n{{selected_code}}\n```',
    category: 'builtin',
  },
  {
    id: 'fix-bug',
    name: '修复 Bug',
    icon: '🐛',
    description: '分析并修复代码中的问题',
    prompt: '以下代码存在问题，请分析原因并提供修复方案：\n\n文件：{{file_name}}\n```{{file_extension}}\n{{selected_code}}\n```\n\n错误信息：{{clipboard}}',
    category: 'builtin',
  },
  {
    id: 'optimize',
    name: '性能优化',
    icon: '⚡',
    description: '优化代码性能',
    prompt: '请分析以下代码的性能问题，并提供优化方案：\n\n```{{file_extension}}\n{{selected_code}}\n```',
    category: 'builtin',
  },
  {
    id: 'convert-language',
    name: '语言转换',
    icon: '🔄',
    description: '将代码转换为其他编程语言',
    prompt: '请将以下 {{file_extension}} 代码转换为 TypeScript：\n\n```{{file_extension}}\n{{selected_code}}\n```',
    category: 'builtin',
  },
];

/**
 * 提示词模板管理器
 */
export class PromptTemplateManager {
  private customTemplates: PromptTemplate[] = [];
  private templatesDir: string;

  constructor(private workspaceRoot: string) {
    this.templatesDir = path.join(workspaceRoot, '.vscode-agent', 'templates');
    this.loadCustomTemplates();
  }

  /**
   * 获取所有模板
   */
  getAllTemplates(): PromptTemplate[] {
    return [...BUILTIN_TEMPLATES, ...this.customTemplates];
  }

  /**
   * 获取内置模板
   */
  getBuiltinTemplates(): PromptTemplate[] {
    return BUILTIN_TEMPLATES;
  }

  /**
   * 获取自定义模板
   */
  getCustomTemplates(): PromptTemplate[] {
    return this.customTemplates;
  }

  /**
   * 根据 ID 获取模板
   */
  getTemplate(id: string): PromptTemplate | undefined {
    return this.getAllTemplates().find(t => t.id === id);
  }

  /**
   * 加载自定义模板
   */
  loadCustomTemplates(): void {
    this.customTemplates = [];
    
    if (!fs.existsSync(this.templatesDir)) {
      return;
    }

    try {
      const files = fs.readdirSync(this.templatesDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.templatesDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const template = JSON.parse(content) as PromptTemplate;
          template.category = 'custom';
          this.customTemplates.push(template);
        }
      }
    } catch (error) {
      console.error('[PromptTemplateManager] 加载自定义模板失败:', error);
    }
  }

  /**
   * 保存自定义模板
   */
  saveCustomTemplate(template: Omit<PromptTemplate, 'category'>): void {
    // 确保目录存在
    if (!fs.existsSync(this.templatesDir)) {
      fs.mkdirSync(this.templatesDir, { recursive: true });
    }

    const fullTemplate: PromptTemplate = {
      ...template,
      category: 'custom',
    };

    const filePath = path.join(this.templatesDir, `${template.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fullTemplate, null, 2), 'utf-8');
    
    // 重新加载
    this.loadCustomTemplates();
  }

  /**
   * 删除自定义模板
   */
  deleteCustomTemplate(id: string): boolean {
    const filePath = path.join(this.templatesDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.loadCustomTemplates();
      return true;
    }
    return false;
  }

  /**
   * 填充模板变量
   */
  fillTemplate(template: PromptTemplate, variables: Record<string, string>): string {
    let result = template.prompt;
    
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(regex, value);
    }
    
    // 清理未填充的变量
    result = result.replace(/\{\{[^}]+\}\}/g, '');
    
    return result;
  }
}

/**
 * 创建模板管理器
 */
export function createPromptTemplateManager(workspaceRoot: string): PromptTemplateManager {
  return new PromptTemplateManager(workspaceRoot);
}
