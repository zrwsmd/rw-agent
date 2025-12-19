# MCP 协议通信流程

## 概述

MCP（Model Context Protocol）使用 JSON-RPC 2.0 作为消息格式，定义了客户端与服务端之间的通信协议。

## 消息格式

### 请求（Request）

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "方法名",
  "params": { ... }
}
```

### 响应（Response）

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { ... }
}
```

### 错误响应（Error Response）

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "Invalid Request"
  }
}
```

### 通知（Notification）- 无需响应

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/xxx",
  "params": { ... }
}
```

## 完整通信流程示例

以下是一个完整的 MCP 会话示例，包含初始化、获取工具列表、调用工具的全过程。

---

### 阶段 1：初始化握手

#### 1.1 客户端发送 `initialize` 请求

```
→ 客户端发送:
```
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {},
      "resources": {},
      "prompts": {}
    },
    "clientInfo": {
      "name": "vscode-agent",
      "version": "1.0.0"
    }
  }
}
```

#### 1.2 服务端返回能力声明

```
← 服务端响应:
```
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {
        "listChanged": true
      },
      "resources": {
        "subscribe": false,
        "listChanged": true
      },
      "prompts": {
        "listChanged": true
      },
      "logging": {},
      "completions": {}
    },
    "serverInfo": {
      "name": "my-mcp-server",
      "version": "1.0.0"
    }
  }
}
```

#### 1.3 客户端发送 `initialized` 通知

```
→ 客户端发送:
```
```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized",
  "params": {}
}
```

> 注意：通知没有 `id` 字段，服务端不需要响应。

---

### 阶段 2：获取工具列表

#### 2.1 客户端请求工具列表

```
→ 客户端发送:
```
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

#### 2.2 服务端返回工具列表

```
← 服务端响应:
```
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "get_weather",
        "description": "获取指定城市的天气信息",
        "inputSchema": {
          "type": "object",
          "properties": {
            "city": {
              "type": "string",
              "description": "城市名称"
            },
            "unit": {
              "type": "string",
              "enum": ["celsius", "fahrenheit"],
              "default": "celsius"
            }
          },
          "required": ["city"]
        }
      },
      {
        "name": "search_database",
        "description": "搜索数据库记录",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string",
              "description": "搜索关键词"
            },
            "limit": {
              "type": "integer",
              "default": 10
            }
          },
          "required": ["query"]
        }
      }
    ]
  }
}
```

---

### 阶段 3：调用工具

#### 3.1 客户端调用工具

```
→ 客户端发送:
```
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": {
      "city": "北京",
      "unit": "celsius"
    }
  }
}
```

#### 3.2 服务端返回工具执行结果

```
← 服务端响应:
```
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "北京当前天气：晴，温度 25°C，湿度 45%"
      }
    ],
    "isError": false
  }
}
```

#### 3.3 工具调用出错的响应

```
← 服务端响应（错误情况）:
```
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "无法获取天气信息：城市名称无效"
      }
    ],
    "isError": true
  }
}
```

---

### 阶段 4：获取资源（可选）

#### 4.1 获取资源列表

```
→ 客户端发送:
```
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "resources/list",
  "params": {}
}
```

```
← 服务端响应:
```
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "resources": [
      {
        "uri": "file:///config/settings.json",
        "name": "配置文件",
        "mimeType": "application/json"
      }
    ]
  }
}
```

#### 4.2 读取资源内容

```
→ 客户端发送:
```
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "resources/read",
  "params": {
    "uri": "file:///config/settings.json"
  }
}
```

```
← 服务端响应:
```
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "contents": [
      {
        "uri": "file:///config/settings.json",
        "mimeType": "application/json",
        "text": "{\"theme\": \"dark\", \"language\": \"zh-CN\"}"
      }
    ]
  }
}
```

---

## 时序图

```
客户端                                    服务端
  │                                         │
  │─────── initialize ─────────────────────>│
  │<────── initialize result ───────────────│
  │                                         │
  │─────── notifications/initialized ──────>│
  │                                         │
  │─────── tools/list ─────────────────────>│
  │<────── tools list result ───────────────│
  │                                         │
  │─────── tools/call ─────────────────────>│
  │<────── tool result ─────────────────────│
  │                                         │
  │─────── tools/call ─────────────────────>│
  │<────── tool result ─────────────────────│
  │                                         │
```

## 方法列表

| 方法 | 类型 | 说明 |
|------|------|------|
| `initialize` | 请求 | 初始化握手 |
| `notifications/initialized` | 通知 | 确认初始化完成 |
| `tools/list` | 请求 | 获取工具列表 |
| `tools/call` | 请求 | 调用工具 |
| `resources/list` | 请求 | 获取资源列表 |
| `resources/read` | 请求 | 读取资源内容 |
| `prompts/list` | 请求 | 获取提示模板列表 |
| `prompts/get` | 请求 | 获取提示模板内容 |

## 错误码

| 错误码 | 说明 |
|--------|------|
| -32700 | Parse error - 无效的 JSON |
| -32600 | Invalid Request - 无效的请求 |
| -32601 | Method not found - 方法不存在 |
| -32602 | Invalid params - 无效的参数 |
| -32603 | Internal error - 内部错误 |

## 注意事项

1. **id 字段**：请求必须有唯一的 id，用于匹配响应
2. **通知无响应**：`notifications/*` 方法不需要响应
3. **顺序执行**：必须先完成 initialize 才能调用其他方法
4. **能力检查**：根据 initialize 返回的 capabilities 决定是否调用某些方法
