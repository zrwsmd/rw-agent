# 阿里百炼平台集成指南

## 概述

本项目已集成阿里百炼平台，支持通过百炼API调用各种大语言模型，包括通义千问系列、DeepSeek系列等。

## 支持的模型

### 通义千问系列
- **qwen-max**: 最强推理能力，适合复杂任务
- **qwen-plus**: 平衡性能和成本，适合大多数场景
- **qwen-turbo**: 快速响应，适合简单任务

### 通义千问2.5系列
- qwen2.5-72b-instruct, qwen2.5-32b-instruct, qwen2.5-14b-instruct
- qwen2.5-7b-instruct, qwen2.5-3b-instruct, qwen2.5-1.5b-instruct, qwen2.5-0.5b-instruct

### 专用模型
- **代码模型**: qwen2.5-coder-32b-instruct, qwen2.5-coder-14b-instruct 等
- **数学模型**: qwen2.5-math-72b-instruct, qwen2.5-math-7b-instruct 等

### DeepSeek系列
- deepseek-v3, deepseek-r1, deepseek-chat, deepseek-coder

### 其他开源模型
- Llama3.1系列, Baichuan2系列, ChatGLM3, Yi系列等

## 配置步骤

### 1. 获取API Key
1. 访问 [阿里云百炼平台](https://bailian.console.aliyun.com/)
2. 注册/登录阿里云账号
3. 开通百炼服务
4. 在控制台获取API Key

### 2. 在VSCode中配置
1. 打开VSCode Agent插件
2. 点击设置按钮（⚙️）
3. 选择提供商：**bailian**
4. 输入API Key
5. 选择模型（推荐从qwen-max, qwen-plus, qwen-turbo中选择）
6. 保存设置

### 3. 开始使用
配置完成后，即可开始与AI助手对话。不同模型有不同特点：

- **代码任务**: 选择 qwen2.5-coder 系列
- **数学问题**: 选择 qwen2.5-math 系列  
- **通用对话**: 选择 qwen-max/plus/turbo
- **快速响应**: 选择 qwen-turbo

## API端点

百炼平台使用OpenAI兼容的API格式：
- 端点: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- 认证: Bearer Token (使用您的API Key)

## 注意事项

1. **计费**: 不同模型有不同的计费标准，请查看百炼平台的定价页面
2. **限流**: 注意API调用频率限制
3. **模型选择**: 根据任务复杂度选择合适的模型以平衡性能和成本
4. **安全**: 请妥善保管您的API Key，不要在代码中硬编码

## 故障排除

### 常见问题

1. **API Key无效**
   - 检查API Key是否正确复制
   - 确认百炼服务已开通
   - 检查账户余额

2. **模型不可用**
   - 某些模型可能需要申请权限
   - 检查所选模型是否在您的可用列表中

3. **请求失败**
   - 检查网络连接
   - 确认API调用频率未超限
   - 查看VSCode开发者控制台的错误信息

### 获取帮助

如遇问题，可以：
1. 查看VSCode开发者控制台的详细错误信息
2. 参考阿里云百炼平台官方文档
3. 在项目GitHub页面提交Issue