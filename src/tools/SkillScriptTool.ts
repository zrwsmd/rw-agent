import { Tool, ToolResult, ToolParameter } from '../types/tool';
import { SkillsManager } from '../skills';

/**
 * Skill 脚本执行工具
 */
export class SkillScriptTool implements Tool {
  name = 'skill_script';
  description = '执行 skill 包中的脚本';
  parameters: ToolParameter[] = [
    {
      name: 'skill_name',
      type: 'string',
      description: 'Skill 名称',
      required: true,
    },
    {
      name: 'script_name',
      type: 'string',
      description: '脚本名称',
      required: true,
    },
    {
      name: 'args',
      type: 'array',
      description: '脚本参数',
      required: false,
    },
  ];

  private skillsManager: SkillsManager | null = null;

  setSkillsManager(manager: SkillsManager): void {
    this.skillsManager = manager;
  }

  async execute(params: {
    skill_name: string;
    script_name: string;
    args?: string[];
  }): Promise<ToolResult> {
    if (!this.skillsManager) {
      return {
        success: false,
        output: 'SkillsManager 未初始化',
      };
    }

    const { skill_name, script_name, args = [] } = params;

    const result = await this.skillsManager.executeScript(skill_name, script_name, args);

    if (result.success) {
      return {
        success: true,
        output: result.stdout || '脚本执行成功',
      };
    } else {
      return {
        success: false,
        output: result.stderr || '脚本执行失败',
      };
    }
  }
}

export function createSkillScriptTool(): SkillScriptTool {
  return new SkillScriptTool();
}
