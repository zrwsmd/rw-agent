import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import {
  MCPServerConfig,
  MCPServerStatus,
  MCPMessage,
} from '../types/mcp';

/**
 * MCP 服务器实例接口
 */
interface MCPServerInstance extends EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): MCPServerStatus;
  callTool(toolName: string, params: any): Promise<any>;
  getResource(uri: string): Promise<any>;
}

/**
 * MCP 服务器管理器
 */
export class MCPServerManager extends EventEmitter {
  private servers: Map<string, MCPServerInstance> = new Map();
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
            
            // 自动检测传输类型
            const transport = server.transport || (server.url ? 'sse' : 'stdio');
            
            // 验证必需字段
            if (transport === 'stdio' && !server.command) {
              console.warn(`[MCPServerManager] 服务器 ${name} 缺少 command 字段，跳过`);
              continue;
            }
            if (transport === 'sse' && !server.url) {
              console.warn(`[MCPServerManager] 服务器 ${name} 缺少 url 字段，跳过`);
              continue;
            }
            
            servers.push({
              name,
              description: server.description || `MCP 服务器: ${name}`,
              transport,
              // stdio 配置
              command: server.command,
              args: server.args || [],
              env: server.env || {},
              cwd: server.cwd,
              // SSE 配置
              url: server.url,
              headers: server.headers || {},
              // 通用配置
              enabled: server.enabled !== false,
              autoStart: server.autoStart !== false,
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
        const serverConfig: any = {
          description: config.description,
          enabled: config.enabled,
          autoStart: config.autoStart,
        };
        
        if (config.transport === 'sse' || config.url) {
          // SSE 配置
          serverConfig.transport = 'sse';
          serverConfig.url = config.url;
          if (config.headers && Object.keys(config.headers).length > 0) {
            serverConfig.headers = config.headers;
          }
        } else {
          // stdio 配置
          serverConfig.command = config.command;
          serverConfig.args = config.args;
          serverConfig.env = config.env;
          serverConfig.cwd = config.cwd;
        }
        
        mcpServers[config.name] = serverConfig;
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
    // 如果服务器已存在，先检查状态
    const existingServer = this.servers.get(config.name);
    if (existingServer) {
      const status = existingServer.getStatus();
      // 如果服务器状态是 stopped、error 或 starting（可能是上次启动失败），先清理再重新启动
      if (status.status === 'stopped' || status.status === 'error' || status.status === 'starting') {
        console.log(`[MCPServerManager] 清理旧服务器实例: ${config.name}, 状态: ${status.status}`);
        try {
          await existingServer.stop();
        } catch (e) {
          // 忽略停止错误
        }
        this.servers.delete(config.name);
      } else if (status.status === 'running') {
        throw new Error(`服务器 ${config.name} 已在运行`);
      }
    }

    // 根据传输类型创建不同的服务器实例
    const transport = config.transport || (config.url ? 'sse' : 'stdio');
    const serverInstance: MCPServerInstance = transport === 'sse'
      ? new MCPSSEClient(config)
      : new MCPServerProcess(config);
    
    this.servers.set(config.name, serverInstance);

    serverInstance.on('status', (status: MCPServerStatus) => {
      this.emit('serverStatus', status);
    });

    serverInstance.on('error', (error: Error) => {
      console.error(`[MCPServerManager] 服务器 ${config.name} 错误:`, error);
      this.emit('serverError', config.name, error);
    });

    try {
      await serverInstance.start();
    } catch (error) {
      // 启动失败时清理服务器记录
      this.servers.delete(config.name);
      throw error;
    }
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
 * MCP 服务器进程 - 通过 stdio 与子进程通信
 */
class MCPServerProcess extends EventEmitter implements MCPServerInstance {
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

    if (!this.config.command) {
      throw new Error('stdio 传输方式需要 command 配置');
    }

    try {
      console.log(`[MCP:${this.config.name}] 启动进程: ${this.config.command} ${(this.config.args || []).join(' ')}`);
      console.log(`[MCP:${this.config.name}] 工作目录: ${this.config.cwd || '(默认)'}`);
      console.log(`[MCP:${this.config.name}] 环境变量: ${JSON.stringify(this.config.env || {})}`);
      console.log(`[MCP:${this.config.name}] PATH: ${process.env.PATH?.substring(0, 200)}...`);
      
      // 合并环境变量，确保 PATH 正确
      const mergedEnv = { 
        ...process.env, 
        ...this.config.env,
        // 确保 Windows 上的 PATH 正确
        PATH: process.env.PATH,
        Path: process.env.Path,
      };
      
      this.process = spawn(this.config.command, this.config.args || [], {
        cwd: this.config.cwd,
        env: mergedEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true, // 在 Windows 上使用 shell 启动
      });

      this.status.pid = this.process.pid;
      console.log(`[MCP:${this.config.name}] 进程已启动, PID: ${this.process.pid}`);

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleMessage(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        console.error(`[MCP:${this.config.name}] stderr:`, data.toString());
      });

      this.process.on('error', (error: Error) => {
        console.error(`[MCP:${this.config.name}] 进程错误:`, error);
        this.status.status = 'error';
        this.status.error = error.message;
        this.emit('status', this.status);
        this.emit('error', error);
      });

      this.process.on('exit', (code: number | null) => {
        console.log(`[MCP:${this.config.name}] 进程退出, code: ${code}`);
        this.status.status = 'stopped';
        this.status.pid = undefined;
        this.emit('status', this.status);
      });

      // 等待 Java 进程启动完成（给 JVM 一些启动时间）
      console.log(`[MCP:${this.config.name}] 等待进程启动...`);
      await new Promise(resolve => setTimeout(resolve, 2000));

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
    console.log(`[MCP:${this.config.name}] 开始初始化握手...`);
    
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

    console.log(`[MCP:${this.config.name}] 初始化响应:`, JSON.stringify(response));
    this.status.serverInfo = response.serverInfo;

    // 发送 initialized 通知（MCP 协议要求）
    console.log(`[MCP:${this.config.name}] 发送 initialized 通知...`);
    this.sendNotification('notifications/initialized', {});
    
    // 等待一下让服务器处理通知
    await new Promise(resolve => setTimeout(resolve, 500));

    // 获取工具列表
    if (response.capabilities?.tools) {
      console.log(`[MCP:${this.config.name}] 获取工具列表...`);
      const toolsResponse = await this.sendRequest('tools/list', {});
      this.status.tools = toolsResponse.tools || [];
      console.log(`[MCP:${this.config.name}] 工具列表:`, this.status.tools.map((t: any) => t.name));
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

      const messageStr = JSON.stringify(message);
      console.log(`[MCP:${this.config.name}] 发送请求:`, messageStr);

      if (this.process?.stdin) {
        this.process.stdin.write(messageStr + '\n');
      } else {
        reject(new Error('服务器进程未运行'));
      }

      // 设置超时
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          console.error(`[MCP:${this.config.name}] 请求超时: ${method}`);
          reject(new Error('请求超时'));
        }
      }, 30000);
    });
  }

  /**
   * 发送通知（不需要响应）
   */
  private sendNotification(method: string, params: any): void {
    const message: MCPMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const messageStr = JSON.stringify(message);
    console.log(`[MCP:${this.config.name}] 发送通知:`, messageStr);

    if (this.process?.stdin) {
      this.process.stdin.write(messageStr + '\n');
    }
  }

  /**
   * 处理服务器消息
   */
  private handleMessage(data: string): void {
    console.log(`[MCP:${this.config.name}] 收到原始数据:`, data.substring(0, 500));
    
    const lines = data.trim().split('\n');
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      // 跳过非 JSON 行（如日志输出）
      if (!trimmedLine.startsWith('{')) {
        console.log(`[MCP:${this.config.name}] 跳过非 JSON 行:`, trimmedLine.substring(0, 100));
        continue;
      }
      
      try {
        console.log(`[MCP:${this.config.name}] 解析 JSON:`, trimmedLine.substring(0, 200));
        const message: MCPMessage = JSON.parse(trimmedLine);
        
        if (message.id && this.pendingRequests.has(message.id)) {
          const { resolve, reject } = this.pendingRequests.get(message.id)!;
          this.pendingRequests.delete(message.id);
          
          if (message.error) {
            console.error(`[MCP:${this.config.name}] 收到错误响应:`, message.error);
            reject(new Error(message.error.message));
          } else {
            console.log(`[MCP:${this.config.name}] 收到成功响应`);
            resolve(message.result);
          }
        } else {
          console.log(`[MCP:${this.config.name}] 收到通知或未匹配的消息, id:`, message.id);
        }
      } catch (error) {
        // 解析失败，可能是不完整的 JSON 或其他格式
        console.warn(`[MCP:${this.config.name}] 解析消息失败，跳过:`, trimmedLine.substring(0, 100));
      }
    }
  }
}

