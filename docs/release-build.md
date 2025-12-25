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

## 日常开发流程

### 代码修改后重新打包

每次修改代码后，只需要运行一个命令就可以重新打包混淆版本：

```bash
npm run package:release
```

这个命令会自动完成以下步骤：
1. 编译TypeScript代码
2. 混淆所有JavaScript文件
3. 创建发布版配置
4. 复制资源文件
5. 安装生产依赖
6. 打包成VSIX文件

### 分步操作

如果只想构建但不打包：
```bash
npm run build:release
```

然后手动进入release目录打包：
```bash
cd release
vsce package
```

### 输出文件

打包完成后，混淆的VSIX文件位于：
- `release/vscode-agent-0.1.0.vsix`

### 混淆效果

混淆后的代码具有以下特征：
- 变量名转换为十六进制标识符
- 字符串数组编码和加密
- 控制流平坦化
- 死代码注入
- 自我防护机制

这样可以有效保护源代码在VSCode扩展目录中不被直接查看。