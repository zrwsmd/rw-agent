// src/agent/AgentEngine.ts - Full Optimized Implementation (Bug Fixed)

import {
  AgentEngine as IAgentEngine,
  AgentEvent,
  AgentMode,
  AgentState,
} from '../types/agent';
import { LLMAdapter, LLMMessage } from '../types/llm';
import { ToolRegistry } from '../types/tool';
import { ContextManagerImpl } from '../context/ContextManager';
import { ReActExecutor } from './ReActExecutor';
import { PlanExecutor } from './PlanExecutor';
import { FunctionCallingExecutor } from './FunctionCallingExecutor';
import { Plan } from '../types/plan';
import { SkillsManager, Skill } from '../skills';
import { MCPIntegration } from '../mcp';

/**
 * Agent 引擎实现 - 优化版
 */
export class AgentEngineImpl implements IAgentEngine {
  private contextManager: ContextManagerImpl;
  private toolRegistry: ToolRegistry;
  private llmAdapter: LLMAdapter;
  private reactExecutor: ReActExecutor;
  private planExecutor: PlanExecutor;
  private functionCallingExecutor: FunctionCallingExecutor;
  private skillsManager: SkillsManager | null = null;
  private mcpIntegration: MCPIntegration | null = null;

  private state: AgentState = { status: 'idle' };
  private currentPlan: Plan | null = null;
  
  // ✅ OPTIMIZATION: Cache matched skills to avoid re-matching
  private cachedMatchedSkills: Skill[] = [];

  constructor(
    contextManager: ContextManagerImpl,
    toolRegistry: ToolRegistry,
    llmAdapter: LLMAdapter,
    workspaceRoot?: string,
    mcpIntegration?: MCPIntegration
  ) {
    this.contextManager = contextManager;
    this.toolRegistry = toolRegistry;
    this.llmAdapter = llmAdapter;
    this.reactExecutor = new ReActExecutor();
    this.planExecutor = new PlanExecutor();
    this.functionCallingExecutor = new FunctionCallingExecutor();
    
    if (workspaceRoot) {
      this.skillsManager = new SkillsManager(workspaceRoot);
    }
    
    this.mcpIntegration = mcpIntegration || null;
  }

  /**
   * 设置模型（用于ContextManager的token限制计算）
   */
  setModel(model: string): void {
    this.contextManager.setModel(model);
    console.log('[AgentEngine] 设置模型:', model);
  }

  getSkillsManager(): SkillsManager | null {
    return this.skillsManager;
  }

  getMCPIntegration(): MCPIntegration | null {
    return this.mcpIntegration;
  }

