# Skill 调用链详解

## 概述

Skill 是一种可扩展的能力包，允许 Agent 根据用户消息自动匹配并注入专业领域知识和工具脚本。

**v2.0 更新：使用向量语义匹配替代关键词匹配，更精准识别用户意图。**

## 调用链流程图

```
用户发送消息 "帮我把这个 jpg 转成 png"
        │
        ▼
1. extension.ts: handleUserMessage()
        │
        ▼
2. AgentEngine.ts: processMessage()
   └─ 调用 checkToolsAndCacheSkills(message) [异步]
        │
        ▼
3. checkToolsAndCacheSkills() [异步]
   └─ 调用 skillsManager.matchSkillsSemantic(message)
        │
        ▼
4. SemanticMatcher.match()
   └─ 计算用户消息与 Skill 的向量相似度
   └─ 返回相似度最高且超过阈值(0.18)的 Skill
        │
        ▼
5. generateSkillsPrompt(goal, cachedMatchedSkills)
   └─ 有脚本：强制要求 LLM 使用 skill_script 工具
   └─ 无脚本：作为知识型指导
        │
        ▼
6. FunctionCallingExecutor.execute()
   └─ LLM 调用 skill_script 工具
        │
        ▼
7. SkillsManager.executeScript()
   └─ 执行脚本，返回结果
```

## 向量语义匹配

### 工作原理

使用 `@xenova/transformers` 的 `all-MiniLM-L6-v2` 模型：

```
用户消息 → Embedding → 余弦相似度 → 返回最高分 Skill
```

### 示例

| 用户输入 | 匹配结果 | 相似度 |
|---------|---------|--------|
| "将a2.jpg转化为png" | jpg-to-png | 0.51 |
| "帮我审查这段代码" | code-review | 0.21 |
| "代码中有 const img = 'test.jpg'" | code-review | 0.20 |

## 脚本执行优先级

**重要**：如果 Skill 包含脚本，LLM 被强制要求优先执行脚本，不自己编写代码。

## 关键文件

- `src/skills/SemanticMatcher.ts` - 向量语义匹配器
- `src/skills/SkillsManager.ts` - Skill 管理和脚本执行
- `src/agent/AgentEngine.ts` - 调用流程控制

## 测试

```bash
node test/semantic-matcher.test.js
```
