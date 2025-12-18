const { AgentEngineImpl } = require('../dist/agent/AgentEngine');
const { ContextManagerImpl } = require('../dist/context/ContextManager');
const { SkillsManager } = require('../dist/skills/SkillsManager');

// 模拟 LLM 适配器
class MockLLMAdapter {
  supportsNativeTools() { return true; }
}

// 模拟工具注册表
class MockToolRegistry {}

// 测试 needsToolUsage 方法
function testNeedsToolUsage() {
  console.log('🧪 测试 needsToolUsage 方法...');
  
  const contextManager = new ContextManagerImpl();
  const toolRegistry = new MockToolRegistry();
  const llmAdapter = new MockLLMAdapter();
  const workspaceRoot = process.cwd();
  
  const agentEngine = new AgentEngineImpl(contextManager, toolRegistry, llmAdapter, workspaceRoot);
  
  // 获取 skillsManager 来验证它是否正确初始化
  const skillsManager = agentEngine.getSkillsManager();
  console.log('SkillsManager 是否存在:', !!skillsManager);
  
  if (skillsManager) {
    console.log('可用 skills:', skillsManager.getAllSkills().map(s => s.name));
    
    // 测试匹配
    const testMessage = 'review my code';
    console.log(`\n测试消息: "${testMessage}"`);
    const matchedSkills = skillsManager.matchSkills(testMessage);
    console.log('匹配的 skills:', matchedSkills.map(s => s.name));
  }
  
  // 由于 needsToolUsage 是私有方法，我们无法直接测试
  // 但我们可以通过观察 processMessage 的行为来推断
  console.log('\n注意：needsToolUsage 是私有方法，无法直接测试');
  console.log('需要通过 processMessage 的日志来观察行为');
}

testNeedsToolUsage();