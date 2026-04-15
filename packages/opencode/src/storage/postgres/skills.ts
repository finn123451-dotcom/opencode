import { getPool, transaction } from "./connection"
import { generateEmbedding, storeEmbedding, searchSimilarEmbeddings } from "./embedding"
import { isAIEnabled } from "./config"
import { v4 as uuidv4 } from "uuid"
import { Log } from "../../util/log"

const logger = Log.create({ service: "skills-storage" })

// ============================================
// Types
// ============================================

export interface SkillSubtaskData {
  id?: string
  sessionId: string
  parentStepId?: string
  description: string
  status: "pending" | "completed" | "failed"
  startTime?: Date
  endTime?: Date
  result?: string
  error?: string
  toolNames?: string[]
  messageCount?: number
  toolCount?: number
}

export interface CapabilityClusterData {
  id?: string
  clusterId: number
  centroid?: number[]
  size: number
  patternSummary?: string
  toolNames?: string[]
  successRate?: number
  avgDurationMs?: number
  status: "pending" | "approved" | "rejected"
}

export interface CapabilityData {
  id?: string
  name: string
  description: string
  triggerPatterns?: string[]
  inputSchema?: Record<string, any>
  outputSchema?: Record<string, any>
  lessonsSource?: Record<string, any>[]
  variations?: Record<string, any>[]
  qualityScore?: number
  successRate?: number
  avgDurationMs?: number
  sampleCount?: number
  mdContent?: string
  reviewStatus: "pending" | "approved" | "rejected"
  createdBy: "auto" | "manual"
  version?: number
}

export interface SkillData {
  id?: string
  name: string
  description: string
  usageScenarios?: string[]
  mdContent?: string
  triggerConfig: {
    type: "semantic" | "error_pattern" | "context"
    condition: string
    weight: number
  }[]
  chainConfig: {
    capabilityId: string
    role: "required" | "optional" | "fallback"
    order: number
  }[]
  errorRecovery?: Record<string, any>
  effectiveness?: {
    successRate: number
    timesUsed: number
  }
  reviewStatus: "pending" | "approved" | "rejected"
  version?: number
}

export interface SkillCapabilityData {
  id?: string
  skillId: string
  capabilityId: string
  role: "required" | "optional" | "fallback"
  orderIndex: number
}

export interface CapabilityMetricData {
  id?: string
  capabilityId: string
  sessionId?: string
  subtaskId?: string
  timesTriggered?: number
  timesUsed?: number
  adoptionRate?: number
  success?: boolean
  durationMs?: number
  timeSavedMs?: number
  relevanceScore?: number
}

export interface SkillFeedbackData {
  id?: string
  skillId: string
  sessionId: string
  adopted: boolean
  result?: "success" | "failure"
  timeSavedMs?: number
  userFeedback?: string
}

// ============================================
// SkillSubtask CRUD
// ============================================

export class SkillSubtaskStorage {
  private pool = getPool()

  async create(data: SkillSubtaskData): Promise<string> {
    const id = data.id || uuidv4()
    const query = `
      INSERT INTO skill_subtasks (
        id, session_id, parent_step_id, description, status,
        start_time, end_time, result, error, tool_names,
        message_count, tool_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        description = COALESCE($4, skill_subtasks.description),
        status = COALESCE($5, skill_subtasks.status),
        end_time = COALESCE($7, skill_subtasks.end_time),
        result = COALESCE($8, skill_subtasks.result),
        error = COALESCE($9, skill_subtasks.error),
        tool_names = COALESCE($10, skill_subtasks.tool_names),
        message_count = COALESCE($11, skill_subtasks.message_count),
        tool_count = COALESCE($12, skill_subtasks.tool_count),
        updated_at = NOW()
      RETURNING id
    `

    const result = await this.pool.query(query, [
      id,
      data.sessionId,
      data.parentStepId || null,
      data.description,
      data.status,
      data.startTime || null,
      data.endTime || null,
      data.result || null,
      data.error || null,
      data.toolNames || null,
      data.messageCount || 0,
      data.toolCount || 0,
    ])

    return result.rows[0].id
  }

