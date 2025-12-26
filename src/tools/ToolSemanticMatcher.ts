/**
 * 工具语义匹配器 - 根据用户意图智能选择工具
 */

interface ToolIntent {
  toolName: string;
  action?: string;
  description: string;
  keywords: string[];
  examples: string[];
}

/**
 * 工具意图定义
 */
const TOOL_INTENTS: ToolIntent[] = [
  {
    toolName: 'lsp_query',
    action: 'symbols',
    description: '查看文件代码结构，获取函数、类、方法列表',
    keywords: ['函数', '方法', '类', '结构', '符号', 'functions', 'methods', 'classes', 'structure'],
    examples: [
      '这个文件有哪些函数',
      '文件里包含什么类',
      '代码结构是什么',
      '有什么方法'
    ]
  },
  {
    toolName: 'lsp_query', 
    action: 'definitions',
    description: '查找变量、函数、类的定义位置',
    keywords: ['定义', '在哪里定义', '来自哪里', 'definition', 'defined', 'where'],
    examples: [
      'xxx在哪里定义的',
      '这个变量是在哪定义的',
      '函数定义在哪',
      'this.app在哪里定义'
    ]
  },
  {
    toolName: 'lsp_query',
    action: 'references', 
    description: '查找符号的所有引用位置',
    keywords: ['引用', '调用', '使用', '在哪里用', 'references', 'used', 'called'],
    examples: [
      'xxx在哪些地方被调用',
      '这个函数在哪里使用',
      '谁调用了这个方法',
      '引用位置'
    ]
  },
  {
    toolName: 'lsp_query',
    action: 'workspace_symbols',
    description: '在整个项目中搜索符号',
    keywords: ['搜索', '查找', '项目中', '全局', 'search', 'find', 'project'],
    examples: [
      '项目中有没有xxx类',
      '搜索UserService',
      '找找ApiClient',
      '全局搜索'
    ]
  },
  {
    toolName: 'read_file',
    action: undefined,
    description: '读取文件内容，查看源代码',
    keywords: ['读取', '查看', '内容', '源码', 'read', 'view', 'content', 'source'],
    examples: [
      '读取这个文件',
      '查看文件内容', 
      '显示源代码',
      '文件里写了什么'
    ]
  }
];

/**
 * 工具语义匹配器
 */
export class ToolSemanticMatcher {
  
  /**
   * 根据用户消息匹配最合适的工具
   */
  matchTool(userMessage: string): {
    toolName: string;
    action?: string;
    confidence: number;
    reason: string;
  } | null {
    
    const lowerMessage = userMessage.toLowerCase();
    let bestMatch: ToolIntent | null = null;
    let bestScore = 0;
    let matchReason = '';

    // 1. 精确模式匹配
    for (const intent of TOOL_INTENTS) {
      // 检查示例匹配
      for (const example of intent.examples) {
        if (this.fuzzyMatch(lowerMessage, example.toLowerCase())) {
          const score = 0.9;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = intent;
            matchReason = `匹配示例: "${example}"`;
          }
        }
      }
      
      // 检查关键词匹配
      let keywordMatches = 0;
      for (const keyword of intent.keywords) {
        if (lowerMessage.includes(keyword.toLowerCase())) {
          keywordMatches++;
        }
      }
      
      if (keywordMatches > 0) {
        const score = 0.7 * (keywordMatches / intent.keywords.length);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = intent;
          matchReason = `匹配关键词: ${keywordMatches}/${intent.keywords.length}`;
        }
      }
    }

    // 2. 特殊模式检测
    if (!bestMatch || bestScore < 0.5) {
      // 检测定义查询模式：包含行号 + "定义"相关词
      if (this.isDefinitionQuery(lowerMessage)) {
        bestMatch = TOOL_INTENTS.find(t => t.toolName === 'lsp_query' && t.action === 'definitions') || null;
        bestScore = 0.8;
        matchReason = '检测到定义查询模式（包含行号和定义相关词）';
      }
      // 检测结构查询模式
      else if (this.isStructureQuery(lowerMessage)) {
        bestMatch = TOOL_INTENTS.find(t => t.toolName === 'lsp_query' && t.action === 'symbols') || null;
        bestScore = 0.8;
        matchReason = '检测到结构查询模式';
      }
    }

    if (bestMatch && bestScore >= 0.5) {
      return {
        toolName: bestMatch.toolName,
        action: bestMatch.action,
        confidence: bestScore,
        reason: matchReason
      };
    }

    return null;
  }

  /**
   * 模糊匹配
   */
  private fuzzyMatch(text: string, pattern: string): boolean {
    const textWords = text.split(/\s+/);
    const patternWords = pattern.split(/\s+/);
    
    let matchCount = 0;
    for (const patternWord of patternWords) {
      if (textWords.some(textWord => 
        textWord.includes(patternWord) || patternWord.includes(textWord)
      )) {
        matchCount++;
      }
    }
    
    return matchCount / patternWords.length >= 0.6;
  }

  /**
   * 检测是否是定义查询
   */
  private isDefinitionQuery(message: string): boolean {
    const hasLineNumber = /\d+行|\d+\s*line/i.test(message);
    const hasDefinitionWords = /定义|在哪|来自|definition|defined|where/i.test(message);
    return hasLineNumber && hasDefinitionWords;
  }

  /**
   * 检测是否是结构查询
   */
  private isStructureQuery(message: string): boolean {
    const hasFileRef = /文件|\.ts|\.js|\.py/i.test(message);
    const hasStructureWords = /函数|方法|类|结构|包含|有哪些|functions|methods|classes|structure/i.test(message);
    return hasFileRef && hasStructureWords;
  }
}

// 导出单例
export const toolSemanticMatcher = new ToolSemanticMatcher();