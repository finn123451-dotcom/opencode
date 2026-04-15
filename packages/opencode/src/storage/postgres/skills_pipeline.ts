// Skills Pipeline - End-to-end skill discovery pipeline
// Phase 1: Build subtasks from sessions
// Phase 2: Vectorize subtasks
// Phase 3: Cluster embeddings
// Phase 4: Extract capabilities from clusters (with LLM)
// Phase 5: Compose skills from capabilities (with LLM)

import { getPool } from "./connection"
import { SkillsStorage, SkillSubtaskData } from "./skills"
import { generateEmbedding } from "./embedding"
import { isAIEnabled } from "./config"
import { Log } from "../../util/log"
import { v4 as uuidv4 } from "uuid"
import { callLLMJson, SYSTEM_PROMPTS, USER_PROMPTS } from "./llm_helper"

const logger = Log.create({ service: "skills-pipeline" })

// ============================================
// Types
// ============================================

export interface PipelineConfig {
  daysLookback: number
  maxSubtasks: number
  minClusterSize: number
  clusterCount: number
  embeddingModel: string
}

const DEFAULT_CONFIG: PipelineConfig = {
  daysLookback: 7,
  maxSubtasks: 1000,
  minClusterSize: 5,
  clusterCount: 50,
  embeddingModel: "text-embedding-3-small",
}

// ============================================
// Phase 1: Subtask Builder
// ============================================

export class SubtaskBuilder {
  private pool = getPool()
  private storage = new SkillsStorage()

  async buildFromSessions(sinceDaysAgo: number = 7): Promise<number> {
    const result = await this.pool.query(
      `SELECT s.id as session_id, s.directory, s.title
       FROM sessions s
       WHERE s.status IN ('completed', 'failed')
       AND s.completed_at > NOW() - INTERVAL '${sinceDaysAgo} days'
       ORDER BY s.completed_at DESC
       LIMIT $1`,
      [DEFAULT_CONFIG.maxSubtasks],
    )

    let built = 0
    for (const session of result.rows) {
      try {
        const count = await this.buildFromSession(session.session_id)
        built += count
      } catch (error) {
        logger.error("failed to build subtasks for session", { error, sessionId: session.session_id })
      }
    }

    logger.info("built subtasks", { count: built })
    return built
  }

  async buildFromSession(sessionId: string): Promise<number> {
    const stepsResult = await this.pool.query(
      `SELECT step_type, content, status, time_start, time_end, duration_ms
       FROM steps
       WHERE session_id = $1
       ORDER BY step_order`,
      [sessionId],
    )

    const toolCallsResult = await this.pool.query(
      `SELECT tc.tool_name, tc.output, tc.status, tc.time_created, tc.time_start, tc.time_end
       FROM tool_calls tc
       WHERE tc.session_id = $1
       ORDER BY tc.time_created`,
      [sessionId],
    )

    if (stepsResult.rows.length === 0) {
      return 0
    }

    let subtaskCount = 0
    let currentSubtask: Partial<SkillSubtaskData> = {
      sessionId,
      description: "",
      status: "completed",
      toolNames: [],
    }

    for (const step of stepsResult.rows) {
      if (step.step_type === "tool_call" || step.step_type === "tool_result") {
        if (step.content) {
          const toolCall = toolCallsResult.rows.find(
            (tc: any) => tc.time_created >= step.time_start - 5000 && tc.time_created <= step.time_start + 5000,
          )

          if (toolCall) {
            currentSubtask.description = step.content || `${toolCall.tool_name} operation`
            currentSubtask.toolNames = [...(currentSubtask.toolNames || []), toolCall.tool_name]

            if (toolCall.status === "failed") {
              currentSubtask.error = toolCall.output || toolCall.error_message
            }
          }
        }
      }

      if (step.step_type === "text" || step.step_type === "reasoning") {
        if (step.content && step.content.length > 10) {
          currentSubtask.description = step.content.substring(0, 500)
        }
      }

      if (step.status === "completed" || step.status === "failed") {
        if (currentSubtask.description) {
          currentSubtask.startTime = step.time_start ? new Date(step.time_start) : undefined
          currentSubtask.endTime = step.time_end ? new Date(step.time_end) : undefined

          const toolCallData = toolCallsResult.rows.filter(
            (tc: any) => tc.time_start >= (step.time_start as number) - 5000,
          )
          currentSubtask.toolCount = toolCallData.length
          currentSubtask.messageCount = 1

          try {
            await this.storage.subtask.create({
              sessionId: currentSubtask.sessionId!,
              description: currentSubtask.description,
              status: currentSubtask.status as "completed" | "failed",
              startTime: currentSubtask.startTime,
              endTime: currentSubtask.endTime,
              result: currentSubtask.result,
              error: currentSubtask.error,
              toolNames: currentSubtask.toolNames,
              messageCount: currentSubtask.messageCount,
              toolCount: currentSubtask.toolCount,
            })
            subtaskCount++
          } catch (error) {
            logger.error("failed to create subtask", { error })
          }
        }

        currentSubtask = {
          sessionId,
          description: "",
          status: "completed",
          toolNames: [],
        }
      }
    }

    logger.debug("built subtasks for session", { sessionId, count: subtaskCount })
    return subtaskCount
  }
}

