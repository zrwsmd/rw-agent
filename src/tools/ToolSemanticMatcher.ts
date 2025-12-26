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
    keywords: ['函数', '方法', '类', '结构', '符号', '包含什么', '有哪些', '都有什么', 'functions', 'methods', 'classes', 'structure', 'symbols'],
    examples: [
      '这个文件有哪些函数',
      '文件里包含什么类',
      '代码结构是什么',
      '有什么方法',
      '显示所有函数',
      '列出类和方法'
    ]
  },
  {
    toolName: 'lsp_query', 
    action: 'definitions',
    description: '查找变量、函数、类的定义位置',
    keywords: ['定义', '在哪里定义', '在哪定义', '来自哪里', '是什么', 'definition', 'defined', 'where'],
    examples: [
      'xxx在哪里定义的',
      '这个变量是在哪定义的',
      '函数定义在哪',
      'this.app在哪里定义',
      '这个类来自哪里',
      '变量的定义位置'
    ]
  },
  {
    toolName: 'lsp_query',
    action: 'references', 
    description: '查找符号的所有引用位置',
    keywords: ['引用', '调用', '使用', '在哪里用', '在哪些地方', '谁调用', '谁使用', 'references', 'used', 'called'],
    examples: [
      'xxx在哪些地方被调用',
      '这个函数在哪里使用',
      '谁调用了这个方法',
      '引用位置',
      '使用情况',
      '调用关系'
    ]
  },
  {
    toolName: 'lsp_query',
    action: 'workspace_symbols',
    description: '在整个项目中搜索符号',
    keywords: ['搜索', '查找', '项目中', '全局', '整个项目', '工作区', 'search', 'find', 'project', 'workspace'],
    examples: [
      '项目中有没有xxx类',
      '搜索UserService',
      '找找ApiClient',
      '全局搜索',
      '整个项目中查找',
      '工作区搜索'
    ]
  },
  {
    toolName: 'read_file',
    action: undefined,
    description: '读取文件内容，查看源代码',
    keywords: ['读取', '查看', '内容', '源码', '文件内容', '显示文件', 'read', 'view', 'content', 'source', 'show'],
    examples: [
      '读取这个文件',
      '查看文件内容', 
      '显示源代码',
      '文件里写了什么',
      '打开文件',
      '看看文件'
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

    console.log('[ToolSemanticMatcher] 分析用户消息:', userMessage);

    // 1. 精确模式匹配 - 提高权重
    for (const intent of TOOL_INTENTS) {
      // 检查示例匹配 - 提高分数
      for (const example of intent.examples) {
        if (this.fuzzyMatch(lowerMessage, example.toLowerCase())) {
          const score = 0.95; // 提高示例匹配分数
          if (score > bestScore) {
            bestScore = score;
            bestMatch = intent;
            matchReason = `精确匹配示例: "${example}"`;
            console.log('[ToolSemanticMatcher] 示例匹配:', intent.toolName, intent.action, score);
          }
        }
      }
      
      // 检查关键词匹配 - 改进算法
      let keywordMatches = 0;
      let totalKeywords = intent.keywords.length;
      
      for (const keyword of intent.keywords) {
        if (lowerMessage.includes(keyword.toLowerCase())) {
          keywordMatches++;
        }
      }
      
      if (keywordMatches > 0) {
        // 提高关键词匹配的权重，特别是多个关键词匹配时
        const score = 0.6 + (keywordMatches / totalKeywords) * 0.3;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = intent;
          matchReason = `关键词匹配: ${keywordMatches}/${totalKeywords} (${intent.keywords.filter(k => lowerMessage.includes(k.toLowerCase())).join(', ')})`;
          console.log('[ToolSemanticMatcher] 关键词匹配:', intent.toolName, intent.action, score);
        }
      }
    }

    // 2. 特殊模式检测 - 提高权重
    if (!bestMatch || bestScore < 0.7) {
      // 检测定义查询模式：包含行号 + "定义"相关词
      if (this.isDefinitionQuery(lowerMessage)) {
        bestMatch = TOOL_INTENTS.find(t => t.toolName === 'lsp_query' && t.action === 'definitions') || null;
        bestScore = 0.9;
        matchReason = '特殊模式：定义查询（包含行号和定义相关词）';
        console.log('[ToolSemanticMatcher] 定义查询模式匹配');
      }
      // 检测结构查询模式
      else if (this.isStructureQuery(lowerMessage)) {
        bestMatch = TOOL_INTENTS.find(t => t.toolName === 'lsp_query' && t.action === 'symbols') || null;
        bestScore = 0.9;
        matchReason = '特殊模式：结构查询';
        console.log('[ToolSemanticMatcher] 结构查询模式匹配');
      }
      // 检测引用查询模式
      else if (this.isReferenceQuery(lowerMessage)) {
        bestMatch = TOOL_INTENTS.find(t => t.toolName === 'lsp_query' && t.action === 'references') || null;
        bestScore = 0.9;
        matchReason = '特殊模式：引用查询';
        console.log('[ToolSemanticMatcher] 引用查询模式匹配');
      }
    }

    // 3. 降低阈值，但确保有明确意图
    const threshold = 0.5;
    if (bestMatch && bestScore >= threshold) {
      console.log('[ToolSemanticMatcher] 最终匹配结果:', {
        toolName: bestMatch.toolName,
        action: bestMatch.action,
        confidence: bestScore,
        reason: matchReason
      });
      
      return {
        toolName: bestMatch.toolName,
        action: bestMatch.action,
        confidence: bestScore,
        reason: matchReason
      };
    }

    console.log('[ToolSemanticMatcher] 未找到合适的工具匹配');
    return null;
  }

  /**
   * 模糊匹配 - 改进算法
   */
  private fuzzyMatch(text: string, pattern: string): boolean {
    const textWords = text.split(/\s+/).filter(w => w.length > 0);
    const patternWords = pattern.split(/\s+/).filter(w => w.length > 0);
    
    if (patternWords.length === 0) return false;
    
    let matchCount = 0;
    for (const patternWord of patternWords) {
      const found = textWords.some(textWord => {
        // 完全匹配
        if (textWord === patternWord) return true;
        // 包含匹配
        if (textWord.includes(patternWord) || patternWord.includes(textWord)) return true;
        // 编辑距离匹配（简单版本）
        if (this.simpleEditDistance(textWord, patternWord) <= 1 && Math.min(textWord.length, patternWord.length) >= 3) return true;
        return false;
      });
      
      if (found) matchCount++;
    }
    
    // 提高匹配阈值
    const matchRatio = matchCount / patternWords.length;
    return matchRatio >= 0.7; // 提高到70%匹配率
  }

  /**
   * 简单编辑距离计算
   */
  private simpleEditDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  }

  /**
   * 检测是否是定义查询
   */
  private isDefinitionQuery(message: string): boolean {
    const hasLineNumber = /\d+行|\d+\s*line/i.test(message);
    const hasDefinitionWords = /定义|在哪里定义|在哪定义|来自哪里|definition|defined|where.*defined/i.test(message);
    const hasVariableRef = /这个|该|此|this\.|\..*在哪/i.test(message);
    
    return (hasLineNumber && hasDefinitionWords) || (hasVariableRef && hasDefinitionWords);
  }

  /**
   * 检测是否是结构查询
   */
  private isStructureQuery(message: string): boolean {
    const hasFileRef = /文件|\.ts|\.js|\.py|代码|源码/i.test(message);
    const hasStructureWords = /函数|方法|类|结构|包含|有哪些|都有什么|functions|methods|classes|structure/i.test(message);
    const hasListWords = /列表|清单|所有|全部|list|all/i.test(message);
    
    return (hasFileRef && hasStructureWords) || (hasStructureWords && hasListWords);
  }

  /**
   * 检测是否是引用查询
   */
  private isReferenceQuery(message: string): boolean {
    const hasReferenceWords = /引用|调用|使用|在哪里用|在哪些地方|谁调用|谁使用|references|used|called|where.*used|where.*called/i.test(message);
    const hasVariableRef = /这个|该|此|函数|方法|变量|类/i.test(message);
    
    return hasReferenceWords && hasVariableRef;
  }
}

// 导出单例
export const toolSemanticMatcher = new ToolSemanticMatcher();