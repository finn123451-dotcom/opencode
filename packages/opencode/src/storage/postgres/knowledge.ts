import { getPool } from './connection';
import { generateEmbedding, storeEmbedding, searchSimilarEmbeddings } from './embedding';
import { CompleteTrajectoryData, trajectoryStorage } from './trajectory';
import { isAIEnabled } from './config';
import crypto from 'crypto';
import OpenAI from 'openai';

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return _openai;
}

export interface KnowledgeEntry {
  id?: string;
  trajectoryId?: string;
  sessionId?: string;
  title: string;
  content: string;
  category?: 'pattern' | 'solution' | 'error_fix' | 'best_practice' | 'general';
  keywords?: string[];
  confidenceScore?: number;
  usageCount?: number;
  metadata?: Record<string, any>;
}

export interface MemoryData {
  id?: string;
  type: 'user_preference' | 'project_context' | 'session_context' | 'global';
  scope: string;
  key: string;
  value: Record<string, any>;
  confidence?: number;
  sourceTrajectoryId?: string;
  metadata?: Record<string, any>;
}

export class KnowledgeBase {
  private _pool: ReturnType<typeof getPool> | null = null;

  private get pool() {
    if (!this._pool) {
      this._pool = getPool();
    }
    return this._pool;
  }

  async createKnowledge(data: KnowledgeEntry): Promise<string> {
    const id = data.id || crypto.randomUUID();
    
    const query = `
      INSERT INTO knowledge_base (
        id, trajectory_id, session_id, title, content, category,
        keywords, confidence_score, usage_count, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        title = COALESCE($4, knowledge_base.title),
        content = COALESCE($5, knowledge_base.content),
        category = COALESCE($6, knowledge_base.category),
        keywords = COALESCE($7, knowledge_base.keywords),
        confidence_score = COALESCE($8, knowledge_base.confidence_score),
        usage_count = COALESCE($9, knowledge_base.usage_count),
        metadata = COALESCE($10, knowledge_base.metadata)::jsonb,
        updated_at = NOW()
      RETURNING id
    `;

    await this.pool.query(query, [
      id,
      data.trajectoryId || null,
      data.sessionId || null,
      data.title,
      data.content,
      data.category || 'general',
      data.keywords || [],
      data.confidenceScore || 0.0,
      data.usageCount || 0,
      JSON.stringify(data.metadata || {}),
    ]);

    if (isAIEnabled()) {
      try {
        const embedding = await generateEmbedding(`${data.title} ${data.content}`);
        const embeddingId = await storeEmbedding('knowledge', id, `${data.title} ${data.content}`, embedding);
        
        await this.pool.query(
          'UPDATE knowledge_base SET embedding_id = $1 WHERE id = $2',
          [embeddingId, id]
        );
      } catch (error) {
        console.error('Failed to create embedding for knowledge entry:', error);
      }
    }

    return id;
  }

  async getKnowledge(knowledgeId: string): Promise<any> {
    const result = await this.pool.query(
      'SELECT * FROM knowledge_base WHERE id = $1',
      [knowledgeId]
    );
    return result.rows[0] || null;
  }

  async searchKnowledge(
    query: string,
    options: {
      category?: string;
      limit?: number;
      minConfidence?: number;
    } = {}
  ): Promise<any[]> {
    if (!isAIEnabled()) {
      console.warn('AI features are disabled. Search will return empty results.');
      return [];
    }
    
    const queryEmbedding = await generateEmbedding(query);
    
    let baseQuery = `
      SELECT kb.*, 1 - (ve.embedding <=> $1) as similarity
      FROM knowledge_base kb
      LEFT JOIN vector_embeddings ve ON kb.embedding_id = ve.id
      WHERE 1 = 1
    `;
    const params: any[] = [queryEmbedding];
    let paramIndex = 2;

    if (options.category) {
      baseQuery += ` AND kb.category = $${paramIndex++}`;
      params.push(options.category);
    }

    if (options.minConfidence !== undefined) {
      baseQuery += ` AND kb.confidence_score >= $${paramIndex++}`;
      params.push(options.minConfidence);
    }

    baseQuery += ` ORDER BY similarity DESC LIMIT $${paramIndex++}`;
    params.push(options.limit || 10);

    const result = await this.pool.query(baseQuery, params);
    return result.rows;
  }

  async updateKnowledgeUsage(knowledgeId: string): Promise<void> {
    await this.pool.query(
      'UPDATE knowledge_base SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = $1',
      [knowledgeId]
    );
  }

