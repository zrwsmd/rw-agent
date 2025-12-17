/**
 * 工具参数定义
 */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * 工具接口
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute(params: Record<string, unknown>): Promise<ToolResult>;
}

/**
 * 工具注册表接口
 */
export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
  getToolDescriptions(): string;
}