  async update(id: string, updates: Partial<SkillSubtaskData>): Promise<void> {
    const setClauses: string[] = []
    const values: any[] = []
    let paramIndex = 1

    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`)
      values.push(updates.status)
    }
    if (updates.endTime !== undefined) {
      setClauses.push(`end_time = $${paramIndex++}`)
      values.push(updates.endTime)
    }
    if (updates.result !== undefined) {
      setClauses.push(`result = $${paramIndex++}`)
      values.push(updates.result)
    }
    if (updates.error !== undefined) {
      setClauses.push(`error = $${paramIndex++}`)
      values.push(updates.error)
    }
    if (updates.toolNames !== undefined) {
      setClauses.push(`tool_names = $${paramIndex++}`)
      values.push(updates.toolNames)
    }

    if (setClauses.length === 0) return

    setClauses.push(`updated_at = NOW()`)
    values.push(id)
    await this.pool.query(`UPDATE skill_subtasks SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`, values)
  }

  async getById(id: string): Promise<any> {
    const result = await this.pool.query("SELECT * FROM skill_subtasks WHERE id = $1", [id])
    return result.rows[0] || null
  }

  async getBySession(sessionId: string): Promise<any[]> {
    const result = await this.pool.query(
      "SELECT * FROM skill_subtasks WHERE session_id = $1 ORDER BY created_at DESC",
      [sessionId],
    )
    return result.rows
  }

  async getRecent(limit: number = 100): Promise<any[]> {
    const result = await this.pool.query("SELECT * FROM skill_subtasks ORDER BY created_at DESC LIMIT $1", [limit])
    return result.rows
  }

  async getCompletedForClustering(days: number = 7, limit: number = 1000): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT * FROM skill_subtasks 
       WHERE status = 'completed' 
       AND end_time > NOW() - INTERVAL '${days} days'
       ORDER BY created_at DESC 
       LIMIT $1`,
      [limit],
    )
    return result.rows
  }
}

// ============================================
// CapabilityCluster CRUD
// ============================================

export class CapabilityClusterStorage {
  private pool = getPool()

  async create(data: CapabilityClusterData): Promise<string> {
    const id = data.id || uuidv4()
    const query = `
      INSERT INTO capability_clusters (
        id, cluster_id, centroid, size, pattern_summary,
        tool_names, success_rate, avg_duration_ms, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        size = COALESCE($4, capability_clusters.size),
        pattern_summary = COALESCE($5, capability_clusters.pattern_summary),
        tool_names = COALESCE($6, capability_clusters.tool_names),
        success_rate = COALESCE($7, capability_clusters.success_rate),
        status = COALESCE($9, capability_clusters.status)
      RETURNING id
    `

    const result = await this.pool.query(query, [
      id,
      data.clusterId,
      data.centroid || null,
      data.size,
      data.patternSummary || null,
      data.toolNames || null,
      data.successRate || null,
      data.avgDurationMs || null,
      data.status,
    ])

    return result.rows[0].id
  }

  async getByClusterId(clusterId: number): Promise<any[]> {
    const result = await this.pool.query("SELECT * FROM capability_clusters WHERE cluster_id = $1", [clusterId])
    return result.rows
  }

  async getPending(): Promise<any[]> {
    const result = await this.pool.query("SELECT * FROM capability_clusters WHERE status = 'pending'")
    return result.rows
  }

  async updateStatus(id: string, status: "pending" | "approved" | "rejected"): Promise<void> {
    await this.pool.query("UPDATE capability_clusters SET status = $1 WHERE id = $2", [status, id])
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM capability_clusters WHERE id IN (SELECT id FROM skill_subtasks WHERE session_id = $1)",
      [sessionId],
    )
  }
}

// ============================================
// Capability CRUD
// ============================================

export class CapabilityStorage {
  private pool = getPool()

  async create(data: CapabilityData): Promise<string> {
    const id = data.id || uuidv4()
    const query = `
      INSERT INTO capabilities (
        id, name, description, trigger_patterns, input_schema, output_schema,
        lessons_source, variations, quality_score, success_rate, avg_duration_ms,
        sample_count, md_content, review_status, created_by, version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (name) DO UPDATE SET
        description = COALESCE($2, capabilities.description),
        trigger_patterns = COALESCE($4, capabilities.trigger_patterns),
        md_content = COALESCE($13, capabilities.md_content),
        quality_score = COALESCE($9, capabilities.quality_score),
        review_status = COALESCE($14, capabilities.review_status),
        updated_at = NOW()
      RETURNING id
    `

    const result = await this.pool.query(query, [
      id,
      data.name,
      data.description,
      JSON.stringify(data.triggerPatterns || []),
      JSON.stringify(data.inputSchema || {}),
      JSON.stringify(data.outputSchema || {}),
      JSON.stringify(data.lessonsSource || []),
      JSON.stringify(data.variations || []),
      data.qualityScore || 0,
      data.successRate || 0,
      data.avgDurationMs || null,
      data.sampleCount || 0,
      data.mdContent || null,
      data.reviewStatus,
      data.createdBy || "auto",
      data.version || 1,
    ])

    return result.rows[0].id
  }

