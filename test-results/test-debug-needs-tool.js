const { AgentEngineImpl } = require('../dist/agent/AgentEngine');
const { ContextManagerImpl } = require('../dist/context/ContextManager');

// 模拟 LLM 适配器
class MockLLMAdapter {
  supportsNativeTools() { return true; }
  
  async *streamComplete(messages) {
    yield '测试响应';
  }
}

// 模拟工具注册表
class MockToolRegistry {}

// 测试 needsToolUsage 的调用
async function testDebugNeedsTool() {
  console.log('🧪 测试 needsToolUsage 调用...');
  
  const contextManager = new ContextManagerImpl();
  const toolRegistry = new MockToolRegistry();
  const llmAdapter = new MockLLMAdapter();
  const workspaceRoot = process.cwd();
  
  const agentEngine = new AgentEngineImpl(contextManager, toolRegistry, llmAdapter, workspaceRoot);
  
  console.log('\n开始处理消息: "review my code"');
  
  // 处理消息并观察日志
  const events = [];
  for await (const event of agentEngine.processMessage('review my code', 'react')) {
    events.push(event);
    console.log('事件:', event.type, event.type === 'token' ? event.content : '');
    
    // 只处理前几个事件，避免无限循环
    if (events.length > 10) break;
  }
  
  console.log('\n处理完成，共', events.length, '个事件');
}

testDebugNeedsTool().catch(console.error);