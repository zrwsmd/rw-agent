import { MCPServerManager } from './MCPServerManager';
import { MCPMarketplace } from './MCPMarketplace';
import { MCPTool, createMCPTool } from '../tools/MCPTool';
import { ToolRegistryImpl } from '../tools/ToolRegistry';
import { MCPServerConfig, MCPServerStatus, MCPMarketplaceServer } from '../types/mcp';
import { EventEmitter } from 'events';

/**
 * MCP 集成管理器
 * 统一管理 MCP 服务器和工具集成
 */
export class MCPIntegration extends EventEmitter {
  private mcpManager: MCPServerManager;
  private toolRegistry: ToolRegistryImpl;
  private mcpTools: Map<string, MCPTool[]> = new Map(); // serverName -> tools

  constructor(workspaceRoot: string, toolRegistry: ToolRegistryImpl) {
    super();
    this.mcpManager = new MCPServerManager(workspaceRoot);
    this.toolRegistry = toolRegistry;
    
    // 监听服务器状态变化
    this.mcpManager.on('serverStatus', (status: MCPServerStatus) => {
      this.handleServerStatusChange(status);
      this.emit('serverStatus', status);
    });

    this.mcpManager.on('serverError', (serverName: string, error: Error) => {
      console.error(`[MCPIntegration] 服务器 ${serverName} 错误:`, error);
      this.emit('serverError', serverName, error);
    });
  }

