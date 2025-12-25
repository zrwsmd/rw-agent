import * as vscode from 'vscode';
import { ChatPanelProvider, UIMessage } from './vscode/ChatPanelProvider';
import { createAgentEngine, AgentEngineImpl } from './agent';
import { createContextManager } from './context';
import { createDefaultTools } from './tools';
import { createLLMAdapter } from './llm';
import { createSkillsManager } from './skills';
import { AgentMode } from './types/agent';
import { LLMConfig } from './types/llm';
import { ConversationStorage, createConversationStorage } from './storage';
import { Conversation } from './types/conversation';
import { MCPIntegration, createMCPIntegration } from './mcp';
import { setMCPConfirmCallback } from './tools/MCPTool';
import { createPromptTemplateManager, PromptTemplateManager } from './templates';
import { createQuickCommandManager, QuickCommandManager, CommandContext } from './commands';

let agentEngine: AgentEngineImpl | null = null;
let currentMode: AgentMode = 'react';
let chatPanelProvider: ChatPanelProvider | null = null;
let conversationStorage: ConversationStorage | null = null;
let currentConversation: Conversation | null = null;
let mcpIntegration: MCPIntegration | null = null;
let extensionContext: vscode.ExtensionContext | null = null;
let isProcessing = false; // ✅ 跟踪当前是否正在处理消息
let promptTemplateManager: PromptTemplateManager | null = null;
let quickCommandManager: QuickCommandManager | null = null;

/**
 * Linux 命令到 Windows 命令的映射
 */
const LINUX_TO_WINDOWS: Record<string, string | ((args: string) => string)> = {
  'ls': (args) => args ? `dir ${args}` : 'dir',
  'cat': (args) => `type ${args}`,
  'rm': (args) => args.includes('-r') ? `rmdir /s /q ${args.replace(/-r[f]?\s*/g, '')}` : `del ${args.replace(/-f\s*/g, '')}`,
  'cp': (args) => `copy ${args.replace(/-r\s*/g, '')}`,
  'mv': (args) => `move ${args}`,
  'mkdir': (args) => `mkdir ${args.replace(/-p\s*/g, '')}`,
  'pwd': () => 'cd',
  'clear': () => 'cls',
  'touch': (args) => `type nul > ${args}`,
  'grep': (args) => `findstr ${args}`,
  'which': (args) => `where ${args}`,
};

/**
 * 将 Linux 命令转换为 Windows 命令
 */
function convertLinuxToWindowsCommand(command: string): string {
  const trimmed = command.trim();
  const spaceIndex = trimmed.indexOf(' ');
  const cmdName = spaceIndex > 0 ? trimmed.substring(0, spaceIndex) : trimmed;
  const args = spaceIndex > 0 ? trimmed.substring(spaceIndex + 1).trim() : '';

  const converter = LINUX_TO_WINDOWS[cmdName];
  if (converter) {
    if (typeof converter === 'function') {
      return converter(args);
    }
    return args ? `${converter} ${args}` : converter;
  }

  return command;
}

// 确认请求管理
interface ConfirmRequest {
  resolve: (value: string) => void;
  reject: (reason?: any) => void;
  timeout: NodeJS.Timeout;
}
const pendingConfirms = new Map<string, ConfirmRequest>();

/**
 * 处理用户的确认响应
 */
function handleConfirmResponse(requestId: string, selectedOption: string): void {
  const request = pendingConfirms.get(requestId);
  if (!request) {
    console.warn('[Extension] 未找到确认请求:', requestId);
    return;
  }

  pendingConfirms.delete(requestId);
  clearTimeout(request.timeout);
  request.resolve(selectedOption);
}

/**
 * 请求用户确认
 */
function requestConfirmation(
  requestId: string,
  title: string,
  description: string,
  details: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingConfirms.delete(requestId);
      reject(new Error('确认请求超时'));
    }, 60000); // 60秒超时

    pendingConfirms.set(requestId, { resolve, reject, timeout });

    // 发送确认请求到 webview
    chatPanelProvider?.postMessage({
      type: 'confirm_action',
      requestId,
      title,
      description,
      details,
      options: [
        { id: 'confirm', label: '1 Yes', primary: true },
        { id: 'confirm_no_ask', label: '2 Yes, and don\'t ask again' },
        { id: 'cancel', label: '3 No' },
      ],
    });
  });
}

/**
 * 显示文件写入的 diff 预览并请求确认（通过 webview）
 */
