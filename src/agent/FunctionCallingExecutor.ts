// src/agent/FunctionCallingExecutor.ts

import { AgentEvent } from '../types/agent';
import { LLMAdapter, LLMMessage, ToolCall } from '../types/llm';
import { ToolRegistry, ToolResult } from '../types/tool';

const MAX_ITERATIONS = 20;

/**
 * 函数调用执行器（使用原生工具调用）
 */
export class FunctionCallingExecutor {
  private cancelled = false;

  /**
   * 执行函数调用循环
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
    const messages: LLMMessage[] = [...context];

    // 添加初始用户消息（如果需要）
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      let userContent = goal;
      if (skillsPrompt) {
        userContent = `${goal}\n\n${skillsPrompt}`;
      }
      messages.push({ role: 'user', content: userContent });
    }

    // 获取工具定义
    const toolDefinitions = toolRegistry.getToolDefinitions();

    while (iteration < MAX_ITERATIONS && !this.cancelled) {
      iteration++;

      console.log(`[FunctionCalling] 迭代 ${iteration}/${MAX_ITERATIONS}`);

      // 调用 LLM（支持工具调用）
      const response = await llm.completeWithTools(messages, {
        tools: toolDefinitions,
        toolChoice: 'auto',
        temperature: 0.7,
      });

      console.log('[FunctionCalling] LLM 响应:', {
        content: response.content?.substring(0, 100),
        toolCalls: response.toolCalls?.length,
        finishReason: response.finishReason,
      });

      // 如果有内容，发送 token 事件
      if (response.content) {
        for (const char of response.content) {
          yield { type: 'token', content: char };
        }
      }

      // 如果没有工具调用，说明任务完成
      if (!response.toolCalls || response.toolCalls.length === 0) {
        yield { type: 'answer', content: response.content || '任务完成' };
        
        // 添加助手响应到消息历史
        messages.push({
          role: 'assistant',
          content: response.content || '',
        });
        
        return;
      }

      // 添加助手响应（包含工具调用）到消息历史
      messages.push({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
      });

      // 执行所有工具调用
      for (const toolCall of response.toolCalls) {
        if (this.cancelled) {
          yield { type: 'error', message: '操作已取消' };
          return;
        }

        const toolName = toolCall.function.name;
        let params: Record<string, unknown>;

        try {
          params = JSON.parse(toolCall.function.arguments);
        } catch (error) {
          console.error('[FunctionCalling] 解析工具参数失败:', error);
          params = {};
        }

        console.log('[FunctionCalling] 执行工具:', toolName, params);

        // 发出行动事件（用于 UI 显示 - 可选）
        yield { type: 'action', tool: toolName, params };

        // 执行工具
        const tool = toolRegistry.get(toolName);
        let result: ToolResult;

        if (!tool) {
          result = {
            success: false,
            output: '',
            error: `工具 "${toolName}" 不存在`,
          };
        } else {
          try {
            result = await tool.execute(params);
          } catch (error) {
            result = {
              success: false,
              output: '',
              error: error instanceof Error ? error.message : '执行工具时发生错误',
            };
          }
        }

        console.log('[FunctionCalling] 工具结果:', {
          success: result.success,
          outputLength: result.output?.length,
          error: result.error,
        });

        // 发出观察事件（用于 UI 显示 - 可选）
        yield { type: 'observation', result };

        // 构造工具响应消息
        const toolResponse = result.success
          ? result.output
          : `错误: ${result.error || result.output || '未知错误'}`;

        // 添加工具响应到消息历史
        messages.push({
          role: 'assistant', // OpenAI 使用 'tool' 角色，这里统一处理
          content: toolResponse,
          toolCallId: toolCall.id,
        });
      }
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
}

/**
 * 创建函数调用执行器
 */
export function createFunctionCallingExecutor(): FunctionCallingExecutor {
  return new FunctionCallingExecutor();
}