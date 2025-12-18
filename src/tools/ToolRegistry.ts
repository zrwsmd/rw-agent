// src/tools/ToolRegistry.ts

import { Tool, ToolRegistry as IToolRegistry } from '../types/tool';
import { ToolDefinition, ParameterSchema } from '../types/llm';

/**
 * 工具注册表实现（增强版）
 */
export class ToolRegistryImpl implements IToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具 "${tool.name}" 已存在`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  getToolDescriptions(): string {
    const tools = this.list();
    if (tools.length === 0) {
      return '没有可用的工具。';
    }

    const descriptions = tools.map((tool) => {
      const params = tool.parameters
        .map((p) => {
          const required = p.required ? '(必需)' : '(可选)';
          return `    - ${p.name}: ${p.type} ${required} - ${p.description}`;
        })
        .join('\n');

      return `## ${tool.name}\n${tool.description}\n参数:\n${params}`;
    });

    return descriptions.join('\n\n');
  }

  /**
   * 转换为 OpenAI/Anthropic 工具定义格式
   */
  getToolDefinitions(): ToolDefinition[] {
    return this.list().map((tool) => this.convertToToolDefinition(tool));
  }

  /**
   * 转换单个工具为标准定义
   */
  private convertToToolDefinition(tool: Tool): ToolDefinition {
    const properties: Record<string, ParameterSchema> = {};
    const required: string[] = [];

    for (const param of tool.parameters) {
      const schema: ParameterSchema = {
        type: param.type,
        description: param.description,
      };

      // Gemini 要求 array 类型必须有 items 字段
      if (param.type === 'array') {
        schema.items = { type: 'string', description: 'Array item' };
      }

      properties[param.name] = schema;

      if (param.required) {
        required.push(param.name);
      }
    }

    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties,
          required,
        },
      },
    };
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  clear(): void {
    this.tools.clear();
  }
}

export function createToolRegistry(): ToolRegistryImpl {
  return new ToolRegistryImpl();
}