async function showDiffAndConfirm(
  filePath: string,
  newContent: string,
  workspaceRoot: string
): Promise<boolean> {
  const fs = require('fs');
  const path = require('path');
  const absolutePath = path.join(workspaceRoot, filePath);

  let originalContent = '';
  let isNewFile = false;

  try {
    originalContent = fs.readFileSync(absolutePath, 'utf-8');
  } catch {
    isNewFile = true;
  }

  // 生成简单的 diff
  const diff = generateSimpleDiff(originalContent, newContent, isNewFile);

  // 计算添加和删除的行数
  let additions = 0;
  let deletions = 0;
  diff.split('\n').forEach(line => {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  });

  const requestId = `diff_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return new Promise<boolean>((resolve) => {
    pendingDiffRequests.set(requestId, resolve);

    // 发送 diff 预览到 webview
    chatPanelProvider?.postMessage({
      type: 'diff_preview',
      requestId,
      filePath,
      diff,
      isNewFile,
      additions,
      deletions,
    });

    // 60秒超时
    setTimeout(() => {
      if (pendingDiffRequests.has(requestId)) {
        pendingDiffRequests.delete(requestId);
        resolve(false);
      }
    }, 60000);
  });
}

/**
 * 生成 unified diff 格式（使用 diff 库）
 */
function generateSimpleDiff(original: string, modified: string, isNewFile: boolean): string {
  const Diff = require('diff');

  if (isNewFile) {
    // 新文件，所有行都是添加
    const lines = modified.split('\n');
    let diff = '@@ -0,0 +1,' + lines.length + ' @@\n';
    diff += lines.map(l => '+' + l).join('\n');
    return diff;
  }

  // 使用 diff 库生成 unified diff
  const patch = Diff.createPatch('file', original, modified, '', '');

  // 提取 diff 内容（跳过头部）
  const lines = patch.split('\n');
  const diffLines: string[] = [];
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      diffLines.push(line);
    } else if (inHunk) {
      // 跳过 "\ No newline at end of file" 这种行
      if (!line.startsWith('\\')) {
        diffLines.push(line);
      }
    }
  }

  return diffLines.join('\n');
}

// Diff 请求管理
const pendingDiffRequests = new Map<string, (confirmed: boolean) => void>();

/**
 * 处理 diff 响应
 */
function handleDiffResponse(requestId: string, confirmed: boolean): void {
  const resolve = pendingDiffRequests.get(requestId);
  if (resolve) {
    pendingDiffRequests.delete(requestId);
    resolve(confirmed);
  }
}

/**
 * 为写入和执行工具添加确认机制
 */
function wrapToolsWithConfirmation(toolRegistry: any, workspaceRoot: string): void {
  const toolsNeedingConfirmation = ['shell_command', 'skill_script'];

  // 单独处理 write_file - 使用 diff 预览
  const writeFileTool = toolRegistry.get('write_file');
  if (writeFileTool) {
    const originalExecute = writeFileTool.execute.bind(writeFileTool);

    writeFileTool.execute = async function (params: Record<string, unknown>) {
      const filePath = params.path as string;
      const content = params.content as string;

      // 显示 diff 并请求确认
      const confirmed = await showDiffAndConfirm(filePath, content, workspaceRoot);

      if (!confirmed) {
        return {
          success: false,
          output: '用户取消了文件写入操作',
        };
      }

      return originalExecute(params);
    };
  }

  // 其他工具使用 webview 确认
  for (const toolName of toolsNeedingConfirmation) {
    const originalTool = toolRegistry.get(toolName);
    if (!originalTool) continue;

    const originalExecute = originalTool.execute.bind(originalTool);

    originalTool.execute = async function (params: Record<string, unknown>) {
      let title = '';
      let description = '';
      let details = '';

      if (toolName === 'shell_command') {
        // 在 Windows 上转换 Linux 命令
        let displayCommand = params.command as string;
        if (process.platform === 'win32') {
          displayCommand = convertLinuxToWindowsCommand(displayCommand);
          // 同时更新 params 中的命令，这样执行时就不需要再转换
          params.command = displayCommand;
        }

        title = '执行命令';
        description = `Allow execute command?`;
        details = `命令: ${displayCommand}\n工作目录: ${params.cwd || '(默认)'}`;
      } else if (toolName === 'skill_script') {
        title = '执行脚本';
        description = `Allow execute script ${params.skill_name}/${params.script_name}?`;
        const args = params.args as string[] | undefined;
        details = `Skill: ${params.skill_name}\n脚本: ${params.script_name}\n参数: ${args?.join(' ') || '(无)'}`;
      }

      const requestId = `confirm_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      const choice = await requestConfirmation(requestId, title, description, details);

      if (choice !== 'confirm' && choice !== 'confirm_no_ask') {
        return {
          success: false,
          output: '用户取消了操作',
        };
      }

      return originalExecute(params);
    };
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('VSCode Agent 扩展已激活');

  // 存储 context 引用
  extensionContext = context;

  // 获取工作区根目录
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // 创建聊天面板提供者
  chatPanelProvider = new ChatPanelProvider(context.extensionUri);
  conversationStorage = createConversationStorage(context, workspaceRoot);

  // 初始化快捷命令管理器
  quickCommandManager = createQuickCommandManager();
  console.log('[Extension] 快捷命令管理器已初始化');

  // 注册 webview 提供者
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatPanelProvider.viewType,
      chatPanelProvider
    )
  );

  // 处理来自 webview 的消息
  chatPanelProvider.onMessage(async (message: UIMessage) => {
    console.log('[Extension] 收到 webview 消息:', message.type);

    switch (message.type) {
      case 'ready':
        // Webview 准备好了，初始化 Agent 并尝试恢复对话
        console.log('[Extension] Webview 准备好了');
        if (!agentEngine) {
          await initializeAgent(context);
        }
        // 优先从内存中恢复当前会话（处理切换视图的情况）
        await restoreCurrentSession();
        break;

      case 'user_message':
        console.log('[Extension] 收到用户消息:', message.content, '图片数:', message.images?.length || 0);
        await handleUserMessage(message.content, context, message.images);
        break;

      case 'set_mode':
        currentMode = message.mode;
        break;

      case 'clear_chat':
        if (agentEngine) {
          agentEngine.getContextManager().clear();
        }
        currentConversation = null;
        break;

      case 'new_conversation':
        if (agentEngine) {
          agentEngine.getContextManager().clear();
        }
        currentConversation = conversationStorage?.createConversation() || null;
        if (currentConversation && conversationStorage) {
          await conversationStorage.setCurrentConversationId(currentConversation.id);
        }
        break;

      case 'list_conversations':
        if (conversationStorage) {
          const conversations = await conversationStorage.listConversations();
          chatPanelProvider?.postMessage({
            type: 'conversation_list',
            conversations: conversations,
          });
        }
        break;

      case 'load_conversation':
        if (conversationStorage) {
          const conv = await conversationStorage.loadConversation(message.id);
          if (conv) {
            currentConversation = conv;
            await conversationStorage.setCurrentConversationId(conv.id);

            // 恢复到 context manager
            if (agentEngine) {
              agentEngine.getContextManager().clear();
              for (const msg of conv.messages) {
                agentEngine.getContextManager().addMessage(msg);
              }
            }

            // 发送消息到 UI
            chatPanelProvider?.postMessage({
              type: 'conversation_loaded',
              messages: conv.messages.map(m => ({
                role: m.role,
                content: m.content,
                toolCall: m.toolCall,
              })),
            });
          }
        }
        break;

      case 'delete_conversation':
        console.log('[Extension] 收到删除对话请求:', message.id);
        if (conversationStorage) {
          try {
            await conversationStorage.deleteConversation(message.id);
            console.log('[Extension] 对话删除成功:', message.id);
            // 刷新列表
            const conversations = await conversationStorage.listConversations();
            chatPanelProvider?.postMessage({
              type: 'conversation_list',
              conversations: conversations,
            });
            console.log('[Extension] 对话列表已刷新');
          } catch (error) {
            console.error('[Extension] 删除对话失败:', error);
          }
        } else {
          console.error('[Extension] conversationStorage 未初始化');
        }
        break;

      case 'cancel':
        if (agentEngine) {
          agentEngine.cancel();
        }
        // ✅ 重置处理状态
        isProcessing = false;
        break;

      case 'confirm_response':
        handleConfirmResponse(message.requestId, message.selectedOption);
        break;

      case 'diff_response':
        handleDiffResponse(message.requestId, message.confirmed);
        break;

      case 'open_settings':
        vscode.commands.executeCommand('vscode-agent.setApiKey');
        break;

      case 'get_current_settings':
        await handleGetCurrentSettings(context);
        break;

        case 'save_settings':
          await handleSaveSettings(message.provider, message.apiKey, message.model, message.baseUrl, context);
          break;

      case 'mcp_list_servers':
        await handleMCPListServers();
        break;

      case 'mcp_list_marketplace':
        await handleMCPListMarketplace();
        break;

      case 'mcp_search':
        await handleMCPSearch(message.query);
        break;

      case 'mcp_start_server':
        await handleMCPStartServer(message.name);
        break;

      case 'mcp_stop_server':
        await handleMCPStopServer(message.name);
        break;

      case 'mcp_remove_server':
        await handleMCPRemoveServer(message.name);
        break;

      case 'mcp_install_server':
        await handleMCPInstallServer(message.name);
        break;

      case 'mcp_add_server':
        await handleMCPAddServer(message.config);
        break;

      case 'mcp_open_config':
        await handleMCPOpenConfig();
        break;

      case 'save_input_text':
        // 保存输入框文本到 extension state
        context.workspaceState.update('inputText', message.text);
        break;

      case 'get_templates':
        await handleGetTemplates();
        break;

      case 'use_template':
        await handleUseTemplate(message.templateId);
        break;

      case 'quick_command':
        await handleQuickCommand(message.command, message.args, context);
        break;

      case 'get_command_suggestions':
        await handleGetCommandSuggestions(message.query);
        break;
    }
  });

  // 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-agent.newChat', () => {
      if (agentEngine) {
        agentEngine.getContextManager().clear();
      }
      chatPanelProvider?.postMessage({ type: 'clear_chat' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-agent.clearChat', () => {
      if (agentEngine) {
        agentEngine.getContextManager().clear();
      }
      chatPanelProvider?.postMessage({ type: 'clear_chat' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-agent.setApiKey', async () => {
      const provider = await vscode.window.showQuickPick(['gemini', 'openai', 'anthropic'], {
        placeHolder: '选择 LLM 提供商',
      });

      if (!provider) {
        return;
      }

      const apiKey = await vscode.window.showInputBox({
        prompt: `输入 ${provider} API 密钥`,
        password: true,
      });

      if (apiKey) {
        await context.secrets.store(`${provider}-api-key`, apiKey);
        vscode.window.showInformationMessage(`${provider} API 密钥已保存`);

        // 重新初始化 agent
        await initializeAgent(context);
      }
    })
  );

  // 注册右键菜单命令
  const templateCommands = [
    { command: 'vscode-agent.codeReview', templateId: 'code-review' },
    { command: 'vscode-agent.explainCode', templateId: 'explain-code' },
    { command: 'vscode-agent.writeTests', templateId: 'write-tests' },
    { command: 'vscode-agent.refactorCode', templateId: 'refactor' },
    { command: 'vscode-agent.addComments', templateId: 'add-comments' },
    { command: 'vscode-agent.fixBug', templateId: 'fix-bug' },
    { command: 'vscode-agent.optimizeCode', templateId: 'optimize' },
  ];

  for (const { command, templateId } of templateCommands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async () => {
        await executeTemplateCommand(templateId, context);
      })
    );
  }

  // 初始化 agent
  initializeAgent(context);
}

