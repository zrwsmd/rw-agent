# MCP 调用链详解

## 概述

MCP (Model Context Protocol) 是一种标准化协议，允许 Agent 与外部服务器通信，获取工具、资源和提示。本项目支持两种传输方式：
- **stdio**: 通过子进程的标准输入/输出通信
- **SSE**: 通过 HTTP Server-Sent Events 通信

## 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户发送消息                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  AgentEngine                                                                │
│  - checkToolsAndCacheSkills() 检测到 MCP 工具可用                            │
│  - 启用工具模式                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  FunctionCallingExecutor                                                    │
│  - 从 ToolRegistry 获取工具定义（包含 MCP 工具）                              │
│  - 调用 LLM，LLM 决定调用某个 MCP 工具                                       │
│  - 执行 MCPTool.execute()                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MCPTool                                                                    │
│  - 请求用户确认                                                              │
│  - 调用 MCPServerManager.callTool()                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MCPServerManager                                                           │
│  - 找到对应的服务器实例                                                       │
│  - 调用 serverInstance.callTool()                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
┌───────────────────────────────┐   ┌───────────────────────────────┐
│  MCPServerProcess (stdio)     │   │  MCPSSEClient (SSE)           │
│  - 通过 stdin 发送 JSON-RPC   │   │  - 通过 HTTP POST 发送请求     │
│  - 从 stdout 读取响应          │   │  - 通过 SSE 接收响应           │
└───────────────────────────────┘   └───────────────────────────────┘
                    │                                   │
                    ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           外部 MCP 服务器                                    │
│                    (如 filesystem-server, weather-server)                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 初始化流程

### 1. 扩展激活时初始化 MCP

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  extension.ts: activate()                                                   │
│  - 创建 MCPIntegration 实例                                                  │
│  - 调用 mcpIntegration.initialize()                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MCPIntegration.ts: initialize()                                            │
│  - 调用 mcpManager.startAllEnabledServers()                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MCPServerManager.ts: startAllEnabledServers()                              │
│  - 加载配置文件 (.vscode-agent/mcp-servers.json)                             │
│  - 过滤 enabled && autoStart 的服务器                                        │
│  - 逐个调用 startServer(config)                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MCPServerManager.ts: startServer()                                         │
│  - 根据 transport 类型创建 MCPServerProcess 或 MCPSSEClient                  │
│  - 调用 serverInstance.start()                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MCPServerProcess.ts: start() (stdio 模式)                                  │
│  1. spawn 子进程                                                             │
│  2. 等待进程启动 (2秒)                                                       │
│  3. 发送 initialize 请求                                                     │
│  4. 发送 notifications/initialized 通知                                      │
│  5. 发送 tools/list 请求获取工具列表                                          │
│  6. 发送 resources/list 请求获取资源列表                                      │
│  7. 发送 prompts/list 请求获取提示列表                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MCPIntegration.ts: handleServerStatusChange()                              │
│  - 服务器状态变为 running                                                    │
│  - 调用 registerServerTools() 注册工具到 ToolRegistry                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. MCP 协议握手详情

```
客户端                                    服务器
   │                                        │
   │──── initialize ────────────────────────>│
   │     {                                   │
   │       protocolVersion: "2024-11-05",    │
   │       capabilities: {...},              │
   │       clientInfo: {...}                 │
   │     }                                   │
   │                                        │
   │<─── initialize response ───────────────│
   │     {                                   │
   │       protocolVersion: "2024-11-05",    │
   │       capabilities: {tools: {}, ...},   │
   │       serverInfo: {...}                 │
   │     }                                   │
   │                                        │
   │──── notifications/initialized ─────────>│
   │     {}                                  │
   │                                        │
   │──── tools/list ────────────────────────>│
   │     {}                                  │
   │                                        │
   │<─── tools/list response ───────────────│
   │     {                                   │
   │       tools: [                          │
   │         {name, description, inputSchema}│
   │       ]                                 │
   │     }                                   │
   │                                        │
```

## 工具调用流程

