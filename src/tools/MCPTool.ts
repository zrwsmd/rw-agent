import { Tool, ToolResult, ToolParameter } from '../types/tool';
import { MCPServerManager } from '../mcp/MCPServerManager';
import { MCPTool as MCPToolDef } from '../types/mcp';

// 确认回调类型
type ConfirmCallback = (
  requestId: string,
  title: string,
  description: string,
  details: string
) => Promise<string>;

// 全局确认回调
let globalConfirmCallback: ConfirmCallback | null = null;

/**
 * 设置全局确认回调
 */
export function setMCPConfirmCallback(callback: ConfirmCallback): void {
  globalConfirmCallback = callback;
}

/**
 * MCP 工具适配器
 * 将 MCP 服务器的工具包装为系统工具
 */
export class MCPTool implements Tool {
  public readonly name: string;
  public readonly description: string;
  public readonly parameters: ToolParameter[];
  public readonly isMCPTool: boolean = true;

  private serverName: string;
  private toolName: string;
  private mcpManager: MCPServerManager;

  constructor(
    serverName: string,
    mcpTool: MCPToolDef,
    mcpManager: MCPServerManager
  ) {
    this.serverName = serverName;
    this.toolName = mcpTool.name;
    this.mcpManager = mcpManager;
    
    // 使用服务器名称作为前缀避免冲突
    this.name = `${serverName}_${mcpTool.name}`;
    this.description = `[MCP:${serverName}] ${mcpTool.description}`;
    
    // 转换参数格式
    this.parameters = this.convertParameters(mcpTool.inputSchema);
  }

  /**
   * 转换 MCP 工具参数为系统工具参数格式
   */
  private convertParameters(inputSchema: any): ToolParameter[] {
    const parameters: ToolParameter[] = [];
    
    if (inputSchema.properties) {
      for (const [name, prop] of Object.entries(inputSchema.properties)) {
        const property = prop as any;
        parameters.push({
          name,
          type: this.mapType(property.type),
          description: property.description || `参数 ${name}`,
          required: inputSchema.required?.includes(name) || false,
        });
      }
    }
    
    return parameters;
  }

  /**
   * 映射类型
   */
  private mapType(mcpType: string): 'string' | 'number' | 'boolean' | 'array' | 'object' {
    switch (mcpType) {
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'array':
        return 'array';
      case 'object':
        return 'object';
      default:
        return 'string';
    }
  }

  /**
   * 执行工具
   */
  public async execute(params: Record<string, unknown>): Promise<ToolResult> {
    try {
      // 请求用户确认
      if (globalConfirmCallback) {
        const requestId = `mcp_confirm_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        const title = '调用 MCP 工具';
        const description = `Allow call MCP tool ${this.toolName}?`;
        const details = `服务器: ${this.serverName}\n工具: ${this.toolName}\n描述: ${this.description.replace(`[MCP:${this.serverName}] `, '')}\n\n参数:\n${JSON.stringify(params, null, 2)}`;
        
        const choice = await globalConfirmCallback(requestId, title, description, details);
        
        if (choice !== 'confirm' && choice !== 'confirm_no_ask') {
          return {
            success: false,
            output: '用户取消了 MCP 工具调用',
          };
        }
      }
      
      console.log(`[MCPTool] 调用 ${this.serverName}.${this.toolName}:`, params);
      
      const result = await this.mcpManager.callTool(this.serverName, this.toolName, params);
      
      console.log(`[MCPTool] ${this.serverName}.${this.toolName} 结果:`, result);
      
      // MCP 工具结果格式可能不同，需要适配
      if (result && typeof result === 'object') {
        if (result.content) {
          // 如果有 content 字段，使用它作为输出
          const content = Array.isArray(result.content) 
            ? result.content.map((c: any) => c.text || c.data || JSON.stringify(c)).join('\n')
            : result.content.text || result.content.data || JSON.stringify(result.content);
          
          return {
            success: true,
            output: content,
          };
        } else {
          // 否则直接序列化结果
          return {
            success: true,
            output: JSON.stringify(result, null, 2),
          };
        }
      } else {
        return {
          success: true,
          output: String(result || '执行成功'),
        };
      }
    } catch (error) {
      console.error(`[MCPTool] ${this.serverName}.${this.toolName} 执行失败:`, error);
      
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : '执行 MCP 工具失败',
      };
    }
  }
}

/**
 * 创建 MCP 工具适配器
 */
export function createMCPTool(
  serverName: string,
  mcpTool: MCPToolDef,
  mcpManager: MCPServerManager
): MCPTool {
  return new MCPTool(serverName, mcpTool, mcpManager);
}