import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Skill 配置
 */
export interface SkillConfig {
  name: string;
  description?: string;
  keywords: string[];
  scripts?: {
    [key: string]: string; // 脚本名称 -> 脚本路径
  };
  resources?: string[]; // 资源文件列表
}

/**
 * Skill 定义
 */
export interface Skill {
  name: string;
  content: string;
  keywords: string[];
  skillPath: string;
  config: SkillConfig;
  scripts: Map<string, string>; // 脚本名称 -> 完整路径
  resources: string[]; // 资源文件完整路径
}

/**
 * 脚本执行结果
 */
export interface ScriptResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Skills 管理器
 */
export class SkillsManager {
  private skills: Map<string, Skill> = new Map();
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.loadSkills();
  }

  /**
   * 加载所有 skills
   */
  public loadSkills(): void {
    this.skills.clear();
    
    console.log('[SkillsManager] 工作区根目录:', this.workspaceRoot);
    
    // 支持 .claude/skills（Claude 风格）和 .agent/skills
    const skillsDirs = [
      path.join(this.workspaceRoot, '.claude', 'skills'),
      path.join(this.workspaceRoot, '.agent', 'skills'),
    ];

    for (const skillsDir of skillsDirs) {
      console.log('[SkillsManager] 检查 skills 目录:', skillsDir);
      if (!fs.existsSync(skillsDir)) {
        console.log('[SkillsManager] 目录不存在:', skillsDir);
        continue;
      }

      console.log('[SkillsManager] 找到 skills 目录:', skillsDir);
      const items = fs.readdirSync(skillsDir);
      console.log('[SkillsManager] 目录内容:', items);
      
      for (const item of items) {
        const itemPath = path.join(skillsDir, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
          // 目录形式的 skill 包
          console.log('[SkillsManager] 加载 skill 包:', itemPath);
          this.loadSkillPackage(itemPath);
        } else if (item.endsWith('.md')) {
          // 单文件 skill
          console.log('[SkillsManager] 加载单文件 skill:', itemPath);
          this.loadSingleFileSkill(itemPath);
        }
      }
    }
    
    console.log('[SkillsManager] 加载完成，共', this.skills.size, '个 skills');
  }

  /**
   * 加载 skill 包（目录形式）
   */
  private loadSkillPackage(skillPath: string): void {
    const skillName = path.basename(skillPath);
    const configPath = path.join(skillPath, 'config.json');
    
    // 优先查找 SKILL.md（Claude 风格）
    let skillMdPath = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      skillMdPath = path.join(skillPath, 'skill.md');
    }

    // 初始化关键词列表
    const keywords: string[] = [skillName.toLowerCase()];
    let name = skillName;
    let description = '';

    // 读取配置文件
    if (fs.existsSync(configPath)) {
      try {
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (configData.name) name = configData.name;
        if (configData.keywords) keywords.push(...configData.keywords);
        if (configData.description) description = configData.description;
      } catch (e) {
        console.error(`解析 skill 配置失败: ${configPath}`, e);
      }
    }

    // 读取 SKILL.md
    let content = '';
    if (fs.existsSync(skillMdPath)) {
      content = fs.readFileSync(skillMdPath, 'utf-8');
      console.log('[SkillsManager] 读取 SKILL.md:', skillMdPath);
      
      // 从 frontmatter 提取配置
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        console.log('[SkillsManager] Frontmatter:', frontmatter);
        
        // 提取 name
        const nameMatch = frontmatter.match(/name:\s*(.+)/);
        if (nameMatch) {
          name = nameMatch[1].trim();
          console.log('[SkillsManager] 提取 name:', name);
        }
        
        // 提取 description
        const descMatch = frontmatter.match(/description:\s*(.+)/);
        if (descMatch) {
          description = descMatch[1].trim();
          console.log('[SkillsManager] 提取 description:', description);
        }
        
        // 提取 keywords（可选字段，支持数组格式）
        const keywordsMatch = frontmatter.match(/keywords:\s*\[([^\]]*)\]/);
        if (keywordsMatch) {
          const keywordsStr = keywordsMatch[1];
          const extractedKeywords = keywordsStr
            .split(',')
            .map((k) => k.trim().replace(/['"]/g, ''))
            .filter((k) => k.length > 0);
          keywords.push(...extractedKeywords);
          console.log('[SkillsManager] 提取 keywords:', extractedKeywords);
        }
      }
    }

    // 英文停用词列表（常见介词、冠词、连词等）
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as',
      'it', 'if', 'or', 'and', 'but', 'not', 'no', 'so', 'do', 'does',
      'this', 'that', 'these', 'those', 'can', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'have', 'has', 'had', 'having',
      'use', 'uses', 'used', 'using', 'all', 'any', 'each', 'every',
    ]);
    
    // 从 name 提取关键词
    const nameLower = name.toLowerCase();
    if (!keywords.includes(nameLower)) {
      keywords.push(nameLower);
    }
    // 拆分连字符
    const nameWords = nameLower.split('-').filter(w => w.length >= 3 && !stopWords.has(w));
    for (const word of nameWords) {
      if (!keywords.includes(word)) {
        keywords.push(word);
      }
    }
    
    // 从 name 提取中文关键词（完整词组）
    const nameChineseChars = name.match(/[\u4e00-\u9fa5]+/g);
    if (nameChineseChars) {
      for (const chars of nameChineseChars) {
        if (chars.length >= 2 && !keywords.includes(chars)) {
          keywords.push(chars);
        }
      }
    }
    
    // 从 description 提取关键词
    if (description) {
      const descLower = description.toLowerCase();
      // 英文词汇：长度 >= 3，且不是停用词
      const englishWords = descLower.split(/[\s,./()-]+/).filter(
        w => w.length >= 3 && /^[a-z0-9]+$/.test(w) && !stopWords.has(w)
      );
      for (const word of englishWords) {
        if (!keywords.includes(word)) {
          keywords.push(word);
        }
      }
      
      // 中文词组（完整提取，长度 >= 2）
      const chineseChars = description.match(/[\u4e00-\u9fa5]+/g);
      if (chineseChars) {
        for (const chars of chineseChars) {
          if (chars.length >= 2 && !keywords.includes(chars)) {
            keywords.push(chars);
          }
        }
      }
    }
    
    console.log('[SkillsManager] 最终关键词列表:', keywords);

    // 构建配置
    const config: SkillConfig = {
      name,
      description,
      keywords,
    };

    // 加载脚本
    const scripts = new Map<string, string>();
    const scriptsDir = path.join(skillPath, 'scripts');
    if (fs.existsSync(scriptsDir)) {
      const scriptFiles = fs.readdirSync(scriptsDir);
      for (const scriptFile of scriptFiles) {
        const scriptName = path.parse(scriptFile).name;
        scripts.set(scriptName, path.join(scriptsDir, scriptFile));
      }
    }

    // 如果配置中指定了脚本，也加载
    if (config.scripts) {
      for (const [name, scriptPath] of Object.entries(config.scripts)) {
        const fullPath = path.join(skillPath, scriptPath);
        if (fs.existsSync(fullPath)) {
          scripts.set(name, fullPath);
        }
      }
    }

    // 加载资源文件
    const resources: string[] = [];
    const resourcesDir = path.join(skillPath, 'resources');
    if (fs.existsSync(resourcesDir)) {
      const resourceFiles = fs.readdirSync(resourcesDir);
      for (const resourceFile of resourceFiles) {
        resources.push(path.join(resourcesDir, resourceFile));
      }
    }

    // 如果配置中指定了资源，也加载
    if (config.resources) {
      for (const resourcePath of config.resources) {
        const fullPath = path.join(skillPath, resourcePath);
        if (fs.existsSync(fullPath)) {
          resources.push(fullPath);
        }
      }
    }

    const skill: Skill = {
      name: config.name || skillName,
      content,
      keywords: config.keywords || [skillName.toLowerCase()],
      skillPath,
      config,
      scripts,
      resources,
    };

    this.skills.set(skillName, skill);
  }

  /**
   * 加载单文件 skill
   */
  private loadSingleFileSkill(filePath: string): void {
    const fileName = path.basename(filePath, '.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    const keywords: string[] = [];

    // 从 frontmatter 提取关键词
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const keywordsMatch = frontmatter.match(/keywords:\s*\[(.*?)\]/);
      if (keywordsMatch) {
        keywords.push(
          ...keywordsMatch[1].split(',').map((k) => k.trim().replace(/['"]/g, ''))
        );
      }
    }

    if (keywords.length === 0) {
      keywords.push(fileName.toLowerCase());
    }

    const skill: Skill = {
      name: fileName,
      content,
      keywords,
      skillPath: filePath,
      config: { name: fileName, keywords },
      scripts: new Map(),
      resources: [],
    };

    this.skills.set(fileName, skill);
  }

  /**
   * 获取所有 skills
   */
  public getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取指定 skill
   */
  public getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * 根据用户消息匹配相关 skills
   */
  public matchSkills(userMessage: string): Skill[] {
    const messageLower = userMessage.toLowerCase();
    console.log('[SkillsManager] 匹配消息:', messageLower);
    console.log('[SkillsManager] 可用 skills:', Array.from(this.skills.keys()));
    
    // 提取用户消息中的词（英文按空格/标点分割，中文按连续字符）
    const messageWords = new Set<string>();
    // 英文词（只保留长度 >= 3 的）
    const englishWords = messageLower.match(/[a-z][a-z0-9]*/g) || [];
    englishWords.filter(w => w.length >= 3).forEach(w => messageWords.add(w));
    // 中文词组（只保留长度 >= 2 的）
    const chineseWords = messageLower.match(/[\u4e00-\u9fa5]+/g) || [];
    chineseWords.filter(w => w.length >= 2).forEach(w => messageWords.add(w));
    
    console.log('[SkillsManager] 用户消息词汇:', Array.from(messageWords));
    
    const matched: Skill[] = [];
    
    for (const skill of this.skills.values()) {
      let matchedKeyword: string | null = null;
      
      for (const keyword of skill.keywords) {
        const kw = keyword.toLowerCase();
        const isChinese = /[\u4e00-\u9fa5]/.test(kw);
        const minLen = isChinese ? 2 : 3;
        
        if (kw.length < minLen) continue;
        
        // 英文：完整词匹配
        if (!isChinese && messageWords.has(kw)) {
          matchedKeyword = kw;
          break;
        }
        
        // 中文：检查用户消息的中文词是否包含关键词
        if (isChinese) {
          for (const word of messageWords) {
            if (/[\u4e00-\u9fa5]/.test(word) && word.includes(kw)) {
              matchedKeyword = kw;
              break;
            }
          }
          if (matchedKeyword) break;
        }
      }
      
      console.log('[SkillsManager] Skill:', skill.name, '关键词:', skill.keywords.slice(0, 5), '匹配词:', matchedKeyword);
      
      if (matchedKeyword) {
        matched.push(skill);
      }
    }
    
    console.log('[SkillsManager] 匹配结果:', matched.map(s => s.name));
    return matched;
  }

  /**
   * 执行 skill 脚本
   */
  public async executeScript(
    skillName: string,
    scriptName: string,
    args: string[] = []
  ): Promise<ScriptResult> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return {
        success: false,
        stdout: '',
        stderr: `Skill "${skillName}" 不存在`,
        exitCode: 1,
      };
    }

    const scriptPath = skill.scripts.get(scriptName);
    if (!scriptPath) {
      return {
        success: false,
        stdout: '',
        stderr: `脚本 "${scriptName}" 不存在`,
        exitCode: 1,
      };
    }

    try {
      // 根据脚本类型选择执行方式
      const ext = path.extname(scriptPath).toLowerCase();
      let command: string;

      switch (ext) {
        case '.js':
          command = `node "${scriptPath}" ${args.join(' ')}`;
          break;
        case '.ts':
          command = `npx ts-node "${scriptPath}" ${args.join(' ')}`;
          break;
        case '.py':
          command = `python "${scriptPath}" ${args.join(' ')}`;
          break;
        case '.sh':
          command = `bash "${scriptPath}" ${args.join(' ')}`;
          break;
        case '.ps1':
          command = `powershell -File "${scriptPath}" ${args.join(' ')}`;
          break;
        case '.bat':
        case '.cmd':
          command = `"${scriptPath}" ${args.join(' ')}`;
          break;
        default:
          command = `"${scriptPath}" ${args.join(' ')}`;
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd: skill.skillPath,
        timeout: 60000, // 60秒超时
      });

      return {
        success: true,
        stdout,
        stderr,
        exitCode: 0,
      };
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; code?: number };
      return {
        success: false,
        stdout: execError.stdout || '',
        stderr: execError.stderr || (error instanceof Error ? error.message : '执行失败'),
        exitCode: execError.code || 1,
      };
    }
  }

  /**
   * 获取 skill 的资源文件内容
   */
  public getResourceContent(skillName: string, resourceName: string): string | null {
    const skill = this.skills.get(skillName);
    if (!skill) return null;

    const resourcePath = skill.resources.find((r) => path.basename(r) === resourceName);
    if (!resourcePath || !fs.existsSync(resourcePath)) return null;

    return fs.readFileSync(resourcePath, 'utf-8');
  }

  /**
   * 生成 skills 的 system prompt
   */
  public generateSkillsPrompt(userMessage: string): string {
    const matchedSkills = this.matchSkills(userMessage);

    if (matchedSkills.length === 0) {
      return '';
    }

    let prompt = '\n\n## 🎯 重要：请使用以下 Skills 完成任务\n\n';
    prompt += '**注意：你必须严格按照匹配的 Skill 的角色和指导来回复用户。**\n\n';
    
    for (const skill of matchedSkills) {
      // 移除 frontmatter
      let content = skill.content.replace(/^---\n[\s\S]*?\n---\n*/, '');
      prompt += `### Skill: ${skill.name}\n${content}\n`;

      // 列出可用脚本（强调使用方式）
      if (skill.scripts.size > 0) {
        prompt += '\n**📜 可用脚本（请使用 skill_script 工具执行）:**\n';
        for (const [name, scriptPath] of skill.scripts) {
          prompt += `- 脚本名: \`${name}\` (文件: ${path.basename(scriptPath)})\n`;
          prompt += `  使用方式: 调用 skill_script 工具，参数 skillName="${skill.name}", scriptName="${name}"\n`;
        }
      } else {
        // 没有脚本的 skill，提供指导
        prompt += '\n**💡 角色扮演指导:**\n';
        prompt += `这是一个知识型 Skill，请立即扮演 "${skill.config.name || skill.name}" 的角色，按照上述描述的专业领域和关注点来回复用户。\n`;
        prompt += `不要询问用户提供更多信息，而是主动提供专业建议或询问具体需求。\n`;
      }

      // 列出资源文件
      if (skill.resources.length > 0) {
        prompt += '\n资源文件:\n';
        for (const resource of skill.resources) {
          prompt += `- ${path.basename(resource)}\n`;
        }
      }

      prompt += '\n';
    }
    
    prompt += '---\n**执行规则:**\n';
    
    // 检查是否有任何 skill 包含脚本
    const hasScripts = matchedSkills.some(skill => skill.scripts.size > 0);
    const hasKnowledgeSkills = matchedSkills.some(skill => skill.scripts.size === 0);
    
    if (hasScripts && hasKnowledgeSkills) {
      prompt += '1. 对于有脚本的 Skill：必须使用 skill_script 工具执行脚本\n';
      prompt += '2. 对于知识型 Skill：立即扮演该角色，按照专业领域提供帮助\n';
      prompt += '3. 不要让用户等待，主动提供专业建议或具体操作\n\n';
    } else if (hasScripts) {
      prompt += '1. 必须使用 skill_script 工具执行脚本\n';
      prompt += '2. 根据脚本输出向用户报告结果\n\n';
    } else {
      prompt += '1. 立即扮演 Skill 定义的专业角色\n';
      prompt += '2. 按照 Skill 描述的关注点和专业领域提供帮助\n';
      prompt += '3. 主动提供建议，不要只是询问用户提供信息\n\n';
    }

    return prompt;
  }

  /**
   * 创建示例 skill 包
   */
  public createExampleSkillPackage(): void {
    const skillsDir = path.join(this.workspaceRoot, '.agent', 'skills');
    const exampleDir = path.join(skillsDir, 'pdf-generator');

    if (fs.existsSync(exampleDir)) return;

    // 创建目录结构
    fs.mkdirSync(path.join(exampleDir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(exampleDir, 'resources'), { recursive: true });

    // 创建 config.json
    const config: SkillConfig = {
      name: 'PDF Generator',
      description: '生成 PDF 文档的技能包',
      keywords: ['pdf', '生成pdf', '导出pdf', 'generate pdf'],
      scripts: {
        generate: 'scripts/generate.js',
      },
    };
    fs.writeFileSync(
      path.join(exampleDir, 'config.json'),
      JSON.stringify(config, null, 2),
      'utf-8'
    );

    // 创建 skill.md
    const skillMd = `# PDF Generator

这个技能可以帮助你生成 PDF 文档。

## 使用方法

1. 准备好要转换的内容
2. 调用 generate 脚本生成 PDF

## 支持的格式

- Markdown 转 PDF
- HTML 转 PDF
`;
    fs.writeFileSync(path.join(exampleDir, 'skill.md'), skillMd, 'utf-8');

    // 创建示例脚本
    const generateScript = `// PDF 生成脚本示例
const args = process.argv.slice(2);
console.log('生成 PDF，参数:', args);
// 实际实现需要安装 pdf 库
`;
    fs.writeFileSync(path.join(exampleDir, 'scripts', 'generate.js'), generateScript, 'utf-8');

    // 重新加载
    this.loadSkills();
  }
}

/**
 * 创建 SkillsManager 实例
 */
export function createSkillsManager(workspaceRoot: string): SkillsManager {
  return new SkillsManager(workspaceRoot);
}