  async getById(id: string): Promise<any> {
    const result = await this.pool.query("SELECT * FROM capabilities WHERE id = $1", [id])
    return result.rows[0] || null
  }

  async getByName(name: string): Promise<any> {
    const result = await this.pool.query("SELECT * FROM capabilities WHERE name = $1", [name])
    return result.rows[0] || null
  }

  async getAll(): Promise<any[]> {
    const result = await this.pool.query("SELECT * FROM capabilities ORDER BY created_at DESC")
    return result.rows
  }

  async getApproved(): Promise<any[]> {
    const result = await this.pool.query(
      "SELECT * FROM capabilities WHERE review_status = 'approved' ORDER BY quality_score DESC",
    )
    return result.rows
  }

  async getPending(): Promise<any[]> {
    const result = await this.pool.query(
      "SELECT * FROM capabilities WHERE review_status = 'pending' ORDER BY created_at DESC",
    )
    return result.rows
  }

  async updateReviewStatus(id: string, status: "pending" | "approved" | "rejected"): Promise<void> {
    await this.pool.query("UPDATE capabilities SET review_status = $1, updated_at = NOW() WHERE id = $2", [status, id])
  }

  async updateMetrics(
    id: string,
    updates: { successRate?: number; avgDurationMs?: number; sampleCount?: number },
  ): Promise<void> {
    const setClauses: string[] = []
    const values: any[] = []
    let paramIndex = 1

    if (updates.successRate !== undefined) {
      setClauses.push(`success_rate = $${paramIndex++}`)
      values.push(updates.successRate)
    }
    if (updates.avgDurationMs !== undefined) {
      setClauses.push(`avg_duration_ms = $${paramIndex++}`)
      values.push(updates.avgDurationMs)
    }
    if (updates.sampleCount !== undefined) {
      setClauses.push(`sample_count = $${paramIndex++}`)
      values.push(updates.sampleCount)
    }

    if (setClauses.length === 0) return

    setClauses.push(`updated_at = NOW()`)
    values.push(id)
    await this.pool.query(`UPDATE capabilities SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`, values)
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("DELETE FROM capabilities WHERE id = $1", [id])
  }
}

// ============================================
// Skill CRUD
// ============================================

export class SkillStorage {
  private pool = getPool()

  async create(data: SkillData): Promise<string> {
    const id = data.id || uuidv4()
    const query = `
      INSERT INTO skills (
        id, name, description, usage_scenarios, md_content,
        trigger_config, chain_config, error_recovery, effectiveness,
        review_status, version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (name) DO UPDATE SET
        description = COALESCE($2, skills.description),
        usage_scenarios = COALESCE($4, skills.usage_scenarios),
        md_content = COALESCE($5, skills.md_content),
        trigger_config = COALESCE($6, skills.trigger_config),
        chain_config = COALESCE($7, skills.chain_config),
        review_status = COALESCE($10, skills.review_status),
        updated_at = NOW()
      RETURNING id
    `

    const result = await this.pool.query(query, [
      id,
      data.name,
      data.description,
      JSON.stringify(data.usageScenarios || []),
      data.mdContent || null,
      JSON.stringify(data.triggerConfig),
      JSON.stringify(data.chainConfig),
      JSON.stringify(data.errorRecovery || {}),
      JSON.stringify(data.effectiveness || { successRate: 0, timesUsed: 0 }),
      data.reviewStatus,
      data.version || 1,
    ])

    return result.rows[0].id
  }

  async getById(id: string): Promise<any> {
    const result = await this.pool.query("SELECT * FROM skills WHERE id = $1", [id])
    return result.rows[0] || null
  }

  async getByName(name: string): Promise<any> {
    const result = await this.pool.query("SELECT * FROM skills WHERE name = $1", [name])
    return result.rows[0] || null
  }

  async getAll(): Promise<any[]> {
    const result = await this.pool.query("SELECT * FROM skills ORDER BY created_at DESC")
    return result.rows
  }