// ============================================
// Phase 2: Vectorizer
// ============================================

export class PipelineVectorizer {
  private storage = new SkillsStorage()

  async vectorizeSubtasks(subtaskIds: string[]): Promise<number> {
    if (!isAIEnabled()) {
      logger.warn("AI features are disabled, skipping vectorization")
      return 0
    }

    let vectorized = 0
    for (const id of subtaskIds) {
      const subtask = await this.storage.subtask.getById(id)
      if (!subtask) continue

      const text = this.composeSubtaskText(subtask)
      try {
        await this.storage.vector.storeSubtaskVector(id, text)
        vectorized++
      } catch (error) {
        logger.error("failed to vectorize subtask", { error, subtaskId: id })
      }
    }

    logger.info("vectorized subtasks", { count: vectorized })
    return vectorized
  }

  private composeSubtaskText(subtask: any): string {
    const parts: string[] = []

    if (subtask.description) {
      parts.push(`Task: ${subtask.description}`)
    }
    if (subtask.tool_names && subtask.tool_names.length > 0) {
      parts.push(`Tools: ${subtask.tool_names.join(", ")}`)
    }
    if (subtask.result) {
      parts.push(`Result: ${subtask.result}`)
    }
    if (subtask.error) {
      parts.push(`Error: ${subtask.error}`)
    }

    return parts.join("\n")
  }
}

// ============================================
// Phase 3: Cluster
// ============================================

export class PipelineCluster {
  private pool = getPool()
  private storage = new SkillsStorage()

  async cluster(options: Partial<PipelineConfig> = {}): Promise<number> {
    const config = { ...DEFAULT_CONFIG, ...options }
    const vectorStorage = this.storage.vector

    const subtasks = await this.storage.subtask.getCompletedForClustering(config.daysLookback, config.maxSubtasks)
    if (subtasks.length < config.minClusterSize) {
      logger.warn("not enough subtasks for clustering", { count: subtasks.length })
      return 0
    }

    const embeddings = await Promise.all(
      subtasks.map(async (s: any) => {
        const text = `${s.description} ${s.tool_names?.join(", ") || ""}`
        return generateEmbedding(text)
      }),
    )

    const result = await this.kMeansCluster(embeddings, config.clusterCount)

    let clustersCreated = 0
    for (const [clusterId, indices] of result.clusters.entries()) {
      if (indices.length < config.minClusterSize) continue

      const centroid = this.calculateCentroid(indices.map((i: number) => embeddings[i]))
      const toolNames = this.mostCommonToolNames(indices.map((i: number) => subtasks[i]))

      try {
        await this.storage.capabilityCluster.create({
          clusterId,
          centroid,
          size: indices.length,
          toolNames,
          status: "pending",
        })
        clustersCreated++
      } catch (error) {
        logger.error("failed to create cluster", { error, clusterId })
      }
    }

    logger.info("created clusters", { count: clustersCreated })
    return clustersCreated
  }

  private async kMeansCluster(
    embeddings: number[][],
    k: number,
  ): Promise<{ clusters: Map<number, number[]>; centroids: number[][] }> {
    const n = embeddings.length
    const dim = embeddings[0].length

    let centroids: number[][] = []
    for (let i = 0; i < k; i++) {
      centroids.push(embeddings[Math.floor(Math.random() * n)].slice())
    }

    const clusters = new Map<number, number[]>()
    for (let iter = 0; iter < 10; iter++) {
      clusters.clear()
      for (let i = 0; i < n; i++) {
        let minDist = Infinity
        let bestCluster = 0
        for (let j = 0; j < k; j++) {
          const dist = this.cosineDistance(embeddings[i], centroids[j])
          if (dist < minDist) {
            minDist = dist
            bestCluster = j
          }
        }
        if (!clusters.has(bestCluster)) {
          clusters.set(bestCluster, [])
        }
        clusters.get(bestCluster)!.push(i)
      }

      for (const [clusterId, indices] of clusters.entries()) {
        if (indices.length === 0) continue
        const newCentroid = this.calculateCentroid(indices.map((i: number) => embeddings[i]))
        centroids[clusterId] = newCentroid
      }
    }

    return { clusters, centroids }
  }