### 完整调用链

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. extension.ts: handleUserMessage()                                       │
│     - 用户发送消息: "列出当前目录的文件"                                       │
│     - 调用 agentEngine.processMessage()                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. AgentEngine.ts: processMessage()                                        │
│     - 调用 checkToolsAndCacheSkills()                                       │
│     - 检测到 MCP 工具可用，返回 true                                          │
│     - 调用 executeFunctionCalling()                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. AgentEngine.ts: checkToolsAndCacheSkills()                              │
│     - 调用 mcpIntegration.getMCPTools()                                     │
│     - 发现有 MCP 工具可用                                                    │
│     - 打印日志: "检测到 X 个 MCP 工具可用，启用工具模式"                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4. FunctionCallingExecutor.ts: execute()                                   │
│     - 从 toolRegistry.getToolDefinitions() 获取所有工具                      │
│     - 工具列表包含 MCP 工具 (如 filesystem_list_directory)                   │
│     - 调用 llm.completeWithTools() 让 LLM 决定使用哪个工具                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  5. GeminiAdapter.ts: completeWithTools()                                   │
│     - 发送请求到 Gemini API                                                  │
│     - LLM 返回 toolCalls: [{                                                │
│         function: {                                                         │
│           name: "filesystem_list_directory",                                │
│           arguments: '{"path": "."}'                                        │
│         }                                                                   │
│       }]                                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  6. FunctionCallingExecutor.ts: execute() 继续                              │
│     - 解析 toolCalls                                                        │
│     - 从 toolRegistry 获取工具: filesystem_list_directory                   │
│     - 调用 tool.execute({ path: "." })                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  7. MCPTool.ts: execute()                                                   │
│     - 请求用户确认 (通过 globalConfirmCallback)                               │
│     - 用户确认后，调用 mcpManager.callTool()                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  8. MCPServerManager.ts: callTool()                                         │
│     - 找到服务器实例: this.servers.get("filesystem")                         │
│     - 调用 server.callTool("list_directory", { path: "." })                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  9. MCPServerProcess.ts: callTool() (stdio 模式)                            │
│     - 调用 sendRequest("tools/call", { name, arguments })                   │
│     - 通过 stdin 发送 JSON-RPC 请求                                          │
│     - 等待 stdout 返回响应                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  10. 外部 MCP 服务器处理请求                                                 │
│      - 执行 list_directory 操作                                             │
│      - 返回文件列表                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  11. 结果返回                                                                │
│      - MCPServerProcess 解析响应                                             │
│      - MCPTool 格式化输出                                                    │
│      - FunctionCallingExecutor 发出 observation 事件                        │
│      - LLM 根据结果生成最终回答                                              │
│      - 发出 answer 事件                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 关键文件和函数

### 1. MCPIntegration.ts - MCP 集成管理器

```typescript
// 初始化 MCP 集成
public async initialize(): Promise<void> {
  await this.mcpManager.startAllEnabledServers();
}

// 处理服务器状态变化
private handleServerStatusChange(status: MCPServerStatus): void {
  if (status.status === 'running') {
    this.registerServerTools(status);  // 注册工具到 ToolRegistry
  } else {
    this.unregisterServerTools(status.name);  // 移除工具
  }
}

// 注册服务器工具
private registerServerTools(status: MCPServerStatus): void {
  for (const mcpTool of status.tools) {
    const tool = createMCPTool(serverName, mcpTool, this.mcpManager);
    this.toolRegistry.register(tool);
  }
}

// 获取已注册的 MCP 工具
public getMCPTools(): { serverName: string; tools: MCPTool[] }[] {
  return Array.from(this.mcpTools.entries()).map(([serverName, tools]) => ({
    serverName,
    tools,
  }));
}
```

### 2. MCPServerManager.ts - 服务器管理器

```typescript
// 启动服务器
public async startServer(config: MCPServerConfig): Promise<void> {
  const transport = config.transport || (config.url ? 'sse' : 'stdio');
  const serverInstance = transport === 'sse'
    ? new MCPSSEClient(config)
    : new MCPServerProcess(config);
  
  this.servers.set(config.name, serverInstance);
  await serverInstance.start();
}

// 调用工具
public async callTool(serverName: string, toolName: string, params: any): Promise<any> {
  const server = this.servers.get(serverName);
  return server.callTool(toolName, params);
}
```

