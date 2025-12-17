# 需求文档

## 简介

本项目旨在开发一款类似 Claude Code 的 AI Agent 扩展，集成到 VSCode 中。该 Agent 支持两种核心工作模式：ReAct（推理-行动循环）和 Plan（规划-执行）模式，能够帮助开发者进行代码生成、问题分析、任务规划等智能辅助工作。

## 术语表

- **Agent**: 一个能够感知环境、做出决策并执行行动的智能程序
- **ReAct 模式**: 推理-行动模式，Agent 在每一步先进行推理思考，然后执行相应行动，观察结果后继续循环
- **Plan 模式**: 规划模式，Agent 先制定完整的执行计划，然后按步骤执行
- **工具 (Tool)**: Agent 可调用的外部能力，如文件读写、命令执行、代码搜索等
- **大语言模型 (LLM)**: 大语言模型，Agent 的核心推理引擎
- **上下文 (Context)**: 上下文信息，包括对话历史、文件内容、工具执行结果等
- **VSCode 扩展**: 通过 VSCode Extension API 与编辑器集成的插件

## 需求列表

### 需求 1

**用户故事:** 作为开发者，我希望通过 VSCode 中的聊天界面与 Agent 交互，以便在不离开开发环境的情况下获得 AI 辅助。

#### 验收标准

1. WHEN 用户打开安装了扩展的 VSCode THEN VSCode 扩展 SHALL 在侧边栏显示聊天面板
2. WHEN 用户输入消息并按回车 THEN VSCode 扩展 SHALL 将消息发送给 Agent 并显示加载指示器
3. WHEN Agent 响应时 THEN VSCode 扩展 SHALL 使用正确的 markdown 格式渲染响应，包括代码块
4. WHEN 用户滚动聊天历史 THEN VSCode 扩展 SHALL 保持平滑滚动并保留消息顺序
5. WHEN 用户关闭并重新打开 VSCode THEN VSCode 扩展 SHALL 恢复之前的聊天会话

### 需求 2

**用户故事:** 作为开发者，我希望 Agent 使用 ReAct 模式进行逐步问题解决，以便我能看到推理过程并在需要时进行干预。

#### 验收标准

1. WHEN Agent 在 ReAct 模式下运行 THEN Agent SHALL 在每一步遵循思考-行动-观察循环
2. WHEN Agent 生成思考内容 THEN Agent SHALL 在采取行动前向用户显示推理过程
3. WHEN Agent 选择行动 THEN Agent SHALL 根据当前上下文和目标从可用工具中选择
4. WHEN Agent 收到观察结果 THEN Agent SHALL 将结果纳入下一步推理
5. WHEN Agent 确定任务完成 THEN Agent SHALL 提供最终答案并退出循环
6. IF Agent 超过最大迭代限制 THEN Agent SHALL 停止执行并向用户报告当前进度

### 需求 3

**用户故事:** 作为开发者，我希望 Agent 使用 Plan 模式处理复杂任务，以便我能在执行前审查和批准执行计划。

#### 验收标准

1. WHEN 用户请求 Plan 模式 THEN Agent SHALL 在执行前生成结构化的多步骤计划
2. WHEN Agent 创建计划 THEN Agent SHALL 显示每个步骤的明确目标和预期结果
3. WHEN 用户批准计划 THEN Agent SHALL 按顺序执行步骤并在每步后报告进度
4. WHEN 计划步骤失败 THEN Agent SHALL 暂停执行并请求用户指导
5. WHEN 用户请求修改计划 THEN Agent SHALL 更新剩余步骤同时保留已完成的工作
6. WHEN 所有计划步骤成功完成 THEN Agent SHALL 提供已完成任务的摘要

### 需求 4

**用户故事:** 作为开发者，我希望 Agent 能够访问文件系统工具，以便它能读取、写入和搜索代码文件。

#### 验收标准

1. WHEN Agent 需要读取文件 THEN Agent SHALL 使用文件读取工具并返回带行号的文件内容
2. WHEN Agent 需要写入或修改文件 THEN Agent SHALL 使用文件写入工具并向用户确认更改
3. WHEN Agent 需要搜索代码模式 THEN Agent SHALL 使用 grep 搜索工具并返回带上下文的匹配结果
4. WHEN Agent 需要按名称查找文件 THEN Agent SHALL 使用文件搜索工具并返回匹配的文件路径
5. WHEN 文件操作失败 THEN Agent SHALL 报告错误并提供清晰的消息和替代建议
6. WHEN Agent 修改文件 THEN Agent SHALL 以用户可在应用前审查的方式创建修改

### 需求 5

**用户故事:** 作为开发者，我希望 Agent 能执行 shell 命令，以便它能运行测试、构建项目和执行系统操作。

#### 验收标准

