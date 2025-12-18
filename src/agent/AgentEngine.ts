// src/agent/AgentEngine.ts (Updated)

import {
  AgentEngine as IAgentEngine,
  AgentEvent,
  AgentMode,
  AgentState,
} from '../types/agent';
import { LLMAdapter } from '../types/llm';
import { ToolRegistry } from '../types/tool';
import { ContextManagerImpl } from '../context/ContextManager';
import { ReActExecutor } from './ReActExecutor';
import { PlanExecutor } from './PlanExecutor';
import { FunctionCallingExecutor } from './FunctionCallingExecutor';
import { Plan } from '../types/plan';
import { SkillsManager } from '../skills';

/**
 * Agent 引擎实现
 */
export class AgentEngineImpl implements IAgentEngine {
  private contextManager: ContextManagerImpl;
  private toolRegistry: ToolRegistry;
  private llmAdapter: LLMAdapter;
  private reactExecutor: ReActExecutor;
  private planExecutor: PlanExecutor;
  private functionCallingExecutor: FunctionCallingExecutor;
  private skillsManager: SkillsManager | null = null;

  private state: AgentState = { status: 'idle' };
  private currentPlan: Plan | null = null;

  constructor(
    contextManager: ContextManagerImpl,
    toolRegistry: ToolRegistry,
    llmAdapter: LLMAdapter,
    workspaceRoot?: string
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
  }

  getSkillsManager(): SkillsManager | null {
    return this.skillsManager;
  }

  /**
   * 处理用户消息
   */
  async *processMessage(
    message: string,
    mode: AgentMode
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
      // 检查是否需要使用工具
      const needsTools = this.needsToolUsage(message);
      if (needsTools) {
        // 如果 LLM 支持原生函数调用，优先使用
        if (this.llmAdapter.supportsNativeTools()) {
          console.log('[AgentEngine] 使用原生函数调用模式');
          yield* this.executeFunctionCalling(message, context);
        } else {
          console.log('[AgentEngine] 使用 ReAct 模式（LLM 不支持原生函数调用）');
          yield* this.executeReAct(message, context);
        }
      } else {
        yield* this.executeSimpleChat(context);
      }
    } else {
      yield* this.executePlan(message, context);
    }
  }

  /**
   * 判断是否需要使用工具
   */
  private needsToolUsage(message: string): boolean {
    const toolKeywords = [
      '文件', '读取', '写入', '创建', '修改', '删除',
      '搜索', '查找', '查看', '打开', '保存',
      '执行', '运行', '命令', '终端', 'shell',
      'file', 'read', 'write', 'create', 'search', 'find',
      'grep', 'execute', 'run', 'command',
      '代码', '项目', '目录', '文件夹', 'convert', '转换'
    ];
    
    const lowerMessage = message.toLowerCase();
    return toolKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  /**
   * 简单聊天模式 - 直接调用 LLM
   */
  private async *executeSimpleChat(
    context: { role: 'system' | 'user' | 'assistant'; content: string }[]
  ): AsyncIterable<AgentEvent> {
    this.state = { status: 'thinking', thought: '思考中...' };

    console.log('[AgentEngine] 开始简单聊天模式');

    try {
      let fullResponse = '';
      
      let systemPrompt = '你是一个智能助手，可以帮助用户完成各种任务。请用中文回答。';
      
      if (this.skillsManager) {
        const userMessages = context.filter(m => m.role === 'user');
        const latestUserMessage = userMessages.length > 0 ? userMessages[userMessages.length - 1].content : '';
        const matchedSkills = this.skillsManager.matchSkills(latestUserMessage);
        if (matchedSkills.length > 0) {
          const skillsPrompt = this.skillsManager.generateSkillsPrompt(latestUserMessage);
          systemPrompt += skillsPrompt;
          for (const skill of matchedSkills) {
            yield { type: 'skill', name: skill.name, description: skill.config.description };
          }
        }
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
   */
  private async *executeFunctionCalling(
    goal: string,
    context: { role: 'system' | 'user' | 'assistant'; content: string }[]
  ): AsyncIterable<AgentEvent> {
    this.state = { status: 'thinking', thought: '' };

    // 注入 Skills
    let skillsPrompt = '';
    if (this.skillsManager) {
      const matchedSkills = this.skillsManager.matchSkills(goal);
      if (matchedSkills.length > 0) {
        skillsPrompt = this.skillsManager.generateSkillsPrompt(goal);
        console.log('[AgentEngine] Skills 注入:', matchedSkills.map(s => s.name));
        for (const skill of matchedSkills) {
          yield { type: 'skill', name: skill.name, description: skill.config.description };
        }
      }
    }

    let finalAnswer = '';

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
   */
  private async *executeReAct(
    goal: string,
    context: { role: 'system' | 'user' | 'assistant'; content: string }[]
  ): AsyncIterable<AgentEvent> {
    this.state = { status: 'thinking', thought: '' };

    let skillsPrompt = '';
    if (this.skillsManager) {
      const matchedSkills = this.skillsManager.matchSkills(goal);
      if (matchedSkills.length > 0) {
        skillsPrompt = this.skillsManager.generateSkillsPrompt(goal);
        console.log('[AgentEngine] Skills 注入:', matchedSkills.map(s => s.name));
        for (const skill of matchedSkills) {
          yield { type: 'skill', name: skill.name, description: skill.config.description };
        }
      }
    }

    let finalAnswer = '';

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
    context: { role: 'system' | 'user' | 'assistant'; content: string }[]
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
   */
  cancel(): void {
    this.reactExecutor.cancel();
    this.planExecutor.cancel();
    this.functionCallingExecutor.cancel();
    this.state = { status: 'idle' };
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

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

export function createAgentEngine(
  contextManager: ContextManagerImpl,
  toolRegistry: ToolRegistry,
  llmAdapter: LLMAdapter,
  workspaceRoot?: string
): AgentEngineImpl {
  return new AgentEngineImpl(contextManager, toolRegistry, llmAdapter, workspaceRoot);
}