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
    
    if (workspaceRoot) {
      this.skillsManager = new SkillsManager(workspaceRoot);
    }
  }

  /**
   * 获取 Skills 管理器
   */
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
    // 添加用户消息到上下文
    this.contextManager.addMessage({
      id: this.generateId(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });

    const context = this.contextManager.getContext(8000);

    if (mode === 'react') {
      // 检查是否需要使用工具
      const needsTools = this.needsToolUsage(message);
      if (needsTools) {
        yield* this.executeReAct(message, context);
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
      '代码', '项目', '目录', '文件夹'
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
      
      // 添加系统提示和 Skills
      let systemPrompt = '你是一个智能助手，可以帮助用户完成各种任务。请用中文回答。';
      
      // 注入匹配的 Skills
      if (this.skillsManager) {
        const userMessage = context.find(m => m.role === 'user')?.content || '';
        const skillsPrompt = this.skillsManager.generateSkillsPrompt(userMessage);
        if (skillsPrompt) {
          systemPrompt += skillsPrompt;
        }
      }
      
      const messages = [
        {
          role: 'system' as const,
          content: systemPrompt,
        },
        ...context,
      ];

      console.log('[AgentEngine] 调用 LLM streamComplete, 消息数:', messages.length);

      for await (const token of this.llmAdapter.streamComplete(messages)) {
        console.log('[AgentEngine] 收到 token:', token.substring(0, 30));
        fullResponse += token;
        yield { type: 'token', content: token };
      }

      console.log('[AgentEngine] 流式完成, 总长度:', fullResponse.length);

      // 发送最终答案
      yield { type: 'answer', content: fullResponse };

      // 添加助手响应到上下文
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
   * 执行 ReAct 模式
   */
  private async *executeReAct(
    goal: string,
    context: { role: 'system' | 'user' | 'assistant'; content: string }[]
  ): AsyncIterable<AgentEvent> {
    this.state = { status: 'thinking', thought: '' };

    // 注入 Skills 到 context
    let skillsPrompt = '';
    if (this.skillsManager) {
      skillsPrompt = this.skillsManager.generateSkillsPrompt(goal);
      console.log('[AgentEngine] Skills 注入:', skillsPrompt ? '有匹配' : '无匹配');
    }

    let finalAnswer = '';

    for await (const event of this.reactExecutor.execute(
      goal,
      context,
      this.toolRegistry,
      this.llmAdapter,
      skillsPrompt
    )) {
      // 更新状态
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

    // 添加助手响应到上下文
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
    // 创建计划
    this.state = { status: 'planning', plan: null as unknown as Plan };

    const plan = await this.planExecutor.createPlan(goal, context, this.llmAdapter);
    this.currentPlan = plan;
    this.state = { status: 'planning', plan };

    yield { type: 'plan', plan };

    // 执行计划
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

    // 添加助手响应到上下文
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
    this.state = { status: 'idle' };
  }

  /**
   * 获取当前状态
   */
  getState(): AgentState {
    return this.state;
  }

  /**
   * 获取当前计划
   */
  getCurrentPlan(): Plan | null {
    return this.currentPlan;
  }

  /**
   * 获取上下文管理器
   */
  getContextManager(): ContextManagerImpl {
    return this.contextManager;
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

/**
 * 创建 Agent 引擎
 */
export function createAgentEngine(
  contextManager: ContextManagerImpl,
  toolRegistry: ToolRegistry,
  llmAdapter: LLMAdapter,
  workspaceRoot?: string
): AgentEngineImpl {
  return new AgentEngineImpl(contextManager, toolRegistry, llmAdapter, workspaceRoot);
}
