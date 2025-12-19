import { ToolResult } from './tool';
import { Plan } from './plan';

/**
 * Agent 模式
 */
export type AgentMode = 'react' | 'plan';

/**
 * Agent 状态
 */
export type AgentState =
  | { status: 'idle' }
  | { status: 'thinking'; thought: string }
  | { status: 'acting'; tool: string; params: unknown }
  | { status: 'planning'; plan: Plan }
  | { status: 'executing'; step: number; total: number };

/**
 * Agent 事件
 */
export type AgentEvent =
  | { type: 'thought'; content: string }
  | { type: 'action'; tool: string; params: unknown }
  | { type: 'observation'; result: ToolResult }
  | { type: 'plan'; plan: Plan }
  | { type: 'step_complete'; step: number; result: string }
  | { type: 'answer'; content: string }
  | { type: 'error'; message: string }
  | { type: 'token'; content: string }
  | { type: 'skill'; name: string; description?: string }
  | {
      type: 'token_usage';
      current: number;
      limit: number;
      remaining: number;
      percentage: number;
    };

/**
 * Agent 引擎接口
 */
export interface AgentEngine {
  processMessage(
    message: string, 
    mode: AgentMode,
    images?: Array<{ mimeType: string; data: string }>
  ): AsyncIterable<AgentEvent>;
  cancel(): void;
  getState(): AgentState;
}