  async getApproved(): Promise<any[]> {
    const result = await this.pool.query(
      "SELECT * FROM skills WHERE review_status = 'approved' ORDER BY (effectiveness->>'timesUsed')::int DESC",
    )
    return result.rows
  }

  async getPending(): Promise<any[]> {
    const result = await this.pool.query(
      "SELECT * FROM skills WHERE review_status = 'pending' ORDER BY created_at DESC",
    )
    return result.rows
  }

  async updateReviewStatus(id: string, status: "pending" | "approved" | "rejected"): Promise<void> {
    await this.pool.query("UPDATE skills SET review_status = $1, updated_at = NOW() WHERE id = $2", [status, id])
  }

  async updateEffectiveness(id: string, updates: { successRate?: number; timesUsed?: number }): Promise<void> {
    const current = await this.getById(id)
    if (!current) return

    const effectiveness = current.effectiveness || { successRate: 0, timesUsed: 0 }
    if (updates.successRate !== undefined) {
      effectiveness.successRate = updates.successRate
    }
    if (updates.timesUsed !== undefined) {
      effectiveness.timesUsed = updates.timesUsed
    }

    await this.pool.query("UPDATE skills SET effectiveness = $1, updated_at = NOW() WHERE id = $2", [
      JSON.stringify(effectiveness),
      id,
    ])
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("DELETE FROM skills WHERE id = $1", [id])
  }
}

// ============================================
// SkillCapability Relation CRUD
// ============================================

export class SkillCapabilityStorage {
  private pool = getPool()

  async create(data: SkillCapabilityData): Promise<string> {
    const id = data.id || uuidv4()
    const query = `
      INSERT INTO skill_capabilities (id, skill_id, capability_id, role, order_index)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (skill_id, capability_id) DO UPDATE SET
        role = COALESCE($4, skill_capabilities.role),
        order_index = COALESCE($5, skill_capabilities.order_index)
      RETURNING id
    `

    const result = await this.pool.query(query, [id, data.skillId, data.capabilityId, data.role, data.orderIndex])

    return result.rows[0].id
  }

  async getBySkillId(skillId: string): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT sc.*, c.name as capability_name, c.description as capability_description
       FROM skill_capabilities sc
       JOIN capabilities c ON sc.capability_id = c.id
       WHERE sc.skill_id = $1
       ORDER BY sc.order_index`,
      [skillId],
    )
    return result.rows
  }

  async getByCapabilityId(capabilityId: string): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT sc.*, s.name as skill_name
       FROM skill_capabilities sc
       JOIN skills s ON sc.skill_id = s.id
       WHERE sc.capability_id = $1`,
      [capabilityId],
    )
    return result.rows
  }

  async deleteBySkillId(skillId: string): Promise<void> {
    await this.pool.query("DELETE FROM skill_capabilities WHERE skill_id = $1", [skillId])
  }
}

// ============================================
// CapabilityMetric CRUD
// ============================================

export class CapabilityMetricStorage {
  private pool = getPool()

  async create(data: CapabilityMetricData): Promise<string> {
    const id = data.id || uuidv4()
    const query = `
      INSERT INTO capability_metrics (
        id, capability_id, session_id, subtask_id,
        times_triggered, times_used, adoption_rate,
        success, duration_ms, time_saved_ms, relevance_score
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `

    const result = await this.pool.query(query, [
      id,
      data.capabilityId,
      data.sessionId || null,
      data.subtaskId || null,
      data.timesTriggered || 0,
      data.timesUsed || 0,
      data.adoptionRate || 0,
      data.success || null,
      data.durationMs || null,
      data.timeSavedMs || null,
      data.relevanceScore || null,
    ])

    return result.rows[0].id
  }

  async getByCapabilityId(capabilityId: string): Promise<any[]> {
    const result = await this.pool.query(
      "SELECT * FROM capability_metrics WHERE capability_id = $1 ORDER BY created_at DESC",
      [capabilityId],
    )
    return result.rows
  }

  async updateTriggered(capabilityId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO capability_metrics (id, capability_id, times_triggered, times_used)
       VALUES ($1, $2, 1, 0)
       ON CONFLICT (id) DO UPDATE SET times_triggered = capability_metrics.times_triggered + 1`,
      [uuidv4(), capabilityId],
    )
  }

  async updateUsed(capabilityId: string, success: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE capability_metrics 
       SET times_used = times_used + 1, success = $2
       WHERE capability_id = $1 AND id IN (
         SELECT id FROM capability_metrics 
         WHERE capability_id = $1 
         ORDER BY created_at DESC LIMIT 1
       )`,
      [capabilityId, success],
    )
  }
}

