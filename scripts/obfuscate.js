const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// 混淆配置
const obfuscationOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false,
  debugProtectionInterval: 0,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  renameGlobals: false,
  rotateStringArray: true,
  selfDefending: true,
  shuffleStringArray: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.8,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
};

// 递归混淆目录中的所有JS文件
function obfuscateDirectory(sourceDir, targetDir) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const files = fs.readdirSync(sourceDir);
  
  files.forEach(file => {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    
    if (fs.statSync(sourcePath).isDirectory()) {
      // 递归处理子目录
      obfuscateDirectory(sourcePath, targetPath);
    } else if (file.endsWith('.js')) {
      // 检查是否包含JSX语法，如果包含则跳过混淆
      const sourceCode = fs.readFileSync(sourcePath, 'utf8');
      
      // 简单检测JSX语法
      const hasJSX = /<[A-Za-z][^>]*>/.test(sourceCode) || /jsx/.test(sourceCode.toLowerCase());
      
      if (hasJSX) {
        console.log(`跳过JSX文件: ${sourcePath}`);
        fs.copyFileSync(sourcePath, targetPath);
      } else {
        // 混淆JS文件
        console.log(`混淆文件: ${sourcePath}`);
        try {
          const obfuscatedCode = JavaScriptObfuscator.obfuscate(sourceCode, obfuscationOptions);
          fs.writeFileSync(targetPath, obfuscatedCode.getObfuscatedCode());
        } catch (error) {
          console.log(`混淆失败，复制原文件: ${sourcePath} - ${error.message}`);
          fs.copyFileSync(sourcePath, targetPath);
        }
      }
    } else {
      // 复制其他文件
      fs.copyFileSync(sourcePath, targetPath);
    }
  });
}

// 开始混淆
console.log('开始混淆代码...');
obfuscateDirectory('./dist', './dist-obfuscated');
console.log('代码混淆完成！');