  async deleteKnowledge(knowledgeId: string): Promise<void> {
    await this.pool.query('DELETE FROM knowledge_base WHERE id = $1', [knowledgeId]);
  }

  async getKnowledgeByCategory(category: string, limit: number = 100): Promise<any[]> {
    const result = await this.pool.query(
      'SELECT * FROM knowledge_base WHERE category = $1 ORDER BY usage_count DESC, created_at DESC LIMIT $2',
      [category, limit]
    );
    return result.rows;
  }

  async getPopularKnowledge(limit: number = 20): Promise<any[]> {
    const result = await this.pool.query(
      'SELECT * FROM knowledge_base ORDER BY usage_count DESC, created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  }

  async generateKnowledgeFromTrajectory(trajectory: CompleteTrajectoryData): Promise<string[]> {
    if (!isAIEnabled()) {
      console.log('AI features are disabled. Skipping knowledge generation.');
      return [];
    }

    const knowledgeIds: string[] = [];

    try {
      const summary = await this.summarizeTrajectory(trajectory);
      const patterns = await this.extractPatterns(trajectory);
      const solutions = await this.extractSolutions(trajectory);
      const errorFixes = await this.extractErrorFixes(trajectory);

      const summaryKnowledge = await this.createKnowledge({
        trajectoryId: trajectory.trajectory.id,
        sessionId: trajectory.session.id,
        title: `会话摘要: ${trajectory.session.title || trajectory.trajectory.title || '未命名会话'}`,
        content: summary,
        category: 'general',
        keywords: this.extractKeywords(summary),
        confidenceScore: 0.9,
        metadata: {
          trajectoryId: trajectory.trajectory.id,
          messageCount: trajectory.messages.length,
          toolCallCount: trajectory.toolCalls.length,
          stepCount: trajectory.steps.length,
        },
      });
      knowledgeIds.push(summaryKnowledge);

      for (const pattern of patterns) {
        const patternKnowledge = await this.createKnowledge({
          trajectoryId: trajectory.trajectory.id,
          sessionId: trajectory.session.id,
          ...pattern,
        });
        knowledgeIds.push(patternKnowledge);
      }

      for (const solution of solutions) {
        const solutionKnowledge = await this.createKnowledge({
          trajectoryId: trajectory.trajectory.id,
          sessionId: trajectory.session.id,
          ...solution,
        });
        knowledgeIds.push(solutionKnowledge);
      }

      for (const errorFix of errorFixes) {
        const errorFixKnowledge = await this.createKnowledge({
          trajectoryId: trajectory.trajectory.id,
          sessionId: trajectory.session.id,
          ...errorFix,
        });
        knowledgeIds.push(errorFixKnowledge);
      }
    } catch (error) {
      console.error('Failed to generate knowledge from trajectory:', error);
    }

    return knowledgeIds;
  }

  private async summarizeTrajectory(trajectory: CompleteTrajectoryData): Promise<string> {
    const messages = trajectory.messages
      .map(m => `${m.role}: ${m.content.substring(0, 500)}`)
      .join('\n');

    const toolCalls = trajectory.toolCalls
      .map(tc => `${tc.tool_name}: ${JSON.stringify(tc.input)} -> ${tc.output?.substring(0, 200) || 'pending'}`)
      .join('\n');

    const prompt = `请总结以下AI编程会话的关键信息：

会话信息：
- 标题: ${trajectory.session.title || '未命名'}
- 目录: ${trajectory.session.directory || '未知'}
- 消息数: ${trajectory.messages.length}
- 工具调用数: ${trajectory.toolCalls.length}
- 步骤数: ${trajectory.steps.length}

消息历史：
${messages}

工具调用历史：
${toolCalls}

请提供：
1. 用户的主要需求和目标
2. AI采取的关键行动
3. 重要的技术决策
4. 最终结果和输出`;

    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'system',
            content: '你是一个AI助手，负责总结技术会话。请提供简洁、结构化的总结。',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2000,
        temperature: 0.3,
      });

      return response.choices[0]?.message?.content || '无法生成总结';
    } catch (error) {
      console.error('Failed to generate trajectory summary:', error);
      return '总结生成失败';
    }
  }

  private async extractPatterns(trajectory: CompleteTrajectoryData): Promise<KnowledgeEntry[]> {
    const patterns: KnowledgeEntry[] = [];

    try {
      const toolCallSequence = trajectory.toolCalls
        .map(tc => `${tc.tool_name}`)
        .join(', ');

      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'system',
            content: '你是一个模式识别专家。从AI编程会话中提取可复用的模式和最佳实践。',
          },
          {
            role: 'user',
            content: `从以下工具调用序列中提取模式和最佳实践：

工具调用序列: ${toolCallSequence}

消息内容:
${trajectory.messages.map(m => `${m.role}: ${m.content}`).join('\n')}

请提取2-5个最重要的模式和最佳实践，每个包括：
1. 模式名称（简洁描述）
2. 详细说明
3. 使用场景
4. 相关关键词

以JSON数组格式返回，每个元素包含：title, content, category('pattern'), keywords[]`,
          },
        ],
        max_tokens: 3000,
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content || '[]';
      const extractedPatterns = JSON.parse(content.match(/\[[\s\S]*\]/)?.[0] || '[]');
      
      for (const pattern of extractedPatterns) {
        patterns.push({
          title: pattern.title || '未命名模式',
          content: pattern.content || '',
          category: 'pattern',
          keywords: pattern.keywords || [],
          confidenceScore: 0.7,
        });
      }
    } catch (error) {
      console.error('Failed to extract patterns:', error);
    }

    return patterns;
  }

  private async extractSolutions(trajectory: CompleteTrajectoryData): Promise<KnowledgeEntry[]> {
    const solutions: KnowledgeEntry[] = [];

    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'system',
            content: '你是一个解决方案分析专家。从AI编程会话中提取解决方案和技术方案。',
          },
          {
            role: 'user',
            content: `从以下会话中提取解决特定问题的技术方案：

用户消息:
${trajectory.messages.filter(m => m.role === 'user').map(m => m.content).join('\n')}

工具调用和结果:
${trajectory.toolCalls.map(tc => `工具: ${tc.tool_name}\n输入: ${JSON.stringify(tc.input)}\n输出: ${tc.output || '无'}`).join('\n\n')}

步骤详情:
${trajectory.steps.map(s => `类型: ${s.stepType}\n内容: ${s.content}\n结果: ${JSON.stringify(s.outputData)}`).join('\n')}

请提取2-5个最重要的解决方案，每个包括：
1. 问题描述
2. 解决方案
3. 实施步骤
4. 注意事项
5. 相关关键词

以JSON数组格式返回，每个元素包含：title, content, category('solution'), keywords[]`,
          },
        ],
        max_tokens: 3000,
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content || '[]';
      const extractedSolutions = JSON.parse(content.match(/\[[\s\S]*\]/)?.[0] || '[]');
      
      for (const solution of extractedSolutions) {
        solutions.push({
          title: solution.title || '未命名解决方案',
          content: solution.content || '',
          category: 'solution',
          keywords: solution.keywords || [],
          confidenceScore: 0.8,
        });
      }
    } catch (error) {
      console.error('Failed to extract solutions:', error);
    }

    return solutions;
  }

  private async extractErrorFixes(trajectory: CompleteTrajectoryData): Promise<KnowledgeEntry[]> {
    const errorFixes: KnowledgeEntry[] = [];

    try {
      const errorSteps = trajectory.steps.filter(s => 
        s.stepType === 'error' || 
        (s.metadata && s.metadata.error) ||
        (s.outputData && s.outputData.error)
      );

      if (errorSteps.length === 0) {
        return errorFixes;
      }

      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'system',
            content: '你是一个错误处理专家。从AI编程会话中提取错误和修复方案。',
          },
          {
            role: 'user',
            content: `从以下错误信息中提取错误类型和修复方案：

错误步骤:
${errorSteps.map(s => `类型: ${s.stepType}\n内容: ${s.content}\n数据: ${JSON.stringify(s.outputData || s.metadata)}`).join('\n')}

完整的工具调用:
${trajectory.toolCalls.map(tc => `工具: ${tc.tool_name}\n状态: ${tc.status}\n输出: ${tc.output || '无'}`).join('\n')}

请提取1-3个最重要的错误和修复方案，每个包括：
1. 错误描述
2. 错误原因分析
3. 修复方案
4. 预防措施
5. 相关关键词

以JSON数组格式返回，每个元素包含：title, content, category('error_fix'), keywords[]`,
          },
        ],
        max_tokens: 2000,
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content || '[]';
      const extractedErrorFixes = JSON.parse(content.match(/\[[\s\S]*\]/)?.[0] || '[]');
      
      for (const errorFix of extractedErrorFixes) {
        errorFixes.push({
          title: errorFix.title || '未命名错误修复',
          content: errorFix.content || '',
          category: 'error_fix',
          keywords: errorFix.keywords || [],
          confidenceScore: 0.85,
        });
      }
    } catch (error) {
      console.error('Failed to extract error fixes:', error);
    }

    return errorFixes;
  }

  private extractKeywords(text: string): string[] {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);

    const frequency: Record<string, number> = {};
    for (const word of words) {
      frequency[word] = (frequency[word] || 0) + 1;
    }

    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }
}

