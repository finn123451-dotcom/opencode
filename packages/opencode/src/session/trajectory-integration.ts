import { EventEmitter } from "events"
import { v4 as uuidv4 } from "uuid"
import { MessageV2 } from "./message-v2"
import { opencodeIntegration, isStorageEnabled } from "../storage/postgres"
import { Config } from "@/config/config"
import { Log } from "../util/log"

const logger = Log.create({ service: "trajectory-tracker" })

export interface TrajectoryEventMap {
  "session:start": { sessionId: string; messageId: string }
  "session:end": { sessionId: string }
  "message:user": { messageId: string; content: string }
  "message:assistant": { messageId: string; content: string }
  "reasoning:start": { messageId: string; reasoningId: string }
  "reasoning:delta": { messageId: string; reasoningId: string; text: string }
  "reasoning:end": { messageId: string; reasoningId: string; content: string }
  "tool:start": { messageId: string; toolCallId: string; toolName: string; input: any }
  "tool:result": { messageId: string; toolCallId: string; toolName: string; output: string; status: string }
  "tool:error": { messageId: string; toolCallId: string; error: string }
  "text:start": { messageId: string; partId: string }
  "text:delta": { messageId: string; partId: string; text: string }
  "text:end": { messageId: string; partId: string; content: string }
  "step:start": { messageId: string; stepId: string }
  "step:end": { messageId: string; stepId: string; stepData: any }
  error: { messageId: string; error: string; stack?: string }
}

export class SessionTrajectoryTracker extends EventEmitter {
  private sessionId: string | null = null
  private currentMessageId: string | null = null
  private currentBranchId: string | null = null
  private activeToolCalls: Map<string, { toolName: string; startTime: number; input: any }> = new Map()
  private activeReasoning: Map<string, { text: string; startTime: number }> = new Map()
  private enabled: boolean = false
  private config: {
    captureMessages: boolean
    captureReasoning: boolean
    captureTools: boolean
    captureSteps: boolean
    captureErrors: boolean
    generateKnowledge: boolean
  } = {
    captureMessages: true,
    captureReasoning: true,
    captureTools: true,
    captureSteps: true,
    captureErrors: true,
    generateKnowledge: true,
  }

  constructor() {
    super()
  }

  async initialize(): Promise<void> {
    try {
      const cfg = await Config.get()

      // Always enable by default unless explicitly disabled
      const configValue = cfg.experimental?.trajectoryStorage
      const envEnabled = isStorageEnabled()

      logger.info("initializing trajectory tracker", {
        configValue,
        envEnabled,
        hasExplicitConfig: configValue !== undefined,
      })

      // If explicitly set to false, disable. Otherwise enable.
      if (configValue === false) {
        this.enabled = false
      } else if (configValue === true) {
        this.enabled = true
      } else {
        // Default behavior: enable if env is enabled, otherwise try to enable
        this.enabled = envEnabled
      }

      if (this.enabled) {
        logger.info("initializing storage and capture")
        try {
          await opencodeIntegration.initialize()
          logger.info("storage enabled and initialized successfully")
        } catch (initError) {
          logger.error("failed to initialize storage, continuing without storage", { error: initError })
          this.enabled = false
        }
      } else {
        logger.info("storage is disabled")
      }
    } catch (error) {
      logger.error("failed to initialize trajectory tracker", { error })
      // Don't disable - try to continue without storage
      this.enabled = false
    }
  }

  async startSession(
    sessionId: string,
    initialMessageId: string,
    sessionInfo?: {
      projectId?: string
      directory?: string
      title?: string
    },
  ): Promise<void> {
    if (!this.enabled) return

    this.sessionId = sessionId
    this.currentMessageId = initialMessageId

    try {
      await opencodeIntegration.startSession({
        sessionId,
        projectId: sessionInfo?.projectId,
        directory: sessionInfo?.directory,
        title: sessionInfo?.title,
      })
    } catch (error) {
      logger.error("failed to start session in trajectory", { error })
    }
  }