/**
 * 初始化 Agent
 */
async function initializeAgent(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('vscode-agent');
  const provider = config.get<string>('llm.provider') || 'gemini';
  const model = config.get<string>('llm.model') || 'gemini-2.0-flash';
  const baseUrl = config.get<string>('llm.baseUrl') || undefined;

  console.log('[Extension] 初始化 Agent, provider:', provider, 'model:', model);

  // 获取 API 密钥
  const apiKey = await context.secrets.get(`${provider}-api-key`);
  console.log('[Extension] API 密钥状态:', apiKey ? '已设置' : '未设置');

  if (!apiKey) {
    vscode.window
      .showWarningMessage(
        '未设置 API 密钥，请先设置',
        '设置 API 密钥'
      )
      .then((selection) => {
        if (selection === '设置 API 密钥') {
          vscode.commands.executeCommand('vscode-agent.setApiKey');
        }
      });
    return;
  }

  // 获取工作区根目录
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  console.log('[Extension] 工作区根目录:', workspaceRoot);
  console.log('[Extension] workspaceFolders:', vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath));

  // 创建组件
  const contextManager = createContextManager();
  const skillsManager = createSkillsManager(workspaceRoot);
  const toolRegistry = createDefaultTools(workspaceRoot, skillsManager);

  // 初始化 MCP 集成
  // 每次都重新创建，确保 MCP 工具注册到当前的 toolRegistry
  if (mcpIntegration) {
    try {
      await mcpIntegration.dispose();
      console.log('[Extension] 已清理旧的 MCP 集成');
    } catch (error) {
      console.error('[Extension] 清理旧 MCP 集成失败:', error);
    }
  }
  
  mcpIntegration = createMCPIntegration(workspaceRoot, toolRegistry);

  // 监听服务器状态变化
  mcpIntegration.on('serverStatus', (status) => {
    chatPanelProvider?.postMessage({
      type: 'mcp_server_status_changed',
      status,
    });
  });

  try {
    await mcpIntegration.initialize();
    console.log('[Extension] MCP 集成初始化成功');

    // 设置 MCP 工具确认回调
    setMCPConfirmCallback(requestConfirmation);
    console.log('[Extension] MCP 工具确认回调已设置');
  } catch (error) {
    console.error('[Extension] MCP 集成初始化失败:', error);
    // MCP 初始化失败不应该阻止整个系统启动
  }

  // 为写入和执行工具添加确认机制
  wrapToolsWithConfirmation(toolRegistry, workspaceRoot);

  // 打印加载的 skills
  const loadedSkills = skillsManager.getAllSkills();
  console.log('[Extension] 已加载 Skills 数量:', loadedSkills.length);
  for (const skill of loadedSkills) {
    console.log('[Extension] - Skill:', skill.name);
    console.log('[Extension]   路径:', skill.skillPath);
    console.log('[Extension]   关键词:', skill.keywords);
    console.log('[Extension]   脚本:', Array.from(skill.scripts.keys()));
  }

  // 为非 OpenAI Compatible 提供商清除 baseUrl
  const llmConfig: LLMConfig = {
    provider,
    apiKey,
    model,
    baseUrl: provider === 'openai-compatible' ? baseUrl : undefined,
  };

  // 验证配置完整性
  if (provider === 'openai-compatible') {
    if (!baseUrl || baseUrl.trim() === '') {
      console.log('[Extension] OpenAI Compatible 提供商缺少 Base URL 配置');
      vscode.window
        .showWarningMessage(
          'OpenAI Compatible 提供商需要配置 Base URL，请完善设置后重试',
          '打开设置'
        )
        .then((selection) => {
          if (selection === '打开设置') {
            vscode.commands.executeCommand('vscode-agent.setApiKey');
          }
        });
      
      // 不要完全阻止初始化，让用户可以打开设置面板
      console.log('[Extension] Agent 初始化暂停，等待用户配置');
      
      // 通知前端显示配置提示
      chatPanelProvider?.postMessage({
        type: 'show_config_needed'
      });
      
      return;
    }
  }

  try {
    const llmAdapter = createLLMAdapter(llmConfig);

    // ✅ 调试：打印 LLM adapter 信息
    console.log('[Extension] LLM adapter 类型:', llmAdapter.constructor.name);
    console.log('[Extension] supportsNativeTools:', llmAdapter.supportsNativeTools());

    agentEngine = createAgentEngine(contextManager, toolRegistry, llmAdapter, workspaceRoot, mcpIntegration);
    console.log('Agent 引擎初始化成功');
    
    // 通知前端恢复正常状态
    chatPanelProvider?.postMessage({
      type: 'ready'
    });

    // ✅ 调试：打印工具注册表信息
    console.log('[Extension] 工具注册表工具数量:', toolRegistry.list().length);
    console.log('[Extension] 已注册工具:', toolRegistry.list().map(t => t.name).join(', '));

    const skills = skillsManager.getAllSkills();
    console.log('Skills 已加载:', skills.length, '个');
    for (const skill of skills) {
      console.log('  - Skill:', skill.name, '关键词:', skill.keywords.join(', '));
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    console.error('[Extension] Agent 初始化失败:', error);
    
    // 根据错误类型提供不同的处理建议
    if (errorMessage.includes('Base URL')) {
      vscode.window.showErrorMessage(
        `配置错误: ${errorMessage}`,
        '打开设置'
      ).then((selection) => {
        if (selection === '打开设置') {
          vscode.commands.executeCommand('vscode-agent.setApiKey');
        }
      });
    } else if (errorMessage.includes('API')) {
      vscode.window.showErrorMessage(
        `API 配置错误: ${errorMessage}`,
        '检查设置'
      ).then((selection) => {
        if (selection === '检查设置') {
          vscode.commands.executeCommand('vscode-agent.setApiKey');
        }
      });
    } else {
      vscode.window.showErrorMessage(
        `初始化 Agent 失败: ${errorMessage}`
      );
    }
  }
}

