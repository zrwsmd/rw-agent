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
  | { type: 'user_message'; content: string; images?: Array<{ mimeType: string; data: string }> }
  | { type: 'agent_event'; event: AgentEvent }
  | { type: 'clear_chat' }
  | { type: 'cancel' }
  | { type: 'set_mode'; mode: AgentMode }
  | { type: 'open_settings' }
    | { type: 'save_settings'; provider: string; apiKey: string; model: string; baseUrl?: string }
    | { type: 'get_current_settings' }
    | { type: 'current_settings'; provider: string; model: string; hasApiKey: boolean; baseUrl?: string }
  | { type: 'ready' }
  | { type: 'new_conversation' }
  | { type: 'load_conversation'; id: string }
  | { type: 'delete_conversation'; id: string }
  | { type: 'list_conversations' }
  | { type: 'conversation_list'; conversations: ConversationItem[] }
  | { type: 'conversation_loaded'; messages: Array<{ role: string; content: string; toolCall?: { name: string; parameters: Record<string, unknown>; result: unknown } }> }
  | { type: 'confirm_action'; requestId: string; title: string; description: string; details: string; options: Array<{ id: string; label: string; primary?: boolean }> }
  | { type: 'confirm_response'; requestId: string; selectedOption: string }
  | { type: 'diff_preview'; requestId: string; filePath: string; diff: string; isNewFile: boolean; additions: number; deletions: number }
  | { type: 'diff_response'; requestId: string; confirmed: boolean }
  | { type: 'mcp_list_servers' }
  | { type: 'mcp_list_marketplace' }
  | { type: 'mcp_search'; query: string }
  | { type: 'mcp_start_server'; name: string }
  | { type: 'mcp_stop_server'; name: string }
  | { type: 'mcp_remove_server'; name: string }
  | { type: 'mcp_install_server'; name: string }
  | { type: 'mcp_add_server'; config: any }
  | { type: 'mcp_open_config' }
  | { type: 'mcp_servers_list'; servers: any[] }
  | { type: 'mcp_marketplace_list'; servers: any[] }
  | { type: 'mcp_server_status_changed'; status: any }
  | { type: 'save_input_text'; text: string }
  | { type: 'restore_input_text'; text: string }
  | { type: 'sync_processing_state'; isProcessing: boolean }
  | { type: 'get_templates' }
  | { type: 'templates_list'; templates: Array<{ id: string; name: string; icon: string; description: string; category: string }> }
  | { type: 'use_template'; templateId: string }
  | { type: 'template_content'; content: string }
  | { type: 'quick_command'; command: string; args: string[] }
  | { type: 'get_command_suggestions'; query: string }
  | { type: 'command_suggestions'; suggestions: Array<{ name: string; alias?: string; description: string; icon: string; category: string; example: string }> }
  | { type: 'command_error'; error: string; warning?: string };


/**
 * 聊天面板提供者
 */
