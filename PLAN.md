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

## 待完成

- [x] 3. 错误处理完善
  - 为 FunctionCallingExecutor 和 ReActExecutor 添加了重试机制
  - LLM 调用失败时最多重试 2 次，工具执行失败时最多重试 3 次
  - 添加了智能错误分类，网络和临时服务器错误可以重试
  - 提供详细的错误信息和恢复建议
  - 改进了工具不存在时的错误提示，显示可用工具列表

- [ ] 4. 工具调用结果的上下文管理
  - 目前工具调用的结果没有完整保存到对话历史
  - 多轮对话时可能丢失上下文
  - 需要保存工具调用和结果到 ContextManager

- [ ] 5. 单元测试
  - 项目有 vitest 配置但没有测试文件
  - 需要为核心模块添加单元测试
  - 包括 LLM 适配器、执行器、工具等

- [x] 6. 对话历史持久化
  - 创建了 ConversationStorage 类（src/storage/ConversationStorage.ts）
  - 使用文件系统存储对话到 `.vscode-agent/conversations/` 目录
  - 支持新建对话、加载历史对话、删除对话
  - UI 添加了新建按钮和历史对话面板
  - 自动保存对话，重启后可恢复
  - 已添加 `.vscode-agent/` 到 .gitignore
  - 功能已测试验证正常工作

- [x] 7. Token 计数和限制
  - 创建了 TokenCounter 工具类（src/utils/TokenCounter.ts）
  - 支持不同模型的 Token 限制配置
  - ContextManager 添加了 Token 使用统计方法
  - AgentEngine 在处理消息前检查 Token 限制
  - 自动截断旧消息以保持在限制内

- [x] 8. AnthropicAdapter 流式工具调用修复
  - 修复了 streamCompleteWithTools 中未使用的 blockId 变量
  - 完善了流式工具调用的 JSON 累积逻辑
  - 现在可以正确处理 Anthropic 流式返回的工具调用 JSON 片段
