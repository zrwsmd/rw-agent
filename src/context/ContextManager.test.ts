// 智能上下文管理功能测试

import { describe, test, expect, beforeEach } from 'vitest';
import { ContextManagerImpl } from './ContextManager';

describe('智能上下文管理', () => {
  let contextManager: ContextManagerImpl;

  beforeEach(() => {
    contextManager = new ContextManagerImpl();
    contextManager.setModel('gpt-4o');
  });

  test('应该正确分离需要总结和保留的消息', () => {
    // 添加10条消息
    for (let i = 0; i < 10; i++) {
      contextManager.addMessage({
        id: `msg_${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `消息 ${i}`,
        timestamp: Date.now() + i
      });
    }

    const { toSummarize, toKeep } = contextManager.getMessagesForSummarization(5);
    
    expect(toSummarize.length).toBe(5);
    expect(toKeep.length).toBe(5);
  });

  test('应用总结后消息数量应该减少', () => {
    // 添加10条消息
    for (let i = 0; i < 10; i++) {
      contextManager.addMessage({
        id: `msg_${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `消息 ${i}`,
        timestamp: Date.now() + i
      });
    }

    const originalCount = contextManager.getMessageCount();
    contextManager.applySummarization('这是总结内容', 5);
    const newCount = contextManager.getMessageCount();

    expect(originalCount).toBe(10);
    expect(newCount).toBe(6); // 1条总结 + 5条保留消息
  });
});