/**
 * MCP SSE 客户端 - 通过 HTTP SSE 连接到 MCP 服务器
 */
class MCPSSEClient extends EventEmitter implements MCPServerInstance {
  private config: MCPServerConfig;
  private status: MCPServerStatus;
  private messageId = 0;
  private pendingRequests: Map<string | number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private eventSource?: any; // EventSource 类型
  private sessionUrl?: string;
  private connected = false;

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
   * 启动 SSE 连接
   */
  public async start(): Promise<void> {
    this.status.status = 'starting';
    this.emit('status', this.status);

    try {
      // 动态导入 eventsource 模块
      const EventSource = await this.getEventSource();
      
      const sseUrl = this.config.url!;
      console.log(`[MCP:${this.config.name}] 连接到 SSE: ${sseUrl}`);

      // 创建 SSE 连接
      this.eventSource = new EventSource(sseUrl, {
        headers: this.config.headers || {},
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('SSE 连接超时'));
        }, 30000);

        this.eventSource.onopen = () => {
          console.log(`[MCP:${this.config.name}] SSE 连接已建立`);
        };

        this.eventSource.onerror = (error: any) => {
          console.error(`[MCP:${this.config.name}] SSE 错误:`, error);
          if (!this.connected) {
            clearTimeout(timeout);
            reject(new Error('SSE 连接失败'));
          }
        };

        // 监听 endpoint 事件获取会话 URL
        this.eventSource.addEventListener('endpoint', (event: any) => {
          const data = event.data;
          console.log(`[MCP:${this.config.name}] 收到 endpoint:`, data);
          
          // 解析会话 URL
          if (data.startsWith('/') || data.startsWith('http')) {
            this.sessionUrl = data.startsWith('http') ? data : new URL(data, sseUrl).href;
          } else {
            this.sessionUrl = new URL(data, sseUrl).href;
          }
          
          this.connected = true;
          clearTimeout(timeout);
          resolve();
        });

        // 监听消息事件
        this.eventSource.addEventListener('message', (event: any) => {
          this.handleMessage(event.data);
        });
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
   * 获取 EventSource 实现
   */
  private async getEventSource(): Promise<any> {
    // 使用内置的简单 HTTP SSE 实现
    return this.createSimpleEventSource();
  }

  /**
   * 创建简单的 EventSource 实现
   */
  private createSimpleEventSource(): any {
    const https = require('https');
    const http = require('http');
    
    return class SimpleEventSource {
      private req: any;
      public onopen?: () => void;
      public onerror?: (error: any) => void;
      private listeners: Map<string, ((event: any) => void)[]> = new Map();

      constructor(url: string, options?: { headers?: Record<string, string> }) {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        
        const reqOptions = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
            ...options?.headers,
          },
        };

        this.req = client.request(reqOptions, (res: any) => {
          if (res.statusCode !== 200) {
            this.onerror?.(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          this.onopen?.();

          let buffer = '';
          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            let eventType = 'message';
            let eventData = '';

            for (const line of lines) {
              if (line.startsWith('event:')) {
                eventType = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                eventData = line.slice(5).trim();
              } else if (line === '') {
                if (eventData) {
                  const handlers = this.listeners.get(eventType) || [];
                  handlers.forEach(handler => handler({ data: eventData }));
                  eventData = '';
                  eventType = 'message';
                }
              }
            }
          });

          res.on('error', (error: any) => {
            this.onerror?.(error);
          });
        });

        this.req.on('error', (error: any) => {
          this.onerror?.(error);
        });

        this.req.end();
      }

      addEventListener(type: string, handler: (event: any) => void) {
        if (!this.listeners.has(type)) {
          this.listeners.set(type, []);
        }
        this.listeners.get(type)!.push(handler);
      }

      close() {
        this.req?.destroy();
      }
    };
  }

  /**
   * 停止 SSE 连接
   */
  public async stop(): Promise<void> {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
    this.connected = false;
    this.sessionUrl = undefined;
    this.status.status = 'stopped';
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
    console.log(`[MCP:${this.config.name}] 开始初始化握手, sessionUrl: ${this.sessionUrl}`);
    
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

    console.log(`[MCP:${this.config.name}] 初始化响应:`, JSON.stringify(response));
    this.status.serverInfo = response.serverInfo;

    // 发送 initialized 通知
    await this.sendNotification('notifications/initialized', {});

    // 获取工具列表
    if (response.capabilities?.tools) {
      console.log(`[MCP:${this.config.name}] 获取工具列表...`);
      const toolsResponse = await this.sendRequest('tools/list', {});
      this.status.tools = toolsResponse.tools || [];
      console.log(`[MCP:${this.config.name}] 工具列表:`, this.status.tools.map((t: any) => t.name));
    }

    // 获取资源列表
    if (response.capabilities?.resources) {
      try {
        const resourcesResponse = await this.sendRequest('resources/list', {});
        this.status.resources = resourcesResponse.resources || [];
      } catch {
        // 某些服务器可能不支持资源
      }
    }

    // 获取提示列表
    if (response.capabilities?.prompts) {
      try {
        const promptsResponse = await this.sendRequest('prompts/list', {});
        this.status.prompts = promptsResponse.prompts || [];
      } catch {
        // 某些服务器可能不支持提示
      }
    }
    
    console.log(`[MCP:${this.config.name}] 初始化完成`);
  }
  
  /**
   * 发送通知 (不需要响应)
   */
  private async sendNotification(method: string, params: any): Promise<void> {
    if (!this.sessionUrl) {
      throw new Error('SSE 会话未建立');
    }

    const message: MCPMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const https = require('https');
    const http = require('http');
    const urlObj = new URL(this.sessionUrl);
    const client = urlObj.protocol === 'https:' ? https : http;

    const postData = JSON.stringify(message);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...this.config.headers,
      },
    };

    return new Promise((resolve, reject) => {
      const req = client.request(reqOptions, (res: any) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
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
   * 发送请求 (通过 HTTP POST)
   */
  private async sendRequest(method: string, params: any): Promise<any> {
    if (!this.sessionUrl) {
      throw new Error('SSE 会话未建立');
    }

    const id = ++this.messageId;
    const message: MCPMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // 发送 HTTP POST 请求
      const https = require('https');
      const http = require('http');
      const urlObj = new URL(this.sessionUrl!);
      const client = urlObj.protocol === 'https:' ? https : http;

      const postData = JSON.stringify(message);
      const reqOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          ...this.config.headers,
        },
      };

      const req = client.request(reqOptions, (res: any) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode !== 200 && res.statusCode !== 202) {
            this.pendingRequests.delete(id);
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
          // 响应会通过 SSE 返回
        });
      });

      req.on('error', (error: any) => {
        this.pendingRequests.delete(id);
        reject(error);
      });

      req.write(postData);
      req.end();

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
   * 处理 SSE 消息
   */
  private handleMessage(data: string): void {
    try {
      const message: MCPMessage = JSON.parse(data);
      
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
      console.error(`[MCP:${this.config.name}] 解析 SSE 消息失败:`, error, 'data:', data);
    }
  }
}

export function createMCPServerManager(workspaceRoot: string): MCPServerManager {
  return new MCPServerManager(workspaceRoot);
}