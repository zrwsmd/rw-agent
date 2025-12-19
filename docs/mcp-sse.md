# MCP SSE 传输方式

## 概述

SSE（Server-Sent Events）是 MCP 的 HTTP 传输方式，支持远程连接和多客户端。

## 架构图

```
┌─────────────────────┐                    ┌─────────────────────┐
│   VSCode Agent      │                    │   MCP Server        │
│   (客户端)          │                    │   (HTTP 服务)       │
│                     │                    │                     │
│   GET /sse          │───────────────────>│   建立 SSE 连接     │
│                     │<──────SSE 长连接───│                     │
│                     │                    │                     │
│   收到 endpoint     │<──event: endpoint──│   发送会话 URL      │
│   保存 sessionUrl   │   data: /messages  │                     │
│                     │                    │                     │
│   POST /messages    │───────────────────>│   接收 JSON-RPC     │
│   (JSON-RPC 请求)   │                    │   处理请求          │
│                     │                    │                     │
│   收到 message      │<──event: message───│   推送响应          │
│   (JSON-RPC 响应)   │   data: {...}      │                     │
└─────────────────────┘                    └─────────────────────┘
```

## 工作流程

### 1. 建立 SSE 连接

```http
GET /sse HTTP/1.1
Host: localhost:8888
Accept: text/event-stream
Cache-Control: no-cache
```

### 2. 服务器发送 endpoint 事件

```
event: endpoint
data: /messages?sessionId=abc123

```

### 3. 客户端发送请求（HTTP POST）

```http
POST /messages?sessionId=abc123 HTTP/1.1
Host: localhost:8888
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
```

### 4. 服务器通过 SSE 推送响应

```
event: message
data: {"jsonrpc":"2.0","id":1,"result":{...}}

```

## 配置示例

```json
{
  "mcpServers": {
    "my-sse-server": {
      "transport": "sse",
      "url": "http://localhost:8888/sse",
      "headers": {
        "Authorization": "Bearer token123"
      },
      "enabled": true,
      "autoStart": true
    }
  }
}
```

## 服务端实现要求

### 1. SSE 端点 (`GET /sse`)

- 返回 `Content-Type: text/event-stream`
- 保持连接打开
- 发送 `endpoint` 事件告知客户端 POST 地址

### 2. 消息端点 (`POST /messages`)

- 接收 JSON-RPC 请求
- 处理请求
- 通过 SSE 连接推送响应

### Spring Boot 示例

```java
@RestController
public class MCPController {
    
    private final Map<String, SseEmitter> sessions = new ConcurrentHashMap<>();
    
    @GetMapping(value = "/sse", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter connect() {
        String sessionId = UUID.randomUUID().toString();
        SseEmitter emitter = new SseEmitter(0L);  // 无超时
        sessions.put(sessionId, emitter);
        
        // 发送 endpoint 事件
        emitter.send(SseEmitter.event()
            .name("endpoint")
            .data("/messages?sessionId=" + sessionId));
        
        return emitter;
    }
    
    @PostMapping("/messages")
    public void handleMessage(
            @RequestParam String sessionId,
            @RequestBody JsonObject request) {
        
        // 处理 JSON-RPC 请求
        JsonObject response = processRequest(request);
        
        // 通过 SSE 推送响应
        SseEmitter emitter = sessions.get(sessionId);
        emitter.send(SseEmitter.event()
            .name("message")
            .data(response.toString()));
    }
}
```

## SSE 事件格式

```
event: <事件类型>
data: <数据内容>

```

| 事件类型 | 用途 | 数据内容 |
|----------|------|----------|
| `endpoint` | 告知 POST 地址 | URL 路径，如 `/messages?sessionId=xxx` |
| `message` | JSON-RPC 响应 | JSON 字符串 |

## 注意事项

1. **SSE 连接保活**：需要定期发送心跳或设置合适的超时
2. **会话管理**：每个 SSE 连接对应一个会话
3. **CORS**：跨域访问需要配置 CORS 头
4. **连接断开重连**：客户端需要处理重连逻辑

## 优缺点

| 优点 | 缺点 |
|------|------|
| 支持远程连接 | 实现复杂 |
| 多客户端共享服务 | 需要网络配置 |
| 服务独立部署 | 有网络延迟 |
| 支持负载均衡 | 需要处理连接管理 |