  async startSessionIfNeeded(
    sessionId: string,
    initialMessageId: string,
    sessionInfo?: {
      projectId?: string
      directory?: string
      title?: string
    },
  ): Promise<boolean> {
    if (this.sessionId === sessionId) {
      return false
    }

    await this.startSession(sessionId, initialMessageId, sessionInfo)
    return true
  }

  async captureSystemPrompt(sessionId: string, systemPrompt: string): Promise<void> {
    if (!this.enabled) return

    try {
      await opencodeIntegration.updateSessionSystemPrompt(sessionId, systemPrompt)
    } catch {
      // Silently fail
    }
  }

  async captureMessagesToLLM(sessionId: string, messages: any[]): Promise<void> {
    if (!this.enabled) return

    try {
      await opencodeIntegration.captureMessagesToLLM(sessionId, messages)
    } catch {
      // Silently fail
    }
  }

  async endSession(status: "completed" | "failed" | "cancelled" = "completed"): Promise<string | null> {
    if (!this.enabled || !this.sessionId) return null

    const sessionId = this.sessionId
    this.sessionId = null
    this.currentMessageId = null
    this.activeToolCalls.clear()
    this.activeReasoning.clear()

    try {
      return await opencodeIntegration.endSession(status)
    } catch (error) {
      logger.error("failed to end session in trajectory", { error })
      return null
    }
  }

  async captureUserMessage(
    messageId: string,
    content: string,
    metadata?: {
      systemPrompt?: string
      agent?: string
      model?: string
      providerId?: string
    },
  ): Promise<void> {
    if (!this.enabled) return

    try {
      await opencodeIntegration.captureUserMessage(messageId, content, metadata)
    } catch {
      // Silently fail
    }
  }

