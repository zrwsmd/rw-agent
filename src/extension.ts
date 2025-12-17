import * as vscode from 'vscode';
import { ChatPanelProvider, UIMessage } from './vscode/ChatPanelProvider';
import { createAgentEngine, AgentEngineImpl } from './agent';
import { createContextManager } from './context';
import { createDefaultTools } from './tools';
import { createLLMAdapter } from './llm';
import { AgentMode } from './types/agent';
import { LLMConfig } from './types/llm';
import {
  createConversationSerializer,
  ConversationSerializerImpl,
} from './serializer';
import { Conversation } from './types/conversation';

let agentEngine: AgentEngineImpl | null = null;
let currentMode: AgentMode = 'react';
let chatPanelProvider: ChatPanelProvider | null = null;
let conversationSerializer: ConversationSerializerImpl | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('VSCode Agent 扩展已激活');

  // 创建聊天面板提供者
  chatPanelProvider = new ChatPanelProvider(context.extensionUri);
  conversationSerializer = createConversationSerializer() as ConversationSerializerImpl;

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
        await context.workspaceState.update('conversation', undefined);
        break;

      case 'cancel':
        if (agentEngine) {
          agentEngine.cancel();
        }
        break;

      case 'open_settings':
        vscode.commands.executeCommand('vscode-agent.setApiKey');
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

  // 创建组件
  const contextManager = createContextManager();
  const toolRegistry = createDefaultTools(workspaceRoot);

  const llmConfig: LLMConfig = {
    provider,
    apiKey,
    model,
    baseUrl,
  };

  try {
    const llmAdapter = createLLMAdapter(llmConfig);
    agentEngine = createAgentEngine(contextManager, toolRegistry, llmAdapter);
    console.log('Agent 引擎初始化成功');
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
  if (!agentEngine || !conversationSerializer) {
    return;
  }

  const history = agentEngine.getContextManager().getHistory();
  const conversation: Conversation = {
    id: 'current',
    title: '当前对话',
    messages: history,
    metadata: {
      model: vscode.workspace.getConfiguration('vscode-agent').get('llm.model') || 'unknown',
      totalTokens: 0,
      toolsUsed: [],
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const json = conversationSerializer.serialize(conversation);
  await context.workspaceState.update('conversation', json);
}

/**
 * 恢复对话
 */
async function restoreConversation(
  context: vscode.ExtensionContext
): Promise<void> {
  if (!conversationSerializer) {
    return;
  }

  const json = context.workspaceState.get<string>('conversation');
  if (!json) {
    return;
  }

  try {
    const conversation = conversationSerializer.deserialize(json);

    // 恢复消息到 UI
    for (const msg of conversation.messages) {
      if (msg.role === 'user') {
        chatPanelProvider?.postMessage({
          type: 'agent_event',
          event: { type: 'answer', content: `[用户] ${msg.content}` },
        });
      } else if (msg.role === 'assistant') {
        chatPanelProvider?.postMessage({
          type: 'agent_event',
          event: { type: 'answer', content: msg.content },
        });
      }
    }

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
 * 处理保存设置
 */
async function handleSaveSettings(
  provider: string,
  apiKey: string,
  model: string,
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    // 保存 API 密钥
    await context.secrets.store(`${provider}-api-key`, apiKey);
    
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
