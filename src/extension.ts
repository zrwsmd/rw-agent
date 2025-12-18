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

let agentEngine: AgentEngineImpl | null = null;
let currentMode: AgentMode = 'react';
let chatPanelProvider: ChatPanelProvider | null = null;
let conversationStorage: ConversationStorage | null = null;
let currentConversation: Conversation | null = null;

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
 * 为写入和执行工具添加确认机制
 */
function wrapToolsWithConfirmation(toolRegistry: any): void {
  const toolsNeedingConfirmation = ['shell_command', 'write_file', 'skill_script'];
  
  for (const toolName of toolsNeedingConfirmation) {
    const originalTool = toolRegistry.get(toolName);
    if (!originalTool) continue;

    const originalExecute = originalTool.execute.bind(originalTool);
    
    originalTool.execute = async function(params: Record<string, unknown>) {
      // 构建确认请求
      let title = '';
      let description = '';
      let details = '';
      
      if (toolName === 'shell_command') {
        title = '执行命令';
        description = `Allow execute command?`;
        details = `命令: ${params.command}\n工作目录: ${params.cwd || '(默认)'}`;
      } else if (toolName === 'write_file') {
        title = '写入文件';
        description = `Allow write to ${params.path}?`;
        const content = params.content as string;
        details = `文件路径: ${params.path}\n\n内容预览:\n${content.substring(0, 500)}${content.length > 500 ? '\n...' : ''}`;
      } else if (toolName === 'skill_script') {
        title = '执行脚本';
        description = `Allow execute script ${params.skill_name}/${params.script_name}?`;
        const args = params.args as string[] | undefined;
        details = `Skill: ${params.skill_name}\n脚本: ${params.script_name}\n参数: ${args?.join(' ') || '(无)'}`;
      }

      // 请求用户确认
      const requestId = `confirm_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      const choice = await requestConfirmation(requestId, title, description, details);

      if (choice !== 'confirm' && choice !== 'confirm_no_ask') {
        return {
          success: false,
          output: '用户取消了操作',
        };
      }

      // 执行原始工具
      return originalExecute(params);
    };
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('VSCode Agent 扩展已激活');

  // 获取工作区根目录
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // 创建聊天面板提供者
  chatPanelProvider = new ChatPanelProvider(context.extensionUri);
  conversationStorage = createConversationStorage(context, workspaceRoot);

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
        // Webview 准备好了，尝试恢复对话
        console.log('[Extension] Webview 准备好了');
        await restoreConversation(context);
        break;

      case 'user_message':
        console.log('[Extension] 收到用户消息:', message.content);
        await handleUserMessage(message.content, context);
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
              messages: conv.messages.map(m => ({ role: m.role, content: m.content })),
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
        break;

      case 'confirm_response':
        handleConfirmResponse(message.requestId, message.selectedOption);
        break;

      case 'open_settings':
        vscode.commands.executeCommand('vscode-agent.setApiKey');
        break;

      case 'get_current_settings':
        await handleGetCurrentSettings(context);
        break;

      case 'save_settings':
        await handleSaveSettings(message.provider, message.apiKey, message.model, context);
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
  
  // 为写入和执行工具添加确认机制
  wrapToolsWithConfirmation(toolRegistry);
  
  // 为写入和执行工具添加确认机制
  wrapToolsWithConfirmation(toolRegistry);
  
  // 打印加载的 skills
  const loadedSkills = skillsManager.getAllSkills();
  console.log('[Extension] 已加载 Skills 数量:', loadedSkills.length);
  for (const skill of loadedSkills) {
    console.log('[Extension] - Skill:', skill.name);
    console.log('[Extension]   路径:', skill.skillPath);
    console.log('[Extension]   关键词:', skill.keywords);
    console.log('[Extension]   脚本:', Array.from(skill.scripts.keys()));
  }

  const llmConfig: LLMConfig = {
    provider,
    apiKey,
    model,
    baseUrl,
  };

  try {
    const llmAdapter = createLLMAdapter(llmConfig);
    agentEngine = createAgentEngine(contextManager, toolRegistry, llmAdapter, workspaceRoot);
    console.log('Agent 引擎初始化成功');
    const skills = skillsManager.getAllSkills();
    console.log('Skills 已加载:', skills.length, '个');
    for (const skill of skills) {
      console.log('  - Skill:', skill.name, '关键词:', skill.keywords.join(', '));
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `初始化 Agent 失败: ${error instanceof Error ? error.message : '未知错误'}`
    );
  }
}

/**
 * 处理用户消息
 */
async function handleUserMessage(
  content: string,
  context: vscode.ExtensionContext
): Promise<void> {
  console.log('[Extension] handleUserMessage 被调用, content:', content);
  console.log('[Extension] agentEngine 状态:', agentEngine ? '已初始化' : '未初始化');
  
  if (!agentEngine) {
    console.log('[Extension] agentEngine 未初始化，发送错误消息');
    chatPanelProvider?.postMessage({
      type: 'agent_event',
      event: { type: 'error', message: '请先点击设置按钮配置 API 密钥' },
    });
    return;
  }

  try {
    console.log('[Extension] 开始处理消息:', content);
    for await (const event of agentEngine.processMessage(content, currentMode)) {
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
async function restoreConversation(
  context: vscode.ExtensionContext
): Promise<void> {
  if (!conversationStorage) {
    return;
  }

  try {
    // 尝试加载当前对话
    const conversation = await conversationStorage.loadCurrentConversation();
    if (!conversation || conversation.messages.length === 0) {
      return;
    }

    currentConversation = conversation;

    // 恢复消息到 UI
    chatPanelProvider?.postMessage({
      type: 'conversation_loaded',
      messages: conversation.messages.map(m => ({ role: m.role, content: m.content })),
    });

    // 恢复到 context manager
    if (agentEngine) {
      for (const msg of conversation.messages) {
        agentEngine.getContextManager().addMessage(msg);
      }
    }
  } catch (error) {
    console.error('恢复对话失败:', error);
  }
}

/**
 * 处理获取当前设置
 */
async function handleGetCurrentSettings(context: vscode.ExtensionContext): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration('vscode-agent');
    const provider = config.get<string>('llm.provider') || 'gemini';
    const model = config.get<string>('llm.model') || 'gemini-2.0-flash';
    
    // 检查 API 密钥是否存在
    const apiKey = await context.secrets.get(`${provider}-api-key`);
    const hasApiKey = !!apiKey;
    
    // 发送当前设置到 webview
    chatPanelProvider?.postMessage({
      type: 'current_settings',
      provider,
      model,
      hasApiKey,
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
  context: vscode.ExtensionContext
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
    
    vscode.window.showInformationMessage(`✅ ${provider} 设置已保存`);
    
    // 重新初始化 agent
    await initializeAgent(context);
  } catch (error) {
    vscode.window.showErrorMessage(`保存设置失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

export function deactivate() {
  console.log('VSCode Agent 扩展已停用');
  if (agentEngine) {
    agentEngine.cancel();
  }
}
