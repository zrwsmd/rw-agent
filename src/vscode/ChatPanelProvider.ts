import * as vscode from 'vscode';
import { AgentEvent, AgentMode } from '../types/agent';

/**
 * UI 消息类型
 */
export type UIMessage =
  | { type: 'user_message'; content: string }
  | { type: 'agent_event'; event: AgentEvent }
  | { type: 'clear_chat' }
  | { type: 'cancel' }
  | { type: 'set_mode'; mode: AgentMode }
  | { type: 'open_settings' }
  | { type: 'ready' };

/**
 * 聊天面板提供者
 */
export class ChatPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'vscode-agent.chatPanel';

  private _view?: vscode.WebviewView;
  private _messageHandler?: (message: UIMessage) => void;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  /**
   * 解析 Webview
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // 处理来自 webview 的消息
    webviewView.webview.onDidReceiveMessage((message: UIMessage) => {
      if (this._messageHandler) {
        this._messageHandler(message);
      }
    });
  }

  /**
   * 发送消息到 webview
   */
  public postMessage(message: UIMessage): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  /**
   * 设置消息处理器
   */
  public onMessage(handler: (message: UIMessage) => void): void {
    this._messageHandler = handler;
  }

  /**
   * 生成 Webview HTML
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Agent Chat</title>
  <style>
    :root {
      --radius: 8px;
      --spacing: 12px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    
    /* 头部工具栏 */
    .toolbar {
      display: flex;
      align-items: center;
      padding: 8px var(--spacing);
      gap: 8px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .toolbar select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
    }
    .toolbar-spacer { flex: 1; }
    .toolbar-btn {
      background: transparent;
      color: var(--vscode-foreground);
      border: none;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
      opacity: 0.8;
    }
    .toolbar-btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
      opacity: 1;
    }
    
    /* 消息区域 */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .message {
      padding: 10px 14px;
      border-radius: var(--radius);
      line-height: 1.5;
      word-wrap: break-word;
      max-width: 95%;
    }
    .message.user {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .message.assistant {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .message.thought {
      background: rgba(100, 100, 255, 0.1);
      border-left: 3px solid var(--vscode-textLink-foreground);
      font-style: italic;
      font-size: 12px;
      opacity: 0.9;
    }
    .message.action {
      background: rgba(255, 200, 100, 0.1);
      border-left: 3px solid var(--vscode-editorWarning-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
    }
    .message.observation {
      background: var(--vscode-input-background);
      border-left: 3px solid var(--vscode-terminal-ansiGreen);
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      white-space: pre-wrap;
      max-height: 200px;
      overflow-y: auto;
    }
    .message.error {
      background: rgba(255, 100, 100, 0.15);
      border-left: 3px solid var(--vscode-errorForeground);
      color: var(--vscode-errorForeground);
    }
    .message.plan {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
    }
    .plan-step {
      padding: 6px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 12px;
    }
    .plan-step:last-child { border-bottom: none; }
    
    /* 输入区域 */
    .input-container {
      padding: var(--spacing);
      background: var(--vscode-sideBar-background);
      border-top: 1px solid var(--vscode-panel-border);
    }
    .input-wrapper {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    .input-wrapper textarea {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 10px 12px;
      border-radius: var(--radius);
      resize: none;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.4;
      min-height: 44px;
      max-height: 150px;
    }
    .input-wrapper textarea:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    .input-wrapper textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    .send-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 10px 16px;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.15s;
    }
    .send-btn:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }
    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    /* 代码块 */
    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 10px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
      font-size: 12px;
    }
    code {
      font-family: var(--vscode-editor-font-family);
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 5px;
      border-radius: 3px;
    }
    pre code {
      background: none;
      padding: 0;
    }
    
    /* 加载动画 */
    .loading {
      display: flex;
      gap: 4px;
      padding: 8px 0;
    }
    .loading span {
      width: 6px;
      height: 6px;
      background: var(--vscode-foreground);
      border-radius: 50%;
      animation: bounce 1.4s infinite ease-in-out both;
    }
    .loading span:nth-child(1) { animation-delay: -0.32s; }
    .loading span:nth-child(2) { animation-delay: -0.16s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
      40% { transform: scale(1); opacity: 1; }
    }
    
    /* 空状态 */
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--vscode-descriptionForeground);
      text-align: center;
      padding: 20px;
    }
    .empty-state-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.5; }
    .empty-state-text { font-size: 14px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <select id="modeSelect" title="选择模式">
      <option value="react">💬 对话</option>
      <option value="plan">📋 计划</option>
    </select>
    <div class="toolbar-spacer"></div>
    <button class="toolbar-btn" id="settingsBtn" title="设置 API 密钥">⚙️ 设置</button>
    <button class="toolbar-btn" id="clearBtn" title="清空对话">🗑️ 清空</button>
  </div>
  
  <div class="messages" id="messages">
    <div class="empty-state" id="emptyState">
      <div class="empty-state-icon">🤖</div>
      <div class="empty-state-text">开始对话吧！</div>
    </div>
  </div>
  
  <div class="input-container">
    <div class="input-wrapper">
      <textarea id="input" placeholder="输入消息，按 Enter 发送..." rows="1"></textarea>
      <button class="send-btn" id="sendBtn">发送</button>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();
      var messagesEl = document.getElementById('messages');
      var inputEl = document.getElementById('input');
      var sendBtn = document.getElementById('sendBtn');
      var modeSelect = document.getElementById('modeSelect');
      var settingsBtn = document.getElementById('settingsBtn');
      var clearBtn = document.getElementById('clearBtn');
      
      var isProcessing = false;
      var currentAssistantMessage = null;

      function sendMessage() {
        var content = inputEl.value.trim();
        if (!content || isProcessing) return;
        
        var empty = document.getElementById('emptyState');
        if (empty) empty.remove();
        
        addMessage('user', content);
        vscode.postMessage({ type: 'user_message', content: content });
        inputEl.value = '';
        isProcessing = true;
        sendBtn.disabled = true;
        currentAssistantMessage = null;
      }

      function addMessage(type, content) {
        var empty = document.getElementById('emptyState');
        if (empty) empty.remove();
        
        var div = document.createElement('div');
        div.className = 'message ' + type;
        div.textContent = content || '';
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return div;
      }

      // 绑定按钮事件
      sendBtn.onclick = function() { sendMessage(); };
      
      settingsBtn.onclick = function() {
        vscode.postMessage({ type: 'open_settings' });
      };
      
      clearBtn.onclick = function() {
        messagesEl.innerHTML = '<div class="empty-state" id="emptyState"><div class="empty-state-icon">🤖</div><div class="empty-state-text">开始对话吧！</div></div>';
        vscode.postMessage({ type: 'clear_chat' });
      };
      
      modeSelect.onchange = function() {
        vscode.postMessage({ type: 'set_mode', mode: modeSelect.value });
      };

      // 回车发送
      inputEl.onkeydown = function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      };

      // 处理来自扩展的消息
      window.addEventListener('message', function(event) {
        var message = event.data;
        
        if (message.type === 'agent_event') {
          var evt = message.event;
          
          if (evt.type === 'thought') {
            addMessage('thought', '💭 ' + evt.content);
          } else if (evt.type === 'action') {
            addMessage('action', '🔧 ' + evt.tool);
          } else if (evt.type === 'observation') {
            var obsContent = evt.result.success ? evt.result.output : '❌ ' + evt.result.error;
            addMessage('observation', '📋 ' + obsContent);
          } else if (evt.type === 'plan') {
            addMessage('plan', '📋 计划');
          } else if (evt.type === 'step_complete') {
            addMessage('assistant', '✅ 步骤 ' + evt.step + ' 完成');
          } else if (evt.type === 'answer') {
            if (!currentAssistantMessage) {
              addMessage('assistant', evt.content);
            }
            currentAssistantMessage = null;
            isProcessing = false;
            sendBtn.disabled = false;
          } else if (evt.type === 'error') {
            addMessage('error', '❌ ' + evt.message);
            isProcessing = false;
            sendBtn.disabled = false;
          } else if (evt.type === 'token') {
            if (!currentAssistantMessage) {
              currentAssistantMessage = addMessage('assistant', '');
            }
            currentAssistantMessage.textContent += evt.content;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }
      });

      // 通知扩展 webview 已准备好
      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }

  /**
   * 生成随机 nonce
   */
  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
