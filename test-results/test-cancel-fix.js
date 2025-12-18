const { ContextManagerImpl } = require('./dist/context/ContextManager');

// 测试取消操作后的上下文清理
function testCancelFix() {
  console.log('🧪 测试取消操作后的上下文清理...');
  
  const contextManager = new ContextManagerImpl();
  
  // 模拟第一次用户消息（将被取消）
  console.log('\n1. 添加第一条用户消息（将被取消）');
  contextManager.addMessage({
    id: 'msg1',
    role: 'user',
    content: '将2.jpg转换为png格式',
    timestamp: Date.now()
  });
  
  console.log('消息历史:', contextManager.getHistory().map(m => ({ role: m.role, content: m.content })));
  
  // 模拟取消操作 - 移除最后一条用户消息
  console.log('\n2. 模拟取消操作 - 移除最后一条消息');
  const removedMessage = contextManager.removeLastMessage();
  console.log('移除的消息:', removedMessage ? { role: removedMessage.role, content: removedMessage.content } : null);
  console.log('取消后消息历史:', contextManager.getHistory().map(m => ({ role: m.role, content: m.content })));
  
  // 添加第二条用户消息
  console.log('\n3. 添加第二条用户消息');
  contextManager.addMessage({
    id: 'msg2',
    role: 'user',
    content: 'review my code',
    timestamp: Date.now()
  });
  
  console.log('最终消息历史:', contextManager.getHistory().map(m => ({ role: m.role, content: m.content })));
  
  // 验证结果
  const history = contextManager.getHistory();
  if (history.length === 1 && history[0].content === 'review my code') {
    console.log('\n✅ 测试通过！取消操作正确清理了上下文');
  } else {
    console.log('\n❌ 测试失败！上下文清理不正确');
  }
}

testCancelFix();