  private cosineDistance(a: number[], b: number[]): number {
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10)
  }

  private calculateCentroid(vectors: number[][]): number[] {
    if (vectors.length === 0) return []
    const dim = vectors[0].length
    const centroid = new Array(dim).fill(0)
    for (const v of vectors) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += v[i]
      }
    }
    return centroid.map((x) => x / vectors.length)
  }

  private mostCommonToolNames(subtasks: any[]): string[] {
    const toolCounts = new Map<string, number>()
    for (const s of subtasks) {
      if (s.tool_names) {
        for (const t of s.tool_names) {
          toolCounts.set(t, (toolCounts.get(t) || 0) + 1)
        }
      }
    }
    return Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t)
  }
}

// ============================================
// Phase 4: Capability Extractor (LLM-based)
// ============================================

interface ExtractedCapability {
  name: string
  description: string
  trigger_patterns: string[]
  input_schema?: Record<string, any>
  output_schema?: Record<string, any>
  variations?: Array<{ pattern: string; focus: string }>
}

export class CapabilityExtractor {
  private storage = new SkillsStorage()
  private daysLookback = DEFAULT_CONFIG.daysLookback
  private maxSubtasks = DEFAULT_CONFIG.maxSubtasks
  private llmAnalysisLimit = 10

  async extractFromPendingClusters(): Promise<number> {
    if (!isAIEnabled()) {
      logger.warn("AI features disabled, skipping capability extraction")
      return 0
    }

    const pendingClusters = await this.storage.capabilityCluster.getPending()
    let extracted = 0

    for (const cluster of pendingClusters) {
      try {
        // Get subtasks for this cluster
        const subtasks = await this.storage.subtask.getCompletedForClustering(this.daysLookback, this.maxSubtasks)
        const clusterSubtasks = subtasks.slice(0, this.llmAnalysisLimit)

        const capabilities = await this.extractFromCluster(cluster.id, clusterSubtasks)
        for (const cap of capabilities) {
          await this.storage.capability.create({
            name: cap.name,
            description: cap.description,
            triggerPatterns: cap.trigger_patterns,
            inputSchema: cap.input_schema,
            outputSchema: cap.output_schema,
            variations: cap.variations,
            reviewStatus: "pending",
            createdBy: "auto",
          })

          // Store vector for capability
          const text = `${cap.name} ${cap.description} ${cap.trigger_patterns?.join(" ")}`
          await this.storage.vector.storeCapabilityVector(cap.name, text)

          extracted++
        }
        await this.storage.capabilityCluster.updateStatus(cluster.id, "approved")
      } catch (error) {
        logger.error("failed to extract from cluster", { error, clusterId: cluster.id })
      }
    }

    logger.info("extracted capabilities", { count: extracted })
    return extracted
  }

  private async extractFromCluster(clusterId: string, subtasks: any[]): Promise<ExtractedCapability[]> {
    const cluster = await this.storage.capabilityCluster.getByClusterId(Number(clusterId))
    if (!cluster || cluster.length === 0) {
      logger.warn("cluster not found", { clusterId })
      return []
    }

    const clusterData = cluster[0]

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPTS.capabilityExtractor },
      {
        role: "user" as const,
        content: USER_PROMPTS.extractCapability({
          subtasks: subtasks.map((s) => ({
            description: s.description,
            result: s.result,
            error: s.error,
            tool_names: s.tool_names,
          })),
          toolNames: clusterData.tool_names || [],
          size: clusterData.size,
        }),
      },
    ]

    try {
      const result = await callLLMJson<ExtractedCapability[]>(messages, { temperature: 0.7 })
      logger.info("LLM extracted capabilities", { clusterId, count: result?.length || 0 })
      return result || []
    } catch (error) {
      logger.error("LLM capability extraction failed", { error, clusterId })
      return []
    }
  }
}

// ============================================
// Phase 5: Skill Composer (LLM-based)
// ============================================

