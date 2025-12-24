/**
 * 向量语义匹配器 - 使用 embedding 计算语义相似度
 */

// 动态导入 transformers（避免 ESM 问题）
let pipeline: any = null;
let embeddingModel: any = null;
let isLoading = false;
let loadPromise: Promise<void> | null = null;

/**
 * 初始化 embedding 模型
 */
async function initModel(): Promise<void> {
  if (embeddingModel) return;
  if (loadPromise) return loadPromise;

  isLoading = true;
  loadPromise = (async () => {
    try {
      console.log('[SemanticMatcher] 开始动态导入 transformers...');
      // 动态导入
      const transformers = await import('@xenova/transformers');
      pipeline = transformers.pipeline;
      
      console.log('[SemanticMatcher] 正在加载 embedding 模型 (首次加载需要下载，请稍候)...');
      // 使用轻量级多语言模型
      embeddingModel = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true, // 使用量化版本，更小更快
      });
      console.log('[SemanticMatcher] ✅ Embedding 模型加载完成');
    } catch (error) {
      console.error('[SemanticMatcher] ❌ 模型加载失败:', error);
      embeddingModel = null;
      throw error;
    } finally {
      isLoading = false;
    }
  })();

  return loadPromise;
}

/**
 * 计算文本的 embedding 向量
 */
async function getEmbedding(text: string): Promise<number[]> {
  await initModel();
  
  if (!embeddingModel) {
    throw new Error('Embedding 模型未初始化');
  }

  const output = await embeddingModel(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * 计算两个向量的余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Skill 描述信息
 */
export interface SkillDescription {
  name: string;
  description: string;
  keywords: string[];
  embedding?: number[];
}

/**
 * 语义匹配器
 */
export class SemanticMatcher {
  private skillEmbeddings: Map<string, number[]> = new Map();
  private initialized = false;
  private similarityThreshold = 0.5; // 提高阈值，减少误匹配

  /**
   * 初始化 - 预计算所有 skill 的 embedding
   */
  async initialize(skills: SkillDescription[]): Promise<void> {
    if (this.initialized) return;

    console.log('[SemanticMatcher] 开始初始化，计算 skill embeddings...');
    
    for (const skill of skills) {
      // 组合 skill 的描述文本
      const text = this.buildSkillText(skill);
      try {
        const embedding = await getEmbedding(text);
        this.skillEmbeddings.set(skill.name, embedding);
        console.log(`[SemanticMatcher] Skill "${skill.name}" embedding 已计算`);
      } catch (error) {
        console.error(`[SemanticMatcher] Skill "${skill.name}" embedding 计算失败:`, error);
      }
    }

    this.initialized = true;
    console.log('[SemanticMatcher] 初始化完成');
  }

  /**
   * 构建 skill 的描述文本（用于 embedding）
   */
  private buildSkillText(skill: SkillDescription): string {
    const parts = [
      skill.name.replace(/-/g, ' '), // jpg-to-png -> jpg to png
      skill.description,
      skill.keywords.length > 0 ? skill.keywords.join(' ') : '',
    ];
    return parts.filter(Boolean).join(' ');
  }

  /**
   * 提取用户消息中的意图部分（过滤代码内容）
   */
  private extractIntent(message: string): string {
    // 移除代码块
    let intent = message.replace(/```[\s\S]*?```/g, '');
    // 移除行内代码
    intent = intent.replace(/`[^`]+`/g, '');
    // 保留完整意图
    intent = intent.trim();
    // 如果太短，使用原始消息
    return intent.length > 5 ? intent : message;
  }

  /**
   * 语义匹配 - 返回最匹配的 skill
   */
  async match(userMessage: string, skills: SkillDescription[]): Promise<{
    skill: SkillDescription | null;
    similarity: number;
    allScores: Array<{ name: string; similarity: number }>;
  }> {
    // 确保已初始化
    if (!this.initialized) {
      await this.initialize(skills);
    }

    // 提取用户意图
    const intent = this.extractIntent(userMessage);
    console.log('[SemanticMatcher] 提取的用户意图:', intent);

    // 计算用户消息的 embedding
    let userEmbedding: number[];
    try {
      userEmbedding = await getEmbedding(intent);
    } catch (error) {
      console.error('[SemanticMatcher] 用户消息 embedding 计算失败:', error);
      return { skill: null, similarity: 0, allScores: [] };
    }

    // 计算与每个 skill 的相似度
    const scores: Array<{ skill: SkillDescription; similarity: number }> = [];
    
    for (const skill of skills) {
      const skillEmbedding = this.skillEmbeddings.get(skill.name);
      if (!skillEmbedding) continue;

      const similarity = cosineSimilarity(userEmbedding, skillEmbedding);
      scores.push({ skill, similarity });
    }

    // 按相似度排序
    scores.sort((a, b) => b.similarity - a.similarity);

    const allScores = scores.map(s => ({ name: s.skill.name, similarity: s.similarity }));
    console.log('[SemanticMatcher] 相似度得分:', allScores);

    // 返回最高分且超过阈值的 skill
    if (scores.length > 0 && scores[0].similarity >= this.similarityThreshold) {
      console.log(`[SemanticMatcher] 匹配到 skill: ${scores[0].skill.name}, 相似度: ${scores[0].similarity.toFixed(3)}`);
      return {
        skill: scores[0].skill,
        similarity: scores[0].similarity,
        allScores,
      };
    }

    console.log('[SemanticMatcher] 未找到匹配的 skill（相似度低于阈值）');
    return { skill: null, similarity: 0, allScores };
  }

  /**
   * 设置相似度阈值
   */
  setThreshold(threshold: number): void {
    this.similarityThreshold = Math.max(0, Math.min(1, threshold));
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 重置（清除缓存的 embeddings）
   */
  reset(): void {
    this.skillEmbeddings.clear();
    this.initialized = false;
  }
}

// 导出单例
export const semanticMatcher = new SemanticMatcher();
