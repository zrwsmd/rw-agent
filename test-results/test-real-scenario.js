const { AgentEngineImpl } = require('../dist/agent/AgentEngine');
const { ContextManagerImpl } = require('../dist/context/ContextManager');
const { ToolRegistryImpl } = require('../dist/tools/ToolRegistry');

// 模拟 LLM 适配器
class MockLLMAdapter {
  supportsNativeTools() { return true; }
  
  async *streamComplete(messages) {
    // 模拟简单响应，避免实际调用 LLM
    yield '我是代码审查专家，请提供您需要审查的代码。';
  }
}

// 测试真实场景
async function testRealScenario() {
  console.log('🧪 测试真实场景...');
  
  const contextManager = new ContextManagerImpl();
  const toolRegistry = new ToolRegistryImpl();
  const llmAdapter = new MockLLMAdapter();
  const workspaceRoot = process.cwd();
  
  const agentEngine = new AgentEngineImpl(contextManager, toolRegistry, llmAdapter, workspaceRoot);
  
  console.log('\n=== 第一次请求：jpg 转换（将被取消）===');
  
  // 模拟第一次请求
  const events1 = [];
  const generator1 = agentEngine.processMessage('将当前项目下的2.jpg转为png', 'react');
  
  // 处理几个事件后取消
  for await (const event of generator1) {
    events1.push(event);
    console.log('事件1:', event.type);
    
    if (events1.length >= 3) {
      console.log('取消第一次请求...');
      agentEngine.cancel();
      break;
    }
  }
  
  console.log('\n=== 第二次请求：代码审查 ===');
  
  // 模拟第二次请求
  const events2 = [];
  for await (const event of agentEngine.processMessage('review my code', 'react')) {
    events2.push(event);
    console.log('事件2:', event.type, event.type === 'token' ? event.content.substring(0, 20) + '...' : '');
    
    // 处理完整响应
    if (event.type === 'answer') {
      break;
    }
  }
  
  console.log('\n=== 结果分析 ===');
  console.log('第一次请求事件数:', events1.length);
  console.log('第二次请求事件数:', events2.length);
  
  // 检查第二次请求是否正确识别了 skill
  const hasSkillEvent = events2.some(e => e.type === 'skill');
  console.log('第二次请求是否识别了 skill:', hasSkillEvent);
  
  if (hasSkillEvent) {
    const skillEvent = events2.find(e => e.type === 'skill');
    console.log('识别的 skill:', skillEvent.name);
  }
}

testRealScenario().catch(console.error);