1. WHEN Agent 需要运行 shell 命令 THEN Agent SHALL 使用命令执行工具并设置正确的工作目录
2. WHEN 命令产生输出 THEN Agent SHALL 捕获并向用户显示 stdout 和 stderr
3. WHEN 命令超过超时时间 THEN Agent SHALL 终止命令并向用户报告超时
4. IF 命令可能有危险 THEN Agent SHALL 在执行前请求用户确认
5. WHEN Agent 运行命令 THEN Agent SHALL 遵守工作区边界和安全限制

### 需求 6

**用户故事:** 作为开发者，我希望配置 Agent 的 LLM 提供商和设置，以便使用我偏好的 AI 模型。

#### 验收标准

1. WHEN 用户打开扩展设置 THEN VSCode 扩展 SHALL 显示 LLM 提供商、API 密钥和模型选择的配置选项
2. WHEN 用户更改 LLM 设置 THEN VSCode 扩展 SHALL 验证配置并测试连接
3. WHEN API 密钥无效 THEN VSCode 扩展 SHALL 显示清晰的错误消息并阻止 Agent 操作
4. WHEN 用户选择不同的模型 THEN Agent SHALL 在后续对话中使用新模型
5. WHEN 配置保存时 THEN VSCode 扩展 SHALL 使用 VSCode 密钥存储安全地持久化设置

### 需求 7

**用户故事:** 作为开发者，我希望 Agent 维护对话上下文，以便它理解正在进行的讨论和项目状态。

#### 验收标准

1. WHEN 用户发送消息 THEN Agent SHALL 在 LLM 上下文中包含相关的对话历史
2. WHEN 上下文超过模型的 token 限制 THEN Agent SHALL 总结旧消息同时保留最近的上下文
3. WHEN 用户引用之前的消息 THEN Agent SHALL 从对话历史中正确解析引用
4. WHEN 用户开始新对话 THEN Agent SHALL 清除之前的上下文并重新开始
5. WHEN Agent 使用工具 THEN Agent SHALL 在上下文中包含工具结果以供后续推理

### 需求 8

**用户故事:** 作为开发者，我希望 Agent 理解我当前的工作区，以便它能根据我的项目提供相关的帮助。

#### 验收标准

1. WHEN Agent 启动 THEN Agent SHALL 扫描工作区以识别项目类型、语言和结构
2. WHEN 用户询问项目相关问题 THEN Agent SHALL 使用工作区上下文提供准确的答案
3. WHEN 用户打开文件 THEN Agent SHALL 知道当前活动的文件及其内容
4. WHEN 用户选择代码 THEN Agent SHALL 能够在响应中引用选中的代码
5. WHEN 工作区发生变化 THEN Agent SHALL 更新其对项目结构的理解

### 需求 9

**用户故事:** 作为开发者，我希望实时看到 Agent 的工具使用情况，以便了解它正在采取什么行动。

#### 验收标准

1. WHEN Agent 调用工具 THEN VSCode 扩展 SHALL 在聊天中显示工具名称和参数
2. WHEN 工具正在执行 THEN VSCode 扩展 SHALL 显示带有工具名称的进度指示器
3. WHEN 工具完成 THEN VSCode 扩展 SHALL 在可折叠区域中显示结果
4. WHEN 工具失败 THEN VSCode 扩展 SHALL 以与成功明显区分的方式显示错误消息
5. WHEN 使用多个工具 THEN VSCode 扩展 SHALL 按时间顺序显示它们并有清晰的分隔

### 需求 10

**用户故事:** 作为开发者，我希望 Agent 支持流式响应，以便我能在生成时看到输出。

#### 验收标准

1. WHEN LLM 生成响应 THEN VSCode 扩展 SHALL 在 token 到达时流式传输到 UI
2. WHEN 流式传输进行中 THEN VSCode 扩展 SHALL 显示打字指示器
3. WHEN 用户在流式传输期间取消 THEN Agent SHALL 停止生成并显示部分响应
4. WHEN 流式传输完成 THEN VSCode 扩展 SHALL 完成消息并启用用户输入
5. WHEN 流式传输期间发生网络中断 THEN VSCode 扩展 SHALL 显示错误并允许重试

### 需求 11

**用户故事:** 作为开发者，我希望 Agent 格式化和序列化对话数据，以便对话可以保存和恢复。

#### 验收标准

1. WHEN 保存对话 THEN Agent SHALL 将所有消息、工具调用和元数据序列化为 JSON 格式
2. WHEN 加载对话 THEN Agent SHALL 反序列化 JSON 并恢复完整的对话状态
3. WHEN 序列化消息 THEN Agent SHALL 保留消息角色、内容、时间戳和工具结果
4. WHEN 序列化格式变更 THEN Agent SHALL 保持与旧格式的向后兼容性
5. WHEN 导出对话 THEN Agent SHALL 提供人类可读格式选项以及 JSON
