# MCP STDIO 传输方式

## 概述

STDIO（Standard Input/Output）是 MCP 最简单的传输方式，通过子进程的标准输入输出进行通信。

## 架构图

```
┌─────────────────────┐         ┌─────────────────────┐
│   VSCode Agent      │         │   MCP Server        │
│   (客户端/父进程)    │         │   (子进程)          │
│                     │         │                     │
│   spawn("java"...)  │────────>│   Java 进程启动     │
│                     │         │                     │
│   stdin.write()     │──JSON──>│   从 stdin 读取     │
│                     │         │                     │
│   stdout.on('data') │<──JSON──│   写入 stdout       │
│                     │         │                     │
│   stderr.on('data') │<──日志──│   写入 stderr       │
└─────────────────────┘         └─────────────────────┘
```

## 工作流程

### 1. 客户端启动子进程

```typescript
const process = spawn("java", ["-jar", "mcp-server.jar"], {
  stdio: ['pipe', 'pipe', 'pipe']  // stdin, stdout, stderr
});
```

### 2. 通信方式

| 方向 | 通道 | 用途 |
|------|------|------|
| 客户端 → 服务端 | stdin | 发送 JSON-RPC 请求 |
| 服务端 → 客户端 | stdout | 返回 JSON-RPC 响应 |
| 服务端 → 客户端 | stderr | 日志输出（不参与协议） |

### 3. 消息格式

每条消息是一行 JSON，以换行符 `\n` 结尾：

```
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}\n
```

## 配置示例

```json
{
  "mcpServers": {
    "my-java-server": {
      "command": "java",
      "args": ["-jar", "E:/path/to/mcp-server.jar"],
      "env": {
        "JAVA_HOME": "C:/Program Files/Java/jdk-17"
      },
      "cwd": "E:/working/directory",
      "enabled": true,
      "autoStart": true
    }
  }
}
```

## 服务端实现要求

Java 服务端需要：

1. **从 stdin 读取**：逐行读取 JSON 消息
2. **写入 stdout**：返回 JSON 响应（每行一个）
3. **日志写入 stderr**：避免干扰 stdout 的 JSON 解析

### Java 示例代码

```java
public class MCPServer {
    public static void main(String[] args) {
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
        String line;
        
        while ((line = reader.readLine()) != null) {
            // 解析 JSON-RPC 请求
            JsonObject request = JsonParser.parseString(line).getAsJsonObject();
            
            // 处理请求
            JsonObject response = handleRequest(request);
            
            // 返回响应到 stdout
            System.out.println(response.toString());
            System.out.flush();  // 重要：立即刷新
        }
    }
}
```

## 注意事项

1. **立即刷新输出**：每次写入 stdout 后必须 `flush()`
2. **日志不要写 stdout**：会破坏 JSON 解析
3. **每行一个 JSON**：不要跨行或合并多个 JSON
4. **JVM 启动时间**：客户端可能需要等待 JVM 启动完成

## 优缺点

| 优点 | 缺点 |
|------|------|
| 实现简单 | 只能本地运行 |
| 无需网络配置 | 进程管理复杂 |
| 低延迟 | 不支持远程调用 |
| 安全（无网络暴露） | 每个客户端需要独立进程 |
