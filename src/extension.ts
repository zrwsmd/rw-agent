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

let agentEngine: AgentEngineImpl | null = null;
let currentMode: AgentMode = 'react';
let chatPanelProvider: ChatPanelProvider | null = null;
let conversationStorage: ConversationStorage | null = null;
let currentConversation: Conversation | null = null;
let mcpIntegration: MCPIntegration | null = null;

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
        // Webview 准备好了，初始化 Agent 并尝试恢复对话
        console.log('[Extension] Webview 准备好了');
        if (!agentEngine) {
          await initializeAgent(context);
        }
        // 优先从内存中恢复当前会话（处理切换视图的情况）
        await restoreCurrentSession();
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
  
  // 初始化 MCP 集成
  if (!mcpIntegration) {
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
  }
  
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
    agentEngine = createAgentEngine(contextManager, toolRegistry, llmAdapter, workspaceRoot, mcpIntegration);
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
/**
 * 恢复当前会话（优先从内存，其次从存储）
 */
async function restoreCurrentSession(): Promise<void> {
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
      return;
    }
  }

  // 如果内存中没有，尝试从存储恢复
  if (!conversationStorage) {
    return;
  }

  try {
    const conversation = await conversationStorage.loadCurrentConversation();
    if (!conversation || conversation.messages.length === 0) {
      return;
    }

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
  } catch (error) {
    console.error('[Extension] 恢复对话失败:', error);
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
