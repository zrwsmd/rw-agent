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

- [ ] 3. 错误处理完善
  - FunctionCallingExecutor 里的错误处理比较简单
  - 可以加入重试机制、更详细的错误信息
  - 工具执行失败时的恢复策略

- [ ] 4. 工具调用结果的上下文管理
  - 目前工具调用的结果没有完整保存到对话历史
  - 多轮对话时可能丢失上下文
  - 需要保存工具调用和结果到 ContextManager

- [ ] 5. 单元测试
  - 项目有 vitest 配置但没有测试文件
  - 需要为核心模块添加单元测试
  - 包括 LLM 适配器、执行器、工具等

- [ ] 6. 对话历史持久化
  - 关闭 VSCode 后对话历史会丢失
  - 需要将对话保存到文件或 VSCode 存储
  - 支持恢复之前的对话

- [x] 7. Token 计数和限制
  - 创建了 TokenCounter 工具类（src/utils/TokenCounter.ts）
  - 支持不同模型的 Token 限制配置
  - ContextManager 添加了 Token 使用统计方法
  - AgentEngine 在处理消息前检查 Token 限制
  - 自动截断旧消息以保持在限制内

- [ ] 8. AnthropicAdapter 流式工具调用修复
  - streamCompleteWithTools 里有个 blockId 变量声明了但没使用
  - 需要完善流式工具调用的 JSON 累积逻辑