export class ChatPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'vscode-agent.chatPanel';

  private _view?: vscode.WebviewView;
  private _messageHandler?: (message: UIMessage) => void;
  private _disposables: vscode.Disposable[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) { }

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

    // ✅ 保持 webview 在隐藏时的状态，防止切换视图时丢失执行状态
    (webviewView as any).retainContextWhenHidden = true;

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // ✅ Store disposable for cleanup
    const messageDisposable = webviewView.webview.onDidReceiveMessage(
      (message: UIMessage) => {
        if (this._messageHandler) {
          this._messageHandler(message);
        }
      }
    );
    this._disposables.push(messageDisposable);

    // ✅ Cleanup when view is disposed
    webviewView.onDidDispose(() => {
      this.dispose();
    });
  }

  /**
   * ✅ NEW: Proper cleanup
   */
  public dispose(): void {
    // Dispose all event listeners
    for (const disposable of this._disposables) {
      disposable.dispose();
    }
    this._disposables = [];
    this._view = undefined;
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://slelguoygbfzlpylpxfs.supabase.co; connect-src https://slelguoygbfzlpylpxfs.supabase.co; img-src data: ${webview.cspSource};">
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
    
    /* 工具调用提示 - 折叠样式 */
    .message.action {
      background: transparent;
      border: none;
      padding: 4px 0;
    }
    .tool-call-details {
      width: 100%;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--vscode-editor-background);
    }
    .tool-call-summary {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      cursor: pointer;
      user-select: none;
      list-style: none;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid transparent;
      transition: background 0.15s;
    }
    .tool-call-summary::-webkit-details-marker {
      display: none;
    }
    .tool-call-summary:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .tool-call-details[open] .tool-call-summary {
      border-bottom-color: var(--vscode-panel-border);
    }
    .tool-call-icon {
      font-size: 14px;
      opacity: 0.8;
    }
    .tool-call-name {
      flex: 1;
      font-size: 13px;
      font-weight: 500;
      color: var(--vscode-foreground);
    }
    .tool-call-arrow {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      transition: transform 0.2s;
    }
    .tool-call-details[open] .tool-call-arrow {
      transform: rotate(180deg);
    }
    .tool-call-content {
      padding: 12px 14px;
    }
    .tool-call-section {
      margin-bottom: 12px;
    }
    .tool-call-section:last-child {
      margin-bottom: 0;
    }
    .tool-call-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .tool-call-params {
      margin: 0;
      padding: 10px 12px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 6px;
      font-size: 12px;
      line-height: 1.5;
      overflow-x: auto;
      max-height: 300px;
      overflow-y: auto;
      color: var(--vscode-foreground);
    }
    
    /* 输入区域 */
    .input-container {
      position: relative;
      padding: var(--spacing);
      background: var(--vscode-sideBar-background);
      border-top: 1px solid var(--vscode-panel-border);
    }
    .image-preview-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
      padding: 10px;
      background: var(--vscode-input-background);
      border-radius: 10px;
      border: 1px solid var(--vscode-input-border);
    }
    .image-preview-container:empty {
      display: none;
      padding: 0;
      border: none;
    }
    .image-preview-item {
      position: relative;
      width: 72px;
      height: 72px;
      border-radius: 10px;
      overflow: hidden;
      border: 2px solid var(--vscode-panel-border);
      cursor: pointer;
      transition: all 0.2s ease;
      background: var(--vscode-editor-background);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }
    .image-preview-item:hover {
      border-color: var(--vscode-focusBorder);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    }
    .image-preview-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.2s ease;
    }
    .image-preview-item:hover img {
      transform: scale(1.05);
    }
    .image-preview-actions {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 6px;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .image-preview-item:hover .image-preview-actions {
      opacity: 1;
    }
    .image-preview-btn {
      width: 28px;
      height: 28px;
      background: rgba(255, 255, 255, 0.9);
      color: #333;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }
    .image-preview-btn:hover {
      background: white;
      transform: scale(1.1);
    }
    .image-preview-btn.remove:hover {
      background: var(--vscode-errorForeground);
      color: white;
    }
    .image-preview-btn.copied {
      background: var(--vscode-terminal-ansiGreen);
      color: white;
    }
    /* 图片放大弹窗 */
    .image-modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.92);
      z-index: 500;
      justify-content: center;
      align-items: center;
      flex-direction: column;
      gap: 20px;
      backdrop-filter: blur(4px);
    }
    .image-modal.show {
      display: flex;
      animation: modalFadeIn 0.2s ease;
    }
    @keyframes modalFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .image-modal img {
      max-width: 90%;
      max-height: 75%;
      border-radius: 12px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
      animation: imageZoomIn 0.25s ease;
    }
    @keyframes imageZoomIn {
      from { transform: scale(0.9); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    .image-modal-actions {
      display: flex;
      gap: 12px;
    }
    .image-modal-btn {
      padding: 12px 24px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s ease;
    }
    .image-modal-btn:hover {
      background: var(--vscode-button-hoverBackground);
      transform: translateY(-1px);
    }
    .image-modal-btn.secondary {
      background: rgba(255, 255, 255, 0.1);
      color: white;
    }
    .image-modal-btn.secondary:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .image-modal-btn.copied {
      background: var(--vscode-terminal-ansiGreen);
    }
    .image-modal-close {
      position: absolute;
      top: 20px;
      right: 20px;
      width: 44px;
      height: 44px;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      font-size: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }
    .image-modal-close:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: scale(1.1);
    }
    .input-wrapper {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    .upload-btn {
      background: transparent;
      color: var(--vscode-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 10px 12px;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 14px;
      transition: background 0.15s;
    }
    .upload-btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
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
    
    /* 快捷命令建议 */
    .command-suggestions {
      position: absolute;
      bottom: calc(100% + 8px);
      left: calc(var(--spacing) + 1px);
      right: calc(var(--spacing) + 1px);
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      max-height: 280px;
      overflow-y: auto;
      display: none;
      z-index: 1000;
      animation: slideInUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes slideInUp {
      from { transform: translateY(10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .command-suggestions.show {
      display: block;
    }
    .command-item {
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .command-item:last-child {
      border-bottom: none;
    }
    .command-item:hover, .command-item.selected {
      background: var(--vscode-list-hoverBackground);
    }
    .command-item-icon {
      font-size: 18px;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(128, 128, 128, 0.1);
      border-radius: 6px;
    }
    .command-item-info {
      flex: 1;
      min-width: 0;
    }
    .command-item-name {
      font-weight: 600;
      font-size: 13px;
      color: var(--vscode-foreground);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .command-item-alias {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-weight: normal;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .command-item-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .command-item-example {
      font-size: 11px;
      color: var(--vscode-textLink-foreground);
      opacity: 0.8;
      font-family: var(--vscode-editor-font-family);
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
    
    /* MCP 管理样式 */
    .mcp-tabs {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 16px;
    }
    .tab-button {
      background: none;
      border: none;
      padding: 8px 16px;
      cursor: pointer;
      color: var(--vscode-descriptionForeground);
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
    }
    .tab-button.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-focusBorder);
    }
    .tab-button:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }
    .search-box {
      margin-bottom: 16px;
    }
    .mcp-server-item {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 8px;
      background: var(--vscode-editor-background);
    }
    .mcp-server-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .mcp-server-info {
      flex: 1;
    }
    .mcp-server-name {
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 4px;
    }
    .mcp-server-description {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .mcp-server-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    /* 开关样式 */
    .mcp-switch {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 20px;
      cursor: pointer;
    }
    .mcp-switch-input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .mcp-switch-slider {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      border-radius: 20px;
      transition: all 0.3s ease;
    }
    .mcp-switch-slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 2px;
      bottom: 2px;
      background-color: white;
      border-radius: 50%;
      transition: all 0.3s ease;
    }
    .mcp-switch-slider.switch-off {
      background-color: #555;
    }
    .mcp-switch-slider.switch-on {
      background-color: #4caf50;
    }
    .mcp-switch-slider.switch-on:before {
      transform: translateX(20px);
    }
    .mcp-switch-slider.switch-error {
      background-color: #f44336;
    }
    .mcp-delete-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      font-size: 14px;
      opacity: 0.6;
      transition: opacity 0.2s;
    }
    .mcp-delete-btn:hover {
      opacity: 1;
    }
    .mcp-action-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      transition: background 0.15s;
    }
    .mcp-action-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .mcp-action-btn.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .mcp-action-btn.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .marketplace-server-item {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 8px;
      background: var(--vscode-editor-background);
    }
    .marketplace-server-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    .marketplace-server-info h4 {
      margin: 0 0 4px 0;
      color: var(--vscode-foreground);
      font-size: 14px;
    }
    .marketplace-server-tags {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .marketplace-tag {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 10px;
    }
    .loading-text {
      text-align: center;
      color: var(--vscode-descriptionForeground);
      padding: 20px;
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
    
    /* 确认对话框样式 */
    .confirm-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 300;
      display: flex;
      justify-content: center;
      align-items: center;
      backdrop-filter: blur(2px);
    }
    .confirm-dialog-container {
      width: 90%;
      max-width: 600px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
    }
    .confirm-dialog {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      max-height: 100%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      overflow: hidden;
    }
    .confirm-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    .confirm-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .confirm-close {
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 6px;
      border-radius: 6px;
      font-size: 20px;
      opacity: 0.7;
      transition: all 0.2s;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .confirm-close:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground);
    }
    .confirm-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .confirm-description {
      font-size: 16px;
      color: var(--vscode-foreground);
      line-height: 1.5;
      font-weight: 500;
    }
    .confirm-details-container {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .confirm-details {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 8px;
      padding: 16px;
      margin: 0;
      font-size: 13px;
      color: var(--vscode-foreground);
      font-family: var(--vscode-editor-font-family);
      overflow-y: auto;
      flex: 1;
      line-height: 1.5;
      min-height: 100px;
    }
    .confirm-footer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 20px 24px;
      border-top: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    .confirm-option-btn {
      padding: 14px 20px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      text-align: left;
      background: var(--vscode-input-background);
      color: var(--vscode-foreground);
      position: relative;
    }
    .confirm-option-btn:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }
    .confirm-option-btn.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    .confirm-option-btn.primary:hover {
      background: var(--vscode-button-hoverBackground);
      border-color: var(--vscode-button-hoverBackground);
    }
    .confirm-option-btn:focus {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
    
    /* Diff 预览对话框样式 */
    .diff-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 400;
      display: flex;
      justify-content: center;
      align-items: center;
      backdrop-filter: blur(3px);
    }
    .diff-dialog {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      width: 90%;
      max-width: 800px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.6);
      overflow: hidden;
    }
    .diff-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .diff-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 15px;
      font-weight: 600;
    }
    .diff-icon {
      font-size: 18px;
    }
    .diff-badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 12px;
      font-weight: 500;
    }
    .diff-badge.new {
      background: rgba(40, 167, 69, 0.2);
      color: #28a745;
    }
    .diff-badge.modified {
      background: rgba(255, 193, 7, 0.2);
      color: #ffc107;
    }
    .diff-close {
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 6px;
      border-radius: 6px;
      font-size: 18px;
      opacity: 0.6;
      transition: all 0.2s;
    }
    .diff-close:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground);
    }
    .diff-content {
      flex: 1;
      overflow-y: auto;
      font-family: var(--vscode-editor-font-family);
      font-size: 13px;
      line-height: 1.5;
      min-height: 150px;
      max-height: 400px;
      padding: 8px 0;
    }
    .diff-hunk {
      margin: 8px 16px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      overflow: hidden;
    }
    .diff-hunk-header {
      background: var(--vscode-textCodeBlock-background);
      color: var(--vscode-descriptionForeground);
      padding: 6px 12px;
      font-size: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .diff-line {
      display: flex;
      padding: 1px 0;
    }
    .diff-line-num {
      width: 40px;
      text-align: right;
      padding: 0 8px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-sideBar-background);
      user-select: none;
      font-size: 12px;
      flex-shrink: 0;
    }
    .diff-line-content {
      flex: 1;
      padding: 0 12px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .diff-line.added {
      background: rgba(40, 167, 69, 0.15);
    }
    .diff-line.added .diff-line-content {
      color: #3fb950;
    }
    .diff-line.added .diff-line-num {
      background: rgba(40, 167, 69, 0.25);
      color: #3fb950;
    }
    .diff-line.removed {
      background: rgba(248, 81, 73, 0.15);
    }
    .diff-line.removed .diff-line-content {
      color: #f85149;
    }
    .diff-line.removed .diff-line-num {
      background: rgba(248, 81, 73, 0.25);
      color: #f85149;
    }
    .diff-line.context {
      background: transparent;
    }
    .diff-line.context .diff-line-content {
      color: var(--vscode-descriptionForeground);
    }
    .diff-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      background: var(--vscode-sideBar-background);
      border-top: 1px solid var(--vscode-panel-border);
    }
    .diff-stats {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }
    .diff-stats .added { color: #28a745; }
    .diff-stats .removed { color: #dc3545; }
    .diff-actions {
      display: flex;
      gap: 10px;
    }
    .diff-btn {
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
    }
    .diff-btn-secondary {
      background: var(--vscode-input-background);
      color: var(--vscode-foreground);
      border: 1px solid var(--vscode-input-border);
    }
    .diff-btn-secondary:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .diff-btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .diff-btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    
    /* 提示词模板面板样式 */
    .template-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 350;
      justify-content: center;
      align-items: center;
      backdrop-filter: blur(2px);
    }
    .template-overlay.show {
      display: flex;
    }
    .template-panel {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      width: 90%;
      max-width: 500px;
      max-height: 70vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      overflow: hidden;
    }
    .template-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    .template-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .template-close {
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 6px;
      border-radius: 6px;
      font-size: 18px;
      opacity: 0.7;
      transition: all 0.2s;
    }
    .template-close:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground);
    }
    .template-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    .template-section {
      margin-bottom: 20px;
    }
    .template-section:last-child {
      margin-bottom: 0;
    }
    .template-section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
      letter-spacing: 0.5px;
    }
    .template-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .template-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .template-item:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
      transform: translateX(4px);
    }
    .template-item-icon {
      font-size: 20px;
      flex-shrink: 0;
    }
    .template-item-info {
      flex: 1;
      min-width: 0;
    }
    .template-item-name {
      font-size: 14px;
      font-weight: 500;
      color: var(--vscode-foreground);
      margin-bottom: 2px;
    }
    .template-item-desc {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .template-item-arrow {
      color: var(--vscode-descriptionForeground);
      font-size: 14px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .template-item:hover .template-item-arrow {
      opacity: 1;
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
    <button class="toolbar-btn" id="historyBtn" title="History"></button>
    <button class="toolbar-btn" id="mcpBtn" title="MCP Servers">🔌</button>
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
    <div class="command-suggestions" id="commandSuggestions"></div>
    <div class="image-preview-container" id="imagePreviewContainer"></div>
    <div class="input-wrapper">
      <input type="file" id="imageInput" accept="image/*" multiple style="display: none;">
      <button class="upload-btn" id="uploadBtn" title="上传图片 (或 Ctrl+V 粘贴)">📷</button>
      <button class="upload-btn" id="templateBtn" title="提示词模板">📝</button>
      <textarea id="input" placeholder="输入消息，按 Enter 发送，Ctrl+V 粘贴图片..." rows="1"></textarea>
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

  <!-- 图片放大弹窗 -->
  <div class="image-modal" id="imageModal">
    <button class="image-modal-close" id="imageModalClose">×</button>
    <img id="imageModalImg" src="" alt="Preview">
    <div class="image-modal-actions">
      <button class="image-modal-btn" id="imageModalCopy">📋 复制图片</button>
      <button class="image-modal-btn secondary" id="imageModalCloseBtn">关闭</button>
    </div>
  </div>

  <!-- 确认对话框 -->
  <div class="confirm-overlay" id="confirmOverlay" style="display: none;">
    <div class="confirm-dialog-container">
      <div class="confirm-dialog">
        <div class="confirm-header">
          <div class="confirm-title" id="confirmTitle">确认操作</div>
          <button class="confirm-close" id="confirmClose">×</button>
        </div>
        <div class="confirm-body">
          <div class="confirm-description" id="confirmDescription"></div>
          <div class="confirm-details-container">
            <pre class="confirm-details" id="confirmDetails"></pre>
          </div>
        </div>
        <div class="confirm-footer" id="confirmFooter"></div>
      </div>
    </div>
  </div>

  <!-- Diff 预览对话框 -->
  <div class="diff-overlay" id="diffOverlay" style="display: none;">
    <div class="diff-dialog">
      <div class="diff-header">
        <div class="diff-title">
          <span class="diff-icon" id="diffIcon">📄</span>
          <span id="diffFileName">file.txt</span>
          <span class="diff-badge" id="diffBadge">新建</span>
        </div>
        <button class="diff-close" id="diffClose">×</button>
      </div>
      <div class="diff-content" id="diffContent"></div>
      <div class="diff-footer">
        <div class="diff-stats" id="diffStats">+0 -0</div>
        <div class="diff-actions">
          <button class="diff-btn diff-btn-secondary" id="diffReject">✕ 拒绝</button>
          <button class="diff-btn diff-btn-primary" id="diffConfirm">✓ 确认写入</button>
        </div>
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
                <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
                <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
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

  <!-- MCP 服务器面板 -->
  <div class="settings-overlay" id="mcpOverlay">
    <div class="settings-panel">
      <div class="settings-header">
        <div class="settings-title">🔌 MCP 服务器</div>
        <button class="settings-close" id="mcpClose">×</button>
      </div>
      <div class="settings-body">
        <div class="settings-section">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div class="settings-section-title" style="margin-bottom: 0;">已配置的服务器</div>
            <button class="settings-btn settings-btn-secondary" id="addMcpServerBtn" style="padding: 6px 12px; font-size: 12px;">📝 编辑配置</button>
          </div>
          <div class="mcp-servers-list" id="mcpServersList">
            <div class="loading-text">加载中...</div>
          </div>
        </div>
      </div>
      <div class="settings-footer">
        <button class="settings-btn settings-btn-secondary" id="mcpRefreshBtn">🔄 刷新</button>
        <button class="settings-btn settings-btn-primary" id="mcpCloseBtn">关闭</button>
      </div>
    </div>
  </div>

  <!-- 提示词模板面板 -->
  <div class="template-overlay" id="templateOverlay">
    <div class="template-panel">
      <div class="template-header">
        <div class="template-title">📝 提示词模板</div>
        <button class="template-close" id="templateClose">×</button>
      </div>
      <div class="template-body">
        <div class="template-section">
          <div class="template-section-title">内置模板</div>
          <div class="template-list" id="builtinTemplates"></div>
        </div>
        <div class="template-section" id="customTemplatesSection" style="display: none;">
          <div class="template-section-title">自定义模板</div>
          <div class="template-list" id="customTemplates"></div>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      try {
        console.log('[ChatPanel] Script starting...');
        var vscode = acquireVsCodeApi();
        
        // ✅ 恢复之前保存的状态
        var previousState = vscode.getState() || {};
        console.log('[ChatPanel] Restored state:', previousState);
        
        var messagesEl = document.getElementById('messages');
        var inputEl = document.getElementById('input');
        var sendBtn = document.getElementById('sendBtn');
        var modeSelect = document.getElementById('modeSelect');
        var settingsBtn = document.getElementById('settingsBtn');
        
        console.log('[ChatPanel] Elements found:', {
          messagesEl: !!messagesEl,
          inputEl: !!inputEl,
          sendBtn: !!sendBtn,
          modeSelect: !!modeSelect,
          settingsBtn: !!settingsBtn
        });
      
      var isProcessing = previousState.isProcessing || false;
      var currentAssistantMessage = null;
      var cancelBtn = document.getElementById('cancelBtn');
      var uploadBtn = document.getElementById('uploadBtn');
      var imageInput = document.getElementById('imageInput');
      var imagePreviewContainer = document.getElementById('imagePreviewContainer');
      var pendingImages = []; // 存储待发送的图片 { mimeType, data }
      
      // ✅ 快捷命令建议相关
      var commandSuggestionsEl = document.getElementById('commandSuggestions');
      var currentSuggestions = [];
      var selectedSuggestionIndex = -1;
      var lastQuery = '';

      // ✅ 保存状态的函数
      function saveState() {
        vscode.setState({
          isProcessing: isProcessing,
          messagesHtml: messagesEl.innerHTML
        });
      }

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
        // ✅ 保存状态
        saveState();
      }
      
      // ✅ 恢复 UI 状态
      if (previousState.isProcessing) {
        setProcessing(true);
      }
      if (previousState.messagesHtml) {
        messagesEl.innerHTML = previousState.messagesHtml;
        // 找到最后一个 assistant 消息作为 currentAssistantMessage
        var assistantMsgs = messagesEl.querySelectorAll('.message.assistant');
        if (assistantMsgs.length > 0) {
          currentAssistantMessage = assistantMsgs[assistantMsgs.length - 1];
        }
      }



      // 图片模态框相关
      var imageModal = document.getElementById('imageModal');
      var imageModalImg = document.getElementById('imageModalImg');
      var imageModalClose = document.getElementById('imageModalClose');
      var imageModalCloseBtn = document.getElementById('imageModalCloseBtn');
      var imageModalCopy = document.getElementById('imageModalCopy');
      var currentImageData = null; // { mimeType, data }

      function showImageModal(mimeType, base64Data) {
        currentImageData = { mimeType: mimeType, data: base64Data };
        imageModalImg.src = 'data:' + mimeType + ';base64,' + base64Data;
        imageModal.classList.add('show');
        imageModalCopy.innerHTML = '📋 复制图片';
        imageModalCopy.classList.remove('copied');
      }

      function hideImageModal() {
        imageModal.classList.remove('show');
        currentImageData = null;
      }

      imageModalClose.onclick = hideImageModal;
      imageModalCloseBtn.onclick = hideImageModal;
      imageModal.onclick = function(e) {
        if (e.target === imageModal) hideImageModal();
      };

      // 复制图片到剪贴板
      async function copyImageToClipboard(mimeType, base64Data) {
        try {
          var byteCharacters = atob(base64Data);
          var byteNumbers = new Array(byteCharacters.length);
          for (var i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          var byteArray = new Uint8Array(byteNumbers);
          var blob = new Blob([byteArray], { type: mimeType });
          await navigator.clipboard.write([
            new ClipboardItem({ [mimeType]: blob })
          ]);
          return true;
        } catch (err) {
          console.error('复制图片失败:', err);
          return false;
        }
      }

      imageModalCopy.onclick = async function() {
        if (currentImageData) {
          var success = await copyImageToClipboard(currentImageData.mimeType, currentImageData.data);
          if (success) {
            imageModalCopy.innerHTML = '✓ 已复制';
            imageModalCopy.classList.add('copied');
            setTimeout(function() {
              imageModalCopy.innerHTML = '📋 复制图片';
              imageModalCopy.classList.remove('copied');
            }, 2000);
          }
        }
      };

      // ESC 关闭模态框
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && imageModal.classList.contains('show')) {
          hideImageModal();
        }
      });

      // 添加图片到预览
      function addImagePreview(mimeType, base64Data) {
        var item = document.createElement('div');
        item.className = 'image-preview-item';
        
        var img = document.createElement('img');
        img.src = 'data:' + mimeType + ';base64,' + base64Data;
        
        var actions = document.createElement('div');
        actions.className = 'image-preview-actions';
        
        // 放大按钮
        var zoomBtn = document.createElement('button');
        zoomBtn.className = 'image-preview-btn';
        zoomBtn.innerHTML = '🔍';
        zoomBtn.title = '放大查看';
        zoomBtn.onclick = function(e) {
          e.stopPropagation();
          showImageModal(mimeType, base64Data);
        };
        
        // 复制按钮
        var copyBtn = document.createElement('button');
        copyBtn.className = 'image-preview-btn';
        copyBtn.innerHTML = '📋';
        copyBtn.title = '复制图片';
        copyBtn.onclick = async function(e) {
          e.stopPropagation();
          var success = await copyImageToClipboard(mimeType, base64Data);
          if (success) {
            copyBtn.innerHTML = '✓';
            copyBtn.classList.add('copied');
            setTimeout(function() {
              copyBtn.innerHTML = '📋';
              copyBtn.classList.remove('copied');
            }, 1500);
          }
        };
        
        // 删除按钮
        var removeBtn = document.createElement('button');
        removeBtn.className = 'image-preview-btn remove';
        removeBtn.innerHTML = '×';
        removeBtn.title = '删除';
        removeBtn.onclick = function(e) {
          e.stopPropagation();
          var index = Array.from(imagePreviewContainer.children).indexOf(item);
          if (index > -1) {
            pendingImages.splice(index, 1);
          }
          item.remove();
        };
        
        actions.appendChild(zoomBtn);
        actions.appendChild(copyBtn);
        actions.appendChild(removeBtn);
        
        item.appendChild(img);
        item.appendChild(actions);
        
        // 点击图片也可以放大
        item.onclick = function() {
          showImageModal(mimeType, base64Data);
        };
        
        imagePreviewContainer.appendChild(item);
        pendingImages.push({ mimeType: mimeType, data: base64Data });
      }

      // 处理文件选择
      function handleFiles(files) {
        for (var i = 0; i < files.length; i++) {
          var file = files[i];
          if (!file.type.startsWith('image/')) continue;
          var reader = new FileReader();
          reader.onload = (function(mimeType) {
            return function(e) {
              var base64 = e.target.result.split(',')[1];
              addImagePreview(mimeType, base64);
            };
          })(file.type);
          reader.readAsDataURL(file);
        }
      }

      // 上传按钮点击
      uploadBtn.onclick = function() {
        imageInput.click();
      };

      // 文件选择变化
      imageInput.onchange = function() {
        handleFiles(imageInput.files);
        imageInput.value = '';
      };

      // Ctrl+V 粘贴图片
      inputEl.addEventListener('paste', function(e) {
        var items = e.clipboardData.items;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            e.preventDefault();
            var file = items[i].getAsFile();
            handleFiles([file]);
            break;
          }
        }
      });

      function sendMessage() {
        var content = inputEl.value.trim();
        if ((!content && pendingImages.length === 0) || isProcessing) return;
        
        var empty = document.getElementById('emptyState');
        if (empty) empty.remove();
        
        // ✅ 检测快捷命令
        if (content.startsWith('/')) {
          // 解析命令
          var parts = content.substring(1).split(/\s+/);
          var command = parts[0].toLowerCase();
          var args = parts.slice(1);
          
          console.log('[ChatPanel] 检测到快捷命令:', command, args);
          
          // 显示用户输入的命令
          addMessage('user', content);
          
          // 发送快捷命令消息
          vscode.postMessage({
            type: 'quick_command',
            command: command,
            args: args
          });
          
          // 清空输入
          inputEl.value = '';
          vscode.postMessage({ type: 'save_input_text', text: '' });
          setProcessing(true);
          currentAssistantMessage = null;
          return;
        }
        
        // 显示用户消息（包含图片）
        addMessage('user', content, null, pendingImages);
        
        // 发送消息
        vscode.postMessage({ 
          type: 'user_message', 
          content: content,
          images: pendingImages.length > 0 ? pendingImages : undefined
        });
        
        // 清空
        inputEl.value = '';
        pendingImages = [];
        imagePreviewContainer.innerHTML = '';
        vscode.postMessage({ type: 'save_input_text', text: '' });
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

      function addMessage(type, content, rawContent, images) {
        var empty = document.getElementById('emptyState');
        if (empty) empty.remove();
        
        var div = document.createElement('div');
        div.className = 'message ' + type;
        
        // 如果有图片，先显示图片
        if (images && images.length > 0) {
          var imagesDiv = document.createElement('div');
          imagesDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;';
          for (var i = 0; i < images.length; i++) {
            (function(imgData) {
              var imgWrapper = document.createElement('div');
              imgWrapper.style.cssText = 'position: relative; display: inline-block;';
              
              var img = document.createElement('img');
              img.src = 'data:' + imgData.mimeType + ';base64,' + imgData.data;
              img.style.cssText = 'max-width: 200px; max-height: 150px; border-radius: 8px; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;';
              img.onmouseover = function() { this.style.transform = 'scale(1.02)'; this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)'; };
              img.onmouseout = function() { this.style.transform = 'scale(1)'; this.style.boxShadow = 'none'; };
              img.onclick = function() {
                showImageModal(imgData.mimeType, imgData.data);
              };
              
              imgWrapper.appendChild(img);
              imagesDiv.appendChild(imgWrapper);
            })(images[i]);
          }
          div.appendChild(imagesDiv);
        }
        
        // 添加文本内容
        if (content) {
          var textDiv = document.createElement('div');
          textDiv.innerHTML = formatText(content).split('\\n').join('<br>');
          div.appendChild(textDiv);
        }
        
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
        // ✅ 保存状态
        saveState();
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
        // ✅ 保存状态
        saveState();
        return div;
      }

      // 添加工具调用消息（折叠样式）
      function addToolCallMessage(toolName, params, result) {
        var empty = document.getElementById('emptyState');
        if (empty) empty.remove();
        
        var paramsStr = '';
        try {
          paramsStr = JSON.stringify(params, null, 2);
        } catch (e) {
          paramsStr = String(params);
        }
        
        // 解析工具名称，判断是否是 MCP 工具
        var isMCP = toolName.includes('_') && toolName.split('_').length >= 2;
        var displayName = toolName;
        var serverName = '';
        var actualToolName = toolName;
        
        if (isMCP) {
          var parts = toolName.split('_');
          serverName = parts[0];
          actualToolName = parts.slice(1).join('_');
          displayName = serverName + '/' + actualToolName;
        }
        
        var icon = '🔧';
        
        var actionDiv = document.createElement('div');
        actionDiv.className = 'message action';
        actionDiv.innerHTML = 
          '<details class="tool-call-details">' +
            '<summary class="tool-call-summary">' +
              '<span class="tool-call-icon">' + icon + '</span>' +
              '<span class="tool-call-name">' + displayName + '</span>' +
              '<span class="tool-call-arrow">▼</span>' +
            '</summary>' +
            '<div class="tool-call-content">' +
              '<div class="tool-call-section">' +
                '<div class="tool-call-label">Arguments</div>' +
                '<pre class="tool-call-params">' + paramsStr + '</pre>' +
              '</div>' +
            '</div>' +
          '</details>';
        messagesEl.appendChild(actionDiv);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        // ✅ 保存状态
        saveState();
        return actionDiv;
      }

      // 绑定按钮事件
      console.log('[ChatPanel] Binding button events...');
      if (sendBtn) {
        sendBtn.onclick = function() { 
          console.log('[ChatPanel] Send button clicked');
          sendMessage(); 
        };
        console.log('[ChatPanel] Send button event bound');
      } else {
        console.error('[ChatPanel] Send button not found!');
      }
      
        // 设置面板元素
        var settingsOverlay = document.getElementById('settingsOverlay');
        var settingsClose = document.getElementById('settingsClose');
        var settingsCancel = document.getElementById('settingsCancel');
        var settingsSave = document.getElementById('settingsSave');
        var providerSelect = document.getElementById('providerSelect');
        var apiKeyInput = document.getElementById('apiKeyInput');
        var modelSelect = document.getElementById('modelSelect');
        var baseUrlField = document.getElementById('baseUrlField');
        var baseUrlInput = document.getElementById('baseUrlInput');
        
        // 模型选项配置
        var modelOptions = {
          gemini: [
            { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
            { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
            { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
            { value: 'gemini-3-pro-preview', label: 'gemini-3-pro-preview' },
            { value: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
            { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
            { value: 'gemini-1.5-pro', label: 'gemini-1.5-pro' }
          ],
          openai: [
            { value: 'gpt-4o', label: 'gpt-4o (推荐)' },
            { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
            { value: 'o1-preview', label: 'o1-preview' },
            { value: 'o1-mini', label: 'o1-mini' }
          ],
          bailian: [
            { value: 'deepseek-v3', label: 'DeepSeek-V3' },
            { value: 'deepseek-r1', label: 'DeepSeek-R1' },
            { value: 'qwen-max', label: 'Qwen-Max' },
            { value: 'qwen-plus', label: 'Qwen-Plus' },
            { value: 'qwen-turbo', label: 'Qwen-Turbo' }
          ],
          anthropic: [
            { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
            { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
            { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' }
          ]
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
        
        if (settingsBtn) {
          settingsBtn.onclick = function() {
            console.log('[ChatPanel] Settings button clicked');
            // 请求当前设置
            vscode.postMessage({ type: 'get_current_settings' });
            settingsOverlay.classList.add('show');
          };
          console.log('[ChatPanel] Settings button event bound');
        } else {
          console.error('[ChatPanel] Settings button not found!');
        }
        
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
          
          // 检查是否已有 API Key
          var apiKeyStatus = document.getElementById('apiKeyStatus');
          var hasExistingKey = apiKeyStatus.classList.contains('set');
          
          if (apiKey || hasExistingKey) {
            vscode.postMessage({ 
              type: 'save_settings', 
              provider: provider,
              apiKey: apiKey, // 如果为空但有现有密钥，后端会保持现有密钥
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
      if (newChatBtn) {
        newChatBtn.onclick = function() {
          console.log('[ChatPanel] New chat button clicked');
          messagesEl.innerHTML = '<div class="empty-state" id="emptyState"><div class="empty-state-icon">🤖</div><div class="empty-state-text">开始对话吧！</div></div>';
          document.getElementById('tokenUsage').classList.remove('show');
          vscode.postMessage({ type: 'new_conversation' });
        };
        console.log('[ChatPanel] New chat button event bound');
      } else {
        console.error('[ChatPanel] New chat button not found!');
      }

      // 历史对话按钮
      var historyBtn = document.getElementById('historyBtn');
      historyBtn.textContent = '📜'; // Fix history button icon
      var historyOverlay = document.getElementById('historyOverlay');
      var historyClose = document.getElementById('historyClose');
      var historyList = document.getElementById('historyList');

      if (historyBtn) {
        historyBtn.onclick = function() {
          console.log('[ChatPanel] History button clicked');
          vscode.postMessage({ type: 'list_conversations' });
          historyOverlay.classList.add('show');
        };
        console.log('[ChatPanel] History button event bound');
      } else {
        console.error('[ChatPanel] History button not found!');
      }

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

      // 回车发送和命令导航
      inputEl.addEventListener('keydown', function(e) {
        // 如果建议框显示中
        if (commandSuggestionsEl.classList.contains('show')) {
          console.log('[ChatPanel] Suggestions visible, key:', e.key);
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedSuggestionIndex = (selectedSuggestionIndex + 1) % currentSuggestions.length;
            updateSelectedSuggestion();
            return;
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedSuggestionIndex = (selectedSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
            updateSelectedSuggestion();
            return;
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            if (selectedSuggestionIndex >= 0) {
              selectCommand(currentSuggestions[selectedSuggestionIndex]);
            } else if (currentSuggestions.length > 0) {
              selectCommand(currentSuggestions[0]);
            }
            return;
          } else if (e.key === 'Escape') {
            e.preventDefault();
            hideCommandSuggestions();
            return;
          }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });

      // 保存输入框文本并检查命令
      var saveInputTimeout = null;
      inputEl.addEventListener('input', function() {
        var value = inputEl.value;
        console.log('[ChatPanel] Input changed:', value);
        
        // 检查是否在输入命令
        if (value.startsWith('/')) {
          // 只在斜杠后或者命令名称变化时请求建议
          var query = value.split(/\s+/)[0];
          console.log('[ChatPanel] Query:', query, 'LastQuery:', lastQuery);
          if (query !== lastQuery) {
            lastQuery = query;
            console.log('[ChatPanel] Fetching suggestions for:', query);
            vscode.postMessage({ type: 'get_command_suggestions', query: query });
          }
        } else {
          hideCommandSuggestions();
        }

        if (saveInputTimeout) {
          clearTimeout(saveInputTimeout);
        }
        saveInputTimeout = setTimeout(function() {
          vscode.postMessage({ type: 'save_input_text', text: value });
        }, 300);
      });

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
              // ✅ 定期保存状态（每 50 个 token 保存一次，避免频繁保存）
              if (Math.random() < 0.02) saveState();
            }
          } else if (evt.type === 'skill') {
            // 显示 skill 使用提示
            var skillDiv = document.createElement('div');
            skillDiv.className = 'message skill';
            skillDiv.innerHTML = '<span class="skill-icon">🎯</span><div class="skill-info"><div class="skill-name">使用 Skill: ' + evt.name + '</div>' + (evt.description ? '<div class="skill-desc">' + evt.description + '</div>' : '') + '</div>';
            messagesEl.appendChild(skillDiv);
            messagesEl.scrollTop = messagesEl.scrollHeight;
            saveState();
          } else if (evt.type === 'action') {
            // 显示工具调用信息
            var actionDiv = document.createElement('div');
            actionDiv.className = 'message action';
            var toolName = evt.tool;
            var params = evt.params;
            var paramsStr = '';
            try {
              paramsStr = JSON.stringify(params, null, 2);
            } catch (e) {
              paramsStr = String(params);
            }
            
            // 解析工具名称，判断是否是 MCP 工具
            var isMCP = toolName.includes('_') && toolName.split('_').length >= 2;
            var displayName = toolName;
            var serverName = '';
            var actualToolName = toolName;
            
            if (isMCP) {
              // MCP 工具格式: serverName_toolName
              var parts = toolName.split('_');
              serverName = parts[0];
              actualToolName = parts.slice(1).join('_');
              displayName = serverName + '/' + actualToolName;
            }
            
            var icon = isMCP ? '🔧' : '🔧';
            
            actionDiv.innerHTML = 
              '<details class="tool-call-details">' +
                '<summary class="tool-call-summary">' +
                  '<span class="tool-call-icon">' + icon + '</span>' +
                  '<span class="tool-call-name">' + displayName + '</span>' +
                  '<span class="tool-call-arrow">▼</span>' +
                '</summary>' +
                '<div class="tool-call-content">' +
                  '<div class="tool-call-section">' +
                    '<div class="tool-call-label">Arguments</div>' +
                    '<pre class="tool-call-params">' + paramsStr + '</pre>' +
                  '</div>' +
                '</div>' +
              '</details>';
            messagesEl.appendChild(actionDiv);
            messagesEl.scrollTop = messagesEl.scrollHeight;
            saveState();
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
            // 检查是否是工具调用消息
            if (msg.toolCall) {
              addToolCallMessage(msg.toolCall.name, msg.toolCall.parameters, msg.toolCall.result);
            } else {
              addMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content, msg.content);
            }
          });
          } else if (message.type === 'current_settings') {
            // 更新设置面板的当前值
            providerSelect.value = message.provider;
            updateModelOptions(message.provider);
            modelSelect.value = message.model;
            
            // 更新 API Key 状态显示
          var apiKeyStatus = document.getElementById('apiKeyStatus');
          if (message.hasApiKey) {
            apiKeyStatus.className = 'api-key-status set';
            apiKeyStatus.innerHTML = '<span>✅</span> 已设置';
            apiKeyInput.placeholder = '输入新的 API 密钥（留空保持不变）...';
          } else {
            apiKeyStatus.className = 'api-key-status not-set';
            apiKeyStatus.innerHTML = '<span>⚠️</span> 未设置';
            apiKeyInput.placeholder = '输入 API 密钥...';
          }
        } else if (message.type === 'mcp_servers_list') {
          renderMCPServers(message.servers);
        } else if (message.type === 'mcp_server_status_changed') {
          // 刷新服务器列表
          loadMCPServers();
        } else if (message.type === 'restore_input_text') {
          // 恢复输入框文本
          if (message.text) {
            inputEl.value = message.text;
          }
        } else if (message.type === 'sync_processing_state') {
          // ✅ 同步处理状态（从后端恢复）
          console.log('[ChatPanel] 同步处理状态:', message.isProcessing);
          setProcessing(message.isProcessing);
          if (message.isProcessing) {
            // 如果正在处理，找到最后一个 assistant 消息作为 currentAssistantMessage
            var assistantMsgs = messagesEl.querySelectorAll('.message.assistant');
            if (assistantMsgs.length > 0) {
              currentAssistantMessage = assistantMsgs[assistantMsgs.length - 1];
            }
          }
        } else if (message.type === 'diff_preview') {
          // 显示 diff 预览对话框
          showDiffPreview(message.requestId, message.filePath, message.diff, message.isNewFile, message.additions, message.deletions);
        } else if (message.type === 'command_error') {
          // ✅ 处理快捷命令错误
          console.log('[ChatPanel] 快捷命令错误:', message.error);
          addMessage('error', message.error);
          setProcessing(false);
          
          // 如果有警告，也显示
          if (message.warning) {
            addMessage('error', '⚠️ ' + message.warning);
          }
        } else if (message.type === 'command_suggestions') {
          // ✅ 处理快捷命令建议
          renderCommandSuggestions(message.suggestions);
        }
      });

      // 快捷命令建议助手函数
      function renderCommandSuggestions(suggestions) {
        console.log('[ChatPanel] Rendering suggestions:', suggestions.length);
        currentSuggestions = suggestions;
        selectedSuggestionIndex = suggestions.length > 0 ? 0 : -1;
        
        if (suggestions.length === 0) {
          console.log('[ChatPanel] No suggestions, hiding');
          hideCommandSuggestions();
          return;
        }
        
        var html = suggestions.map(function(s, i) {
          var aliasHtml = s.alias ? '<span class="command-item-alias">/' + s.alias + '</span>' : '';
          var selectedClass = i === selectedSuggestionIndex ? 'selected' : '';
          return '<div class="command-item ' + selectedClass + '" data-index="' + i + '">' +
            '<div class="command-item-icon">' + s.icon + '</div>' +
            '<div class="command-item-info">' +
              '<div class="command-item-name">/' + s.name + ' ' + aliasHtml + '</div>' +
              '<div class="command-item-desc">' + s.description + '</div>' +
              '<div class="command-item-example">示例: ' + s.example + '</div>' +
            '</div>' +
          '</div>';
        }).join('');
        
        commandSuggestionsEl.innerHTML = html;
        commandSuggestionsEl.classList.add('show');
        console.log('[ChatPanel] Suggestions element shown');
        
        // 绑定点击事件
        commandSuggestionsEl.querySelectorAll('.command-item').forEach(function(item) {
          item.onclick = function() {
            var index = parseInt(item.getAttribute('data-index'));
            selectCommand(currentSuggestions[index]);
          };
        });
      }

      function updateSelectedSuggestion() {
        commandSuggestionsEl.querySelectorAll('.command-item').forEach(function(item, i) {
          if (i === selectedSuggestionIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
          } else {
            item.classList.remove('selected');
          }
        });
      }

      function selectCommand(suggestion) {
        var value = inputEl.value;
        var parts = value.split(/\s+/);
        parts[0] = '/' + suggestion.name;
        inputEl.value = parts.join(' ') + ' ';
        inputEl.focus();
        hideCommandSuggestions();
        lastQuery = parts[0];
      }

      function hideCommandSuggestions() {
        commandSuggestionsEl.classList.remove('show');
        currentSuggestions = [];
        selectedSuggestionIndex = -1;
        lastQuery = '';
      }

      // 点击外部隐藏建议
      document.addEventListener('click', function(e) {
        if (!inputEl.contains(e.target) && !commandSuggestionsEl.contains(e.target)) {
          hideCommandSuggestions();
        }
      });

      // 确认对话框处理
      var confirmOverlay = document.getElementById('confirmOverlay');
      var confirmClose = document.getElementById('confirmClose');
      var currentConfirmRequestId = null;
      
      // Diff 预览对话框处理
      var diffOverlay = document.getElementById('diffOverlay');
      var diffClose = document.getElementById('diffClose');
      var diffConfirm = document.getElementById('diffConfirm');
      var diffReject = document.getElementById('diffReject');
      var currentDiffRequestId = null;
      
      function showDiffPreview(requestId, filePath, diff, isNewFile, additions, deletions) {
        currentDiffRequestId = requestId;
        
        // 设置文件名和图标
        document.getElementById('diffFileName').textContent = filePath;
        document.getElementById('diffIcon').textContent = isNewFile ? '📄' : '✏️';
        
        var badge = document.getElementById('diffBadge');
        badge.textContent = isNewFile ? '新建' : '修改';
        badge.className = 'diff-badge ' + (isNewFile ? 'new' : 'modified');
        
        // 设置统计信息
        document.getElementById('diffStats').innerHTML = 
          '<span class="added">+' + additions + '</span> <span class="removed">-' + deletions + '</span>';
        
        // 渲染 diff 内容 - 按 hunk 分组显示
        var content = document.getElementById('diffContent');
        content.innerHTML = '';
        
        var lines = diff.split('\\n');
        var currentHunk = null;
        var oldLineNum = 0;
        var newLineNum = 0;
        
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          
          if (line.startsWith('@@')) {
            // 解析 hunk header: @@ -1,5 +1,6 @@
            var match = line.match(/@@ -(\\d+)/);
            if (match) {
              oldLineNum = parseInt(match[1]) - 1;
              newLineNum = parseInt(match[1]) - 1;
            }
            var matchNew = line.match(/\\+(\\d+)/);
            if (matchNew) {
              newLineNum = parseInt(matchNew[1]) - 1;
            }
            
            // 创建新的 hunk 容器
            currentHunk = document.createElement('div');
            currentHunk.className = 'diff-hunk';
            
            var hunkHeader = document.createElement('div');
            hunkHeader.className = 'diff-hunk-header';
            hunkHeader.textContent = line;
            currentHunk.appendChild(hunkHeader);
            
            content.appendChild(currentHunk);
          } else if (currentHunk && line !== '') {
            var lineDiv = document.createElement('div');
            lineDiv.className = 'diff-line';
            
            var lineNumDiv = document.createElement('span');
            lineNumDiv.className = 'diff-line-num';
            
            var lineContentDiv = document.createElement('span');
            lineContentDiv.className = 'diff-line-content';
            
            if (line.startsWith('+')) {
              lineDiv.className += ' added';
              newLineNum++;
              lineNumDiv.textContent = '+' + newLineNum;
              lineContentDiv.textContent = line.substring(1);
            } else if (line.startsWith('-')) {
              lineDiv.className += ' removed';
              oldLineNum++;
              lineNumDiv.textContent = '-' + oldLineNum;
              lineContentDiv.textContent = line.substring(1);
            } else {
              lineDiv.className += ' context';
              oldLineNum++;
              newLineNum++;
              lineNumDiv.textContent = oldLineNum.toString();
              lineContentDiv.textContent = line.substring(1);
            }
            
            lineDiv.appendChild(lineNumDiv);
            lineDiv.appendChild(lineContentDiv);
            currentHunk.appendChild(lineDiv);
          }
        }
        
        diffOverlay.style.display = 'flex';
      }
      
      function closeDiffPreview(confirmed) {
        diffOverlay.style.display = 'none';
        if (currentDiffRequestId) {
          vscode.postMessage({
            type: 'diff_response',
            requestId: currentDiffRequestId,
            confirmed: confirmed
          });
          currentDiffRequestId = null;
        }
      }
      
      diffClose.onclick = function() { closeDiffPreview(false); };
      diffReject.onclick = function() { closeDiffPreview(false); };
      diffConfirm.onclick = function() { closeDiffPreview(true); };
      
      diffOverlay.onclick = function(e) {
        if (e.target === diffOverlay) {
          closeDiffPreview(false);
        }
      };

      confirmClose.onclick = function() {
        confirmOverlay.style.display = 'none';
        if (currentConfirmRequestId) {
          vscode.postMessage({
            type: 'confirm_response',
            requestId: currentConfirmRequestId,
            selectedOption: 'cancel'
          });
          currentConfirmRequestId = null;
        }
      };

      confirmOverlay.onclick = function(e) {
        if (e.target === confirmOverlay) {
          confirmOverlay.style.display = 'none';
          if (currentConfirmRequestId) {
            vscode.postMessage({
              type: 'confirm_response',
              requestId: currentConfirmRequestId,
              selectedOption: 'cancel'
            });
            currentConfirmRequestId = null;
          }
        }
      };

      // 键盘快捷键支持
      document.addEventListener('keydown', function(e) {
        if (confirmOverlay.style.display === 'flex') {
          if (e.key === 'Escape') {
            confirmClose.click();
          } else if (e.key >= '1' && e.key <= '3') {
            var buttons = confirmOverlay.querySelectorAll('.confirm-option-btn');
            var index = parseInt(e.key) - 1;
            if (buttons[index]) {
              buttons[index].click();
            }
          }
        }
      });

      // 处理来自扩展的确认请求
      window.addEventListener('message', function(event) {
        var message = event.data;
        if (message.type === 'confirm_action') {
          currentConfirmRequestId = message.requestId;
          document.getElementById('confirmTitle').textContent = message.title;
          document.getElementById('confirmDescription').textContent = message.description;
          document.getElementById('confirmDetails').textContent = message.details;
          
          var footer = document.getElementById('confirmFooter');
          footer.innerHTML = '';
          
          for (var i = 0; i < message.options.length; i++) {
            var option = message.options[i];
            var btn = document.createElement('button');
            btn.className = 'confirm-option-btn ' + (option.primary ? 'primary' : '');
            btn.textContent = option.label;
            btn.onclick = (function(optionId) {
              return function() {
                confirmOverlay.style.display = 'none';
                vscode.postMessage({
                  type: 'confirm_response',
                  requestId: currentConfirmRequestId,
                  selectedOption: optionId
                });
                currentConfirmRequestId = null;
              };
            })(option.id);
            footer.appendChild(btn);
          }
          
          confirmOverlay.style.display = 'flex';
          // 聚焦到第一个按钮
          setTimeout(function() {
            var firstBtn = footer.querySelector('.confirm-option-btn');
            if (firstBtn) firstBtn.focus();
          }, 100);
        }
      });

      // MCP 管理功能
      var mcpServersList = document.getElementById('mcpServersList');
      
      // 加载MCP服务器列表
      function loadMCPServers() {
        vscode.postMessage({ type: 'mcp_list_servers' });
      }
      
      // 渲染MCP服务器列表
      function renderMCPServers(servers) {
        if (!mcpServersList) return;
        
        if (!servers || servers.length === 0) {
          mcpServersList.innerHTML = '<div class="loading-text">暂无配置的 MCP 服务器</div>';
          return;
        }

        mcpServersList.innerHTML = servers.map(function(server) {
          var isRunning = server.status === 'running';
          var isError = server.status === 'error';
          var statusText = isRunning ? 'Enabled' : isError ? 'Error' : 'Disabled';
          var switchClass = isRunning ? 'switch-on' : isError ? 'switch-error' : 'switch-off';
          
          return '<div class="mcp-server-item">' +
            '<div class="mcp-server-header">' +
              '<div class="mcp-server-info">' +
                '<div class="mcp-server-name">' + server.name + '</div>' +
                '<div class="mcp-server-description">' + (server.description || '无描述') + '</div>' +
              '</div>' +
              '<div class="mcp-server-actions">' +
                '<label class="mcp-switch" title="' + statusText + '">' +
                  '<input type="checkbox" class="mcp-switch-input" data-server-name="' + server.name + '" data-server-status="' + server.status + '" ' + (isRunning ? 'checked' : '') + '>' +
                  '<span class="mcp-switch-slider ' + switchClass + '"></span>' +
                '</label>' +
                '<button class="mcp-delete-btn" data-server-name="' + server.name + '" title="删除服务器">🗑️</button>' +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('');
        
        // 绑定开关事件
        var switchInputs = mcpServersList.querySelectorAll('.mcp-switch-input');
        for (var i = 0; i < switchInputs.length; i++) {
          switchInputs[i].onchange = function() {
            var name = this.getAttribute('data-server-name');
            var status = this.getAttribute('data-server-status');
            toggleMCPServer(name, status);
          };
        }
        
        // 绑定删除按钮事件
        var deleteButtons = mcpServersList.querySelectorAll('.mcp-delete-btn');
        for (var i = 0; i < deleteButtons.length; i++) {
          deleteButtons[i].onclick = function() {
            var name = this.getAttribute('data-server-name');
            if (confirm('确定要删除服务器 "' + name + '" 吗？')) {
              vscode.postMessage({ type: 'mcp_remove_server', name: name });
            }
          };
        }
      }
      
      // 切换MCP服务器状态
      function toggleMCPServer(name, currentStatus) {
        if (currentStatus === 'running') {
          vscode.postMessage({ type: 'mcp_stop_server', name: name });
        } else {
          vscode.postMessage({ type: 'mcp_start_server', name: name });
        }
      }

      // MCP面板管理
      var mcpBtn = document.getElementById('mcpBtn');
      var mcpOverlay = document.getElementById('mcpOverlay');
      var mcpClose = document.getElementById('mcpClose');
      var mcpCloseBtn = document.getElementById('mcpCloseBtn');
      var mcpRefreshBtn = document.getElementById('mcpRefreshBtn');
      var addMcpServerBtn = document.getElementById('addMcpServerBtn');
      
      if (mcpBtn) {
        mcpBtn.onclick = function() {
          console.log('[ChatPanel] MCP button clicked');
          mcpOverlay.classList.add('show');
          loadMCPServers();
        };
      }
      
      if (mcpClose) {
        mcpClose.onclick = function() {
          mcpOverlay.classList.remove('show');
        };
      }
      
      if (mcpCloseBtn) {
        mcpCloseBtn.onclick = function() {
          mcpOverlay.classList.remove('show');
        };
      }
      
      if (mcpRefreshBtn) {
        mcpRefreshBtn.onclick = function() {
          loadMCPServers();
        };
      }
      
      if (mcpOverlay) {
        mcpOverlay.onclick = function(e) {
          if (e.target === mcpOverlay) {
            mcpOverlay.classList.remove('show');
          }
        };
      }
      
      // 编辑配置按钮 - 直接打开配置文件
      if (addMcpServerBtn) {
        addMcpServerBtn.onclick = function() {
          console.log('[ChatPanel] Open MCP config clicked');
          vscode.postMessage({ type: 'mcp_open_config' });
        };
      }

      // 提示词模板功能
      var templateBtn = document.getElementById('templateBtn');
      var templateOverlay = document.getElementById('templateOverlay');
      var templateClose = document.getElementById('templateClose');
      var builtinTemplates = document.getElementById('builtinTemplates');
      var customTemplates = document.getElementById('customTemplates');
      var customTemplatesSection = document.getElementById('customTemplatesSection');
      
      function renderTemplates(templates) {
        var builtinHtml = '';
        var customHtml = '';
        
        for (var i = 0; i < templates.length; i++) {
          var t = templates[i];
          var html = '<div class="template-item" data-template-id="' + t.id + '">' +
            '<span class="template-item-icon">' + t.icon + '</span>' +
            '<div class="template-item-info">' +
              '<div class="template-item-name">' + t.name + '</div>' +
              '<div class="template-item-desc">' + t.description + '</div>' +
            '</div>' +
            '<span class="template-item-arrow">→</span>' +
          '</div>';
          
          if (t.category === 'builtin') {
            builtinHtml += html;
          } else {
            customHtml += html;
          }
        }
        
        builtinTemplates.innerHTML = builtinHtml || '<div class="loading-text">暂无内置模板</div>';
        
        if (customHtml) {
          customTemplates.innerHTML = customHtml;
          customTemplatesSection.style.display = 'block';
        } else {
          customTemplatesSection.style.display = 'none';
        }
        
        // 绑定点击事件
        var items = templateOverlay.querySelectorAll('.template-item');
        for (var j = 0; j < items.length; j++) {
          items[j].onclick = function() {
            var templateId = this.getAttribute('data-template-id');
            vscode.postMessage({ type: 'use_template', templateId: templateId });
            templateOverlay.classList.remove('show');
          };
        }
      }
      
      if (templateBtn) {
        templateBtn.onclick = function() {
          console.log('[ChatPanel] Template button clicked');
          vscode.postMessage({ type: 'get_templates' });
          templateOverlay.classList.add('show');
        };
      }
      
      if (templateClose) {
        templateClose.onclick = function() {
          templateOverlay.classList.remove('show');
        };
      }
      
      if (templateOverlay) {
        templateOverlay.onclick = function(e) {
          if (e.target === templateOverlay) {
            templateOverlay.classList.remove('show');
          }
        };
      }
      
      // 处理模板消息
      window.addEventListener('message', function(event) {
        var message = event.data;
        if (message.type === 'templates_list') {
          renderTemplates(message.templates);
        } else if (message.type === 'template_content') {
          // 将模板内容填充到输入框
          inputEl.value = message.content;
          inputEl.focus();
          // 触发 input 事件以保存文本
          inputEl.dispatchEvent(new Event('input'));
        }
      });

      /*
      var mcpTabInstalled = document.getElementById('mcpTabInstalled');
      var mcpTabMarketplace = document.getElementById('mcpTabMarketplace');
      var mcpInstalledContent = document.getElementById('mcp-installed');
      var mcpMarketplaceContent = document.getElementById('mcp-marketplace');
      var mcpServersList = document.getElementById('mcpServersList');
      var marketplaceServers = document.getElementById('marketplaceServers');
      var mcpSearch = document.getElementById('mcpSearch');

      // 先定义MCP相关函数
      function loadInstalledServers() {
        vscode.postMessage({ type: 'mcp_list_servers' });
      }

      function loadMarketplaceServers() {
        vscode.postMessage({ type: 'mcp_list_marketplace' });
      }

      // 只有当MCP元素存在时才绑定事件
      if (mcpTabInstalled && mcpTabMarketplace && mcpInstalledContent && mcpMarketplaceContent) {
        // 标签页切换
        mcpTabInstalled.onclick = function() {
          mcpTabInstalled.classList.add('active');
          mcpTabMarketplace.classList.remove('active');
          mcpInstalledContent.classList.add('active');
          mcpMarketplaceContent.classList.remove('active');
          loadInstalledServers();
        };

        mcpTabMarketplace.onclick = function() {
          mcpTabMarketplace.classList.add('active');
          mcpTabInstalled.classList.remove('active');
          mcpMarketplaceContent.classList.add('active');
          mcpInstalledContent.classList.remove('active');
          loadMarketplaceServers();
        };
      }

      // 搜索功能
      if (mcpSearch) {
        mcpSearch.oninput = function() {
          var query = mcpSearch.value.trim();
          if (query) {
            vscode.postMessage({ type: 'mcp_search', query: query });
          } else {
            loadMarketplaceServers();
          }
        };
      }
      */

      // MCP 消息处理已集成到主消息处理器中

      /*
      // 渲染已安装的服务器
      function renderInstalledServers(servers) {
        if (!mcpServersList) return;
        
        if (!servers || servers.length === 0) {
          mcpServersList.innerHTML = '<div class="loading-text">暂无已安装的 MCP 服务器</div>';
          return;
        }

        mcpServersList.innerHTML = servers.map(function(server) {
          var statusClass = server.status === 'running' ? 'running' : 
                           server.status === 'error' ? 'error' : 'stopped';
          var statusText = server.status === 'running' ? '运行中' : 
                          server.status === 'error' ? '错误' : '已停止';
          
          return '<div class="mcp-server-item">' +
            '<div class="mcp-server-header">' +
              '<div class="mcp-server-name">' + server.name + '</div>' +
              '<div class="mcp-server-status ' + statusClass + '">' + statusText + '</div>' +
            '</div>' +
            '<div class="mcp-server-description">' + (server.description || '无描述') + '</div>' +
            '<div class="mcp-server-actions">' +
              (server.status === 'running' ? 
                '<button class="mcp-action-btn" onclick="stopMCPServer(\'' + server.name + '\')">停止</button>' :
                '<button class="mcp-action-btn primary" onclick="startMCPServer(\'' + server.name + '\')">启动</button>') +
              '<button class="mcp-action-btn" onclick="removeMCPServer(\'' + server.name + '\')">删除</button>' +
            '</div>' +
          '</div>';
        }).join('');
      }

      // 渲染市场服务器
      function renderMarketplaceServers(servers) {
        if (!marketplaceServers) return;
        
        if (!servers || servers.length === 0) {
          marketplaceServers.innerHTML = '<div class="loading-text">暂无可用的 MCP 服务器</div>';
          return;
        }

        marketplaceServers.innerHTML = servers.map(function(server) {
          return '<div class="marketplace-server-item">' +
            '<div class="marketplace-server-header">' +
              '<div class="marketplace-server-info">' +
                '<h4>' + server.displayName + '</h4>' +
                '<div class="mcp-server-description">' + server.description + '</div>' +
              '</div>' +
              '<button class="mcp-action-btn primary" onclick="installMCPServer(\'' + server.name + '\')">安装</button>' +
            '</div>' +
            '<div class="marketplace-server-tags">' +
              server.tags.map(function(tag) {
                return '<span class="marketplace-tag">' + tag + '</span>';
              }).join('') +
            '</div>' +
          '</div>';
        }).join('');
      }

      // MCP 服务器操作函数
      window.startMCPServer = function(name) {
        vscode.postMessage({ type: 'mcp_start_server', name: name });
      };

      window.stopMCPServer = function(name) {
        vscode.postMessage({ type: 'mcp_stop_server', name: name });
      };

      window.removeMCPServer = function(name) {
        if (confirm('确定要删除服务器 ' + name + ' 吗？')) {
          vscode.postMessage({ type: 'mcp_remove_server', name: name });
        }
      };

      window.installMCPServer = function(name) {
        vscode.postMessage({ type: 'mcp_install_server', name: name });
      };

      // 处理 MCP 相关消息
      window.addEventListener('message', function(event) {
        var message = event.data;
        
        if (message.type === 'mcp_servers_list') {
          renderInstalledServers(message.servers);
        } else if (message.type === 'mcp_marketplace_list') {
          renderMarketplaceServers(message.servers);
        } else if (message.type === 'mcp_server_status_changed') {
          // 刷新已安装服务器列表
          if (mcpInstalledContent && mcpInstalledContent.classList.contains('active')) {
            loadInstalledServers();
          }
        }
      });
      */

      // 通知扩展 webview 已准备好
      console.log('[ChatPanel] Script completed, sending ready message');
      vscode.postMessage({ type: 'ready' });
      } catch (error) {
        console.error('[ChatPanel] Script error:', error);
      }
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
