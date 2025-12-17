import { AgentEvent } from '../types/agent';
import { Plan, PlanStep } from '../types/plan';
import { LLMAdapter, LLMMessage } from '../types/llm';
import { ToolRegistry } from '../types/tool';
import { ReActExecutor } from './ReActExecutor';

/**
 * Plan 执行器
 */
export class PlanExecutor {
  private cancelled = false;
  private reactExecutor: ReActExecutor;

  constructor() {
    this.reactExecutor = new ReActExecutor();
  }

  /**
   * 创建计划
   */
  async createPlan(
    goal: string,
    context: LLMMessage[],
    llm: LLMAdapter
  ): Promise<Plan> {
    const prompt = this.buildPlanPrompt(goal);
    const messages: LLMMessage[] = [
      { role: 'system', content: prompt },
      ...context,
      { role: 'user', content: goal },
    ];

    const response = await llm.complete(messages);
    const steps = this.parsePlanSteps(response);

    return {
      id: this.generateId(),
      goal,
      steps,
      status: 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * 执行计划
   */
  async *executePlan(
    plan: Plan,
    context: LLMMessage[],
    toolRegistry: ToolRegistry,
    llm: LLMAdapter
  ): AsyncIterable<AgentEvent> {
    this.cancelled = false;
    plan.status = 'executing';
    plan.updatedAt = Date.now();

    yield { type: 'plan', plan: { ...plan } };

    for (let i = 0; i < plan.steps.length; i++) {
      if (this.cancelled) {
        plan.status = 'failed';
        yield { type: 'error', message: '计划执行已取消' };
        return;
      }

      const step = plan.steps[i];
      step.status = 'running';

      // 使用 ReAct 执行单个步骤
      const stepGoal = `执行计划步骤 ${step.id}: ${step.description}\n预期结果: ${step.expectedOutcome}`;
      let stepResult = '';
      let hasError = false;

      for await (const event of this.reactExecutor.execute(
        stepGoal,
        context,
        toolRegistry,
        llm
      )) {
        if (this.cancelled) {
          break;
        }

        yield event;

        if (event.type === 'answer') {
          stepResult = event.content;
        } else if (event.type === 'error') {
          hasError = true;
          stepResult = event.message;
        }
      }

      if (hasError || this.cancelled) {
        step.status = 'failed';
        step.result = stepResult;
        plan.status = 'failed';
        plan.updatedAt = Date.now();

        yield {
          type: 'step_complete',
          step: step.id,
          result: `步骤失败: ${stepResult}`,
        };

        // 暂停等待用户指导
        yield {
          type: 'error',
          message: `步骤 ${step.id} 执行失败，请提供指导`,
        };
        return;
      }

      step.status = 'completed';
      step.result = stepResult;

      yield {
        type: 'step_complete',
        step: step.id,
        result: stepResult,
      };
    }

    plan.status = 'completed';
    plan.updatedAt = Date.now();

    // 生成摘要
    const summary = this.generateSummary(plan);
    yield { type: 'answer', content: summary };
  }

  /**
   * 修改计划（保留已完成步骤）
   */
  modifyPlan(plan: Plan, newSteps: Omit<PlanStep, 'id' | 'status'>[]): Plan {
    const completedSteps = plan.steps.filter((s) => s.status === 'completed');
    const nextId = completedSteps.length + 1;

    const modifiedSteps: PlanStep[] = [
      ...completedSteps,
      ...newSteps.map((s, i) => ({
        ...s,
        id: nextId + i,
        status: 'pending' as const,
      })),
    ];

    return {
      ...plan,
      steps: modifiedSteps,
      status: 'approved',
      updatedAt: Date.now(),
    };
  }

  /**
   * 取消执行
   */
  cancel(): void {
    this.cancelled = true;
    this.reactExecutor.cancel();
  }

  /**
   * 构建计划生成提示
   */
  private buildPlanPrompt(goal: string): string {
    return `你是一个任务规划专家。请为以下目标创建一个详细的执行计划。

## 要求
1. 将任务分解为 3-7 个清晰的步骤
2. 每个步骤应该是具体、可执行的
3. 步骤之间应该有逻辑顺序
4. 每个步骤都要有明确的预期结果

## 输出格式
请按以下格式输出计划：

Step 1: [步骤描述]
Expected: [预期结果]

Step 2: [步骤描述]
Expected: [预期结果]

...

## 目标
${goal}`;
  }

  /**
   * 解析计划步骤
   */
  private parsePlanSteps(response: string): PlanStep[] {
    const steps: PlanStep[] = [];
    const stepRegex = /Step\s*(\d+):\s*([\s\S]*?)(?=Step\s*\d+:|$)/gi;
    let match;

    while ((match = stepRegex.exec(response)) !== null) {
      const stepContent = match[2].trim();
      const expectedMatch = stepContent.match(/Expected:\s*([\s\S]*?)$/i);

      const description = expectedMatch
        ? stepContent.replace(/Expected:\s*[\s\S]*$/i, '').trim()
        : stepContent;

      const expectedOutcome = expectedMatch
        ? expectedMatch[1].trim()
        : '步骤完成';

      steps.push({
        id: steps.length + 1,
        description,
        expectedOutcome,
        status: 'pending',
      });
    }

    // 如果没有解析到步骤，创建一个默认步骤
    if (steps.length === 0) {
      steps.push({
        id: 1,
        description: response.trim(),
        expectedOutcome: '任务完成',
        status: 'pending',
      });
    }

    return steps;
  }

  /**
   * 生成计划执行摘要
   */
  private generateSummary(plan: Plan): string {
    const completedSteps = plan.steps.filter((s) => s.status === 'completed');
    const lines = [
      `## 计划执行完成`,
      ``,
      `**目标**: ${plan.goal}`,
      ``,
      `**完成步骤**: ${completedSteps.length}/${plan.steps.length}`,
      ``,
    ];

    for (const step of completedSteps) {
      lines.push(`### 步骤 ${step.id}: ${step.description}`);
      lines.push(`结果: ${step.result || '完成'}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * 创建 Plan 执行器
 */
export function createPlanExecutor(): PlanExecutor {
  return new PlanExecutor();
}
