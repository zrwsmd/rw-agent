import { AgentEvent } from '../types/agent';
import { LLMAdapter, LLMMessage } from '../types/llm';
import { ToolRegistry, ToolResult } from '../types/tool';

const MAX_ITERATIONS = 20;
const MAX_TOOL_RETRIES = 3;
const MAX_LLM_RETRIES = 2;

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
   * Linux 命令到 Windows 命令的映射
   */
  private static readonly LINUX_TO_WINDOWS: Record<string, string | ((args: string) => string)> = {
    'ls': (args) => args ? `dir ${args}` : 'dir',
    'cat': (args) => `type ${args}`,
    'rm': (args) => args.includes('-r') ? `rmdir /s /q ${args.replace(/-r[f]?\s*/g, '')}` : `del ${args.replace(/-f\s*/g, '')}`,
    'cp': (args) => `copy ${args.replace(/-r\s*/g, '')}`,
    'mv': (args) => `move ${args}`,
    'mkdir': (args) => `mkdir ${args.replace(/-p\s*/g, '')}`,
    'pwd': () => 'cd',
    'clear': () => 'cls',
    'touch': (args) => `type nul > ${args}`,
    'grep': (args) => `findstr ${args}`,
    'which': (args) => `where ${args}`,
  };

  /**
   * 将 Linux 命令转换为 Windows 命令
   */
  private convertLinuxToWindows(command: string): string {
    const trimmed = command.trim();
    const spaceIndex = trimmed.indexOf(' ');
    const cmdName = spaceIndex > 0 ? trimmed.substring(0, spaceIndex) : trimmed;
    const args = spaceIndex > 0 ? trimmed.substring(spaceIndex + 1).trim() : '';
    
    const converter = ReActExecutor.LINUX_TO_WINDOWS[cmdName];
    if (converter) {
      if (typeof converter === 'function') {
        return converter(args);
      }
      return args ? `${converter} ${args}` : converter;
    }
    
    return command;
  }

  /**
   * 带重试的 LLM 调用
   */
  private async callLLMWithRetry(
    llm: LLMAdapter,
    messages: LLMMessage[],
    retryCount = 0
  ): Promise<string> {
    try {
      let response = '';
      for await (const token of llm.streamComplete(messages)) {
        if (this.cancelled) {
          throw new Error('操作已取消');
        }
        response += token;
      }
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error(`[ReAct] LLM 调用失败 (尝试 ${retryCount + 1}/${MAX_LLM_RETRIES + 1}):`, errorMessage);
      
      if (retryCount < MAX_LLM_RETRIES && !this.cancelled) {
        // 等待一段时间后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return this.callLLMWithRetry(llm, messages, retryCount + 1);
      }
      
      throw new Error(`LLM 调用失败，已重试 ${MAX_LLM_RETRIES} 次: ${errorMessage}`);
    }
  }

  /**
   * 带重试的工具执行
   */
  private async executeToolWithRetry(
    tool: any,
    params: Record<string, unknown>,
    toolName: string,
    retryCount = 0
  ): Promise<ToolResult> {
    try {
      return await tool.execute(params);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error(`[ReAct] 工具 "${toolName}" 执行失败 (尝试 ${retryCount + 1}/${MAX_TOOL_RETRIES + 1}):`, errorMessage);
      
      if (retryCount < MAX_TOOL_RETRIES) {
        // 对于某些错误类型，可以尝试重试
        if (this.isRetryableError(error)) {
          await new Promise(resolve => setTimeout(resolve, 500 * (retryCount + 1)));
          return this.executeToolWithRetry(tool, params, toolName, retryCount + 1);
        }
      }
      
      return {
        success: false,
        output: '',
        error: `工具执行失败，已重试 ${retryCount} 次: ${errorMessage}`,
      };
    }
  }

  /**
   * 判断错误是否可以重试
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    
    const message = error.message.toLowerCase();
    
    // 网络相关错误可以重试
    if (message.includes('network') || 
        message.includes('timeout') || 
        message.includes('connection') ||
        message.includes('econnreset') ||
        message.includes('enotfound')) {
      return true;
    }
    
    // 临时服务器错误可以重试
    if (message.includes('500') || 
        message.includes('502') || 
        message.includes('503') || 
        message.includes('504')) {
      return true;
    }
    
    return false;
  }

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

      // 获取 LLM 响应（带重试）
      let response: string;
      try {
        response = '';
        for await (const token of llm.streamComplete(messages)) {
          if (this.cancelled) {
            yield { type: 'error', message: '操作已取消' };
            return;
          }
          response += token;
          yield { type: 'token', content: token };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        yield { type: 'error', message: `LLM 调用失败: ${errorMessage}` };
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
      let displayParams = step.action.parameters;
      if (step.action.tool === 'shell_command' && process.platform === 'win32' && step.action.parameters.command) {
        const convertedCommand = this.convertLinuxToWindows(step.action.parameters.command as string);
        displayParams = { ...step.action.parameters, command: convertedCommand };
      }
      yield { type: 'action', tool: step.action.tool, params: displayParams };

      // 执行工具
      const tool = toolRegistry.get(step.action.tool);
      let result: ToolResult;

      if (!tool) {
        result = {
          success: false,
          output: '',
          error: `工具 "${step.action.tool}" 不存在。可用工具: ${toolRegistry.list().map(t => t.name).join(', ')}`,
        };
      } else {
        result = await this.executeToolWithRetry(tool, step.action.parameters, step.action.tool);
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

    // 获取当前日期
    const today = new Date();
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

    return `你是一个智能助手，使用 ReAct（推理-行动）模式来完成任务。

当前日期：${dateStr}

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
