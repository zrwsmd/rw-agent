import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import {
  MCPServerConfig,
  MCPServerStatus,
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPMessage,
  MCPServerInfo,
} from '../types/mcp';

/**
 * MCP 服务器管理器
 */
export class MCPServerManager extends EventEmitter {
  private servers: Map<string, MCPServerProcess> = new Map();
  private configPath: string;

  constructor(workspaceRoot: string) {
    super();
    this.configPath = path.join(workspaceRoot, '.vscode-agent', 'mcp-servers.json');
    this.ensureConfigDirectory();
  }

  /**
   * 确保配置目录存在
   */
  private ensureConfigDirectory(): void {
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  }

  /**
   * 加载服务器配置
   */
  public loadConfigs(): MCPServerConfig[] {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(content);
        
        // 支持新的配置格式 {"mcpServers": {...}}
        if (config.mcpServers) {
          const servers: MCPServerConfig[] = [];
          for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
            const server = serverConfig as any;
            
            // 验证必需字段
            if (!server.command) {
              console.warn(`[MCPServerManager] 服务器 ${name} 缺少 command 字段，跳过`);
              continue;
            }
            
            servers.push({
              name,
              description: server.description || `MCP 服务器: ${name}`,
              command: server.command,
              args: server.args || [],
              env: server.env || {},
              cwd: server.cwd,
              enabled: server.enabled !== false, // 默认启用
              autoStart: server.autoStart !== false, // 默认自动启动
            });
          }
          return servers;
        }
        
        // 兼容旧格式
        return config;
      }
    } catch (error) {
      console.error('[MCPServerManager] 加载配置失败:', error);
    }
    return [];
  }

  /**
   * 保存服务器配置
   */
  public saveConfigs(configs: MCPServerConfig[]): void {
    try {
      // 转换为新的配置格式
      const mcpServers: Record<string, any> = {};
      for (const config of configs) {
        mcpServers[config.name] = {
          command: config.command,
          args: config.args,
          env: config.env,
          cwd: config.cwd,
          description: config.description,
          enabled: config.enabled,
          autoStart: config.autoStart,
        };
      }
      
      const newConfig = { mcpServers };
      fs.writeFileSync(this.configPath, JSON.stringify(newConfig, null, 2));
    } catch (error) {
      console.error('[MCPServerManager] 保存配置失败:', error);
      throw error;
    }
  }

  /**
   * 启动服务器
   */
  public async startServer(config: MCPServerConfig): Promise<void> {
    if (this.servers.has(config.name)) {
      throw new Error(`服务器 ${config.name} 已在运行`);
    }

    const serverProcess = new MCPServerProcess(config);
    this.servers.set(config.name, serverProcess);

    serverProcess.on('status', (status: MCPServerStatus) => {
      this.emit('serverStatus', status);
    });

    serverProcess.on('error', (error: Error) => {
      console.error(`[MCPServerManager] 服务器 ${config.name} 错误:`, error);
      this.emit('serverError', config.name, error);
    });

    await serverProcess.start();
  }

  /**
   * 停止服务器
   */
  public async stopServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (server) {
      await server.stop();
      this.servers.delete(name);
    }
  }

  /**
   * 获取服务器状态
   */
  public getServerStatus(name: string): MCPServerStatus | null {
    const server = this.servers.get(name);
    return server ? server.getStatus() : null;
  }

  /**
   * 获取所有服务器状态
   */
  public getAllServerStatuses(): MCPServerStatus[] {
    const configs = this.loadConfigs();
    return configs.map(config => {
      const runningServer = this.servers.get(config.name);
      if (runningServer) {
        // 服务器正在运行，返回实际状态
        return runningServer.getStatus();
      } else {
        // 服务器未运行，返回停止状态
        return {
          name: config.name,
          status: 'stopped' as const,
          description: config.description,
          tools: [],
          resources: [],
          prompts: [],
        };
      }
    });
  }

  /**
   * 调用服务器工具
   */
  public async callTool(serverName: string, toolName: string, params: any): Promise<any> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`服务器 ${serverName} 未运行`);
    }
    return server.callTool(toolName, params);
  }

  /**
   * 获取资源
   */
  public async getResource(serverName: string, uri: string): Promise<any> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`服务器 ${serverName} 未运行`);
    }
    return server.getResource(uri);
  }

  /**
   * 启动所有启用的服务器
   */
  public async startAllEnabledServers(): Promise<void> {
    const configs = this.loadConfigs();
    const enabledConfigs = configs.filter(config => config.enabled && config.autoStart !== false);

    for (const config of enabledConfigs) {
      try {
        await this.startServer(config);
      } catch (error) {
        console.error(`[MCPServerManager] 启动服务器 ${config.name} 失败:`, error);
      }
    }
  }

  /**
   * 停止所有服务器
   */
  public async stopAllServers(): Promise<void> {
    const stopPromises = Array.from(this.servers.keys()).map(name => this.stopServer(name));
    await Promise.all(stopPromises);
  }
}