// ============================================
// SkillFeedback CRUD
// ============================================

export class SkillFeedbackStorage {
  private pool = getPool()

  async create(data: SkillFeedbackData): Promise<string> {
    const id = data.id || uuidv4()
    const query = `
      INSERT INTO skill_feedback (
        id, skill_id, session_id, adopted, result, time_saved_ms, user_feedback
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `

    const result = await this.pool.query(query, [
      id,
      data.skillId,
      data.sessionId,
      data.adopted,
      data.result || null,
      data.timeSavedMs || null,
      data.userFeedback || null,
    ])

    return result.rows[0].id
  }

  async getBySkillId(skillId: string): Promise<any[]> {
    const result = await this.pool.query("SELECT * FROM skill_feedback WHERE skill_id = $1 ORDER BY created_at DESC", [
      skillId,
    ])
    return result.rows
  }

  async getBySessionId(sessionId: string): Promise<any[]> {
    const result = await this.pool.query(
      "SELECT * FROM skill_feedback WHERE session_id = $1 ORDER BY created_at DESC",
      [sessionId],
    )
    return result.rows
  }
}

// ============================================
// Vector Operations
// ============================================

export class SkillVectorStorage {
  async storeSubtaskVector(subtaskId: string, text: string): Promise<void> {
    if (!isAIEnabled()) {
      logger.debug("AI features are disabled, skipping vector storage")
      return
    }

    try {
      const embedding = await generateEmbedding(text)
      await storeEmbedding("skill_subtask", subtaskId, text, embedding)
    } catch (error) {
      logger.error("failed to store subtask vector", { error, subtaskId })
    }
  }

  async storeCapabilityVector(capabilityId: string, text: string): Promise<void> {
    if (!isAIEnabled()) {
      logger.debug("AI features are disabled, skipping vector storage")
      return
    }

    try {
      const embedding = await generateEmbedding(text)
      await storeEmbedding("capability", capabilityId, text, embedding)
    } catch (error) {
      logger.error("failed to store capability vector", { error, capabilityId })
    }
  }

  async storeSkillVector(skillId: string, text: string): Promise<void> {
    if (!isAIEnabled()) {
      logger.debug("AI features are disabled, skipping vector storage")
      return
    }

    try {
      const embedding = await generateEmbedding(text)
      await storeEmbedding("skill", skillId, text, embedding)
    } catch (error) {
      logger.error("failed to store skill vector", { error, skillId })
    }
  }

  async searchSimilarSkills(
    query: string,
    options: { limit?: number; status?: string } = {},
  ): Promise<Array<{ id: string; name: string; description: string; similarity: number }>> {
    if (!isAIEnabled()) {
      logger.warn("AI features are disabled, search will return empty results")
      return []
    }

    const queryEmbedding = await generateEmbedding(query)
    const results = await searchSimilarEmbeddings(queryEmbedding, "skill", { limit: options.limit || 10 })

    let skills = results
    if (options.status) {
      const skillStorage = new SkillStorage()
      const approvedSkills = await skillStorage.getApproved()
      const approvedIds = new Set(approvedSkills.map((s: any) => s.id))
      skills = results.filter((r: any) => approvedIds.has(r.entity_id))
    }

    return skills
  }

  async searchSimilarCapabilities(
    query: string,
    options: { limit?: number } = {},
  ): Promise<Array<{ id: string; name: string; description: string; similarity: number }>> {
    if (!isAIEnabled()) {
      logger.warn("AI features are disabled, search will return empty results")
      return []
    }

    const queryEmbedding = await generateEmbedding(query)
    const results = await searchSimilarEmbeddings(queryEmbedding, "capability", { limit: options.limit || 10 })
    return results
  }
}

// ============================================
// Aggregated Storage Class
// ============================================

export class SkillsStorage {
  subtask = new SkillSubtaskStorage()
  capabilityCluster = new CapabilityClusterStorage()
  capability = new CapabilityStorage()
  skill = new SkillStorage()
  skillCapability = new SkillCapabilityStorage()
  capabilityMetric = new CapabilityMetricStorage()
  feedback = new SkillFeedbackStorage()
  vector = new SkillVectorStorage()
}
