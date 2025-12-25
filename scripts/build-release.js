const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Windows兼容的文件复制函数
function copyFileOrDir(source, target) {
  if (fs.statSync(source).isDirectory()) {
    // 复制目录
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
    const files = fs.readdirSync(source);
    files.forEach(file => {
      copyFileOrDir(path.join(source, file), path.join(target, file));
    });
  } else {
    // 复制文件
    const targetDir = path.dirname(target);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.copyFileSync(source, target);
  }
}

console.log('开始构建发布版本...');

try {
  // 1. 编译TypeScript
  console.log('1. 编译TypeScript代码...');
  execSync('npm run compile', { stdio: 'inherit' });

  // 2. 混淆代码
  console.log('2. 混淆JavaScript代码...');
  execSync('node scripts/obfuscate.js', { stdio: 'inherit' });

  // 3. 创建混淆版本的package.json
  console.log('3. 创建发布版本配置...');
  execSync('node scripts/create-obfuscated-package.js', { stdio: 'inherit' });

  // 4. 复制必要文件到发布目录
  console.log('4. 复制资源文件...');
  const releaseDir = './release';
  if (fs.existsSync(releaseDir)) {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  }
  fs.mkdirSync(releaseDir, { recursive: true });

  // 复制文件
  const filesToCopy = [
    { src: 'package-obfuscated.json', dest: 'package.json' },
    { src: 'README.md', dest: 'README.md' },
    { src: 'resources', dest: 'resources' }
  ];

  filesToCopy.forEach(({ src, dest }) => {
    if (fs.existsSync(src)) {
      const targetPath = path.join(releaseDir, dest);
      copyFileOrDir(src, targetPath);
      console.log(`已复制: ${src} -> ${targetPath}`);
    }
  });

  // 复制混淆后的代码
  copyFileOrDir('dist-obfuscated', path.join(releaseDir, 'dist'));
  console.log('已复制混淆代码到发布目录');

  // 安装生产依赖
  console.log('5. 安装生产依赖...');
  process.chdir(releaseDir);
  execSync('npm install --production', { stdio: 'inherit' });
  process.chdir('..');

  console.log('6. 构建完成！');
  console.log('发布文件位于 ./release 目录');
  console.log('');
  console.log('下一步：');
  console.log('cd release && vsce package');

} catch (error) {
  console.error('构建失败:', error.message);
  process.exit(1);
}