export class MemoryManager {
  private _pool: ReturnType<typeof getPool> | null = null;

  private get pool() {
    if (!this._pool) {
      this._pool = getPool();
    }
    return this._pool;
  }

  async createMemory(data: MemoryData): Promise<string> {
    const id = data.id || crypto.randomUUID();

    const query = `
      INSERT INTO memories (id, type, scope, key, value, confidence, source_trajectory_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (type, scope, key) DO UPDATE SET
        value = $5,
        confidence = COALESCE($6, memories.confidence),
        source_trajectory_id = COALESCE($7, memories.source_trajectory_id),
        metadata = COALESCE($8, memories.metadata)::jsonb,
        updated_at = NOW()
      RETURNING id
    `;

    await this.pool.query(query, [
      id,
      data.type,
      data.scope,
      data.key,
      JSON.stringify(data.value),
      data.confidence || 1.0,
      data.sourceTrajectoryId || null,
      JSON.stringify(data.metadata || {}),
    ]);

    return id;
  }

  async getMemory(type: string, scope: string, key: string): Promise<any> {
    const result = await this.pool.query(
      'SELECT * FROM memories WHERE type = $1 AND scope = $2 AND key = $3',
      [type, scope, key]
    );
    return result.rows[0] || null;
  }

  async getMemoriesByScope(scope: string): Promise<any[]> {
    const result = await this.pool.query(
      'SELECT * FROM memories WHERE scope = $1 ORDER BY confidence DESC, updated_at DESC',
      [scope]
    );
    return result.rows;
  }