/**
 * MCP 服务器进程
 */
class MCPServerProcess extends EventEmitter {
  private config: MCPServerConfig;
  private process?: ChildProcess;
  private status: MCPServerStatus;
  private messageId = 0;
  private pendingRequests: Map<string | number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = new Map();

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
    this.status = {
      name: config.name,
      status: 'stopped',
      tools: [],
      resources: [],
      prompts: [],
    };
  }

  /**
   * 启动服务器进程
   */
  public async start(): Promise<void> {
    this.status.status = 'starting';
    this.emit('status', this.status);

    try {
      this.process = spawn(this.config.command, this.config.args || [], {
        cwd: this.config.cwd,
        env: { ...process.env, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.status.pid = this.process.pid;

      this.process.stdout?.on('data', (data) => {
        this.handleMessage(data.toString());
      });

      this.process.stderr?.on('data', (data) => {
        console.error(`[MCP:${this.config.name}] stderr:`, data.toString());
      });

      this.process.on('error', (error) => {
        this.status.status = 'error';
        this.status.error = error.message;
        this.emit('status', this.status);
        this.emit('error', error);
      });

      this.process.on('exit', (code) => {
        this.status.status = 'stopped';
        this.status.pid = undefined;
        this.emit('status', this.status);
      });

      // 初始化握手
      await this.initialize();
      
      this.status.status = 'running';
      this.emit('status', this.status);
    } catch (error) {
      this.status.status = 'error';
      this.status.error = error instanceof Error ? error.message : '未知错误';
      this.emit('status', this.status);
      throw error;
    }
  }

  /**
   * 停止服务器进程
   */
  public async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
    this.status.status = 'stopped';
    this.status.pid = undefined;
    this.emit('status', this.status);
  }

  /**
   * 获取服务器状态
   */
  public getStatus(): MCPServerStatus {
    return { ...this.status };
  }

  /**
   * 初始化握手
   */
  private async initialize(): Promise<void> {
    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      clientInfo: {
        name: 'vscode-agent',
        version: '1.0.0',
      },
    });

    this.status.serverInfo = response.serverInfo;

    // 获取工具列表
    if (response.capabilities?.tools) {
      const toolsResponse = await this.sendRequest('tools/list', {});
      this.status.tools = toolsResponse.tools || [];
    }

    // 获取资源列表
    if (response.capabilities?.resources) {
      try {
        const resourcesResponse = await this.sendRequest('resources/list', {});
        this.status.resources = resourcesResponse.resources || [];
      } catch (error) {
        // 某些服务器可能不支持资源
      }
    }

    // 获取提示列表
    if (response.capabilities?.prompts) {
      try {
        const promptsResponse = await this.sendRequest('prompts/list', {});
        this.status.prompts = promptsResponse.prompts || [];
      } catch (error) {
        // 某些服务器可能不支持提示
      }
    }
  }

  /**
   * 调用工具
   */
  public async callTool(toolName: string, params: any): Promise<any> {
    return this.sendRequest('tools/call', {
      name: toolName,
      arguments: params,
    });
  }

  /**
   * 获取资源
   */
  public async getResource(uri: string): Promise<any> {
    return this.sendRequest('resources/read', { uri });
  }

  /**
   * 发送请求
   */
  private async sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      const message: MCPMessage = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });

      if (this.process?.stdin) {
        this.process.stdin.write(JSON.stringify(message) + '\n');
      } else {
        reject(new Error('服务器进程未运行'));
      }

      // 设置超时
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('请求超时'));
        }
      }, 30000);
    });
  }

  /**
   * 处理服务器消息
   */
  private handleMessage(data: string): void {
    const lines = data.trim().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const message: MCPMessage = JSON.parse(line);
        
        if (message.id && this.pendingRequests.has(message.id)) {
          const { resolve, reject } = this.pendingRequests.get(message.id)!;
          this.pendingRequests.delete(message.id);
          
          if (message.error) {
            reject(new Error(message.error.message));
          } else {
            resolve(message.result);
          }
        }
      } catch (error) {
        console.error(`[MCP:${this.config.name}] 解析消息失败:`, error, 'data:', line);
      }
    }
  }
}

export function createMCPServerManager(workspaceRoot: string): MCPServerManager {
  return new MCPServerManager(workspaceRoot);
}