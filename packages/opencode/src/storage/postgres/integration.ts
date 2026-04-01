import { trajectoryCapture, TrajectoryCaptureConfig } from "./capture"
import { configureTrajectoryStorage, getTrajectoryStorageConfig, initializeStorage, isAIEnabled } from "./config"
import { trajectoryStorage } from "./trajectory"
import { knowledgeBase, memoryManager } from "./knowledge"
import { Log } from "../../util/log"

const logger = Log.create({ service: "opencode-integration" })

export interface OpenCodeIntegrationConfig {
  autoCapture: boolean
  captureSessionStart: boolean
  captureMessages: boolean
  captureToolCalls: boolean
  captureReasoning: boolean
  captureErrors: boolean
  generateKnowledgeOnComplete: boolean
  storeMemories: boolean
}

export class OpenCodeIntegration {
  private config: OpenCodeIntegrationConfig
  private initialized: boolean = false

  constructor(config: Partial<OpenCodeIntegrationConfig> = {}) {
    this.config = {
      autoCapture: config.autoCapture ?? true,
      captureSessionStart: config.captureSessionStart ?? true,
      captureMessages: config.captureMessages ?? true,
      captureToolCalls: config.captureToolCalls ?? true,
      captureReasoning: config.captureReasoning ?? true,
      captureErrors: config.captureErrors ?? true,
      generateKnowledgeOnComplete: config.generateKnowledgeOnComplete ?? true,
      storeMemories: config.storeMemories ?? true,
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    await initializeStorage()
    await trajectoryCapture.initialize()

    this.initialized = true
    logger.info("initialized")
  }

  async startSession(sessionInfo: {
    sessionId: string
    projectId?: string
    directory?: string
    title?: string
    metadata?: Record<string, any>
  }): Promise<string> {
    await this.ensureInitialized()
    return await trajectoryCapture.startSession(sessionInfo)
  }

  async endSession(status: "completed" | "failed" | "cancelled" = "completed"): Promise<string | null> {
    await this.ensureInitialized()
    return await trajectoryCapture.endSession(status)
  }

  async captureUserMessage(messageId: string, content: string, metadata?: Record<string, any>): Promise<void> {
    await this.ensureInitialized()
    if (!this.config.captureMessages) return
    await trajectoryCapture.captureMessage({
      id: messageId,
      role: "user",
      content,
      metadata,
    })
  }

  async captureAssistantMessage(messageId: string, content: string, metadata?: Record<string, any>): Promise<void> {
    await this.ensureInitialized()
    if (!this.config.captureMessages) return
    await trajectoryCapture.captureMessage({
      id: messageId,
      role: "assistant",
      content,
      metadata,
    })
  }

  async updateSessionSystemPrompt(sessionId: string, systemPrompt: string): Promise<void> {
    await this.ensureInitialized()
    await trajectoryCapture.updateSessionSystemPrompt(sessionId, systemPrompt)
  }

  async captureMessagesToLLM(sessionId: string, messages: any[]): Promise<void> {
    await this.ensureInitialized()
    await trajectoryCapture.captureMessagesToLLM(sessionId, messages)
  }

  async updateLlmMessageTiming(sessionId: string, messages: any[], timeEnd: number, durationMs: number): Promise<void> {
    await this.ensureInitialized()
    await trajectoryCapture.updateLlmMessageTiming(sessionId, messages, timeEnd, durationMs)
  }

  async captureReasoning(
    messageId: string,
    reasoning: {
      reasoningId?: string
      content: string
      model?: string
      providerMetadata?: Record<string, any>
    },
  ): Promise<void> {
    await this.ensureInitialized()
    if (this.config.captureReasoning) {
      await trajectoryCapture.captureReasoning(messageId, reasoning)
    }
  }

  async captureMessagePart(
    messageId: string,
    part: {
      partType: string
      content?: string
      partOrder?: number
      metadata?: Record<string, any>
    },
  ): Promise<string> {
    await this.ensureInitialized()
    return await trajectoryCapture.captureMessagePart(messageId, part)
  }

  async captureToolCallStart(
    messageId: string,
    toolCall: {
      toolName: string
      input: Record<string, any>
      toolCallId?: string
      callId?: string
    },
  ): Promise<string> {
    await this.ensureInitialized()
    if (this.config.captureToolCalls) {
      return await trajectoryCapture.captureToolCallStart(
        messageId,
        toolCall.toolCallId || uuidv4(),
        toolCall.callId || uuidv4(),
        toolCall.toolName,
        toolCall.input,
      )
    }
    return ""
  }

  async captureToolCallComplete(
    toolCallId: string,
    result: {
      output: string
      status?: "completed" | "failed"
    },
  ): Promise<void> {
    await this.ensureInitialized()
    if (this.config.captureToolCalls && toolCallId) {
      await trajectoryCapture.completeToolCall(toolCallId, result)
    }
  }

  async captureError(
    messageId: string,
    error: {
      message: string
      stack?: string
    },
  ): Promise<void> {
    await this.ensureInitialized()
    if (this.config.captureErrors) {
      await trajectoryCapture.captureError(messageId, error)
    }
  }

  async captureStep(
    messageId: string,
    step: {
      stepId?: string
      stepType:
        | "reasoning"
        | "tool_call"
        | "tool_result"
        | "text"
        | "error"
        | "subtask"
        | "compaction"
        | "text_generation"
      content?: string
      inputData?: Record<string, any>
      outputData?: Record<string, any>
      reason?: string
      durationMs?: number
      tokensInput?: number
      tokensOutput?: number
      tokensReasoning?: number
      cost?: number
    },
  ): Promise<string> {
    await this.ensureInitialized()
    if (this.config.captureSteps) {
      return await trajectoryCapture.captureStep(messageId, step)
    }
    return ""
  }

  async captureFileOperation(operation: {
    messageId?: string
    toolCallId?: string
    operationType: "read" | "write" | "edit" | "glob" | "grep" | "list" | "bash"
    filePath: string
    fileContent?: string
    fileMime?: string
    fileSize?: number
    offset?: number
    limit?: number
    diffContent?: string
    diffHash?: string
    diffStats?: Record<string, any>
    metadata?: Record<string, any>
  }): Promise<string> {
    await this.ensureInitialized()
    return await trajectoryCapture.captureFileOperation(operation)
  }

  async captureSnapshot(snapshot: {
    messageId?: string
    stepId?: string
    snapshotHash: string
    workingDirectory?: string
    fileCount?: number
    fileList?: string[]
    metadata?: Record<string, any>
  }): Promise<string> {
    await this.ensureInitialized()
    return await trajectoryCapture.captureSnapshot(snapshot)
  }

  async capturePatch(patch: {
    messageId?: string
    stepId?: string
    patchHash: string
    filePath: string
    fileDiff?: string
    additions?: number
    deletions?: number
    diffStats?: Record<string, any>
    originalContent?: string
    patchedContent?: string
    metadata?: Record<string, any>
  }): Promise<string> {
    await this.ensureInitialized()
    return await trajectoryCapture.capturePatch(patch)
  }

  async captureSessionCompaction(
    sessionId: string,
    compaction: {
      model?: string
      providerId?: string
      summary?: string
      tokensBefore?: number
      tokensAfter?: number
    },
  ): Promise<string> {
    await this.ensureInitialized()
    return await trajectoryCapture.captureSessionCompaction(sessionId, compaction)
  }

  async captureToolAttachment(attachment: {
    messageId?: string
    toolCallId?: string
    filename: string
    mime?: string
    url?: string
    sourceType?: string
    sourcePath?: string
    sourceRange?: Record<string, any>
  }): Promise<string> {
    await this.ensureInitialized()
    return await trajectoryCapture.captureToolAttachment(attachment)
  }

  async captureRetry(retry: {
    messageId: string
    attemptNumber: number
    errorName?: string
    errorMessage?: string
    errorDetails?: Record<string, any>
    errorStack?: string
    status?: "pending" | "completed" | "failed"
    metadata?: Record<string, any>
  }): Promise<string> {
    await this.ensureInitialized()
    return await trajectoryCapture.captureRetry(retry)
  }

  async captureExecutionLog(log: {
    stepId?: string
    toolCallId?: string
    logLevel: "debug" | "info" | "warn" | "error"
    source?: string
    message: string
    data?: Record<string, any>
  }): Promise<number> {
    await this.ensureInitialized()
    return await trajectoryCapture.captureExecutionLog(log)
  }

  async captureApiCall(apiCall: {
    messageId?: string
    providerId: string
    modelId?: string
    endpoint?: string
    requestBody?: Record<string, any>
    responseBody?: Record<string, any>
    statusCode?: number
    latencyMs?: number
    cost?: number
    tokensInput?: number
    tokensOutput?: number
    errorMessage?: string
    errorCode?: string
    metadata?: Record<string, any>
  }): Promise<number> {
    await this.ensureInitialized()
    return await trajectoryCapture.captureApiCall(apiCall)
  }

  async capturePermissionRequest(request: {
    permissionType: string
    action: string
    pattern?: string
    toolName?: string
    inputData?: Record<string, any>
    status?: "pending" | "approved" | "denied"
    userResponse?: string
    responseMessage?: string
    respondedAt?: number
    metadata?: Record<string, any>
  }): Promise<string> {
    await this.ensureInitialized()
    return await trajectoryCapture.capturePermissionRequest(request)
  }

  async captureCostStatistic(stat: {
    providerId?: string
    modelId?: string
    costInput?: number
    costOutput?: number
    costCacheRead?: number
    costCacheWrite?: number
    costReasoning?: number
    totalCost?: number
    tokensInput?: number
    tokensOutput?: number
    tokensReasoning?: number
    tokensCacheRead?: number
    tokensCacheWrite?: number
    apiCalls?: number
    periodStart?: number
    periodEnd?: number
    metadata?: Record<string, any>
  }): Promise<number> {
    await this.ensureInitialized()
    return await trajectoryCapture.captureCostStatistic(stat)
  }

  async completeTrajectory(title?: string, description?: string): Promise<string> {
    await this.ensureInitialized()
    const sessionId = await trajectoryCapture.storeCompleteTrajectory(title, description)

    if (this.config.generateKnowledgeOnComplete && isAIEnabled()) {
      const session = await trajectoryStorage.getSessionWithDetails(sessionId)
      if (session) {
        await knowledgeBase.generateKnowledgeFromTrajectory({ session, messages: [], toolCalls: [], steps: [] } as any)
        if (this.config.storeMemories) {
          await memoryManager.extractAndStoreMemories({ session, messages: [], toolCalls: [], steps: [] } as any)
        }
      }
    }

    return sessionId
  }

  async searchKnowledge(
    query: string,
    options?: {
      category?: string
      limit?: number
    },
  ): Promise<any[]> {
    await this.ensureInitialized()
    return await knowledgeBase.searchKnowledge(query, options)
  }

  async getRelevantMemories(scope: string): Promise<any[]> {
    await this.ensureInitialized()
    return await memoryManager.getMemoriesByScope(scope)
  }

  async getSessionHistory(sessionId: string): Promise<{
    messages: any[]
    toolCalls: any[]
    steps: any[]
  }> {
    await this.ensureInitialized()

    const [messages, toolCalls, steps] = await Promise.all([
      trajectoryStorage.getMessagesBySession(sessionId),
      trajectoryStorage.getToolCallsBySession(sessionId),
      trajectoryStorage.getStepsBySession(sessionId),
    ])

    return { messages, toolCalls, steps }
  }

  async getSimilarContent(
    query: string,
    options?: {
      limit?: number
      entityType?: string
    },
  ): Promise<any[]> {
    await this.ensureInitialized()
    return await trajectoryStorage.searchSimilarContent(query, options)
  }

  async getPopularKnowledge(limit?: number): Promise<any[]> {
    await this.ensureInitialized()
    return await knowledgeBase.getPopularKnowledge(limit)
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  getStats(): ReturnType<typeof trajectoryCapture.getStats> {
    return trajectoryCapture.getStats()
  }

  updateCaptureConfig(config: Partial<TrajectoryCaptureConfig>): void {
    trajectoryCapture.updateConfig(config)
  }

  isEnabled(): boolean {
    return trajectoryCapture.isEnabled()
  }
}

export const opencodeIntegration = new OpenCodeIntegration()

export async function initializeOpenCodeIntegration(pgConfig?: {
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
}): Promise<void> {
  if (pgConfig) {
    configureTrajectoryStorage({
      postgres: {
        host: pgConfig.host || "localhost",
        port: pgConfig.port || 5432,
        database: pgConfig.database || "opencode",
        user: pgConfig.user || "opencode",
        password: pgConfig.password || "",
      },
    })
  }

  await opencodeIntegration.initialize()
}

export async function shutdownOpenCodeIntegration(): Promise<void> {
  await opencodeIntegration.endSession("completed")
}
