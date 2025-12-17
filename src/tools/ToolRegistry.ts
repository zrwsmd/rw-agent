import { Tool, ToolRegistry as IToolRegistry } from '../types/tool';

/**
 * 工具注册表实现
 */
export class ToolRegistryImpl implements IToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * 注册工具
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具 "${tool.name}" 已存在`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 按名称获取工具
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   */
  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 生成工具描述（用于 LLM 提示）
   */
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
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 移除工具
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
  }
}

/**
 * 创建工具注册表实例
 */
export function createToolRegistry(): ToolRegistryImpl {
  return new ToolRegistryImpl();
}
