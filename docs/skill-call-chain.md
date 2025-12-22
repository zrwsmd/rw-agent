# Skill 调用链详解

## 概述

Skill 是一种可扩展的能力包，允许 Agent 根据用户消息自动匹配并注入专业领域知识和工具脚本。

## 调用链流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户发送消息                                    │
│                         "帮我把这个 jpg 转成 png"                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. extension.ts: handleUserMessage()                                       │
│     - 接收 webview 消息                                                      │
│     - 调用 agentEngine.processMessage()                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. AgentEngine.ts: processMessage()                                        │
│     - 添加用户消息到上下文                                                    │
│     - 调用 checkToolsAndCacheSkills(message)                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. AgentEngine.ts: checkToolsAndCacheSkills()                              │
│     - 调用 skillsManager.matchSkills(message)                               │
│     - 缓存匹配结果到 this.cachedMatchedSkills                                │
│     - 返回 true（需要工具模式）                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4. SkillsManager.ts: matchSkills()                                         │
│     - 提取用户消息中的词汇（英文/中文）                                        │
│     - 遍历所有已加载的 Skills                                                │
│     - 匹配关键词（如 "jpg", "png", "convert", "转换"）                        │
│     - 返回匹配的 Skill 数组                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  5. AgentEngine.ts: processMessage() 继续                                   │
│     - 发出 skill 事件: yield { type: 'skill', name, description }           │
│     - 检查 LLM 是否支持原生工具调用                                           │
│     - 调用 executeFunctionCalling() 或 executeReAct()                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  6. AgentEngine.ts: executeFunctionCalling()                                │
│     - 调用 skillsManager.generateSkillsPrompt(goal)                         │
│     - 将 skillsPrompt 传给 FunctionCallingExecutor                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  7. SkillsManager.ts: generateSkillsPrompt()                                │
│     - 生成包含 Skill 文档内容的系统提示                                       │
│     - 列出可用脚本和使用说明                                                  │
│     - 返回格式化的 prompt 字符串                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  8. FunctionCallingExecutor.ts: execute()                                   │
│     - 将 skillsPrompt 添加到系统消息                                         │
│     - 获取工具定义（包含 skill_script 工具）                                  │
│     - 调用 LLM (GeminiAdapter.completeWithTools)                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  9. GeminiAdapter.ts: completeWithTools()                                   │
│     - 发送请求到 Gemini API（带工具定义）                                     │
│     - LLM 决定调用 skill_script 工具                                         │
│     - 返回 toolCalls: [{ function: { name: 'skill_script', args: {...} }}]  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  10. FunctionCallingExecutor.ts: execute() 继续                             │
│      - 解析 toolCalls                                                       │
│      - 从 toolRegistry 获取 skill_script 工具                               │
│      - 调用 tool.execute({ skill_name, script_name, args })                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  11. SkillScriptTool.ts: execute()                                          │
│      - 调用 skillsManager.executeScript(skill_name, script_name, args)      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  12. SkillsManager.ts: executeScript()                                      │
│      - 查找 Skill 和脚本路径                                                 │
│      - 根据脚本类型选择执行方式（node/python/bash/powershell）               │
│      - 执行脚本: execAsync(command, { cwd: skill.skillPath })               │
│      - 返回 { success, stdout, stderr, exitCode }                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  13. 结果返回                                                                │
│      - SkillScriptTool 返回 ToolResult                                      │
│      - FunctionCallingExecutor 发出 observation 事件                        │
│      - LLM 根据结果生成最终回答                                              │
│      - 发出 answer 事件                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 关键文件和函数

### 1. extension.ts
```typescript
// 入口：处理用户消息
async function handleUserMessage(content, context, images) {
  for await (const event of agentEngine.processMessage(content, currentMode, images)) {
    chatPanelProvider?.postMessage({ type: 'agent_event', event });
  }
}
```

