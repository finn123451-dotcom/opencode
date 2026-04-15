// Skills Online Service - Real-time skill matching
import { SkillsStorage } from "./skills"
import { generateEmbedding, searchSimilarEmbeddings } from "./embedding"
import { isAIEnabled } from "./config"
import { Log } from "../../util/log"

const logger = Log.create({ service: "skills-online" })

// ============================================
// Types
// ============================================

export interface SkillSuggestion {
  skill: any
  confidence: number
  matchReason: string
  suggestedParams?: Record<string, any>
}

export interface MatchContext {
  sessionId: string
  currentGoal: string
  recentTools: string[]
  recentMessages: string[]
  errorContext?: string
}

export interface FeedbackData {
  skillId: string
  sessionId: string
  adopted: boolean
  result: "success" | "failure"
  timeSavedMs?: number
  userFeedback?: string
}

// ============================================
// Skill Matcher
// ============================================

export class SkillMatcher {
  private storage = new SkillsStorage()

  async findRelevantSkills(context: MatchContext, topK: number = 3): Promise<SkillSuggestion[]> {
    if (!isAIEnabled()) {
      logger.warn("AI features disabled")
      return []
    }

    // 1. 向量化当前上下文
    const contextText = this.composeContextText(context)
    const contextVector = await generateEmbedding(contextText)

    // 2. 向量检索
    const candidates = await this.vectorSearch(contextVector, topK)

    // 3. 规则过滤
    const filtered = this.applyTriggerRules(candidates, context)

    // 4. 排序返回
    return filtered.slice(0, topK)
  }

  private composeContextText(context: MatchContext): string {
    const parts: string[] = []

    if (context.currentGoal) {
      parts.push(`Goal: ${context.currentGoal}`)
    }
    if (context.recentTools?.length > 0) {
      parts.push(`Recent tools: ${context.recentTools.join(", ")}`)
    }
    if (context.errorContext) {
      parts.push(`Error: ${context.errorContext}`)
    }

    return parts.join("\n")
  }

  private async vectorSearch(queryVector: number[], topK: number): Promise<any[]> {
    try {
      const results = await searchSimilarEmbeddings(queryVector, "skill", { limit: topK * 2 })
      return results
    } catch (error) {
      logger.error("vector search failed", { error })
      return []
    }
  }

  private applyTriggerRules(candidates: any[], context: MatchContext): SkillSuggestion[] {
    const suggestions: SkillSuggestion[] = []

    for (const candidate of candidates) {
      const skill = candidate.entity
      if (!skill) continue

      let confidence = candidate.similarity || 0
      let matchReason = "semantic match"

      // 规则1: error_pattern 匹配
      if (context.errorContext && skill.trigger_config) {
        for (const rule of skill.trigger_config) {
          if (rule.type === "error_pattern") {
            const pattern = new RegExp(rule.condition, "i")
            if (pattern.test(context.errorContext)) {
              confidence = Math.max(confidence, rule.weight)
              matchReason = `error pattern: ${rule.condition}`
              break
            }
          }
        }
      }

      // 规则2: tool context 匹配
      if (context.recentTools?.length > 0 && skill.trigger_config) {
        for (const rule of skill.trigger_config) {
          if (rule.type === "context") {
            for (const tool of context.recentTools) {
              if (rule.condition.includes(tool)) {
                confidence = Math.max(confidence, rule.weight * 0.8)
                matchReason = `context: ${tool}`
                break
              }
            }
          }
        }
      }

      if (confidence > 0.5) {
        suggestions.push({
          skill,
          confidence,
          matchReason,
        })
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence)
  }
}

// ============================================
// Feedback Collector
// ============================================

export class SkillFeedbackCollector {
  private storage = new SkillsStorage()

  async recordFeedback(feedback: FeedbackData): Promise<void> {
    await this.storage.feedback.create({
      skillId: feedback.skillId,
      sessionId: feedback.sessionId,
      adopted: feedback.adopted,
      result: feedback.result,
      timeSavedMs: feedback.timeSavedMs,
      userFeedback: feedback.userFeedback,
    })

    // 更新技能效果指标
    const skill = await this.storage.skill.getById(feedback.skillId)
    if (skill) {
      const effectiveness = skill.effectiveness || { successRate: 0, timesUsed: 0 }
      const timesUsed = (effectiveness.timesUsed || 0) + 1
      const successCount = (effectiveness.successRate || 0) * (timesUsed - 1)
      const newSuccessRate =
        feedback.adopted && feedback.result === "success" ? (successCount + 1) / timesUsed : successCount / timesUsed

      await this.storage.skill.updateEffectiveness(feedback.skillId, {
        successRate: newSuccessRate,
        timesUsed,
      })
    }

    logger.info("feedback recorded", { skillId: feedback.skillId, adopted: feedback.adopted })
  }

