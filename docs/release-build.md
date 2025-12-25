# 发布版本构建指南

## 概述

本项目支持代码混淆以保护源代码在VSCode扩展目录中不被直接查看。

## 构建步骤

### 1. 开发版本构建
```bash
npm run compile
```

### 2. 混淆版本构建
```bash
npm run build:release
```

这个命令会：
- 编译TypeScript代码到`dist/`目录
- 混淆JavaScript代码到`dist-obfuscated/`目录
- 创建发布版本的package.json
- 复制所有必要文件到`release/`目录

### 3. 打包扩展
```bash
npm run package:release
```

或者手动：
```bash
cd release
vsce package
```

## 文件结构

- `scripts/obfuscate.js` - 代码混淆脚本
- `scripts/build-release.js` - 完整构建流程
- `scripts/create-obfuscated-package.js` - 创建发布版package.json
- `release/` - 发布版本目录
- `dist-obfuscated/` - 混淆后的代码

## 注意事项

- JSX文件会被跳过混淆，直接复制
- 混淆配置在`scripts/obfuscate.js`中可调整
- 发布版本会移除所有开发依赖