/**
 * 处理用户消息
 */
async function handleUserMessage(
  content: string,
  context: vscode.ExtensionContext,
  images?: Array<{ mimeType: string; data: string }>
): Promise<void> {
  console.log('[Extension] handleUserMessage 被调用, content:', content, '图片数:', images?.length || 0);
  console.log('[Extension] agentEngine 状态:', agentEngine ? '已初始化' : '未初始化');

  if (!agentEngine) {
    console.log('[Extension] agentEngine 未初始化，尝试重新初始化...');
    await initializeAgent(context);

    if (!agentEngine) {
      console.log('[Extension] 初始化失败，发送错误消息');
      chatPanelProvider?.postMessage({
        type: 'agent_event',
        event: { type: 'error', message: '请先点击设置按钮配置 API 密钥' },
      });
      return;
    }
  }

  try {
    console.log('[Extension] 开始处理消息:', content);
    // ✅ 设置处理状态
    isProcessing = true;

    for await (const event of agentEngine.processMessage(content, currentMode, images)) {
      console.log('[Extension] Agent 事件:', event.type);
      chatPanelProvider?.postMessage({ type: 'agent_event', event });
    }
    console.log('[Extension] 消息处理完成');

    // 保存对话
    await saveConversation(context);
  } catch (error) {
    console.error('[Extension] 处理消息错误:', error);
    chatPanelProvider?.postMessage({
      type: 'agent_event',
      event: {
        type: 'error',
        message: error instanceof Error ? error.message : '处理消息时发生错误',
      },
    });
  } finally {
    // ✅ 重置处理状态
    isProcessing = false;
  }
}