  /**
   * 处理用户消息 - 优化版
   */
  async *processMessage(
    message: string,
    mode: AgentMode,
    images?: Array<{ mimeType: string; data: string }>
  ): AsyncIterable<AgentEvent> {
    // ===== 预检查：在添加用户消息前检查（阈值85%）=====
    // 如果已经非常接近限制，先进行上下文管理
    const preCheckUsage = this.contextManager.getTokenUsage();
    if (this.contextManager.needsContextSummarization(0.85)) {
      console.log('[AgentEngine] 预检查触发：token使用率超过85%，先进行上下文管理');
      // 传递当前用户问题，确保不丢失
      yield* this.performContextSummarization(message);
      console.log('[AgentEngine] 上下文管理完成，继续处理用户问题...');
    }

    // 添加用户消息到上下文（可能是新的上下文）
    this.contextManager.addMessage({
      id: this.generateId(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
      images: images,
    });

    // 获取当前token使用情况
    const tokenUsage = this.contextManager.getTokenUsage();
    
    // 发送 Token 使用信息
    yield {
      type: 'token_usage',
      current: tokenUsage.current,
      limit: tokenUsage.limit,
      remaining: tokenUsage.remaining,
      percentage: tokenUsage.percentage,
    };

    const context = this.contextManager.getContext(8000);

    if (mode === 'react') {
      // ✅ OPTIMIZATION: Check tools AND cache matched skills in one pass (async for semantic matching)
      const needsTools = await this.checkToolsAndCacheSkills(message);
      
      if (needsTools) {
        // Emit skill events from cached skills
        for (const skill of this.cachedMatchedSkills) {
          yield { 
            type: 'skill', 
            name: skill.name, 
            description: skill.config.description 
          };
        }

        // ✅ 调试：检查 LLM 适配器类型和工具支持
        const supportsTools = this.llmAdapter.supportsNativeTools();
        console.log('[AgentEngine] LLM 适配器类型:', this.llmAdapter.constructor.name);
        console.log('[AgentEngine] supportsNativeTools():', supportsTools);
        console.log('[AgentEngine] 工具注册表工具数量:', this.toolRegistry.list().length);
        console.log('[AgentEngine] 已注册工具:', this.toolRegistry.list().map(t => t.name).join(', '));

        // Choose executor based on LLM capabilities
        if (supportsTools) {
          console.log('[AgentEngine] 使用原生函数调用模式');
          yield* this.executeFunctionCalling(message, context);
        } else {
          console.log('[AgentEngine] 使用 ReAct 模式（LLM 不支持原生函数调用）');
          yield* this.executeReAct(message, context);
        }
      } else {
        // Simple chat without tools
        yield* this.executeSimpleChat(message, context);
      }
    } else {
      // Plan mode
      yield* this.executePlan(message, context);
    }

    // ✅ Clear cache after processing
    this.cachedMatchedSkills = [];
  }

  /**
   * ✅ OPTIMIZATION: Combined tool check + skill caching (使用语义匹配)
   * This prevents Skills from being matched multiple times
   * 
   * 修复：先执行语义匹配，再检查 MCP 工具，确保 skills 总是被匹配
   */
  private async checkToolsAndCacheSkills(message: string): Promise<boolean> {
    // Reset cache
    this.cachedMatchedSkills = [];
    let needsTools = false;

    // ✅ 先执行 Skills 语义匹配（无论是否有 MCP 工具）
    if (this.skillsManager) {
      try {
        console.log('[AgentEngine] 开始语义匹配 Skills...');
        this.cachedMatchedSkills = await this.skillsManager.matchSkillsSemantic(message);
        if (this.cachedMatchedSkills.length > 0) {
          console.log(
            '[AgentEngine] 语义匹配到 Skills:', 
            this.cachedMatchedSkills.map(s => s.name)
          );
          needsTools = true;
        }
      } catch (error) {
        console.error('[AgentEngine] 语义匹配失败:', error);
      }
    }

    // 检查 MCP 工具
    if (this.mcpIntegration) {
      const mcpTools = this.mcpIntegration.getMCPTools();
      const totalMCPTools = mcpTools.reduce((sum, s) => sum + s.tools.length, 0);
      if (totalMCPTools > 0) {
        console.log(`[AgentEngine] 检测到 ${totalMCPTools} 个 MCP 工具可用`);
        needsTools = true;
      }
    }

    // 如果已经匹配到 skills 或有 MCP 工具，直接返回
    if (needsTools) {
      return true;
    }
    
    // Fallback to keyword detection for basic tool usage (file operations only)
    const toolKeywords = [
      '文件', '读取', '写入', '创建', '删除',
      '搜索', '查找', '打开', '保存',
      '执行', '运行', '命令', '终端', 'shell',
      'file', 'read', 'write', 'create', 'search', 'find',
      'grep', 'execute', 'run', 'command',
      '目录', '文件夹',
      // LSP 相关关键词
      '函数', '方法', '类', '接口', '变量', '符号',
      '定义', '引用', '跳转', '导航',
      'function', 'method', 'class', 'interface', 'variable', 'symbol',
      'definition', 'reference', 'navigate', 'symbols',
      '哪些函数', '有什么方法', '包含什么', '代码结构',
    ];
    
    const lowerMessage = message.toLowerCase();
    return toolKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  /**
   * 简单聊天模式 - 直接调用 LLM
   * ✅ BUG FIXED: Use cached skills instead of re-matching
   */
  private async *executeSimpleChat(
    message: string,
    context: LLMMessage[]
  ): AsyncIterable<AgentEvent> {
    this.state = { status: 'thinking', thought: '思考中...' };

    console.log('[AgentEngine] 开始简单聊天模式');

    try {
      let fullResponse = '';
      
      // 获取当前日期
      const today = new Date();
      const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
      
      // ✅ BUG FIX: Build system prompt AFTER skills check
      let systemPrompt = '';
      
      // ✅ Use cached skills instead of re-matching
      if (this.cachedMatchedSkills.length > 0 && this.skillsManager) {
        console.log('[AgentEngine] 简单聊天模式检测到匹配的 Skills:', 
          this.cachedMatchedSkills.map(s => s.name));
        
        // Generate skills prompt with cached skills
        const skillsPrompt = this.skillsManager.generateSkillsPrompt(message, this.cachedMatchedSkills);
        
        // Build system prompt with skills
        systemPrompt = `你是一个智能助手，可以帮助用户完成各种任务。请用中文回答。\n\n当前日期：${dateStr}`;
        systemPrompt += skillsPrompt;
        
        console.log('[AgentEngine] Skills 提示已注入到简单聊天模式');
      } else {
        // No skills matched, use default prompt
        systemPrompt = `你是一个智能助手，可以帮助用户完成各种任务。请用中文回答。\n\n当前日期：${dateStr}`;
      }
      
      const messages = [
        {
          role: 'system' as const,
          content: systemPrompt,
        },
        ...context,
      ];

      for await (const token of this.llmAdapter.streamComplete(messages)) {
        fullResponse += token;
        yield { type: 'token', content: token };
      }

      yield { type: 'answer', content: fullResponse };

      this.contextManager.addMessage({
        id: this.generateId(),
        role: 'assistant',
        content: fullResponse,
        timestamp: Date.now(),
      });

      // 发送更新后的 Token 使用信息（包含 AI 回复）
      const updatedTokenUsage = this.contextManager.getTokenUsage();
      yield {
        type: 'token_usage',
        current: updatedTokenUsage.current,
        limit: updatedTokenUsage.limit,
        remaining: updatedTokenUsage.remaining,
        percentage: updatedTokenUsage.percentage,
      };

      // 在AI回复后检查是否需要上下文管理
      yield* this.checkContextAfterResponse();
    } catch (error) {
      console.error('[AgentEngine] 错误:', error);
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : '调用 LLM 失败',
      };
    }

    this.state = { status: 'idle' };
  }

  /**
   * 执行函数调用模式（原生工具调用）
   * ✅ OPTIMIZATION: Use cached skills instead of re-matching
   */
  private async *executeFunctionCalling(
    goal: string,
    context: LLMMessage[]
  ): AsyncIterable<AgentEvent> {
    this.state = { status: 'thinking', thought: '' };

    // ✅ Use cached skills (already matched in checkToolsAndCacheSkills)
    let skillsPrompt = '';
    if (this.cachedMatchedSkills.length > 0 && this.skillsManager) {
      skillsPrompt = this.skillsManager.generateSkillsPrompt(goal, this.cachedMatchedSkills);
      console.log('[AgentEngine] Skills 注入:', this.cachedMatchedSkills.map(s => s.name));
    }

    let finalAnswer = '';

    // 跟踪当前工具调用
    let currentToolCall: { tool: string; params: unknown } | null = null;

    for await (const event of this.functionCallingExecutor.execute(
      goal,
      context,
      this.toolRegistry,
      this.llmAdapter,
      skillsPrompt
    )) {
      if (event.type === 'action') {
        this.state = {
          status: 'acting',
          tool: event.tool,
          params: event.params,
        };
        // 记录当前工具调用
        currentToolCall = { tool: event.tool, params: event.params };
      } else if (event.type === 'observation') {
        // 保存工具调用结果到上下文
        if (currentToolCall) {
          this.contextManager.addMessage({
            id: this.generateId(),
            role: 'assistant',
            content: `使用工具 ${currentToolCall.tool}`,
            timestamp: Date.now(),
            toolCall: {
              name: currentToolCall.tool,
              parameters: currentToolCall.params as Record<string, unknown>,
              result: event.result,
            },
          });
          currentToolCall = null;
        }
      } else if (event.type === 'answer') {
        finalAnswer = event.content;
      }

      yield event;
    }

    if (finalAnswer) {
      this.contextManager.addMessage({
        id: this.generateId(),
        role: 'assistant',
        content: finalAnswer,
        timestamp: Date.now(),
      });

      // 发送更新后的 Token 使用信息（包含 AI 回复）
      const updatedTokenUsage = this.contextManager.getTokenUsage();
      yield {
        type: 'token_usage',
        current: updatedTokenUsage.current,
        limit: updatedTokenUsage.limit,
        remaining: updatedTokenUsage.remaining,
        percentage: updatedTokenUsage.percentage,
      };

      // 在AI回复后检查是否需要上下文管理
      yield* this.checkContextAfterResponse();
    }

    this.state = { status: 'idle' };
  }

  /**
   * 执行 ReAct 模式（文本解析方式）
   * ✅ OPTIMIZATION: Use cached skills instead of re-matching
   */
  private async *executeReAct(
    goal: string,
    context: LLMMessage[]
  ): AsyncIterable<AgentEvent> {
    this.state = { status: 'thinking', thought: '' };

    // ✅ Use cached skills (already matched in checkToolsAndCacheSkills)
    let skillsPrompt = '';
    if (this.cachedMatchedSkills.length > 0 && this.skillsManager) {
      skillsPrompt = this.skillsManager.generateSkillsPrompt(goal, this.cachedMatchedSkills);
      console.log('[AgentEngine] Skills 注入:', this.cachedMatchedSkills.map(s => s.name));
    }

    let finalAnswer = '';
    // 跟踪当前工具调用
    let currentToolCall: { tool: string; params: unknown } | null = null;

    for await (const event of this.reactExecutor.execute(
      goal,
      context,
      this.toolRegistry,
      this.llmAdapter,
      skillsPrompt
    )) {
      if (event.type === 'thought') {
        this.state = { status: 'thinking', thought: event.content };
      } else if (event.type === 'action') {
        this.state = {
          status: 'acting',
          tool: event.tool,
          params: event.params,
        };
        // 记录当前工具调用
        currentToolCall = { tool: event.tool, params: event.params };
      } else if (event.type === 'observation') {
        // 保存工具调用结果到上下文
        if (currentToolCall) {
          this.contextManager.addMessage({
            id: this.generateId(),
            role: 'assistant',
            content: `使用工具 ${currentToolCall.tool}`,
            timestamp: Date.now(),
            toolCall: {
              name: currentToolCall.tool,
              parameters: currentToolCall.params as Record<string, unknown>,
              result: event.result,
            },
          });
          currentToolCall = null;
        }
      } else if (event.type === 'answer') {
        finalAnswer = event.content;
      }

      yield event;
    }

    if (finalAnswer) {
      this.contextManager.addMessage({
        id: this.generateId(),
        role: 'assistant',
        content: finalAnswer,
        timestamp: Date.now(),
      });

      // 发送更新后的 Token 使用信息（包含 AI 回复）
      const updatedTokenUsage = this.contextManager.getTokenUsage();
      yield {
        type: 'token_usage',
        current: updatedTokenUsage.current,
        limit: updatedTokenUsage.limit,
        remaining: updatedTokenUsage.remaining,
        percentage: updatedTokenUsage.percentage,
      };

      // 在AI回复后检查是否需要上下文管理
      yield* this.checkContextAfterResponse();
    }

    this.state = { status: 'idle' };
  }

  /**
   * 执行 Plan 模式
   */
  private async *executePlan(
    goal: string,
    context: LLMMessage[]
  ): AsyncIterable<AgentEvent> {
    this.state = { status: 'planning', plan: null as unknown as Plan };

    const plan = await this.planExecutor.createPlan(goal, context, this.llmAdapter);
    this.currentPlan = plan;
    this.state = { status: 'planning', plan };

    yield { type: 'plan', plan };

    let finalAnswer = '';

    for await (const event of this.planExecutor.executePlan(
      plan,
      context,
      this.toolRegistry,
      this.llmAdapter
    )) {
      if (event.type === 'step_complete') {
        const completedSteps = plan.steps.filter(
          (s) => s.status === 'completed'
        ).length;
        this.state = {
          status: 'executing',
          step: completedSteps,
          total: plan.steps.length,
        };
      } else if (event.type === 'answer') {
        finalAnswer = event.content;
      }

      yield event;
    }

    if (finalAnswer) {
      this.contextManager.addMessage({
        id: this.generateId(),
        role: 'assistant',
        content: finalAnswer,
        timestamp: Date.now(),
      });

      // 发送更新后的 Token 使用信息（包含 AI 回复）
      const updatedTokenUsage = this.contextManager.getTokenUsage();
      yield {
        type: 'token_usage',
        current: updatedTokenUsage.current,
        limit: updatedTokenUsage.limit,
        remaining: updatedTokenUsage.remaining,
        percentage: updatedTokenUsage.percentage,
      };

      // 在AI回复后检查是否需要上下文管理
      yield* this.checkContextAfterResponse();
    }

    this.state = { status: 'idle' };
  }

  /**
   * 取消当前执行
   * ✅ OPTIMIZATION: Also clear skill cache
   */
  cancel(): void {
    this.reactExecutor.cancel();
    this.planExecutor.cancel();
    this.functionCallingExecutor.cancel();
    this.state = { status: 'idle' };
    
    // ✅ Clear skill cache on cancel
    this.cachedMatchedSkills = [];
    
    // 清理最后一条用户消息（被取消的请求）
    this.removeLastUserMessage();
  }

  /**
   * 移除最后一条用户消息（用于取消操作时清理上下文）
   */
  private removeLastUserMessage(): void {
    const messages = this.contextManager.getHistory();
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'user') {
        // 移除最后一条用户消息
        this.contextManager.removeLastMessage();
        console.log('[AgentEngine] 已清理被取消的用户消息:', lastMessage.content.substring(0, 50));
      }
    }
  }

  getState(): AgentState {
    return this.state;
  }

  getCurrentPlan(): Plan | null {
    return this.currentPlan;
  }

  getContextManager(): ContextManagerImpl {
    return this.contextManager;
  }

  /**
   * 获取 Token 使用统计
   */
  getTokenUsage(): {
    current: number;
    limit: number;
    remaining: number;
    percentage: number;
  } {
    return this.contextManager.getTokenUsage();
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 检查是否需要智能上下文管理（在AI回复后调用）
   * 后检查：阈值80%，为下次对话做准备
   */
  private async *checkContextAfterResponse(): AsyncIterable<AgentEvent> {
    if (this.contextManager.needsContextSummarization(0.80)) {
      console.log('[AgentEngine] 后检查触发：token使用率超过80%，为下次对话做准备');
      yield* this.performContextSummarization();
    }
  }

  /**
   * 执行上下文总结
   * 用大模型把对话压缩成简短的问答记录，累积保存
   */
  private async *performContextSummarization(pendingUserMessage?: string): AsyncIterable<AgentEvent> {
    console.log('[AgentEngine] ===== 开始上下文总结 =====');
    
    yield {
      type: 'thought',
      content: '对话历史较长，正在让AI总结上下文...',
    };

    try {
      const { toSummarize, toKeep, previousSummary } = this.contextManager.getMessagesForSummarization(2);
      
      // 解析之前的历史记录（JSON数组）
      let historyRecords: Array<{q: string, a: string}> = [];
      if (previousSummary) {
        try {
          historyRecords = JSON.parse(previousSummary);
          console.log('[AgentEngine] 已有历史记录数:', historyRecords.length);
        } catch (e) {
          console.log('[AgentEngine] 解析历史记录失败，重新开始');
        }
      }
      
      // 收集需要总结的对话，过滤掉工具调用的中间消息
      const allMessages = [...toSummarize, ...toKeep];
      const conversations: Array<{question: string, answer: string}> = [];
      
      let currentQuestion: string | null = null;
      let lastAnswer: string | null = null;
      
      for (const msg of allMessages) {
        if (msg.role === 'user') {
          // 如果有上一轮的问答，先保存
          if (currentQuestion && lastAnswer) {
            conversations.push({ question: currentQuestion, answer: lastAnswer });
          }
          currentQuestion = msg.content;
          lastAnswer = null;
        } else if (msg.role === 'assistant') {
          // 过滤掉工具调用的中间消息（通常很短或包含"使用工具"）
          const content = msg.content;
          if (content.length > 20 && 
              !content.startsWith('使用工具') && 
              !content.includes('正在搜索') &&
              !content.includes('正在查询')) {
            // 这是最终答案，覆盖之前的中间结果
            lastAnswer = content;
          }
        }
      }
      
      // 保存最后一轮问答
      if (currentQuestion && lastAnswer) {
        conversations.push({ question: currentQuestion, answer: lastAnswer });
      }
      
      console.log('[AgentEngine] 收集到有效对话数:', conversations.length);
      
      // 用大模型总结每轮对话
      if (conversations.length > 0) {
        const summaryPrompt = `请将以下对话总结成简短的问答记录。
要求：
1. 每条记录用一句话概括问题的核心
2. 答案要提取最终结论，不要包含"通过搜索"、"使用工具"等过程描述
3. 直接返回JSON数组格式，不要其他内容

对话内容：
${conversations.map((c, i) => `对话${i+1}:\n问：${c.question}\n答：${c.answer}`).join('\n\n')}

返回格式：[{"q":"问题概括","a":"答案要点"},...]`;

        try {
          console.log('[AgentEngine] 调用大模型总结对话...');
          const summaryResponse = await this.llmAdapter.complete([
            { role: 'user', content: summaryPrompt }
          ], { maxTokens: 500, temperature: 0.3 });
          
          if (summaryResponse) {
            const jsonMatch = summaryResponse.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const newRecords = JSON.parse(jsonMatch[0]) as Array<{q: string, a: string}>;
              historyRecords.push(...newRecords);
              console.log('[AgentEngine] 大模型总结完成，新增记录:', newRecords.length);
            }
          }
        } catch (e) {
          console.error('[AgentEngine] 大模型总结失败，使用简单截取:', e);
          for (const conv of conversations) {
            historyRecords.push({
              q: conv.question.substring(0, 50),
              a: conv.answer.substring(0, 100)
            });
          }
        }
      }
      
      // 如果历史记录太多，保留最近的15条
      if (historyRecords.length > 15) {
        historyRecords = historyRecords.slice(-15);
      }
      
      const summaryJson = JSON.stringify(historyRecords);
      console.log('[AgentEngine] 累积历史记录数:', historyRecords.length);
      
      this.contextManager.applySummarization(summaryJson, 0);
      
      // 检查总结后的token使用情况
      const postSummaryUsage = this.contextManager.getTokenUsage();
      console.log('[AgentEngine] 总结后token使用:', postSummaryUsage);
      
      // 如果总结后仍然超过80%，说明历史记录太长了
      const isOverflow = postSummaryUsage.percentage > 80;
      if (isOverflow) {
        console.log('[AgentEngine] 历史记录过长，将在新窗口提示用户');
      }
      
      yield {
        type: 'context_summarized',
        summary: summaryJson,
        summarizedCount: toSummarize.length,
        hasHistorySummary: !!previousSummary
      };
      
      yield {
        type: 'new_conversation_with_summary',
        summary: summaryJson,
        summarizedCount: toSummarize.length,
        pendingUserMessage: pendingUserMessage,
        isOverflow: isOverflow
      };
      
      console.log('[AgentEngine] ===== 上下文总结完成 =====');
    } catch (error) {
      console.error('[AgentEngine] 上下文总结失败:', error);
    }
  }

  /**
   * 总结历史上下文
   */
  private async summarizeContext(messages: Array<{ role: string; content: string; timestamp: number }>): Promise<string> {
    try {
      console.log('[AgentEngine] 开始总结上下文，消息数量:', messages.length);
      
      // 构建总结提示
      const conversationText = messages
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n\n');

      console.log('[AgentEngine] 对话文本长度:', conversationText.length);

      const summaryPrompt = `请总结以下对话的关键信息，包括：
1. 主要讨论的话题和问题
2. 重要的决定和结论
3. 正在进行的任务或项目状态
4. 需要记住的重要上下文信息

对话内容：
${conversationText}

请用简洁的中文总结，保留所有重要信息：`;

      // 使用LLM生成总结
      const summaryMessages: LLMMessage[] = [
        { role: 'user', content: summaryPrompt }
      ];

      console.log('[AgentEngine] 调用LLM生成总结...');
      const response = await this.llmAdapter.complete(summaryMessages, {
        maxTokens: 500, // 减少token使用
        temperature: 0.3
      });

      console.log('[AgentEngine] LLM响应:', response ? response.substring(0, 100) + '...' : 'null');
      return response || '无法生成上下文总结';
    } catch (error) {
      console.error('[AgentEngine] 上下文总结失败:', error);
      // 返回简单的统计信息作为降级方案
      const topicKeywords = this.extractTopicKeywords(messages);
      return `对话涉及 ${messages.length} 条消息，主要话题包括：${topicKeywords.join('、')}`;
    }
  }

  /**
   * 提取话题关键词（降级方案）
   */
  private extractTopicKeywords(messages: Array<{ content: string }>): string[] {
    const keywords = new Set<string>();
    const commonWords = ['的', '了', '是', '在', '有', '和', '我', '你', '他', '她', '它', '这', '那', '一个', '可以', '需要', '如果', '但是', '因为', '所以'];
    
    messages.forEach(msg => {
      const words = msg.content
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 1 && !commonWords.includes(word));
      
      words.forEach(word => {
        if (word.length >= 2) {
          keywords.add(word);
        }
      });
    });

    return Array.from(keywords).slice(0, 10);
  }
}

/**
 * 创建 Agent 引擎实例
 */
export function createAgentEngine(
  contextManager: ContextManagerImpl,
  toolRegistry: ToolRegistry,
  llmAdapter: LLMAdapter,
  workspaceRoot?: string,
  mcpIntegration?: MCPIntegration
): AgentEngineImpl {
  return new AgentEngineImpl(contextManager, toolRegistry, llmAdapter, workspaceRoot, mcpIntegration);
}