  /**
   * 初始化 MCP 集成
   */
  public async initialize(): Promise<void> {
    console.log('[MCPIntegration] 初始化 MCP 集成...');
    
    try {
      // 启动所有启用的服务器
      await this.mcpManager.startAllEnabledServers();
      console.log('[MCPIntegration] MCP 集成初始化完成');
    } catch (error) {
      console.error('[MCPIntegration] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 处理服务器状态变化
   */
  private handleServerStatusChange(status: MCPServerStatus): void {
    console.log(`[MCPIntegration] 服务器 ${status.name} 状态变化:`, status.status);
    
    if (status.status === 'running') {
      // 服务器启动成功，注册工具
      this.registerServerTools(status);
    } else if (status.status === 'stopped' || status.status === 'error') {
      // 服务器停止或出错，移除工具
      this.unregisterServerTools(status.name);
    }
  }

  /**
   * 注册服务器工具
   */
  private registerServerTools(status: MCPServerStatus): void {
    const serverName = status.name;
    
    // 移除旧工具
    this.unregisterServerTools(serverName);
    
    // 注册新工具
    const tools: MCPTool[] = [];
    for (const mcpTool of status.tools) {
      try {
        const tool = createMCPTool(serverName, mcpTool, this.mcpManager);
        this.toolRegistry.register(tool);
        tools.push(tool);
        console.log(`[MCPIntegration] 注册工具: ${tool.name}`);
      } catch (error) {
        console.error(`[MCPIntegration] 注册工具 ${mcpTool.name} 失败:`, error);
      }
    }
    
    this.mcpTools.set(serverName, tools);
    console.log(`[MCPIntegration] 服务器 ${serverName} 注册了 ${tools.length} 个工具`);
  }

  /**
   * 移除服务器工具
   */
  private unregisterServerTools(serverName: string): void {
    const tools = this.mcpTools.get(serverName);
    if (tools) {
      for (const tool of tools) {
        try {
          this.toolRegistry.unregister(tool.name);
          console.log(`[MCPIntegration] 移除工具: ${tool.name}`);
        } catch (error) {
          console.error(`[MCPIntegration] 移除工具 ${tool.name} 失败:`, error);
        }
      }
      this.mcpTools.delete(serverName);
    }
  }

  /**
   * 获取服务器配置
   */
  public getServerConfigs(): MCPServerConfig[] {
    return this.mcpManager.loadConfigs();
  }

  /**
   * 保存服务器配置
   */
  public saveServerConfigs(configs: MCPServerConfig[]): void {
    this.mcpManager.saveConfigs(configs);
  }

  /**
   * 添加服务器
   */
  public async addServer(config: MCPServerConfig): Promise<void> {
    const configs = this.getServerConfigs();
    
    // 检查是否已存在
    if (configs.some(c => c.name === config.name)) {
      throw new Error(`服务器 ${config.name} 已存在`);
    }
    
    configs.push(config);
    this.saveServerConfigs(configs);
    
    // 如果启用，立即启动
    if (config.enabled) {
      await this.mcpManager.startServer(config);
    }
  }

  /**
   * 更新服务器配置
   */
  public async updateServer(name: string, updates: Partial<MCPServerConfig>): Promise<void> {
    const configs = this.getServerConfigs();
    const index = configs.findIndex(c => c.name === name);
    
    if (index === -1) {
      throw new Error(`服务器 ${name} 不存在`);
    }
    
    const oldConfig = configs[index];
    const newConfig = { ...oldConfig, ...updates };
    configs[index] = newConfig;
    
    this.saveServerConfigs(configs);
    
    // 如果服务器正在运行，重启它
    const status = this.mcpManager.getServerStatus(name);
    if (status && status.status === 'running') {
      await this.mcpManager.stopServer(name);
      if (newConfig.enabled) {
        await this.mcpManager.startServer(newConfig);
      }
    } else if (newConfig.enabled && !oldConfig.enabled) {
      // 如果从禁用变为启用，启动服务器
      await this.mcpManager.startServer(newConfig);
    }
  }

  /**
   * 删除服务器
   */
  public async removeServer(name: string): Promise<void> {
    // 停止服务器
    await this.mcpManager.stopServer(name);
    
    // 从配置中移除
    const configs = this.getServerConfigs();
    const filteredConfigs = configs.filter(c => c.name !== name);
    this.saveServerConfigs(filteredConfigs);
  }

  /**
   * 启动服务器
   */
  public async startServer(name: string): Promise<void> {
    const configs = this.getServerConfigs();
    const config = configs.find(c => c.name === name);
    
    if (!config) {
      throw new Error(`服务器 ${name} 不存在`);
    }
    
    await this.mcpManager.startServer(config);
  }

  /**
   * 停止服务器
   */
  public async stopServer(name: string): Promise<void> {
    await this.mcpManager.stopServer(name);
  }

  /**
   * 获取服务器状态
   */
  public getServerStatus(name: string): MCPServerStatus | null {
    return this.mcpManager.getServerStatus(name);
  }

  /**
   * 获取所有服务器状态
   */
  public getAllServerStatuses(): MCPServerStatus[] {
    return this.mcpManager.getAllServerStatuses();
  }

  /**
   * 获取市场服务器
   */
  public getMarketplaceServers(): MCPMarketplaceServer[] {
    return MCPMarketplace.getMarketplaceServers();
  }

  /**
   * 搜索市场服务器
   */
  public searchMarketplaceServers(query: string): MCPMarketplaceServer[] {
    return MCPMarketplace.searchByName(query);
  }

  /**
   * 从市场安装服务器
   */
  public async installFromMarketplace(
    serverName: string,
    customizations?: Partial<MCPServerConfig>
  ): Promise<void> {
    const marketplaceServer = MCPMarketplace.getServer(serverName);
    if (!marketplaceServer) {
      throw new Error(`市场中未找到服务器 ${serverName}`);
    }

    // 验证要求
    const validation = MCPMarketplace.validateRequirements(marketplaceServer);
    if (!validation.valid) {
      throw new Error(`服务器要求不满足: ${validation.issues.join(', ')}`);
    }

    // 转换为配置
    const config = MCPMarketplace.toServerConfig(marketplaceServer, customizations);
    
    // 添加服务器
    await this.addServer(config);
  }

  /**
   * 获取已注册的 MCP 工具
   */
  public getMCPTools(): { serverName: string; tools: MCPTool[] }[] {
    return Array.from(this.mcpTools.entries()).map(([serverName, tools]) => ({
      serverName,
      tools,
    }));
  }

  /**
   * 清理资源
   */
  public async dispose(): Promise<void> {
    console.log('[MCPIntegration] 清理 MCP 集成...');
    
    // 停止所有服务器
    await this.mcpManager.stopAllServers();
    
    // 移除所有工具
    for (const serverName of this.mcpTools.keys()) {
      this.unregisterServerTools(serverName);
    }
    
    console.log('[MCPIntegration] MCP 集成清理完成');
  }
}

export function createMCPIntegration(
  workspaceRoot: string,
  toolRegistry: ToolRegistryImpl
): MCPIntegration {
  return new MCPIntegration(workspaceRoot, toolRegistry);
}