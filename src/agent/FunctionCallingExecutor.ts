// src/agent/FunctionCallingExecutor.ts

import { AgentEvent } from '../types/agent';
import { LLMAdapter, LLMMessage } from '../types/llm';
import { ToolRegistry, ToolResult } from '../types/tool';

const MAX_ITERATIONS = 20;
const MAX_TOOL_RETRIES = 3;
const MAX_LLM_RETRIES = 2;

/**
 * 函数调用执行器（使用原生工具调用）
 */
export class FunctionCallingExecutor {
  private cancelled = false;

  /**
   * 带重试的 LLM 调用
   */
  private async callLLMWithRetry(
    llm: LLMAdapter,
    messages: LLMMessage[],
    toolDefinitions: any[],
    retryCount = 0
  ): Promise<any> {
    try {
      return await llm.completeWithTools(messages, {
        tools: toolDefinitions,
        toolChoice: 'auto',
        temperature: 0.7,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error(`[FunctionCalling] LLM 调用失败 (尝试 ${retryCount + 1}/${MAX_LLM_RETRIES + 1}):`, errorMessage);
      
      if (retryCount < MAX_LLM_RETRIES) {
        // 等待一段时间后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return this.callLLMWithRetry(llm, messages, toolDefinitions, retryCount + 1);
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
      console.error(`[FunctionCalling] 工具 "${toolName}" 执行失败 (尝试 ${retryCount + 1}/${MAX_TOOL_RETRIES + 1}):`, errorMessage);
      
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
   * 生成错误恢复建议
   */
  private generateErrorRecoveryAdvice(error: string, toolName: string): string {
    const advice = [];
    
    if (error.includes('参数') || error.includes('parameter')) {
      advice.push('请检查工具参数是否正确');
    }
    
    if (error.includes('权限') || error.includes('permission')) {
      advice.push('请检查是否有足够的权限执行此操作');
    }
    
    if (error.includes('文件') || error.includes('file')) {
      advice.push('请检查文件路径是否存在且可访问');
    }
    
    if (error.includes('网络') || error.includes('network')) {
      advice.push('请检查网络连接是否正常');
    }
    
    if (advice.length === 0) {
      advice.push('请尝试使用其他方法或工具完成任务');
    }
    
    return `工具 "${toolName}" 执行失败: ${error}\n\n建议: ${advice.join('，')}`;
  }

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

    // 获取当前日期
    const today = new Date();
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    
    // 构建系统消息（包含当前日期和 Skills 提示）
    let systemContent = `你是一个智能助手，可以帮助用户完成各种任务。请用中文回答。\n\n当前日期：${dateStr}`;
    
    // ✅ 将 skillsPrompt 添加到系统消息中，而不是用户消息
    if (skillsPrompt) {
      systemContent += `\n\n${skillsPrompt}`;
      console.log('[FunctionCalling] Skills 提示已添加到系统消息');
    }
    
    messages.unshift({
      role: 'system',
      content: systemContent,
    });

    // 添加初始用户消息（如果需要）
    if (context.length === 0 || context[context.length - 1].role !== 'user') {
      messages.push({ role: 'user', content: goal });
    }

    // 获取工具定义
    const toolDefinitions = toolRegistry.getToolDefinitions();
    
    // ✅ 调试：打印工具定义
    console.log('[FunctionCalling] 工具定义数量:', toolDefinitions.length);
    console.log('[FunctionCalling] 工具列表:', toolDefinitions.map(t => t.function.name).join(', '));

    while (iteration < MAX_ITERATIONS && !this.cancelled) {
      iteration++;

      console.log(`[FunctionCalling] 迭代 ${iteration}/${MAX_ITERATIONS}`);

      // 调用 LLM（支持工具调用，带重试）
      let response;
      try {
        response = await this.callLLMWithRetry(llm, messages, toolDefinitions);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        yield { type: 'error', message: `LLM 调用失败: ${errorMessage}` };
        return;
      }

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
            error: `工具 "${toolName}" 不存在。可用工具: ${toolRegistry.list().map(t => t.name).join(', ')}`,
          };
        } else {
          result = await this.executeToolWithRetry(tool, params, toolName);
        }

        console.log('[FunctionCalling] 工具结果:', {
          success: result.success,
          outputLength: result.output?.length,
          error: result.error,
        });

        // 发出观察事件（用于 UI 显示 - 可选）
        yield { type: 'observation', result };

        // 构造工具响应消息
        let toolResponse: string;
        if (result.success) {
          toolResponse = result.output;
        } else {
          const errorAdvice = this.generateErrorRecoveryAdvice(
            result.error || '未知错误', 
            toolName
          );
          toolResponse = errorAdvice;
          
          // 对于严重错误，发送错误事件
          if (result.error && !this.isRetryableError(new Error(result.error))) {
            yield { 
              type: 'error', 
              message: `工具 "${toolName}" 执行失败: ${result.error}` 
            };
          }
        }

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