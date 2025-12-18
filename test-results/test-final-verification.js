const { AgentEngineImpl } = require('../dist/agent/AgentEngine');
const { ContextManagerImpl } = require('../dist/context/ContextManager');
const { ToolRegistryImpl } = require('../dist/tools/ToolRegistry');

// 模拟 LLM 适配器
class MockLLMAdapter {
  supportsNativeTools() { return true; }
  
  async *streamComplete(messages) {
    // 检查是否有 skills 提示
    const systemMessage = messages.find(m => m.role === 'system');
    if (systemMessage && systemMessage.content.includes('审查专家')) {
      yield '我是代码审查专家，已准备好审查您的代码。请提供需要审查的代码文件或代码片段。';
    } else {
      yield '普通聊天响应';
    }
  }
}

// 最终验证测试
async function testFinalVerification() {
  console.log('🧪 最终验证测试...');
  
  const contextManager = new ContextManagerImpl();
  const toolRegistry = new ToolRegistryImpl();
  const llmAdapter = new MockLLMAdapter();
  const workspaceRoot = process.cwd();
  
  const agentEngine = new AgentEngineImpl(contextManager, toolRegistry, llmAdapter, workspaceRoot);
  
  console.log('\n=== 测试场景：取消 jpg 转换后进行代码审查 ===');
  
  // 第一步：模拟 jpg 转换请求（立即取消）
  console.log('\n1. 发送 jpg 转换请求...');
  const generator1 = agentEngine.processMessage('将当前项目下的2.jpg转为png', 'react');
  
  let firstEventType = null;
  for await (const event of generator1) {
    firstEventType = event.type;
    console.log('第一次请求事件:', event.type);
    
    // 立即取消
    agentEngine.cancel();
    break;
  }
  
  // 第二步：发送代码审查请求
  console.log('\n2. 发送代码审查请求...');
  const events = [];
  let hasSkillEvent = false;
  let hasCorrectResponse = false;
  
  for await (const event of agentEngine.processMessage('review my code', 'react')) {
    events.push(event);
    console.log('第二次请求事件:', event.type);
    
    if (event.type === 'skill' && event.name === 'code-review') {
      hasSkillEvent = true;
      console.log('✅ 正确识别了 code-review skill');
    }
    
    if (event.type === 'token' && event.content.includes('审查专家')) {
      hasCorrectResponse = true;
      console.log('✅ LLM 正确扮演了审查专家角色');
    }
    
    if (event.type === 'answer') {
      break;
    }
    
    // 避免无限循环
    if (events.length > 20) break;
  }
  
  // 第三步：验证结果
  console.log('\n=== 验证结果 ===');
  console.log('第一次请求首个事件类型:', firstEventType);
  console.log('第二次请求事件总数:', events.length);
  console.log('是否识别了 code-review skill:', hasSkillEvent);
  console.log('是否正确扮演审查专家角色:', hasCorrectResponse);
  
  // 检查上下文是否正确清理
  const history = contextManager.getHistory();
  console.log('最终上下文消息数:', history.length);
  console.log('最后一条用户消息:', history.filter(m => m.role === 'user').pop()?.content);
  
  if (hasSkillEvent && hasCorrectResponse && history.filter(m => m.role === 'user').pop()?.content === 'review my code') {
    console.log('\n🎉 所有测试通过！修复成功！');
  } else {
    console.log('\n❌ 测试未完全通过，需要进一步检查');
  }
}

testFinalVerification().catch(console.error);