  async getSkillStats(skillId: string): Promise<{
    timesUsed: number
    adoptionRate: number
    successRate: number
  }> {
    const feedbacks = await this.storage.feedback.getBySkillId(skillId)

    if (feedbacks.length === 0) {
      return { timesUsed: 0, adoptionRate: 0, successRate: 0 }
    }

    const adopted = feedbacks.filter((f: any) => f.adopted).length
    const successful = feedbacks.filter((f: any) => f.result === "success").length

    return {
      timesUsed: feedbacks.length,
      adoptionRate: adopted / feedbacks.length,
      successRate: successful / adopted || 0,
    }
  }
}

// ============================================
// Constants
// ============================================

const DEFAULT_QA_THRESHOLD = 0.7

// ============================================
// Quality Assurance
// ============================================

export class QualityAssurance {
  private storage = new SkillsStorage()

  async validateCapability(capability: CapabilityData): Promise<{
    valid: boolean
    score: number
    errors: string[]
  }> {
    const errors: string[] = []
    let score = 1.0

    // Level 1: 语法验证
    if (!capability.name || capability.name.length < 3) {
      errors.push("name too short")
      score -= 0.3
    }
    if (!capability.description || capability.description.length < 10) {
      errors.push("description too short")
      score -= 0.2
    }
    if (!capability.triggerPatterns || capability.triggerPatterns.length === 0) {
      errors.push("no trigger patterns")
      score -= 0.2
    }

    // Level 2: 逻辑验证
    // (已通过 schema constraints 保证)

    // Level 3: 质量评分
    if (capability.qualityScore && capability.qualityScore < 0.5) {
      score *= capability.qualityScore
    }

    return {
      valid: errors.length === 0,
      score: Math.max(0, score),
      errors,
    }
  }

  async validateSkill(skill: SkillData): Promise<{
    valid: boolean
    score: number
    errors: string[]
  }> {
    const errors: string[] = []
    let score = 1.0

    // Level 1: 语法验证
    if (!skill.name || skill.name.length < 3) {
      errors.push("name too short")
      score -= 0.3
    }
    if (!skill.description || skill.description.length < 10) {
      errors.push("description too short")
      score -= 0.2
    }
    if (!skill.triggerConfig || skill.triggerConfig.length === 0) {
      errors.push("no trigger config")
      score -= 0.2
    }
    if (!skill.chainConfig || skill.chainConfig.length < 2) {
      errors.push("chain requires at least 2 capabilities")
      score -= 0.2
    }

    // Level 2: 逻辑验证 - 检查循环依赖
    if (skill.chainConfig) {
      const hasCycle = this.checkCycleDependency(skill.chainConfig)
      if (hasCycle) {
        errors.push("circular dependency in capability chain")
        score -= 0.3
      }
    }

    // Level 3: 完整性检查
    if (!skill.usageScenarios || skill.usageScenarios.length === 0) {
      errors.push("no usage scenarios")
      score -= 0.1
    }

    return {
      valid: errors.length === 0,
      score: Math.max(0, score),
      errors,
    }
  }

  private checkCycleDependency(chain: { capabilityId: string; role: string; order: number }[]): boolean {
    const orders = chain.map((c) => c.order)
    const uniqueOrders = new Set(orders)
    return uniqueOrders.size !== orders.length
  }

  async autoApproveIfQuality(skillId: string, threshold: number = DEFAULT_QA_THRESHOLD): Promise<boolean> {
    const skill = await this.storage.skill.getById(skillId)
    if (!skill) return false

    const validation = await this.validateSkill(skill)
    if (validation.score >= threshold && validation.valid) {
      await this.storage.skill.updateReviewStatus(skillId, "approved")
      logger.info("auto-approved skill", { skillId, score: validation.score })
      return true
    }

    return false
  }
}

// ============================================
// Complete Online Service
// ============================================

export class SkillsOnlineService {
  matcher = new SkillMatcher()
  feedback = new SkillFeedbackCollector()
  quality = new QualityAssurance()
}
