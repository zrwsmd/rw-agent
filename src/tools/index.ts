export { BaseTool, WorkspaceBoundaryError } from './BaseTool';
export { FileReadTool } from './FileReadTool';
export { FileWriteTool } from './FileWriteTool';
export { FileSearchTool } from './FileSearchTool';
export { GrepSearchTool } from './GrepSearchTool';
export { ShellCommandTool } from './ShellCommandTool';
export { ToolRegistryImpl, createToolRegistry } from './ToolRegistry';

import { ToolRegistryImpl } from './ToolRegistry';
import { FileReadTool } from './FileReadTool';
import { FileWriteTool } from './FileWriteTool';
import { FileSearchTool } from './FileSearchTool';
import { GrepSearchTool } from './GrepSearchTool';
import { ShellCommandTool } from './ShellCommandTool';

/**
 * 创建并注册所有默认工具
 */
export function createDefaultTools(workspaceRoot: string): ToolRegistryImpl {
  const registry = new ToolRegistryImpl();

  registry.register(new FileReadTool(workspaceRoot));
  registry.register(new FileWriteTool(workspaceRoot));
  registry.register(new FileSearchTool(workspaceRoot));
  registry.register(new GrepSearchTool(workspaceRoot));
  registry.register(new ShellCommandTool(workspaceRoot));

  return registry;
}
