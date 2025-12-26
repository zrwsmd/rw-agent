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
    // ===== 预检查：在添加用户消息前检查（阈值95%）=====
    // 如果已经非常接近限制，先进行上下文管理
    const preCheckUsage = this.contextManager.getTokenUsage();
    if (this.contextManager.needsContextSummarization(0.95)) {
      console.log('[AgentEngine] 预检查触发：token使用率超过95%，先进行上下文管理');
      yield* this.performContextSummarization();
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
   * 后检查：阈值85%，为下次对话做准备
   */
  private async *checkContextAfterResponse(): AsyncIterable<AgentEvent> {
    if (this.contextManager.needsContextSummarization(0.85)) {
      console.log('[AgentEngine] 后检查触发：token使用率超过85%，为下次对话做准备');
      yield* this.performContextSummarization();
    }
  }

  /**
   * 执行上下文总结和新对话切换
   * 累积历史总结，确保所有历史记录都被保留
   */
  private async *performContextSummarization(): AsyncIterable<AgentEvent> {
    const tokenUsage = this.contextManager.getTokenUsage();
    
    console.log('[AgentEngine] ===== 开始智能上下文管理 =====');
    console.log('[AgentEngine] Token使用情况:', tokenUsage);
    
    yield {
      type: 'thought',
      content: '对话历史较长，正在智能总结上下文...',
    };

    try {
      const { toSummarize, toKeep, previousSummary } = this.contextManager.getMessagesForSummarization(2);
      console.log('[AgentEngine] 需要总结的消息数量:', toSummarize.length);
      console.log('[AgentEngine] 保留的消息数量:', toKeep.length);
      console.log('[AgentEngine] 是否有之前的总结:', previousSummary ? '是' : '否');
      if (previousSummary) {
        console.log('[AgentEngine] 之前总结内容:', previousSummary.substring(0, 200) + '...');
      }
      
      if (toSummarize.length > 0 || previousSummary) {
        // 提取当前对话的关键词
        const topicKeywords = this.extractTopicKeywords(toSummarize);
        const currentSummary = toSummarize.length > 0 
          ? `本轮对话涉及 ${toSummarize.length} 条消息，主要话题：${topicKeywords.join('、')}。`
          : '';
        
        console.log('[AgentEngine] 当前轮总结:', currentSummary);
        
        // 累积总结：将之前的总结和当前总结合并
        let accumulatedSummary: string;
        if (previousSummary) {
          accumulatedSummary = `【历史记录】${previousSummary}\n\n【最近对话】${currentSummary}`;
          console.log('[AgentEngine] 累积模式：合并历史记录和当前对话');
        } else {
          accumulatedSummary = currentSummary;
          console.log('[AgentEngine] 首次总结模式：无历史记录');
        }
        
        console.log('[AgentEngine] 最终累积总结长度:', accumulatedSummary.length);
        console.log('[AgentEngine] 累积总结内容:', accumulatedSummary);
        
        // 检查累积总结本身是否太长
        const summaryTokens = this.contextManager.estimateTokens(accumulatedSummary);
        const tokenLimit = this.contextManager.getModelTokenLimit();
        const summaryPercentage = (summaryTokens / tokenLimit) * 100;
        
        console.log('[AgentEngine] 总结token数:', summaryTokens, '占比:', summaryPercentage.toFixed(1) + '%');
        
        // 如果累积总结本身超过了token限制的70%，说明历史太长了
        if (summaryPercentage > 70) {
          console.log('[AgentEngine] 累积总结过长，需要压缩历史记录');
          
          yield {
            type: 'context_overflow',
            message: '历史记录过长，部分早期对话将被压缩',
            summaryTokens: summaryTokens,
            tokenLimit: tokenLimit
          };
          
          // 压缩历史总结，只保留最近的部分
          accumulatedSummary = `【历史摘要】对话历史较长，已进行多轮总结。${currentSummary}`;
        }
        
        this.contextManager.applySummarization(accumulatedSummary, 2);
        
        yield {
          type: 'context_summarized',
          summary: accumulatedSummary,
          summarizedCount: toSummarize.length,
          hasHistorySummary: !!previousSummary
        };
        
        yield {
          type: 'new_conversation_with_summary',
          summary: accumulatedSummary,
          summarizedCount: toSummarize.length
        };
        
        console.log('[AgentEngine] ===== 上下文总结完成，历史记录已累积 =====');
      }
    } catch (error) {
      console.error('[AgentEngine] 上下文总结失败:', error);
      const deletedCount = this.contextManager.autoTruncate(30);
      if (deletedCount > 0) {
        yield {
          type: 'thought',
          content: `上下文总结失败，已自动清理 ${deletedCount} 条旧消息`,
        };
      }
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