/**
 * 保存对话
 */
async function saveConversation(
  context: vscode.ExtensionContext
): Promise<void> {
  if (!agentEngine || !conversationStorage) {
    return;
  }

  const history = agentEngine.getContextManager().getHistory();

  // 如果没有当前对话，创建一个新的
  if (!currentConversation) {
    currentConversation = conversationStorage.createConversation();
    await conversationStorage.setCurrentConversationId(currentConversation.id);
  }

  // 更新对话内容
  currentConversation.messages = history;
  currentConversation.metadata = {
    model: vscode.workspace.getConfiguration('vscode-agent').get('llm.model') || 'unknown',
    totalTokens: agentEngine.getContextManager().estimateCurrentTokens(),
    toolsUsed: [],
  };

  // 如果是第一条消息，用它生成标题
  if (history.length === 1 && history[0].role === 'user') {
    currentConversation.title = conversationStorage.generateTitleFromMessage(history[0].content);
  }

  await conversationStorage.saveConversation(currentConversation);
}

/**
 * 恢复对话
 */
/**
 * 恢复当前会话（优先从内存，其次从存储）
 */
async function restoreCurrentSession(): Promise<void> {
  let restored = false;

  // ✅ 同步执行状态到 webview
  chatPanelProvider?.postMessage({
    type: 'sync_processing_state',
    isProcessing: isProcessing,
  });

  // 优先从 agentEngine 的 contextManager 恢复（处理切换视图的情况）
  if (agentEngine) {
    const history = agentEngine.getContextManager().getHistory();
    if (history.length > 0) {
      console.log('[Extension] 从内存恢复当前会话，消息数:', history.length);
      chatPanelProvider?.postMessage({
        type: 'conversation_loaded',
        messages: history.map(m => ({
          role: m.role,
          content: m.content,
          toolCall: m.toolCall,
        })),
      });
      restored = true;
    }
  }

  // 如果内存中没有，尝试从存储恢复
  if (!restored && conversationStorage) {
    try {
      const conversation = await conversationStorage.loadCurrentConversation();
      if (conversation && conversation.messages.length > 0) {
        currentConversation = conversation;
        console.log('[Extension] 从存储恢复对话，消息数:', conversation.messages.length);

        // 恢复消息到 UI
        chatPanelProvider?.postMessage({
          type: 'conversation_loaded',
          messages: conversation.messages.map(m => ({
            role: m.role,
            content: m.content,
            toolCall: m.toolCall,
          })),
        });

        // 恢复到 context manager
        if (agentEngine) {
          for (const msg of conversation.messages) {
            agentEngine.getContextManager().addMessage(msg);
          }
        }
      }
    } catch (error) {
      console.error('[Extension] 恢复对话失败:', error);
    }
  }

  // 恢复输入框文本
  if (extensionContext) {
    const savedInputText = extensionContext.workspaceState.get<string>('inputText');
    if (savedInputText) {
      chatPanelProvider?.postMessage({
        type: 'restore_input_text',
        text: savedInputText,
      });
    }
  }
}



