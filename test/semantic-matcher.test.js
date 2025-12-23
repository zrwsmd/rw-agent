/**
 * 向量语义匹配测试
 * 运行: node test/semantic-matcher.test.js
 */

const { SemanticMatcher } = require('../dist/skills/SemanticMatcher');

// 模拟 skills 数据
const testSkills = [
  {
    name: 'jpg-to-png',
    description: 'Convert .jpg/.jpeg images to .png (batch). Uses ImageMagick if available.',
    keywords: ['jpg', 'png', 'image', 'convert', '图片转换'],
  },
  {
    name: 'code-review',
    description: 'Review code for bugs, security issues, and best practices.',
    keywords: ['review', 'code', 'bug', 'security', '代码审查'],
  },
  {
    name: 'xlsx',
    description: 'Read and write Excel xlsx files, parse spreadsheet data.',
    keywords: ['excel', 'xlsx', 'spreadsheet', '表格'],
  },
];

// 测试用例
const testCases = [
  // 应该匹配 jpg-to-png
  { input: '将a2.jpg转化为png', expected: 'jpg-to-png' },
  { input: 'convert image.jpg to png format', expected: 'jpg-to-png' },
  { input: '把图片从jpg格式转成png', expected: 'jpg-to-png' },
  
  // 应该匹配 code-review
  { input: '帮我审查这段代码', expected: 'code-review' },
  { input: 'review this code for bugs', expected: 'code-review' },
  
  // 应该匹配 xlsx
  { input: '读取excel文件', expected: 'xlsx' },
  { input: 'parse xlsx spreadsheet', expected: 'xlsx' },
  
  // 不应该匹配
  { input: '今天天气怎么样', expected: null },
  
  // 关键测试：代码中包含 jpg/png 但意图是代码审查
  { 
    input: '帮我审查这段代码：\n```\nconst img = "test.jpg";\n```', 
    expected: 'code-review'
  },
];

async function runTests() {
  console.log('='.repeat(50));
  console.log('向量语义匹配测试');
  console.log('='.repeat(50));
  
  const matcher = new SemanticMatcher();
  matcher.setThreshold(0.18);
  
  console.log('\n初始化中...\n');
  
  let passed = 0, failed = 0;
  
  for (const tc of testCases) {
    const result = await matcher.match(tc.input, testSkills);
    const matched = result.skill?.name || null;
    const ok = matched === tc.expected;
    
    ok ? passed++ : failed++;
    console.log(`${ok ? '✅' : '❌'} "${tc.input.slice(0, 30)}..." → ${matched || '(无)'} (期望: ${tc.expected || '(无)'})`);
  }
  
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
}

runTests().catch(console.error);
