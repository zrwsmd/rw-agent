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
    // 检查 Token 限制，必要时自动截断
    if (this.contextManager.isNearTokenLimit(0.85)) {
      const deletedCount = this.contextManager.autoTruncate(4000);
      if (deletedCount > 0) {
        console.log(`[AgentEngine] 自动截断了 ${deletedCount} 条旧消息以保持在 Token 限制内`);
        yield {
          type: 'thought',
          content: `对话历史过长，已自动清理 ${deletedCount} 条旧消息`,
        };
      }
    }

    // 添加用户消息到上下文
    this.contextManager.addMessage({
      id: this.generateId(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
      images: images, // 添加图片
    });

    // 发送 Token 使用信息
    const tokenUsage = this.contextManager.getTokenUsage();
    yield {
      type: 'token_usage',
      current: tokenUsage.current,
      limit: tokenUsage.limit,
      remaining: tokenUsage.remaining,
      percentage: tokenUsage.percentage,
    };

    const context = this.contextManager.getContext(8000);

    if (mode === 'react') {
      // ✅ OPTIMIZATION: Check tools AND cache matched skills in one pass
      const needsTools = this.checkToolsAndCacheSkills(message);
      
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
   * ✅ OPTIMIZATION: Combined tool check + skill caching
   * This prevents Skills from being matched multiple times
   */
  private checkToolsAndCacheSkills(message: string): boolean {
    // Reset cache
    this.cachedMatchedSkills = [];

    // Check Skills first (higher priority)
    if (this.skillsManager) {
      this.cachedMatchedSkills = this.skillsManager.matchSkills(message);
      if (this.cachedMatchedSkills.length > 0) {
        console.log(
          '[AgentEngine] 检测到匹配的 Skills，启用工具模式:', 
          this.cachedMatchedSkills.map(s => s.name)
        );
        return true;
      }
    }
    
    // Check MCP tools - 如果有 MCP 工具可用，也启用工具模式
    if (this.mcpIntegration) {
      const mcpTools = this.mcpIntegration.getMCPTools();
      const totalMCPTools = mcpTools.reduce((sum, s) => sum + s.tools.length, 0);
      if (totalMCPTools > 0) {
        console.log(`[AgentEngine] 检测到 ${totalMCPTools} 个 MCP 工具可用，启用工具模式`);
        console.log('[AgentEngine] MCP 工具列表:');
        for (const { serverName, tools } of mcpTools) {
          console.log(`  服务器 ${serverName}:`);
          for (const tool of tools) {
            console.log(`    - ${tool.name}: ${tool.description}`);
          }
        }
        return true;
      }
    }
    
    // Fallback to keyword detection for non-skill tool usage
    const toolKeywords = [
      '文件', '读取', '写入', '创建', '修改', '删除',
      '搜索', '查找', '查看', '打开', '保存',
      '执行', '运行', '命令', '终端', 'shell',
      'file', 'read', 'write', 'create', 'search', 'find',
      'grep', 'execute', 'run', 'command',
      '代码', '项目', '目录', '文件夹', 'convert', '转换',
      '文言文', '列表', '获取', '网络', '网上',
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
        
        // Generate skills prompt with the original message
        const skillsPrompt = this.skillsManager.generateSkillsPrompt(message);
        
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
      skillsPrompt = this.skillsManager.generateSkillsPrompt(goal);
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
      skillsPrompt = this.skillsManager.generateSkillsPrompt(goal);
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
   * 设置当前模型（用于 Token 限制计算）
   */
  setModel(model: string): void {
    this.contextManager.setModel(model);
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
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