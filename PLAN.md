# VSCode Agent 优化计划

## 已完成

- [x] 1. OpenAI 和 Anthropic 的 Function Calling 支持
  - OpenAIAdapter 实现了 completeWithTools 和 streamCompleteWithTools
  - AnthropicAdapter 实现了 completeWithTools 和 streamCompleteWithTools
  - 三个主流 LLM 提供商（OpenAI、Anthropic、Gemini）都支持 Function Calling

- [x] 2. Plan 模式支持 Function Calling
  - PlanExecutor 根据 LLM 能力选择 ReActExecutor 或 FunctionCallingExecutor
  - 如果 llm.supportsNativeTools() 返回 true，使用 FunctionCallingExecutor
  - 否则使用 ReActExecutor

- [x] 3. 错误处理完善
  - 为 FunctionCallingExecutor 和 ReActExecutor 添加了重试机制
  - LLM 调用失败时最多重试 2 次，工具执行失败时最多重试 3 次
  - 添加了智能错误分类，网络和临时服务器错误可以重试
  - 提供详细的错误信息和恢复建议
  - 改进了工具不存在时的错误提示，显示可用工具列表

- [x] 4. 工具调用结果的上下文管理
  - AgentEngine 现在会保存工具调用和结果到 ContextManager
  - 在 FunctionCallingExecutor 和 ReActExecutor 中监听 'observation' 事件
  - 将工具调用信息（名称、参数、结果）保存为带有 toolCall 字段的消息
  - 支持多轮对话中的工具调用上下文保持
  - 对话持久化时包含完整的工具调用历史

- [x] 5. 对话历史持久化
  - 创建了 ConversationStorage 类（src/storage/ConversationStorage.ts）
  - 使用文件系统存储对话到 `.vscode-agent/conversations/` 目录
  - 支持新建对话、加载历史对话、删除对话
  - UI 添加了新建按钮和历史对话面板
  - 自动保存对话，重启后可恢复
  - 已添加 `.vscode-agent/` 到 .gitignore
  - 功能已测试验证正常工作

- [x] 6. Token 计数和限制
  - 创建了 TokenCounter 工具类（src/utils/TokenCounter.ts）
  - 支持不同模型的 Token 限制配置
  - ContextManager 添加了 Token 使用统计方法
  - AgentEngine 在处理消息前检查 Token 限制
  - 自动截断旧消息以保持在限制内

- [x] 7. AnthropicAdapter 流式工具调用修复
  - 修复了 streamCompleteWithTools 中未使用的 blockId 变量
  - 完善了流式工具调用的 JSON 累积逻辑
  - 现在可以正确处理 Anthropic 流式返回的工具调用 JSON 片段

- [x] 8. MCP (Model Context Protocol) 集成
  - 创建了完整的 MCP 类型定义（src/types/mcp.ts）
  - 实现了 MCPServerManager 用于进程管理和 JSON-RPC 通信
  - 创建了 MCPTool 适配器将 MCP 工具包装为系统工具
  - 实现了 MCPMarketplace 提供 8 个预配置的流行服务器
  - 创建了 MCPIntegration 统一管理服务器和工具
  - 在设置面板添加了 MCP 管理 UI（已安装/市场标签页）
  - 支持启动/停止/删除/安装 MCP 服务器
  - 自动注册/注销 MCP 工具到工具注册表
  - 配置文件存储在 .vscode-agent/mcp-servers.json

- [x] 9. 智能上下文管理系统
  - 实现了双重检测机制（85%预检查 + 80%后检查）
  - 使用大模型智能总结对话历史，生成结构化JSON格式
  - 自动开启新对话窗口，实现无缝对话体验
  - 历史记录累积机制，支持无限轮对话切换
  - 用户问题续传，预检查触发时问题不会丢失
  - 溢出保护机制，历史过长时提醒用户手动新开窗口
  - 过滤工具调用中间过程，只保留最终答案
  - 完整的UI反馈，包括总结卡片、新窗口提示、溢出警告

- [x] 10. 代码混淆和发布构建
  - 实现了完整的代码混淆构建流程
  - 创建了 scripts/obfuscate.js 用于代码混淆
  - 创建了 scripts/build-release.js 用于发布构建
  - 创建了 scripts/create-obfuscated-package.js 用于打包
  - 支持 npm run build:release 和 npm run package:release 命令
  - 混淆后的代码保护源码不被轻易逆向
  - 完整的发布文档 docs/release-build.md

- [x] 11. Anthropic Compatible (MiniMax) 供应商
  - 新增 AnthropicCompatibleAdapter 支持 MiniMax API
  - 兼容 Anthropic API 格式，使用 MiniMax 后端
  - 支持 MiniMax-M2.1、MiniMax-M2.1-lightning、MiniMax-M2 模型
  - 完整的工具调用和流式响应支持
  - 支持思考过程（thinking）功能
  - 国内外API端点支持，可配置Base URL
  - Token限制配置和UI集成

## 待完成

- [ ] 12. 单元测试
  - 项目有 vitest 配置但没有测试文件
  - 需要为核心模块添加单元测试
  - 包括 LLM 适配器、执行器、工具等
  - 特别是智能上下文管理的测试用例

- [ ] 13. 性能优化
  - 大文件处理优化
  - 长对话的内存管理
  - 工具调用的并发处理
  - 缓存机制改进

- [ ] 14. 更多 LLM 供应商支持
  - 国内其他主流 LLM 供应商
  - 本地模型支持改进
  - 更多开源模型适配

- [ ] 15. 高级功能
  - 多模态支持（图片、文档）
  - 语音输入输出
  - 代码执行环境
  - 插件系统扩展

## 最近更新

### 智能上下文管理 (v1.0)
这是一个重大功能更新，实现了真正的"无限对话"体验：
- 双重检测确保用户体验流畅
- 大模型智能总结保证信息质量
- 自动新窗口切换保持对话连续性
- 历史累积机制实现长期记忆
- 完善的UI反馈和错误处理

### 代码保护和发布
- 完整的混淆构建流程保护源码
- 自动化的发布打包流程
- 支持开发和发布两套构建配置

### MiniMax 集成
- 新增主流国产大模型支持
- 兼容 Anthropic 接口标准
- 支持高级功能如思考过程

这些功能让 VSCode Agent 成为了一个功能完整、体验优秀的 AI 助手插件。