interface ComposedSkill {
  name: string
  description: string
  trigger_config: Array<{ type: string; condition: string; weight: number }>
  chain_config: Array<{ capability_id: string; role: string; order: number }>
  usage_scenarios: string[]
}

export class SkillComposer {
  private storage = new SkillsStorage()

  async composeFromCapabilities(): Promise<number> {
    if (!isAIEnabled()) {
      logger.warn("AI features disabled, skipping skill composition")
      return 0
    }

    const capabilities = await this.storage.capability.getApproved()
    if (capabilities.length < 2) {
      logger.warn("not enough capabilities for composition", { count: capabilities.length })
      return 0
    }

    // Analyze co-occurrence from skill_capabilities table
    const cooccurrence = await this.analyzeCooccurrence(capabilities)

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPTS.skillComposer },
      {
        role: "user" as const,
        content: USER_PROMPTS.composeSkill(capabilities),
      },
    ]

    let composed = 0
    try {
      const skills = await callLLMJson<ComposedSkill[]>(messages, { temperature: 0.7 })

      for (const skill of skills || []) {
        // Map capability names to IDs
        const chainConfig = skill.chain_config.map((c) => {
          const cap = capabilities.find((p: any) => p.name.includes(c.capability_id))
          return {
            capabilityId: cap?.id || c.capability_id,
            role: c.role as "required" | "optional" | "fallback",
            order: c.order,
          }
        })

        const skillId = await this.storage.skill.create({
          name: skill.name,
          description: skill.description,
          triggerConfig: skill.trigger_config.map((t) => ({
            type: t.type as "semantic" | "error_pattern" | "context",
            condition: t.condition,
            weight: t.weight,
          })),
          chainConfig,
          usageScenarios: skill.usage_scenarios,
          reviewStatus: "pending",
        })

        // Store vector for skill
        const text = `${skill.name} ${skill.description} ${skill.usage_scenarios?.join(" ")}`
        await this.storage.vector.storeSkillVector(skillId, text)

        // Create skill-capability relations
        for (const c of chainConfig) {
          await this.storage.skillCapability.create({
            skillId,
            capabilityId: c.capabilityId,
            role: c.role,
            orderIndex: c.order,
          })
        }

        composed++
      }
    } catch (error) {
      logger.error("LLM skill composition failed", { error })
    }

    logger.info("composed skills", { count: composed })
    return composed
  }

  private async analyzeCooccurrence(capabilities: any[]): Promise<Record<string, number>> {
    const cooccurrence: Record<string, number> = {}

    // Get all skill_capability relations
    for (const cap of capabilities) {
      const relations = await this.storage.skillCapability.getByCapabilityId(cap.id)
      for (const rel of relations) {
        const key = `${cap.name}-${rel.skill_id}`
        cooccurrence[key] = (cooccurrence[key] || 0) + 1
      }
    }

    return cooccurrence
  }
}

// ============================================
// Complete Pipeline
// ============================================

export class SkillsPipeline {
  private subtaskBuilder = new SubtaskBuilder()
  private vectorizer = new PipelineVectorizer()
  private cluster = new PipelineCluster()
  private extractor = new CapabilityExtractor()
  private composer = new SkillComposer()
  private storage = new SkillsStorage()

  async runFullPipeline(options: Partial<PipelineConfig> = {}): Promise<{
    subtasksBuilt: number
    clustersCreated: number
    capabilitiesExtracted: number
    skillsComposed: number
  }> {
    const config = { ...DEFAULT_CONFIG, ...options }

    logger.info("starting full pipeline", { config })

    const subtasksBuilt = await this.subtaskBuilder.buildFromSessions(config.daysLookback)

    const subtasks = await this.storage.subtask.getCompletedForClustering(config.daysLookback, config.maxSubtasks)
    const subtaskIds = subtasks.map((s: any) => s.id)
    await this.vectorizer.vectorizeSubtasks(subtaskIds)

    const clustersCreated = await this.cluster.cluster(config)

    const capabilitiesExtracted = await this.extractor.extractFromPendingClusters()

    const skillsComposed = await this.composer.composeFromCapabilities()

    logger.info("pipeline complete", {
      subtasksBuilt,
      clustersCreated,
      capabilitiesExtracted,
      skillsComposed,
    })

    return {
      subtasksBuilt,
      clustersCreated,
      capabilitiesExtracted,
      skillsComposed,
    }
  }
}
