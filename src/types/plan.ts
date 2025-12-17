import { LLMAdapter } from './llm';
import { Tool } from './tool';
import { AgentEvent } from './agent';

/**
 * 计划状态
 */
export type PlanStatus = 'draft' | 'approved' | 'executing' | 'completed' | 'failed';

/**
 * 步骤状态
 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * 计划步骤
 */
export interface PlanStep {
  id: number;
  description: string;
  expectedOutcome: string;
  status: StepStatus;
  result?: string;
}

/**
 * 计划
 */
export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  status: PlanStatus;
  createdAt: number;
  updatedAt: number;
}

/**
 * 计划上下文
 */
export interface PlanContext {
  messages: { role: string; content: string }[];
}

/**
 * 计划执行器接口
 */
export interface PlanExecutor {
  createPlan(goal: string, context: PlanContext, llm: LLMAdapter): Promise<Plan>;
  executePlan(
    plan: Plan,
    context: PlanContext,
    tools: Tool[],
    llm: LLMAdapter
  ): AsyncIterable<AgentEvent>;
}