/**
 * 恢复对话（从存储）- 保留用于其他场景
 */
async function restoreConversation(
  _context: vscode.ExtensionContext
): Promise<void> {
  await restoreCurrentSession();
}

/**
 * 处理获取当前设置
 */
async function handleGetCurrentSettings(context: vscode.ExtensionContext): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration('vscode-agent');
    const provider = config.get<string>('llm.provider') || 'gemini';
    const model = config.get<string>('llm.model') || 'gemini-2.0-flash';
    const baseUrl = config.get<string>('llm.baseUrl') || '';

    // 检查 API 密钥是否存在
    const apiKey = await context.secrets.get(`${provider}-api-key`);
    const hasApiKey = !!apiKey;

    // 发送当前设置到 webview
    chatPanelProvider?.postMessage({
      type: 'current_settings',
      provider,
      model,
      hasApiKey,
      baseUrl,
    });
  } catch (error) {
    console.error('[Extension] 获取当前设置失败:', error);
  }
}

/**
 * 处理保存设置
 */
async function handleSaveSettings(
  provider: string,
  apiKey: string,
  model: string,
  baseUrl: string | undefined,
  context: vscode.ExtensionContext,
): Promise<void> {
  try {
    // 只有在提供了新的 API 密钥时才保存
    if (apiKey) {
      await context.secrets.store(`${provider}-api-key`, apiKey);
    }

    // 更新配置
    const config = vscode.workspace.getConfiguration('vscode-agent');
    await config.update('llm.provider', provider, vscode.ConfigurationTarget.Global);
    if (model) {
      await config.update('llm.model', model, vscode.ConfigurationTarget.Global);
    }
    
    // 保存 Base URL（只对 OpenAI Compatible 提供商）
    if (provider === 'openai-compatible') {
      if (baseUrl !== undefined) {
        await config.update('llm.baseUrl', baseUrl, vscode.ConfigurationTarget.Global);
      }
    }
    // 注意：不要清除其他提供商的 baseUrl 配置，以便用户切换回来时能恢复

    vscode.window.showInformationMessage(`✅ ${provider} 设置已保存`);

    // 重新初始化 agent
    await initializeAgent(context);
  } catch (error) {
    vscode.window.showErrorMessage(`保存设置失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 处理 MCP 服务器列表请求
 */
async function handleMCPListServers(): Promise<void> {
  if (!mcpIntegration) {
    chatPanelProvider?.postMessage({
      type: 'mcp_servers_list',
      servers: [],
    });
    return;
  }

  try {
    const statuses = mcpIntegration.getAllServerStatuses();
    chatPanelProvider?.postMessage({
      type: 'mcp_servers_list',
      servers: statuses,
    });
  } catch (error) {
    console.error('[Extension] 获取 MCP 服务器列表失败:', error);
    chatPanelProvider?.postMessage({
      type: 'mcp_servers_list',
      servers: [],
    });
  }
}

/**
 * 处理 MCP 市场列表请求
 */
async function handleMCPListMarketplace(): Promise<void> {
  if (!mcpIntegration) {
    chatPanelProvider?.postMessage({
      type: 'mcp_marketplace_list',
      servers: [],
    });
    return;
  }

  try {
    const marketplaceServers = mcpIntegration.getMarketplaceServers();
    chatPanelProvider?.postMessage({
      type: 'mcp_marketplace_list',
      servers: marketplaceServers,
    });
  } catch (error) {
    console.error('[Extension] 获取 MCP 市场列表失败:', error);
    chatPanelProvider?.postMessage({
      type: 'mcp_marketplace_list',
      servers: [],
    });
  }
}

/**
 * 处理 MCP 搜索请求
 */
async function handleMCPSearch(query: string): Promise<void> {
  if (!mcpIntegration) {
    chatPanelProvider?.postMessage({
      type: 'mcp_marketplace_list',
      servers: [],
    });
    return;
  }

  try {
    const searchResults = mcpIntegration.searchMarketplaceServers(query);
    chatPanelProvider?.postMessage({
      type: 'mcp_marketplace_list',
      servers: searchResults,
    });
  } catch (error) {
    console.error('[Extension] MCP 搜索失败:', error);
    chatPanelProvider?.postMessage({
      type: 'mcp_marketplace_list',
      servers: [],
    });
  }
}

/**
 * 处理启动 MCP 服务器请求
 */
async function handleMCPStartServer(name: string): Promise<void> {
  if (!mcpIntegration) {
    vscode.window.showErrorMessage('MCP 集成未初始化');
    return;
  }

  try {
    await mcpIntegration.startServer(name);
    vscode.window.showInformationMessage(`MCP 服务器 ${name} 启动成功`);

    // 刷新服务器列表
    await handleMCPListServers();
  } catch (error) {
    console.error('[Extension] 启动 MCP 服务器失败:', error);
    vscode.window.showErrorMessage(`启动 MCP 服务器失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 处理停止 MCP 服务器请求
 */
async function handleMCPStopServer(name: string): Promise<void> {
  if (!mcpIntegration) {
    vscode.window.showErrorMessage('MCP 集成未初始化');
    return;
  }

  try {
    await mcpIntegration.stopServer(name);
    vscode.window.showInformationMessage(`MCP 服务器 ${name} 已停止`);

    // 刷新服务器列表
    await handleMCPListServers();
  } catch (error) {
    console.error('[Extension] 停止 MCP 服务器失败:', error);
    vscode.window.showErrorMessage(`停止 MCP 服务器失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 处理删除 MCP 服务器请求
 */
async function handleMCPRemoveServer(name: string): Promise<void> {
  if (!mcpIntegration) {
    vscode.window.showErrorMessage('MCP 集成未初始化');
    return;
  }

  try {
    await mcpIntegration.removeServer(name);
    vscode.window.showInformationMessage(`MCP 服务器 ${name} 已删除`);

    // 刷新服务器列表
    await handleMCPListServers();
  } catch (error) {
    console.error('[Extension] 删除 MCP 服务器失败:', error);
    vscode.window.showErrorMessage(`删除 MCP 服务器失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 处理安装 MCP 服务器请求
 */
async function handleMCPInstallServer(name: string): Promise<void> {
  if (!mcpIntegration) {
    vscode.window.showErrorMessage('MCP 集成未初始化');
    return;
  }

  try {
    await mcpIntegration.installFromMarketplace(name);
    vscode.window.showInformationMessage(`MCP 服务器 ${name} 安装成功`);

    // 刷新服务器列表
    await handleMCPListServers();
  } catch (error) {
    console.error('[Extension] 安装 MCP 服务器失败:', error);
    vscode.window.showErrorMessage(`安装 MCP 服务器失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 处理添加自定义 MCP 服务器请求
 */
async function handleMCPAddServer(config: any): Promise<void> {
  if (!mcpIntegration) {
    vscode.window.showErrorMessage('MCP 集成未初始化');
    return;
  }

  try {
    await mcpIntegration.addServer(config);
    vscode.window.showInformationMessage(`MCP 服务器 ${config.name} 添加成功`);

    // 刷新服务器列表
    await handleMCPListServers();
  } catch (error) {
    console.error('[Extension] 添加 MCP 服务器失败:', error);
    vscode.window.showErrorMessage(`添加 MCP 服务器失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 处理打开 MCP 配置文件请求
 */
async function handleMCPOpenConfig(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('未找到工作区');
    return;
  }

  const fs = require('fs');
  const path = require('path');

  const configDir = path.join(workspaceRoot, '.vscode-agent');
  const configFilePath = path.join(configDir, 'mcp-servers.json');

  try {
    // 确保目录存在
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // 如果配置文件不存在，创建默认配置
    if (!fs.existsSync(configFilePath)) {
      const defaultConfig = {
        mcpServers: {
          "example-stdio-server": {
            "command": "npx",
            "args": ["your-mcp-package"],
            "description": "stdio 传输示例（请修改）",
            "enabled": false,
            "autoStart": false
          },
          "example-sse-server": {
            "transport": "sse",
            "url": "http://localhost:3000/sse",
            "headers": {},
            "description": "SSE 传输示例（请修改）",
            "enabled": false,
            "autoStart": false
          }
        }
      };
      fs.writeFileSync(configFilePath, JSON.stringify(defaultConfig, null, 2));
    }

    // 打开配置文件
    const configPath = vscode.Uri.file(configFilePath);
    const document = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(document);
  } catch (error) {
    console.error('[Extension] 打开 MCP 配置文件失败:', error);
    vscode.window.showErrorMessage(`打开配置文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 处理获取模板列表请求
 */
async function handleGetTemplates(): Promise<void> {
  if (!promptTemplateManager) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    promptTemplateManager = createPromptTemplateManager(workspaceRoot);
  }

  const templates = promptTemplateManager.getAllTemplates();
  chatPanelProvider?.postMessage({
    type: 'templates_list',
    templates: templates.map(t => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      description: t.description,
      category: t.category,
    })),
  });
}

/**
 * 处理使用模板请求
 */
async function handleUseTemplate(templateId: string): Promise<void> {
  if (!promptTemplateManager) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    promptTemplateManager = createPromptTemplateManager(workspaceRoot);
  }

  const template = promptTemplateManager.getTemplate(templateId);
  if (!template) {
    console.error('[Extension] 模板未找到:', templateId);
    return;
  }

  // 获取变量值
  const variables: Record<string, string> = {};

  // 获取当前选中的代码
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    variables['selected_code'] = selectedText || '// 请选择代码';
    variables['file_name'] = editor.document.fileName.split(/[/\\]/).pop() || '';
    variables['file_extension'] = editor.document.languageId || '';
  } else {
    variables['selected_code'] = '// 请选择代码';
    variables['file_name'] = '';
    variables['file_extension'] = '';
  }

  // 获取剪贴板内容
  try {
    const clipboardText = await vscode.env.clipboard.readText();
    variables['clipboard'] = clipboardText || '';
  } catch {
    variables['clipboard'] = '';
  }

  // 填充模板
  const content = promptTemplateManager.fillTemplate(template, variables);

  chatPanelProvider?.postMessage({
    type: 'template_content',
    content: content,
  });
}

/**
 * 执行右键菜单模板命令 - 直接发送给 AI
 */
async function executeTemplateCommand(templateId: string, context: vscode.ExtensionContext): Promise<void> {
  if (!promptTemplateManager) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    promptTemplateManager = createPromptTemplateManager(workspaceRoot);
  }

  const template = promptTemplateManager.getTemplate(templateId);
  if (!template) {
    vscode.window.showErrorMessage('模板未找到');
    return;
  }

  // 获取选中的代码
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('请先打开一个文件');
    return;
  }

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);

  if (!selectedText) {
    vscode.window.showWarningMessage('请先选中代码');
    return;
  }

  // 获取变量值
  const variables: Record<string, string> = {
    selected_code: selectedText,
    file_name: editor.document.fileName.split(/[/\\]/).pop() || '',
    file_extension: editor.document.languageId || '',
    clipboard: '',
  };

  // 获取剪贴板内容
  try {
    variables['clipboard'] = await vscode.env.clipboard.readText() || '';
  } catch {
    // ignore
  }

  // 填充模板
  const content = promptTemplateManager.fillTemplate(template, variables);

  // 确保聊天面板可见
  await vscode.commands.executeCommand('vscode-agent.chatPanel.focus');

  // 直接发送消息给 AI
  await handleUserMessage(content, context);
}

/**
 * 处理快捷命令
 */
async function handleQuickCommand(
  command: string,
  args: string[],
  context: vscode.ExtensionContext
): Promise<void> {
  if (!quickCommandManager) {
    console.error('[Extension] QuickCommandManager 未初始化');
    chatPanelProvider?.postMessage({
      type: 'command_error',
      error: '快捷命令系统未初始化',
    });
    return;
  }

  console.log(`[Extension] 执行快捷命令: /${command}`, args);

  // 收集命令执行上下文
  const commandContext: CommandContext = await collectCommandContext();

  // 执行命令
  const result = await quickCommandManager.executeCommand(command, commandContext, args);

  if (!result.success) {
    console.error('[Extension] 命令执行失败:', result.error);
    chatPanelProvider?.postMessage({
      type: 'command_error',
      error: result.error || '命令执行失败',
      warning: result.warning,
    });
    return;
  }

  // 如果有警告,显示给用户
  if (result.warning) {
    vscode.window.showWarningMessage(result.warning);
  }

  // 发送生成的提示给 Agent
  if (result.prompt) {
    console.log('[Extension] 发送命令生成的提示给 Agent');
    await handleUserMessage(result.prompt, context);
  }
}

/**
 * 处理命令建议请求
 */
async function handleGetCommandSuggestions(query: string): Promise<void> {
  if (!quickCommandManager) {
    console.error('[Extension] QuickCommandManager 未初始化');
    return;
  }

  const suggestions = quickCommandManager.getCommandSuggestions(query);

  chatPanelProvider?.postMessage({
    type: 'command_suggestions',
    suggestions,
  });
}

/**
 * 收集命令执行上下文
 */
async function collectCommandContext(): Promise<CommandContext> {
  const context: CommandContext = {};

  // 获取当前编辑器和选中的代码
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);

    if (selectedText) {
      context.selectedCode = selectedText;
    }

    context.fileName = editor.document.fileName.split(/[/\\]/).pop() || '';
    context.fileExtension = editor.document.languageId || '';
    context.filePath = editor.document.fileName;

    context.cursorPosition = {
      line: selection.active.line,
      column: selection.active.character,
    };
  }

  // 获取剪贴板内容
  try {
    const clipboardText = await vscode.env.clipboard.readText();
    if (clipboardText) {
      context.clipboardContent = clipboardText;
    }
  } catch (error) {
    console.warn('[Extension] 无法读取剪贴板:', error);
  }

  // 获取工作区根目录
  context.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // 获取 Git diff（用于 commit 命令）
  try {
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (gitExtension) {
      const api = gitExtension.getAPI(1);
      if (api.repositories.length > 0) {
        const repo = api.repositories[0];
        const diff = await repo.diff(true); // true = include staged changes
        if (diff) {
          context.gitDiff = diff;
        }
      }
    }
  } catch (error) {
    console.warn('[Extension] 无法获取 Git diff:', error);
  }

  return context;
}


export function deactivate() {
  console.log('VSCode Agent 扩展已停用');
  if (agentEngine) {
    agentEngine.cancel();
  }
  if (mcpIntegration) {
    mcpIntegration.dispose().catch(error => {
      console.error('[Extension] MCP 清理失败:', error);
    });
  }
}