### 2. AgentEngine.ts
```typescript
// 检查是否需要工具并缓存匹配的 Skills
private checkToolsAndCacheSkills(message: string): boolean {
  this.cachedMatchedSkills = [];
  
  if (this.skillsManager) {
    this.cachedMatchedSkills = this.skillsManager.matchSkills(message);
    if (this.cachedMatchedSkills.length > 0) {
      return true; // 启用工具模式
    }
  }
  // ... 其他检查
}

// 执行函数调用模式
private async *executeFunctionCalling(goal, context) {
  let skillsPrompt = '';
  if (this.cachedMatchedSkills.length > 0 && this.skillsManager) {
    skillsPrompt = this.skillsManager.generateSkillsPrompt(goal);
  }
  
  yield* this.functionCallingExecutor.execute(
    goal, context, this.toolRegistry, this.llmAdapter, skillsPrompt
  );
}
```

### 3. SkillsManager.ts
```typescript
// 匹配 Skills
public matchSkills(userMessage: string): Skill[] {
  const messageLower = userMessage.toLowerCase();
  const messageWords = new Set<string>();
  // 提取英文词和中文词
  // 遍历所有 Skills，匹配关键词
  // 返回匹配的 Skills
}

// 生成 Skills 提示
public generateSkillsPrompt(userMessage: string): string {
  const matchedSkills = this.matchSkills(userMessage);
  // 生成包含 Skill 文档、可用脚本、使用说明的 prompt
}

// 执行脚本
public async executeScript(skillName, scriptName, args): Promise<ScriptResult> {
  const skill = this.skills.get(skillName);
  const scriptPath = skill.scripts.get(scriptName);
  // 根据脚本类型执行
  const { stdout, stderr } = await execAsync(command, { cwd: skill.skillPath });
}
```

### 4. FunctionCallingExecutor.ts
```typescript
async *execute(goal, context, toolRegistry, llm, skillsPrompt) {
  // 构建系统消息（包含 skillsPrompt）
  let systemContent = `你是一个智能助手...`;
  if (skillsPrompt) {
    systemContent += `\n\n${skillsPrompt}`;
  }
  
  // 获取工具定义（包含 skill_script）
  const toolDefinitions = toolRegistry.getToolDefinitions();
  
  // 调用 LLM
  const response = await llm.completeWithTools(messages, { tools: toolDefinitions });
  
  // 执行工具调用
  if (response.toolCalls) {
    for (const toolCall of response.toolCalls) {
      const tool = toolRegistry.get(toolCall.function.name);
      const result = await tool.execute(params);
      yield { type: 'observation', result };
    }
  }
}
```

### 5. SkillScriptTool.ts
```typescript
async execute(params: { skill_name, script_name, args }) {
  const result = await this.skillsManager.executeScript(
    params.skill_name, 
    params.script_name, 
    params.args
  );
  return { success: result.success, output: result.stdout };
}
```

## Skill 目录结构

```
.agent/skills/
└── jpg-to-png/                    # Skill 包目录
    ├── SKILL.md                   # Skill 文档（必需）
    ├── config.json                # 配置文件（可选）
    ├── scripts/                   # 脚本目录
    │   └── convert.js             # 转换脚本
    └── resources/                 # 资源文件（可选）
```

### SKILL.md 示例
```markdown
---
name: jpg-to-png
description: 将 JPG 图片转换为 PNG 格式
keywords: [jpg, png, convert, 转换, 图片]
---

# JPG to PNG Converter

这个 Skill 可以帮助你将 JPG 图片转换为 PNG 格式。

## 使用方法

调用 convert 脚本：
- skill_name: jpg-to-png
- script_name: convert
- args: [输入文件路径, 输出文件路径]
```

## 事件流

```
1. { type: 'token_usage', current: 100, limit: 8000, ... }
2. { type: 'skill', name: 'jpg-to-png', description: '...' }
3. { type: 'action', tool: 'skill_script', params: { skill_name: 'jpg-to-png', ... } }
4. { type: 'observation', result: { success: true, output: '转换成功' } }
5. { type: 'token', content: '已' }
6. { type: 'token', content: '成' }
7. { type: 'token', content: '功' }
8. ... (更多 token)
9. { type: 'answer', content: '已成功将图片转换为 PNG 格式。' }
```

## 调试建议

1. **查看日志**：代码中有大量 `console.log`，在调试控制台查看
2. **关键断点位置**：
   - `SkillsManager.matchSkills()` - 查看关键词匹配
   - `SkillsManager.generateSkillsPrompt()` - 查看生成的提示
   - `SkillScriptTool.execute()` - 查看脚本执行
3. **条件断点**：`event.type === 'skill'` 或 `event.type === 'action'`
