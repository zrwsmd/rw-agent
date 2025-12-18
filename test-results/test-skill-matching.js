const { SkillsManager } = require('../dist/skills/SkillsManager');
const path = require('path');

// 测试 skill 匹配逻辑
function testSkillMatching() {
  console.log('🧪 测试 Skill 匹配逻辑...');
  
  const workspaceRoot = process.cwd();
  console.log('工作区根目录:', workspaceRoot);
  
  const skillsManager = new SkillsManager(workspaceRoot);
  
  // 测试消息
  const testMessages = [
    '将当前项目下的2.jpg转为png',
    'review my code',
    'code review',
    '审查代码'
  ];
  
  for (const message of testMessages) {
    console.log(`\n测试消息: "${message}"`);
    const matchedSkills = skillsManager.matchSkills(message);
    console.log('匹配结果:', matchedSkills.map(s => s.name));
    
    if (matchedSkills.length > 0) {
      console.log('Skills 详情:');
      for (const skill of matchedSkills) {
        console.log(`  - ${skill.name}: 关键词=${skill.keywords}, 脚本数量=${skill.scripts.size}`);
      }
    }
  }
}

testSkillMatching();