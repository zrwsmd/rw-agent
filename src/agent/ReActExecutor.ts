import { AgentEvent } from '../types/agent';
import { LLMAdapter, LLMMessage } from '../types/llm';
import { Tool, ToolRegistry, ToolResult } from '../types/tool';

const MAX_ITERATIONS = 20;

/**
 * ReAct 步骤
 */
interface ReActStep {
  thought: string;
  action: { tool: string; parameters: Record<string, unknown> } | null;
}

/**
 * ReAct 执行器
 */
export class ReActExecutor {
  private cancelled = false;

  /**
   * 执行 ReAct 循环
   */
  async *execute(
    goal: string,
    context: LLMMessage[],
    toolRegistry: ToolRegistry,
    llm: LLMAdapter,
    skillsPrompt?: string
  ): AsyncIterable<AgentEvent> {
    this.cancelled = false;
    let iteration = 0;
    const observations: string[] = [];

    while (iteration < MAX_ITERATIONS && !this.cancelled) {
      iteration++;

      // 构建提示
      let prompt = this.buildPrompt(goal, toolRegistry, observations);
      
      // 注入 Skills
      if (skillsPrompt) {
        prompt += '\n' + skillsPrompt;
      }
      
      const messages: LLMMessage[] = [
        { role: 'system', content: prompt },
        ...context,
      ];

      // 获取 LLM 响应
      let response = '';
      for await (const token of llm.streamComplete(messages)) {
        if (this.cancelled) {
          break;
        }
        response += token;
        yield { type: 'token', content: token };
      }

      if (this.cancelled) {
        yield { type: 'error', message: '操作已取消' };
        return;
      }

      // 解析响应
      const step = this.parseResponse(response);

      // 发出思考事件
      yield { type: 'thought', content: step.thought };

      // 检查是否完成
      if (!step.action) {
        // 提取最终答案
        const answer = this.extractAnswer(response);
        yield { type: 'answer', content: answer };
        return;
      }

      // 发出行动事件
      yield { type: 'action', tool: step.action.tool, params: step.action.parameters };

      // 执行工具
      const tool = toolRegistry.get(step.action.tool);
      let result: ToolResult;

      if (!tool) {
        result = {
          success: false,
          output: '',
          error: `工具 "${step.action.tool}" 不存在`,
        };
      } else {
        try {
          result = await tool.execute(step.action.parameters);
        } catch (error) {
          result = {
            success: false,
            output: '',
            error: error instanceof Error ? error.message : '执行工具时发生错误',
          };
        }
      }

      // 发出观察事件
      yield { type: 'observation', result };

      // 记录观察结果 - 优先使用 output，其次使用 error
      const obsText = result.success
        ? result.output
        : `错误: ${result.output || result.error || '未知错误'}`;
      
      console.log('[ReActExecutor] 工具执行结果:', { success: result.success, output: result.output, error: result.error });
      
      observations.push(
        `Action: ${step.action.tool}(${JSON.stringify(step.action.parameters)})\nObservation: ${obsText}`
      );
    }

    if (iteration >= MAX_ITERATIONS) {
      yield {
        type: 'error',
        message: `达到最大迭代次数 (${MAX_ITERATIONS})，任务未完成`,
      };
    }
  }

  /**
   * 取消执行
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * 构建 ReAct 提示
   */
  private buildPrompt(
    goal: string,
    toolRegistry: ToolRegistry,
    observations: string[]
  ): string {
    const toolDescriptions = toolRegistry.getToolDescriptions();
    const obsHistory =
      observations.length > 0
        ? `\n\n之前的行动和观察:\n${observations.join('\n\n')}`
        : '';

    return `你是一个智能助手，使用 ReAct（推理-行动）模式来完成任务。

## 可用工具
${toolDescriptions}

## 任务
${goal}
${obsHistory}

## 响应格式
请按以下格式响应：

Thought: [你的推理过程，分析当前情况和下一步计划]
Action: [工具名称]
Action Input: [JSON 格式的参数]

或者，如果任务已完成：

Thought: [总结你的发现]
Final Answer: [最终答案]

注意：
1. 每次只执行一个行动
2. 仔细分析观察结果后再决定下一步
3. 如果遇到错误，尝试其他方法
4. 完成任务后给出 Final Answer`;
  }

  /**
   * 解析 LLM 响应
   */
  private parseResponse(response: string): ReActStep {
    // 提取 Thought
    const thoughtMatch = response.match(/Thought:\s*([\s\S]*?)(?=Action:|Final Answer:|$)/i);
    const thought = thoughtMatch ? thoughtMatch[1].trim() : '';

    // 检查是否有 Final Answer
    if (response.toLowerCase().includes('final answer:')) {
      return { thought, action: null };
    }

    // 提取 Action
    const actionMatch = response.match(/Action:\s*(\S+)/i);
    const inputMatch = response.match(/Action Input:\s*([\s\S]*?)(?=Thought:|Action:|$)/i);

    if (actionMatch) {
      const tool = actionMatch[1].trim();
      let parameters: Record<string, unknown> = {};

      if (inputMatch) {
        try {
          parameters = JSON.parse(inputMatch[1].trim());
        } catch {
          // 尝试解析简单格式
          const simpleInput = inputMatch[1].trim();
          if (simpleInput) {
            parameters = { input: simpleInput };
          }
        }
      }

      return { thought, action: { tool, parameters } };
    }

    return { thought, action: null };
  }

  /**
   * 提取最终答案
   */
  private extractAnswer(response: string): string {
    const match = response.match(/Final Answer:\s*([\s\S]*?)$/i);
    return match ? match[1].trim() : response;
  }
}

/**
 * 创建 ReAct 执行器
 */
export function createReActExecutor(): ReActExecutor {
  return new ReActExecutor();
}