  async captureAssistantMessage(
    messageId: string,
    content: string,
    metadata?: {
      model?: string
      providerId?: string
      finishReason?: string
      cost?: number
      tokensInput?: number
      tokensOutput?: number
      tokensReasoning?: number
    },
  ): Promise<void> {
    if (!this.enabled) return

    this.currentMessageId = messageId

    try {
      await opencodeIntegration.captureAssistantMessage(messageId, content, metadata)
    } catch {
      // Silently fail
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
    if (!this.enabled) return ""

    try {
      return await opencodeIntegration.captureMessagePart(messageId, part)
    } catch {
      return ""
    }
  }

  async handleReasoningStart(messageId: string, reasoningId: string, metadata?: any): Promise<void> {
    if (!this.enabled || !this.config.captureReasoning) return

    this.activeReasoning.set(reasoningId, { text: "", startTime: Date.now() })

    try {
      await opencodeIntegration.captureReasoning(messageId, {
        reasoningId,
        content: "",
        model: metadata?.model,
        providerMetadata: metadata,
      })
    } catch (error) {
      logger.error("failed to capture reasoning start", { error })
    }
  }

  async handleReasoningDelta(reasoningId: string, text: string): Promise<void> {
    if (!this.enabled) return

    const reasoning = this.activeReasoning.get(reasoningId)
    if (reasoning) {
      reasoning.text += text
    }
  }

  async handleReasoningEnd(messageId: string, reasoningId: string): Promise<void> {
    if (!this.enabled || !this.config.captureReasoning) return

    const reasoning = this.activeReasoning.get(reasoningId)
    if (reasoning) {
      try {
        await opencodeIntegration.captureReasoning(messageId, {
          content: reasoning.text,
        })
      } catch (error) {
        logger.error("failed to capture reasoning end", { error })
      }
      this.activeReasoning.delete(reasoningId)
    }
  }

  async handleToolCallStart(
    messageId: string,
    toolCallId: string,
    toolName: string,
    input: any,
    callId?: string,
  ): Promise<void> {
    if (!this.enabled || !this.config.captureTools) return

    this.activeToolCalls.set(toolCallId, { toolName, startTime: Date.now(), input })

    try {
      await opencodeIntegration.captureToolCallStart(
        messageId,
        {
          toolName,
          input,
          toolCallId,
          callId,
        },
        this.currentBranchId ?? undefined,
      )
    } catch (error) {
      logger.error("failed to capture tool call start", { error })
    }
  }

  async handleToolCallResult(
    messageId: string,
    toolCallId: string,
    output: string,
    status: "completed" | "failed" = "completed",
  ): Promise<void> {
    if (!this.enabled || !this.config.captureTools) return

    const toolCall = this.activeToolCalls.get(toolCallId)
    if (toolCall) {
      try {
        await opencodeIntegration.captureToolCallComplete(
          toolCallId,
          {
            output,
            status,
          },
          this.currentBranchId ?? undefined,
        )
      } catch (error) {
        logger.error("failed to capture tool call result", { error })
      }
      this.activeToolCalls.delete(toolCallId)
    }
  }

  async handleToolCallError(messageId: string, toolCallId: string, error: string): Promise<void> {
    if (!this.enabled || !this.config.captureTools) return

    const toolCall = this.activeToolCalls.get(toolCallId)
    if (toolCall) {
      try {
        await opencodeIntegration.captureToolCallComplete(toolCallId, {
          output: error,
          status: "failed",
        })
      } catch (err) {
        logger.error("failed to capture tool call error", { error: err })
      }
      this.activeToolCalls.delete(toolCallId)
    }
  }

  async handleTextStart(messageId: string, partId: string): Promise<void> {
    if (!this.enabled || !this.config.captureSteps) return
  }

  async handleTextDelta(partId: string, text: string): Promise<void> {
    if (!this.enabled) return
  }

  async handleTextEnd(messageId: string, partId: string, content: string): Promise<void> {
    if (!this.enabled || !this.config.captureSteps) return
  }

  async handleStepStart(messageId: string, stepId: string, snapshot?: string): Promise<void> {
    if (!this.enabled || !this.config.captureSteps) return
  }

  async captureStepStart(messageId: string, stepId?: string): Promise<string> {
    if (!this.enabled || !this.config.captureSteps) return ""

    try {
      return await opencodeIntegration.captureStep(messageId, {
        stepId,
        stepType: "text_generation",
      })
    } catch {
      return ""
    }
  }

  async captureSessionCompaction(compaction: {
    model?: string
    providerId?: string
    summary?: string
    tokensBefore?: number
    tokensAfter?: number
  }): Promise<string> {
    if (!this.enabled) return ""

    try {
      return await opencodeIntegration.captureSessionCompaction(this.sessionId || "", compaction)
    } catch {
      return ""
    }
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
    if (!this.enabled) return ""

    try {
      return await opencodeIntegration.captureToolAttachment(attachment)
    } catch {
      return ""
    }
  }

  async captureBranchSelection(selection: {
    sessionId: string
    winnerBranchId: string
    winnerStrategy: string
    allBranches: Array<{
      id: string
      name: string
      status: string
      success: boolean
      durationMs: number
    }>
    scores: Record<string, number>
  }): Promise<void> {
    if (!this.enabled) return

    try {
      await opencodeIntegration.captureBranchSelection(selection)
    } catch (error) {
      logger.error("failed to capture branch selection", { error })
    }
  }

  async handleStepEnd(
    messageId: string,
    stepId: string,
    stepData: {
      reason?: string
      tokensInput?: number
      tokensOutput?: number
      tokensReasoning?: number
      cost?: number
      patch?: { hash: string; files: any[] }
    },
  ): Promise<void> {
    if (!this.enabled || !this.config.captureSteps) return

    try {
      if (messageId) {
        await opencodeIntegration.captureStep(messageId, {
          stepId,
          stepType: stepData.reason === "patch" ? "text" : "text_generation",
          content: stepData.patch?.files ? JSON.stringify(stepData.patch.files) : undefined,
          outputData: stepData,
          reason: stepData.reason,
          tokensInput: stepData.tokensInput,
          tokensOutput: stepData.tokensOutput,
          tokensReasoning: stepData.tokensReasoning,
          cost: stepData.cost,
        })
      }
    } catch (error) {
      logger.error("failed to capture step end", { error })
    }
  }

  async handleError(messageId: string, error: string, stack?: string): Promise<void> {
    if (!this.enabled || !this.config.captureErrors) return

    try {
      await opencodeIntegration.captureError(messageId, {
        message: error,
        stack,
      })
    } catch (err) {
      logger.error("failed to capture error", { error: err })
    }
  }

  async completeTrajectory(title?: string, description?: string): Promise<string | null> {
    if (!this.enabled) return null

    try {
      return await opencodeIntegration.completeTrajectory(title, description)
    } catch (error) {
      logger.error("failed to complete trajectory", { error })
      return null
    }
  }

  async searchKnowledge(query: string, options?: { category?: string; limit?: number }): Promise<any[]> {
    if (!this.enabled) return []

    try {
      return await opencodeIntegration.searchKnowledge(query, options)
    } catch (error) {
      logger.error("failed to search knowledge", { error })
      return []
    }
  }

  async getRelevantMemories(scope: string): Promise<any[]> {
    if (!this.enabled) return []

    try {
      return await opencodeIntegration.getRelevantMemories(scope)
    } catch (error) {
      logger.error("failed to get memories", { error })
      return []
    }
  }

  getActiveToolCalls(): Array<{ toolCallId: string; toolName: string; startTime: number; input: any }> {
    return Array.from(this.activeToolCalls.entries()).map(([id, data]) => ({
      toolCallId: id,
      ...data,
    }))
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setBranch(branchId: string | null): void {
    this.currentBranchId = branchId
  }

  getBranch(): string | null {
    return this.currentBranchId
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  getCurrentMessageId(): string | null {
    return this.currentMessageId
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
    if (!this.enabled) return ""

    try {
      return await opencodeIntegration.captureFileOperation(operation)
    } catch (error) {
      logger.error("failed to capture file operation", { error })
      return ""
    }
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
    if (!this.enabled) return ""

    try {
      return await opencodeIntegration.captureSnapshot(snapshot)
    } catch (error) {
      logger.error("failed to capture snapshot", { error })
      return ""
    }
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
    if (!this.enabled) return ""

    try {
      return await opencodeIntegration.capturePatch(patch)
    } catch (error) {
      logger.error("failed to capture patch", { error })
      return ""
    }
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
    if (!this.enabled) return ""

    try {
      return await opencodeIntegration.captureRetry(retry)
    } catch (error) {
      logger.error("failed to capture retry", { error })
      return ""
    }
  }

  async captureExecutionLog(log: {
    stepId?: string
    toolCallId?: string
    logLevel: "debug" | "info" | "warn" | "error"
    source?: string
    message: string
    data?: Record<string, any>
  }): Promise<number> {
    if (!this.enabled) return 0

    try {
      return await opencodeIntegration.captureExecutionLog(log)
    } catch (error) {
      logger.error("failed to capture execution log", { error })
      return 0
    }
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
    if (!this.enabled) return 0

    try {
      return await opencodeIntegration.captureApiCall(apiCall)
    } catch (error) {
      logger.error("failed to capture api call", { error })
      return 0
    }
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
    if (!this.enabled) return ""

    try {
      return await opencodeIntegration.capturePermissionRequest(request)
    } catch (error) {
      logger.error("failed to capture permission request", { error })
      return ""
    }
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
    if (!this.enabled) return 0

    try {
      return await opencodeIntegration.captureCostStatistic(stat)
    } catch (error) {
      logger.error("failed to capture cost statistic", { error })
      return 0
    }
  }

  disable(): void {
    this.enabled = false
  }

  async enable(): Promise<void> {
    await this.initialize()
  }
}

export const sessionTrajectoryTracker = new SessionTrajectoryTracker()