  async getMemoriesByType(type: string): Promise<any[]> {
    const result = await this.pool.query(
      'SELECT * FROM memories WHERE type = $1 ORDER BY confidence DESC, updated_at DESC',
      [type]
    );
    return result.rows;
  }

  async deleteMemory(type: string, scope: string, key: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM memories WHERE type = $1 AND scope = $2 AND key = $3',
      [type, scope, key]
    );
  }

  async updateMemoryConfidence(type: string, scope: string, key: string, confidence: number): Promise<void> {
    await this.pool.query(
      'UPDATE memories SET confidence = $1, updated_at = NOW() WHERE type = $2 AND scope = $3 AND key = $4',
      [confidence, type, scope, key]
    );
  }

  async extractAndStoreMemories(trajectory: CompleteTrajectoryData): Promise<void> {
    try {
      const userMessages = trajectory.messages.filter(m => m.role === 'user');
      const assistantMessages = trajectory.messages.filter(m => m.role === 'assistant');

      if (userMessages.length > 0) {
        await this.createMemory({
          type: 'session_context',
          scope: trajectory.session.id,
          key: 'user_goals',
          value: {
            goals: userMessages.map(m => m.content),
          },
          sourceTrajectoryId: trajectory.trajectory.id,
        });
      }

      for (const toolCall of trajectory.toolCalls) {
        if (toolCall.status === 'completed' && toolCall.output) {
          await this.createMemory({
            type: 'session_context',
            scope: trajectory.session.id,
            key: `tool_result_${toolCall.tool_name}`,
            value: {
              toolName: toolCall.tool_name,
              input: toolCall.input,
              output: toolCall.output,
            },
            sourceTrajectoryId: trajectory.trajectory.id,
          });
        }
      }

      await this.createMemory({
        type: 'session_context',
        scope: trajectory.session.id,
        key: 'session_summary',
        value: {
          messageCount: trajectory.messages.length,
          toolCallCount: trajectory.toolCalls.length,
          stepCount: trajectory.steps.length,
          title: trajectory.session.title,
          directory: trajectory.session.directory,
        },
        sourceTrajectoryId: trajectory.trajectory.id,
      });

      if (trajectory.session.projectId) {
        await this.createMemory({
          type: 'project_context',
          scope: trajectory.session.projectId,
          key: 'project_activity',
          value: {
            lastSessionId: trajectory.session.id,
            lastActivity: new Date().toISOString(),
            totalSessions: 1,
          },
          confidence: 0.9,
        });
      }
    } catch (error) {
      console.error('Failed to extract and store memories:', error);
    }
  }
}

export const knowledgeBase = new KnowledgeBase();
export const memoryManager = new MemoryManager();
