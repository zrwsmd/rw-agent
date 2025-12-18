import * as vscode from 'vscode';
import { AgentEvent, AgentMode } from '../types/agent';

/**
 * 对话列表项
 */
export interface ConversationItem {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

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
  | { type: 'save_settings'; provider: string; apiKey: string; model: string }
  | { type: 'ready' }
  | { type: 'new_conversation' }
  | { type: 'load_conversation'; id: string }
  | { type: 'delete_conversation'; id: string }
  | { type: 'list_conversations' }
  | { type: 'conversation_list'; conversations: ConversationItem[] }
  | { type: 'conversation_loaded'; messages: Array<{ role: string; content: string }> };

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

    /* Token 使用显示 */
    .token-usage {
      display: none;
      padding: 8px 12px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .token-usage.show {
      display: block;
    }
    .token-usage-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }
    .token-usage-progress {
      flex: 1;
      height: 6px;
      background: var(--vscode-input-background);
      border-radius: 3px;
      overflow: hidden;
    }
    .token-usage-fill {
      height: 100%;
      background: var(--vscode-terminal-ansiGreen);
      transition: background-color 0.3s;
    }
    .token-usage-fill.warning {
      background: var(--vscode-editorWarning-foreground);
    }
    .token-usage-fill.danger {
      background: var(--vscode-errorForeground);
    }
    .token-usage-text {
      font-size: 11px;
      white-space: nowrap;
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
      position: relative;
    }
    .message.assistant .copy-btn {
      position: absolute;
      top: 6px;
      right: 6px;
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      opacity: 0;
      padding: 4px 6px;
      border-radius: 4px;
      font-size: 12px;
      transition: opacity 0.2s, background 0.2s;
    }
    .message.assistant:hover .copy-btn {
      opacity: 0.6;
    }
    .message.assistant .copy-btn:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground);
    }
    .message.assistant .copy-btn.copied {
      opacity: 1;
      color: var(--vscode-terminal-ansiGreen);
    }
    .message.thought {
      background: rgba(100, 100, 255, 0.1);
      border-left: 3px solid var(--vscode-textLink-foreground);
      font-size: 12px;
      opacity: 0.9;
      padding: 0;
    }
    .thought-header {
      padding: 8px 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
    }
    .thought-header:hover {
      background: rgba(100, 100, 255, 0.15);
    }
    .thought-arrow {
      transition: transform 0.2s;
      font-size: 10px;
    }
    .thought-arrow.expanded {
      transform: rotate(90deg);
    }
    .thought-title {
      font-style: italic;
      color: var(--vscode-textLink-foreground);
    }
    .thought-content {
      display: none;
      padding: 8px 14px;
      border-top: 1px solid rgba(100, 100, 255, 0.2);
      font-style: italic;
      line-height: 1.5;
    }
    .thought-content.show {
      display: block;
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
    
    /* Skill 提示 */
    .message.skill {
      background: linear-gradient(135deg, rgba(100, 200, 100, 0.15), rgba(100, 200, 100, 0.05));
      border-left: 3px solid var(--vscode-terminal-ansiGreen);
      font-size: 12px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .skill-icon {
      font-size: 16px;
    }
    .skill-info {
      flex: 1;
    }
    .skill-name {
      font-weight: 600;
      color: var(--vscode-terminal-ansiGreen);
    }
    .skill-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    
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
    .cancel-btn {
      background: var(--vscode-errorForeground);
      color: white;
      border: none;
      padding: 10px 16px;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.15s;
      display: none;
    }
    .cancel-btn.show {
      display: block;
    }
    .cancel-btn:hover {
      opacity: 0.9;
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
    
    /* 历史对话面板 */
    .history-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 100;
      justify-content: center;
      align-items: center;
    }
    .history-overlay.show {
      display: flex;
    }
    .history-panel {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      width: 90%;
      max-width: 400px;
      max-height: 70vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .history-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .history-title {
      font-size: 14px;
      font-weight: 600;
    }
    .history-close {
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 4px;
      font-size: 16px;
      opacity: 0.7;
    }
    .history-close:hover {
      opacity: 1;
    }
    .history-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .history-item {
      display: flex;
      align-items: center;
      padding: 10px 12px;
      border-radius: 6px;
      cursor: pointer;
      margin-bottom: 4px;
    }
    .history-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .history-item-info {
      flex: 1;
      min-width: 0;
    }
    .history-item-title {
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .history-item-meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    .history-item-delete {
      background: transparent;
      border: none;
      color: var(--vscode-errorForeground);
      cursor: pointer;
      padding: 4px 8px;
      font-size: 12px;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .history-item:hover .history-item-delete {
      opacity: 0.7;
    }
    .history-item-delete:hover {
      opacity: 1;
    }
    .history-empty {
      text-align: center;
      padding: 40px 20px;
      color: var(--vscode-descriptionForeground);
    }

    /* 设置面板 */
    .settings-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 100;
      justify-content: center;
      align-items: center;
    }
    .settings-overlay.show {
      display: flex;
    }
    .settings-panel {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      width: 90%;
      max-width: 400px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    .settings-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .settings-title {
      font-size: 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .settings-close {
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      font-size: 18px;
      opacity: 0.7;
    }
    .settings-close:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground);
    }
    .settings-body {
      padding: 20px;
    }
    .settings-section {
      margin-bottom: 24px;
    }
    .settings-section:last-child {
      margin-bottom: 0;
    }
    .settings-section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
      letter-spacing: 0.5px;
    }
    .settings-field {
      margin-bottom: 16px;
    }
    .settings-field:last-child {
      margin-bottom: 0;
    }
    .settings-label {
      display: block;
      font-size: 13px;
      margin-bottom: 6px;
      color: var(--vscode-foreground);
    }
    .settings-select {
      width: 100%;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
    }
    .settings-select:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    .settings-input {
      width: 100%;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 13px;
    }
    .settings-input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    .settings-input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    .settings-hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 6px;
    }
    .settings-footer {
      padding: 16px 20px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
    .settings-btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      border: none;
      transition: background 0.15s;
    }
    .settings-btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .settings-btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .settings-btn-secondary {
      background: transparent;
      color: var(--vscode-foreground);
      border: 1px solid var(--vscode-input-border);
    }
    .settings-btn-secondary:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }
    .api-key-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      margin-top: 8px;
    }
    .api-key-status.set {
      color: var(--vscode-terminal-ansiGreen);
    }
    .api-key-status.not-set {
      color: var(--vscode-errorForeground);
    }
    
    /* 确认对话框 */
    .confirm-dialog-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 200;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .confirm-dialog {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      min-width: 300px;
      max-width: 400px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    .confirm-dialog-content {
      padding: 20px;
    }
    .confirm-dialog h3 {
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .confirm-dialog p {
      margin: 0 0 20px 0;
      font-size: 14px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
    }
    .confirm-dialog-buttons {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
    .confirm-btn-cancel,
    .confirm-btn-delete {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    .confirm-btn-cancel {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .confirm-btn-cancel:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .confirm-btn-delete {
      background: var(--vscode-errorForeground);
      color: var(--vscode-button-foreground);
    }
    .confirm-btn-delete:hover {
      background: var(--vscode-errorForeground);
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <select id="modeSelect" title="选择模式">
      <option value="react">💬 对话</option>
      <option value="plan">📋 计划</option>
    </select>
    <div class="toolbar-spacer"></div>
    <button class="toolbar-btn" id="newChatBtn" title="New Chat">➕</button>
    <button class="toolbar-btn" id="historyBtn" title="History">�</button>
    <button class="toolbar-btn" id="settingsBtn" title="Settings">⚙️</button>
  </div>

  <div class="token-usage" id="tokenUsage">
    <div>Token 使用: <span id="tokenCurrent">0</span> / <span id="tokenLimit">8192</span></div>
    <div class="token-usage-bar">
      <div class="token-usage-progress">
        <div class="token-usage-fill" id="tokenFill" style="width: 0%"></div>
      </div>
      <div class="token-usage-text"><span id="tokenPercentage">0</span>%</div>
    </div>
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
      <button class="cancel-btn" id="cancelBtn">⏹ 停止</button>
    </div>
  </div>

  <!-- 历史对话面板 -->
  <div class="history-overlay" id="historyOverlay">
    <div class="history-panel">
      <div class="history-header">
        <div class="history-title">📜对话</div>
        <button class="history-close" id="historyClose">×</button>
      </div>
      <div class="history-list" id="historyList">
        <div class="history-empty">暂无历史对话</div>
      </div>
    </div>
  </div>

  <!-- 设置面板 -->
  <div class="settings-overlay" id="settingsOverlay">
    <div class="settings-panel">
      <div class="settings-header">
        <div class="settings-title">⚙️ 设置</div>
        <button class="settings-close" id="settingsClose">×</button>
      </div>
      <div class="settings-body">
        <div class="settings-section">
          <div class="settings-section-title">API 配置</div>
          <div class="settings-field">
            <label class="settings-label">LLM 提供商</label>
            <select class="settings-select" id="providerSelect">
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic Claude</option>
            </select>
          </div>
          <div class="settings-field">
            <label class="settings-label">API 密钥</label>
            <input type="password" class="settings-input" id="apiKeyInput" placeholder="输入 API 密钥...">
            <div class="api-key-status not-set" id="apiKeyStatus">
              <span>⚠️</span> 未设置
            </div>
            <div class="settings-hint">密钥将安全存储在 VSCode 密钥库中</div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">模型设置</div>
          <div class="settings-field">
            <label class="settings-label">模型名称</label>
            <select class="settings-select" id="modelSelect">
              <optgroup label="Gemini 模型" id="geminiModels">
                <option value="gemini-2.5-flash">gemini-2.5-flash (推荐)</option>
                <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                <option value="gemini-1.5-pro">gemini-1.5-pro</option>
              </optgroup>
              <optgroup label="OpenAI 模型" id="openaiModels" style="display:none">
                <option value="gpt-4o">gpt-4o (推荐)</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4-turbo">gpt-4-turbo</option>
                <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
              </optgroup>
              <optgroup label="Anthropic 模型" id="anthropicModels" style="display:none">
                <option value="claude-sonnet-4-20250514">claude-sonnet-4 (推荐)</option>
                <option value="claude-3-5-sonnet-20241022">claude-3.5-sonnet</option>
                <option value="claude-3-opus-20240229">claude-3-opus</option>
                <option value="claude-3-haiku-20240307">claude-3-haiku</option>
              </optgroup>
            </select>
          </div>
        </div>
      </div>
      <div class="settings-footer">
        <button class="settings-btn settings-btn-secondary" id="settingsCancel">取消</button>
        <button class="settings-btn settings-btn-primary" id="settingsSave">保存设置</button>
      </div>
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
      
      var isProcessing = false;
      var currentAssistantMessage = null;
      var cancelBtn = document.getElementById('cancelBtn');

      function setProcessing(processing) {
        isProcessing = processing;
        sendBtn.disabled = processing;
        if (processing) {
          sendBtn.style.display = 'none';
          cancelBtn.classList.add('show');
        } else {
          sendBtn.style.display = 'block';
          cancelBtn.classList.remove('show');
        }
      }

      function sendMessage() {
        var content = inputEl.value.trim();
        if (!content || isProcessing) return;
        
        var empty = document.getElementById('emptyState');
        if (empty) empty.remove();
        
        addMessage('user', content);
        vscode.postMessage({ type: 'user_message', content: content });
        inputEl.value = '';
        setProcessing(true);
        currentAssistantMessage = null;
      }
      
      cancelBtn.onclick = function() {
        vscode.postMessage({ type: 'cancel' });
        setProcessing(false);
        
        // 移除最后一条用户消息（被取消的请求）
        removeLastUserMessage();
        
        addMessage('error', '⏹ 已停止生成');
      };

      // 移除最后一条用户消息的函数
      function removeLastUserMessage() {
        var messages = messagesEl.children;
        for (var i = messages.length - 1; i >= 0; i--) {
          var msg = messages[i];
          if (msg.classList && msg.classList.contains('message') && msg.classList.contains('user')) {
            console.log('[UI] 移除被取消的用户消息:', msg.textContent.substring(0, 50));
            msg.remove();
            break;
          }
        }
      }

      function formatText(text) {
        if (!text) return '';
        // 移除 Markdown 符号 - 使用 split/join 一次性替换
        text = text.split('**').join('');
        text = text.split('*').join('');
        return text.trim();
      }

      function addMessage(type, content, rawContent) {
        var empty = document.getElementById('emptyState');
        if (empty) empty.remove();
        
        var div = document.createElement('div');
        div.className = 'message ' + type;
        div.innerHTML = formatText(content || '').split('\\n').join('<br>');
        
        // 为 assistant 消息添加复制按钮
        if (type === 'assistant') {
          var copyBtn = document.createElement('button');
          copyBtn.className = 'copy-btn';
          copyBtn.innerHTML = '📋';
          copyBtn.title = '复制';
          copyBtn.setAttribute('data-content', rawContent || content || '');
          copyBtn.onclick = function(e) {
            e.stopPropagation();
            var textToCopy = copyBtn.getAttribute('data-content');
            navigator.clipboard.writeText(textToCopy).then(function() {
              copyBtn.innerHTML = '✓';
              copyBtn.classList.add('copied');
              setTimeout(function() {
                copyBtn.innerHTML = '📋';
                copyBtn.classList.remove('copied');
              }, 1500);
            });
          };
          div.appendChild(copyBtn);
        }
        
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return div;
      }

      function addThought(content) {
        var empty = document.getElementById('emptyState');
        if (empty) empty.remove();
        
        var div = document.createElement('div');
        div.className = 'message thought';
        
        var header = document.createElement('div');
        header.className = 'thought-header';
        header.innerHTML = '<span class="thought-arrow">▶</span><span class="thought-title">💭 思考中...</span>';
        
        var contentDiv = document.createElement('div');
        contentDiv.className = 'thought-content';
        contentDiv.innerHTML = formatText(content || '').split('\\n').join('<br>');
        
        header.onclick = function() {
          var arrow = header.querySelector('.thought-arrow');
          var isExpanded = contentDiv.classList.contains('show');
          if (isExpanded) {
            contentDiv.classList.remove('show');
            arrow.classList.remove('expanded');
          } else {
            contentDiv.classList.add('show');
            arrow.classList.add('expanded');
          }
        };
        
        div.appendChild(header);
        div.appendChild(contentDiv);
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return div;
      }

      // 绑定按钮事件
      sendBtn.onclick = function() { sendMessage(); };
      
      // 设置面板元素
      var settingsOverlay = document.getElementById('settingsOverlay');
      var settingsClose = document.getElementById('settingsClose');
      var settingsCancel = document.getElementById('settingsCancel');
      var settingsSave = document.getElementById('settingsSave');
      var providerSelect = document.getElementById('providerSelect');
      var apiKeyInput = document.getElementById('apiKeyInput');
      var modelSelect = document.getElementById('modelSelect');
      
      // 模型选项配置
      var modelOptions = {
        gemini: [
          { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
          { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
          { value: 'gemini-2.5-pro-preview', label: 'gemini-2.5-pro-preview' },
          { value: 'gemini-2.5-flash-preview-image', label: 'gemini-2.5-flash-preview-image' }
        ],
        openai: [],
        anthropic: []
      };
      
      function updateModelOptions(provider) {
        modelSelect.innerHTML = '';
        var options = modelOptions[provider] || modelOptions.gemini;
        for (var i = 0; i < options.length; i++) {
          var opt = document.createElement('option');
          opt.value = options[i].value;
          opt.textContent = options[i].label;
          modelSelect.appendChild(opt);
        }
      }
      
      providerSelect.onchange = function() {
        updateModelOptions(providerSelect.value);
      };
      
      settingsBtn.onclick = function() {
        updateModelOptions(providerSelect.value);
        settingsOverlay.classList.add('show');
      };
      
      settingsClose.onclick = function() {
        settingsOverlay.classList.remove('show');
      };
      
      settingsCancel.onclick = function() {
        settingsOverlay.classList.remove('show');
      };
      
      settingsOverlay.onclick = function(e) {
        if (e.target === settingsOverlay) {
          settingsOverlay.classList.remove('show');
        }
      };
      
      settingsSave.onclick = function() {
        var provider = providerSelect.value;
        var apiKey = apiKeyInput.value.trim();
        var model = modelSelect.value;
        
        if (apiKey) {
          vscode.postMessage({ 
            type: 'save_settings', 
            provider: provider,
            apiKey: apiKey,
            model: model
          });
          apiKeyInput.value = '';
          settingsOverlay.classList.remove('show');
        } else {
          // 提示用户输入密钥
          apiKeyInput.style.borderColor = 'var(--vscode-errorForeground)';
          apiKeyInput.placeholder = '请输入 API 密钥！';
          setTimeout(function() {
            apiKeyInput.style.borderColor = '';
            apiKeyInput.placeholder = '输入 API 密钥...';
          }, 2000);
        }
      };
      
      // 新建对话按钮
      var newChatBtn = document.getElementById('newChatBtn');
      newChatBtn.onclick = function() {
        messagesEl.innerHTML = '<div class="empty-state" id="emptyState"><div class="empty-state-icon">🤖</div><div class="empty-state-text">开始对话吧！</div></div>';
        document.getElementById('tokenUsage').classList.remove('show');
        vscode.postMessage({ type: 'new_conversation' });
      };

      // 历史对话按钮
      var historyBtn = document.getElementById('historyBtn');
      historyBtn.textContent = '📜'; // Fix history button icon
      var historyOverlay = document.getElementById('historyOverlay');
      var historyClose = document.getElementById('historyClose');
      var historyList = document.getElementById('historyList');

      historyBtn.onclick = function() {
        vscode.postMessage({ type: 'list_conversations' });
        historyOverlay.classList.add('show');
      };

      historyClose.onclick = function() {
        historyOverlay.classList.remove('show');
      };

      historyOverlay.onclick = function(e) {
        if (e.target === historyOverlay) {
          historyOverlay.classList.remove('show');
        }
      };

      function renderHistoryList(conversations) {
        if (!conversations || conversations.length === 0) {
          historyList.innerHTML = '<div class="history-empty">暂无历史对话</div>';
          return;
        }

        historyList.innerHTML = conversations.map(function(conv) {
          var date = new Date(conv.updatedAt).toLocaleString();
          return '<div class="history-item" data-id="' + conv.id + '">' +
            '<div class="history-item-info">' +
            '<div class="history-item-title">' + conv.title + '</div>' +
            '<div class="history-item-meta">' + conv.messageCount + ' 条消息 · ' + date + '</div>' +
            '</div>' +
            '<button class="history-item-delete" data-id="' + conv.id + '">🗑️</button>' +
            '</div>';
        }).join('');

        // 绑定点击事件
        historyList.querySelectorAll('.history-item').forEach(function(item) {
          item.onclick = function(e) {
            if (e.target.classList.contains('history-item-delete')) {
              e.stopPropagation();
              var id = e.target.getAttribute('data-id');
              console.log('[ChatPanel] 点击删除按钮，对话ID:', id);
              
              // 创建自定义确认对话框
              var confirmDialog = document.createElement('div');
              confirmDialog.className = 'confirm-dialog-overlay';
              confirmDialog.innerHTML = 
                '<div class="confirm-dialog">' +
                  '<div class="confirm-dialog-content">' +
                    '<h3>确认删除</h3>' +
                    '<p>确定要删除这个对话吗？此操作无法撤销。</p>' +
                    '<div class="confirm-dialog-buttons">' +
                      '<button class="confirm-btn-cancel">取消</button>' +
                      '<button class="confirm-btn-delete">删除</button>' +
                    '</div>' +
                  '</div>' +
                '</div>';
              
              document.body.appendChild(confirmDialog);
              
              // 绑定按钮事件
              confirmDialog.querySelector('.confirm-btn-cancel').onclick = function() {
                console.log('[ChatPanel] 用户取消删除');
                document.body.removeChild(confirmDialog);
              };
              
              confirmDialog.querySelector('.confirm-btn-delete').onclick = function() {
                console.log('[ChatPanel] 用户确认删除，发送删除消息');
                vscode.postMessage({ type: 'delete_conversation', id: id });
                document.body.removeChild(confirmDialog);
              };
              
              // 点击背景关闭
              confirmDialog.onclick = function(e) {
                if (e.target === confirmDialog) {
                  document.body.removeChild(confirmDialog);
                }
              };
            } else {
              var id = item.getAttribute('data-id');
              vscode.postMessage({ type: 'load_conversation', id: id });
              historyOverlay.classList.remove('show');
            }
          };
        });
      }
      
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
          
          // 只显示思考过程和最终答案，隐藏工具调用细节
          if (evt.type === 'thought') {
            addThought(evt.content);
          } else if (evt.type === 'answer') {
            if (!currentAssistantMessage) {
              addMessage('assistant', evt.content, evt.content);
            } else {
              // 更新复制按钮的内容
              var copyBtn = currentAssistantMessage.querySelector('.copy-btn');
              if (copyBtn) {
                copyBtn.setAttribute('data-content', currentAssistantMessage.innerText);
              }
            }
            currentAssistantMessage = null;
            setProcessing(false);
          } else if (evt.type === 'error') {
            addMessage('error', '❌ ' + evt.message);
            setProcessing(false);
          } else if (evt.type === 'token') {
            if (!currentAssistantMessage) {
              currentAssistantMessage = addMessage('assistant', '', '');
            }
            var tokenContent = evt.content;
            if (tokenContent) {
              // 处理换行符，保留复制按钮
              var copyBtn = currentAssistantMessage.querySelector('.copy-btn');
              tokenContent = tokenContent.split('\\n').join('<br>');
              if (copyBtn) {
                copyBtn.remove();
              }
              currentAssistantMessage.innerHTML = currentAssistantMessage.innerHTML + tokenContent;
              if (copyBtn) {
                currentAssistantMessage.appendChild(copyBtn);
              }
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
          } else if (evt.type === 'skill') {
            // 显示 skill 使用提示
            var skillDiv = document.createElement('div');
            skillDiv.className = 'message skill';
            skillDiv.innerHTML = '<span class="skill-icon">🎯</span><div class="skill-info"><div class="skill-name">使用 Skill: ' + evt.name + '</div>' + (evt.description ? '<div class="skill-desc">' + evt.description + '</div>' : '') + '</div>';
            messagesEl.appendChild(skillDiv);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          } else if (evt.type === 'token_usage') {
            // 显示 Token 使用情况
            var tokenUsageEl = document.getElementById('tokenUsage');
            var tokenCurrentEl = document.getElementById('tokenCurrent');
            var tokenLimitEl = document.getElementById('tokenLimit');
            var tokenPercentageEl = document.getElementById('tokenPercentage');
            var tokenFillEl = document.getElementById('tokenFill');
            
            tokenCurrentEl.textContent = evt.current;
            tokenLimitEl.textContent = evt.limit;
            tokenPercentageEl.textContent = Math.round(evt.percentage);
            tokenFillEl.style.width = evt.percentage + '%';
            
            // 根据使用百分比改变颜色
            tokenFillEl.classList.remove('warning', 'danger');
            if (evt.percentage >= 90) {
              tokenFillEl.classList.add('danger');
            } else if (evt.percentage >= 75) {
              tokenFillEl.classList.add('warning');
            }
            
            // 显示 Token 使用区域
            tokenUsageEl.classList.add('show');
          }
          // action, observation, plan, step_complete 等技术细节不显示
        } else if (message.type === 'conversation_list') {
          // 渲染历史对话列表
          renderHistoryList(message.conversations);
        } else if (message.type === 'conversation_loaded') {
          // 加载对话消息
          var empty = document.getElementById('emptyState');
          if (empty) empty.remove();
          messagesEl.innerHTML = '';
          
          message.messages.forEach(function(msg) {
            addMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content, msg.content);
          });
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
