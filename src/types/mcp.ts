/**
 * MCP (Model Context Protocol) 相关类型定义
 */

export interface MCPServerConfig {
  name: string;
  description?: string;
  // stdio 传输方式
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  // SSE 传输方式
  url?: string;
  headers?: Record<string, string>;
  // 通用配置
  transport?: 'stdio' | 'sse';
  enabled: boolean;
  autoStart?: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface MCPServerCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  logging?: {};
}

export interface MCPServerInfo {
  name: string;
  version: string;
  capabilities: MCPServerCapabilities;
}

export interface MCPMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface MCPServerStatus {
  name: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  pid?: number;
  error?: string;
  description?: string;
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  serverInfo?: MCPServerInfo;
}

export interface MCPMarketplaceServer {
  name: string;
  displayName: string;
  description: string;
  author: string;
  version: string;
  repository?: string;
  homepage?: string;
  tags: string[];
  config: Omit<MCPServerConfig, 'name' | 'enabled'>;
  requirements?: {
    node?: string;
    python?: string;
    system?: string[];
  };
  installation?: {
    npm?: string;
    pip?: string;
    manual?: string[];
  };
}