const fs = require('fs');
const path = require('path');

// 读取原始package.json
const originalPackage = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// 创建混淆版本的package.json
const obfuscatedPackage = {
  ...originalPackage,
  main: "./dist/extension.js", // 发布版本中混淆代码在dist目录
  scripts: {
    // 移除开发相关的脚本
    "vscode:prepublish": "echo 'Pre-compiled extension'"
  }
};

// 移除开发依赖
delete obfuscatedPackage.devDependencies;

// 写入混淆版本的package.json
fs.writeFileSync('package-obfuscated.json', JSON.stringify(obfuscatedPackage, null, 2));

console.log('已创建混淆版本的package.json');