### 3. MCPServerProcess - stdio 传输

```typescript
// 启动进程
public async start(): Promise<void> {
  this.process = spawn(this.config.command, this.config.args, {
    cwd: this.config.cwd,
    env: { ...process.env, ...this.config.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  });
  
  this.process.stdout.on('data', (data) => this.handleMessage(data.toString()));
  
  await this.initialize();  // MCP 协议握手
}

// 发送请求
private async sendRequest(method: string, params: any): Promise<any> {
  const message = { jsonrpc: '2.0', id: ++this.messageId, method, params };
  this.process.stdin.write(JSON.stringify(message) + '\n');
  // 等待响应...
}

// 调用工具
public async callTool(toolName: string, params: any): Promise<any> {
  return this.sendRequest('tools/call', { name: toolName, arguments: params });
}
```

### 4. MCPSSEClient - SSE 传输

```typescript
// 启动 SSE 连接
public async start(): Promise<void> {
  // 建立 SSE 连接
  this.eventSource = new EventSource(this.config.url);
  
  // 监听 endpoint 事件获取会话 URL
  this.eventSource.addEventListener('endpoint', (event) => {
    this.sessionUrl = event.data;
  });
  
  // 监听消息事件
  this.eventSource.addEventListener('message', (event) => {
    this.handleMessage(event.data);
  });
  
  await this.initialize();  // MCP 协议握手
}

// 发送请求 (通过 HTTP POST)
private async sendRequest(method: string, params: any): Promise<any> {
  const message = { jsonrpc: '2.0', id: ++this.messageId, method, params };
  // POST 到 sessionUrl
  // 响应通过 SSE 返回
}
```

### 5. MCPTool.ts - 工具适配器

```typescript
// 执行工具
public async execute(params: Record<string, unknown>): Promise<ToolResult> {
  // 请求用户确认
  if (globalConfirmCallback) {
    const choice = await globalConfirmCallback(requestId, title, description, details);
    if (choice !== 'confirm' && choice !== 'confirm_no_ask') {
      return { success: false, output: '用户取消了 MCP 工具调用' };
    }
  }
  
  // 调用 MCP 服务器
  const result = await this.mcpManager.callTool(this.serverName, this.toolName, params);
  
  // 格式化输出
  return { success: true, output: formatResult(result) };
}
```

## 配置文件格式

### .vscode-agent/mcp-servers.json

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-filesystem", "/path/to/allowed/dir"],
      "description": "文件系统访问",
      "enabled": true,
      "autoStart": true
    },
    "weather-sse": {
      "transport": "sse",
      "url": "http://localhost:3000/sse",
      "headers": {
        "Authorization": "Bearer xxx"
      },
      "description": "天气服务 (SSE)",
      "enabled": true,
      "autoStart": true
    }
  }
}
```

## 事件流

```
1. { type: 'token_usage', current: 100, limit: 8000, ... }
2. { type: 'action', tool: 'filesystem_list_directory', params: { path: '.' } }
   ↓ (用户确认弹窗)
3. { type: 'observation', result: { success: true, output: '...' } }
4. { type: 'token', content: '当' }
5. { type: 'token', content: '前' }
6. ... (更多 token)
7. { type: 'answer', content: '当前目录包含以下文件：...' }
```

## 调试建议

1. **查看日志**：代码中有大量 `console.log`，在调试控制台查看
   - `[MCPIntegration]` - 集成管理器日志
   - `[MCPServerManager]` - 服务器管理器日志
   - `[MCP:服务器名]` - 具体服务器日志
   - `[MCPTool]` - 工具调用日志

2. **关键断点位置**：
   - `MCPIntegration.registerServerTools()` - 工具注册
   - `MCPTool.execute()` - 工具执行
   - `MCPServerProcess.sendRequest()` - 请求发送
   - `MCPServerProcess.handleMessage()` - 响应处理

3. **常见问题排查**：
   - 服务器启动失败：检查 command 和 args 是否正确
   - 工具未注册：检查服务器状态是否为 running
   - 调用超时：检查服务器进程是否正常响应
