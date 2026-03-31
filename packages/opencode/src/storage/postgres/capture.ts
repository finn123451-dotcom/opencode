import { EventEmitter } from "events"
import {
  trajectoryStorage,
  CompleteTrajectoryData,
  SessionData,
  MessageData,
  StepData,
  ToolCallData,
  TrajectoryData,
  MessagePartData,
  ReasoningChainData,
  ToolAttachmentData,
  FileOperationData,
  SnapshotData,
  PatchData,
  SubtaskData,
  SessionCompactionData,
  RetryData,
  ExecutionLogData,
  ApiCallLogData,
  CostStatisticData,
  PermissionRequestData,
} from "./trajectory"
import { knowledgeBase, memoryManager } from "./knowledge"
import { v4 as uuidv4 } from "uuid"
import { Log } from "../../util/log"

const logger = Log.create({ service: "trajectory-capture" })

export interface TrajectoryCaptureConfig {
  enabled: boolean
  storeEmbeddings: boolean
  generateKnowledge: boolean
  captureRate: number
  captureFiles: boolean
  captureSnapshots: boolean
  capturePatches: boolean
}

export interface CaptureEvent {
  type: string
  timestamp: Date
  data: any
}

export class TrajectoryCapture extends EventEmitter {
  private config: TrajectoryCaptureConfig
  private currentSessionId: string | null = null
  private currentMessageId: string | null = null
  private stepCounter: number = 0
  private toolCallCounter: number = 0
  private startTime: Date | null = null

  private sessionBuffer: Partial<SessionData> | null = null
  private messageBuffer: MessageData[] = []
  private partBuffer: MessagePartData[] = []
  private reasoningBuffer: ReasoningChainData[] = []
  private toolCallBuffer: ToolCallData[] = []
  private attachmentBuffer: ToolAttachmentData[] = []
  private fileOpBuffer: FileOperationData[] = []
  private snapshotBuffer: SnapshotData[] = []
  private patchBuffer: PatchData[] = []
  private stepBuffer: StepData[] = []
  private subtaskBuffer: SubtaskData[] = []
  private compactionBuffer: SessionCompactionData[] = []
  private retryBuffer: RetryData[] = []
  private executionLogBuffer: ExecutionLogData[] = []
  private apiCallLogBuffer: ApiCallLogData[] = []
  private permissionRequestBuffer: PermissionRequestData[] = []

  constructor(config: Partial<TrajectoryCaptureConfig> = {}) {
    super()
    this.config = {
      enabled: config.enabled ?? true,
      storeEmbeddings: config.storeEmbeddings ?? true,
      generateKnowledge: config.generateKnowledge ?? true,
      captureRate: config.captureRate ?? 1.0,
      captureFiles: config.captureFiles ?? true,
      captureSnapshots: config.captureSnapshots ?? true,
      capturePatches: config.capturePatches ?? true,
    }
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      logger.info("capture is disabled")
      return
    }
    logger.info("initialized")
  }

  async startSession(sessionInfo: {
    sessionId: string
    projectId?: string
    userId?: string
    parentSessionId?: string
    directory: string
    title?: string
    version?: string
    permission?: Record<string, any>[]
  }): Promise<string> {
    if (!this.config.enabled) {
      logger.debug("capture disabled, not starting session")
      return sessionInfo.sessionId
    }

    this.currentSessionId = sessionInfo.sessionId
    this.startTime = new Date()

    logger.info("starting session", { sessionId: sessionInfo.sessionId, directory: sessionInfo.directory })

    this.sessionBuffer = {
      id: sessionInfo.sessionId,
      projectId: sessionInfo.projectId,
      userId: sessionInfo.userId,
      parentSessionId: sessionInfo.parentSessionId,
      directory: sessionInfo.directory,
      title: sessionInfo.title,
      version: sessionInfo.version,
      permission: sessionInfo.permission,
    }

    await trajectoryStorage.createSession(this.sessionBuffer as SessionData)

    this.emit("session_start", {
      type: "session_start",
      timestamp: new Date(),
      data: sessionInfo,
    })

    return sessionInfo.sessionId
  }

  async endSession(status: "completed" | "failed" | "cancelled" = "completed"): Promise<string | null> {
    if (!this.config.enabled || !this.currentSessionId) return null

    const sessionId = this.currentSessionId

    if (sessionId && this.config.generateKnowledge) {
      try {
        const session = await trajectoryStorage.getSessionComplete(sessionId)
        if (session) {
          const trajectoryData = { session, messages: [], toolCalls: [], steps: [] }
          await knowledgeBase.generateKnowledgeFromTrajectory(trajectoryData as any)
          await memoryManager.extractAndStoreMemories(trajectoryData as any)
        }
      } catch (error) {
        logger.error("failed to generate knowledge from completed session", { error })
      }
    }

    this.emit("session_end", {
      type: "session_end",
      timestamp: new Date(),
      data: { sessionId: this.currentSessionId, status },
    })

    this.resetSession()
    return sessionId
  }

  async updateSessionSystemPrompt(sessionId: string, systemPrompt: string): Promise<void> {
    if (!this.config.enabled || !this.currentSessionId) return

    try {
      await trajectoryStorage.updateSessionSystemPrompt(sessionId, systemPrompt)
    } catch (error) {
      logger.error("failed to update session system prompt", { error })
    }
  }

  async captureMessagesToLLM(sessionId: string, messages: any[]): Promise<void> {
    if (!this.config.enabled || !this.currentSessionId || !messages?.length) return

    try {
      await trajectoryStorage.createLlmMessages(sessionId, messages)
    } catch (error) {
      logger.error("failed to capture messages to LLM", { error })
    }
  }

  private resetSession(): void {
    this.currentSessionId = null
    this.currentMessageId = null
    this.stepCounter = 0
    this.toolCallCounter = 0
    this.startTime = null
    this.sessionBuffer = null
    this.messageBuffer = []
    this.partBuffer = []
    this.reasoningBuffer = []
    this.toolCallBuffer = []
    this.attachmentBuffer = []
    this.fileOpBuffer = []
    this.snapshotBuffer = []
    this.patchBuffer = []
    this.stepBuffer = []
    this.subtaskBuffer = []
    this.compactionBuffer = []
    this.retryBuffer = []
  }

  async captureUserMessage(
    messageId: string,
    content: string,
    metadata?: {
      parentId?: string
      model?: string
      providerId?: string
      agent?: string
      variant?: string
      systemPrompt?: string
      cost?: number
      tokensInput?: number
      tokensOutput?: number
      tokensReasoning?: number
      tokensCacheRead?: number
      tokensCacheWrite?: number
      timeCreated?: number
    },
  ): Promise<void> {
    if (!this.config.enabled || !this.currentSessionId) {
      logger.debug("skipping captureUserMessage", { enabled: this.config.enabled, sessionId: this.currentSessionId })
      return
    }

    const messageData: MessageData = {
      id: messageId,
      sessionId: this.currentSessionId,
      parentId: metadata?.parentId,
      role: "user",
      content,
      model: metadata?.model,
      providerId: metadata?.providerId,
      agent: metadata?.agent,
      variant: metadata?.variant,
      systemPrompt: metadata?.systemPrompt,
      cost: metadata?.cost || 0,
      tokensInput: metadata?.tokensInput || 0,
      tokensOutput: metadata?.tokensOutput || 0,
      tokensReasoning: metadata?.tokensReasoning || 0,
      tokensCacheRead: metadata?.tokensCacheRead || 0,
      tokensCacheWrite: metadata?.tokensCacheWrite || 0,
      timeCreated: metadata?.timeCreated ?? Date.now(),
      stepOrder: this.messageBuffer.length,
    }

    await trajectoryStorage.createMessage(messageData)
    this.messageBuffer.push(messageData)
    this.currentMessageId = messageId

    this.emit("message", {
      type: "user_message",
      timestamp: new Date(),
      data: messageData,
    })
  }

  async captureAssistantMessage(
    messageId: string,
    content: string,
    metadata?: {
      parentId?: string
      model?: string
      providerId?: string
      agent?: string
      variant?: string
      finishReason?: string
      cost?: number
      tokensInput?: number
      tokensOutput?: number
      tokensReasoning?: number
      tokensCacheRead?: number
      tokensCacheWrite?: number
      timeCreated?: number
      timeCompleted?: number
    },
  ): Promise<void> {
    if (!this.config.enabled || !this.currentSessionId) {
      logger.debug("skipping captureAssistantMessage", {
        enabled: this.config.enabled,
        sessionId: this.currentSessionId,
      })
      return
    }

    const messageData: MessageData = {
      id: messageId,
      sessionId: this.currentSessionId,
      parentId: metadata?.parentId,
      role: "assistant",
      content,
      model: metadata?.model,
      providerId: metadata?.providerId,
      agent: metadata?.agent,
      variant: metadata?.variant,
      finishReason: metadata?.finishReason,
      cost: metadata?.cost || 0,
      tokensInput: metadata?.tokensInput || 0,
      tokensOutput: metadata?.tokensOutput || 0,
      tokensReasoning: metadata?.tokensReasoning || 0,
      tokensCacheRead: metadata?.tokensCacheRead || 0,
      tokensCacheWrite: metadata?.tokensCacheWrite || 0,
      timeCreated: metadata?.timeCreated ?? Date.now(),
      timeCompleted: metadata?.timeCompleted ?? null,
      stepOrder: this.messageBuffer.length,
    }

    await trajectoryStorage.createMessage(messageData)
    this.messageBuffer.push(messageData)
    this.currentMessageId = messageId

    this.emit("message", {
      type: "assistant_message",
      timestamp: new Date(),
      data: messageData,
    })
  }

  async captureReasoningStart(
    messageId: string,
    reasoningId: string,
    metadata?: {
      model?: string
      providerMetadata?: Record<string, any>
    },
  ): Promise<void> {
    if (!this.config.enabled || !this.currentSessionId) return

    const reasoningData: ReasoningChainData = {
      id: reasoningId,
      sessionId: this.currentSessionId,
      messageId,
      content: "",
      model: metadata?.model,
      providerMetadata: metadata?.providerMetadata,
      timeStart: Date.now(),
    }

    await trajectoryStorage.createReasoningChain(reasoningData)
    this.reasoningBuffer.push(reasoningData)

    this.emit("reasoning_start", {
      type: "reasoning_start",
      timestamp: new Date(),
      data: reasoningData,
    })
  }

  async captureReasoningDelta(reasoningId: string, text: string): Promise<void> {
    if (!this.config.enabled) return

    const reasoning = this.reasoningBuffer.find((r) => r.id === reasoningId)
    if (reasoning) {
      reasoning.content += text
    }
  }

  async captureReasoningEnd(reasoningId: string, fullContent: string): Promise<void> {
    if (!this.config.enabled) return

    const reasoning = this.reasoningBuffer.find((r) => r.id === reasoningId)
    if (reasoning) {
      reasoning.content = fullContent
      reasoning.timeEnd = Date.now()
    }

    this.emit("reasoning_end", {
      type: "reasoning_end",
      timestamp: new Date(),
      data: { id: reasoningId, content: fullContent },
    })
  }

  async captureReasoning(
    messageId: string,
    reasoning: {
      reasoningId?: string
      content: string
      model?: string
      providerMetadata?: Record<string, any>
    },
  ): Promise<string | void> {
    if (!this.config.enabled || !this.currentSessionId) return

    const actualReasoningId = reasoning.reasoningId || uuidv4()

    // Check if already exists in buffer
    let existingReasoning = this.reasoningBuffer.find((r) => r.id === actualReasoningId)

    if (!existingReasoning) {
      // Start new reasoning (INSERT)
      await this.captureReasoningStart(messageId, actualReasoningId, {
        model: reasoning.model,
        providerMetadata: reasoning.providerMetadata,
      })
      existingReasoning = this.reasoningBuffer.find((r) => r.id === actualReasoningId)
    }

    if (existingReasoning) {
      // Update messageId if provided and different
      if (messageId && messageId !== existingReasoning.messageId) {
        existingReasoning.messageId = messageId
      }

      if (reasoning.content) {
        existingReasoning.content = reasoning.content
        existingReasoning.timeEnd = Date.now()
      }

      // Update existing record (UPDATE, not INSERT)
      await trajectoryStorage.updateReasoningChain(actualReasoningId, {
        content: existingReasoning.content,
        timeEnd: existingReasoning.timeEnd,
        messageId: existingReasoning.messageId,
      })
    }

    return actualReasoningId
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
    if (!this.config.enabled || !this.currentSessionId) return ""

    const id = uuidv4()
    const partData: MessagePartData = {
      id,
      sessionId: this.currentSessionId,
      messageId: messageId || this.currentMessageId || "",
      partType: part.partType,
      content: part.content,
      partOrder: part.partOrder || this.partBuffer.length,
      metadata: part.metadata,
    }

    try {
      await trajectoryStorage.createMessagePart(partData)
      this.partBuffer.push(partData)
      return id
    } catch (error: any) {
      if (error?.code === "23503") {
        return ""
      }
      throw error
    }
  }

  async captureToolCallStart(
    messageId: string,
    toolCallId: string,
    callId: string,
    toolName: string,
    input: Record<string, any>,
    metadata?: {
      title?: string
    },
  ): Promise<string> {
    if (!this.config.enabled || !this.currentSessionId) return ""

    const toolCallData: ToolCallData = {
      id: toolCallId,
      sessionId: this.currentSessionId,
      messageId,
      callId,
      toolName,
      input,
      status: "running",
      title: metadata?.title,
      timeCreated: Date.now(),
      timeStart: Date.now(),
    }

    await trajectoryStorage.createToolCall(toolCallData)
    this.toolCallBuffer.push(toolCallData)
    this.toolCallCounter++

    await this.captureStep(messageId, {
      stepType: "tool_call",
      content: `${toolName}(${JSON.stringify(input)})`,
      inputData: input,
    })

    this.emit("tool_call_start", {
      type: "tool_call_start",
      timestamp: new Date(),
      data: toolCallData,
    })

    return toolCallId
  }

  async captureToolCallComplete(
    toolCallId: string,
    result: {
      output: string
      status?: "completed" | "failed"
      title?: string
      truncated?: boolean
      outputPath?: string
      durationMs?: number
      attachments?: Array<{
        filename?: string
        mime?: string
        url?: string
        sourceType?: string
        sourcePath?: string
      }>
    },
  ): Promise<void> {
    if (!this.config.enabled) return

    const toolCall = this.toolCallBuffer.find((tc) => tc.id === toolCallId)
    if (toolCall) {
      toolCall.output = result.output
      toolCall.status = result.status || "completed"
      toolCall.title = result.title || toolCall.title
      toolCall.truncated = result.truncated
      toolCall.outputPath = result.outputPath
      toolCall.durationMs = result.durationMs || (toolCall.timeStart ? Date.now() - toolCall.timeStart : undefined)
      toolCall.timeEnd = Date.now()

      await trajectoryStorage.updateToolCall(toolCallId, {
        output: result.output,
        status: toolCall.status,
        title: toolCall.title,
        truncated: toolCall.truncated,
        durationMs: toolCall.durationMs,
        timeEnd: toolCall.timeEnd,
      })
    }

    this.emit("tool_call_complete", {
      type: "tool_call_complete",
      timestamp: new Date(),
      data: { toolCallId, ...result },
    })
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
    if (!this.config.enabled || !this.currentSessionId) return ""

    const stepId = step.stepId || uuidv4()

    // Check if step already exists in buffer
    let existingStep = this.stepBuffer.find((s) => s.id === stepId)

    if (existingStep) {
      // Update existing step
      existingStep.content = step.content || existingStep.content
      existingStep.outputData = step.outputData || existingStep.outputData
      existingStep.reason = step.reason || existingStep.reason
      existingStep.durationMs = step.durationMs || existingStep.durationMs
      existingStep.tokensInput = step.tokensInput
      existingStep.tokensOutput = step.tokensOutput
      existingStep.tokensReasoning = step.tokensReasoning
      existingStep.cost = step.cost
      existingStep.timeEnd = Date.now()

      await trajectoryStorage.updateStep(stepId, {
        content: existingStep.content,
        outputData: existingStep.outputData,
        reason: existingStep.reason,
        durationMs: existingStep.durationMs,
        tokensInput: existingStep.tokensInput,
        tokensOutput: existingStep.tokensOutput,
        tokensReasoning: existingStep.tokensReasoning,
        cost: existingStep.cost,
        timeEnd: existingStep.timeEnd,
      })

      return stepId
    }

    // Create new step
    const stepData: StepData = {
      id: stepId,
      sessionId: this.currentSessionId,
      messageId,
      stepType: step.stepType,
      stepOrder: ++this.stepCounter,
      content: step.content,
      inputData: step.inputData,
      outputData: step.outputData,
      reason: step.reason,
      durationMs: step.durationMs,
      tokensInput: step.tokensInput,
      tokensOutput: step.tokensOutput,
      tokensReasoning: step.tokensReasoning,
      cost: step.cost,
      timeStart: Date.now(),
    }

    await trajectoryStorage.createStep(stepData)
    this.stepBuffer.push(stepData)

    this.emit("step", {
      type: "step",
      timestamp: new Date(),
      data: stepData,
    })

    return stepId
  }

  async captureError(
    messageId: string,
    error: {
      message: string
      stack?: string
      metadata?: Record<string, any>
    },
  ): Promise<void> {
    if (!this.config.enabled) return

    await this.captureStep(messageId, {
      stepType: "error",
      content: error.message,
      outputData: { error: error.message, stack: error.stack, ...error.metadata },
    })

    this.emit("error", {
      type: "error",
      timestamp: new Date(),
      data: { messageId, ...error },
    })
  }

  async createTrajectory(title?: string, description?: string): Promise<string> {
    if (!this.config.enabled || !this.currentSessionId || this.messageBuffer.length === 0) {
      throw new Error("No active session or no messages to create trajectory")
    }

    // Update session with summary data
    const sessionId = this.currentSessionId
    const titleContent = title || this.messageBuffer[0]?.content?.substring(0, 100) || "未命名会话"

    // Update session with totals
    await trajectoryStorage.updateSessionSummary(sessionId, {
      title: titleContent,
      description: description,
      totalSteps: this.stepCounter,
      totalToolCalls: this.toolCallCounter,
      totalDurationMs: this.startTime ? Date.now() - this.startTime.getTime() : undefined,
    })

    return sessionId
  }

  async storeCompleteTrajectory(title?: string, description?: string): Promise<string> {
    if (!this.config.enabled || !this.currentSessionId) {
      throw new Error("No active session")
    }

    const sessionId = await this.createTrajectory(title, description)

    // Store the complete data
    await trajectoryStorage.storeCompleteTrajectory({
      session: this.sessionBuffer as SessionData,
      messages: [...this.messageBuffer],
      parts: [...this.partBuffer],
      reasoningChains: [...this.reasoningBuffer],
      toolCalls: [...this.toolCallBuffer],
      attachments: [...this.attachmentBuffer],
      fileOperations: [...this.fileOpBuffer],
      snapshots: [...this.snapshotBuffer],
      patches: [...this.patchBuffer],
      steps: [...this.stepBuffer],
      subtasks: [...this.subtaskBuffer],
      compactions: [...this.compactionBuffer],
      retries: [...this.retryBuffer],
    } as any)

    return sessionId
  }

  async searchKnowledge(query: string, options?: { category?: string; limit?: number }): Promise<any[]> {
    if (!this.config.enabled) return []
    return knowledgeBase.searchKnowledge(query, options)
  }

  async getRelevantMemories(scope: string): Promise<any[]> {
    if (!this.config.enabled) return []
    return memoryManager.getMemoriesByScope(scope)
  }

  getConfig(): TrajectoryCaptureConfig {
    return { ...this.config }
  }

  updateConfig(updates: Partial<TrajectoryCaptureConfig>): void {
    this.config = { ...this.config, ...updates }
  }

  isEnabled(): boolean {
    return this.config.enabled
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId
  }

  getStats(): {
    sessionId: string | null
    messageCount: number
    stepCount: number
    toolCallCount: number
    fileOperationCount: number
    snapshotCount: number
    patchCount: number
    startTime: Date | null
  } {
    return {
      sessionId: this.currentSessionId,
      messageCount: this.messageBuffer.length,
      stepCount: this.stepCounter,
      toolCallCount: this.toolCallCounter,
      fileOperationCount: this.fileOpBuffer.length,
      snapshotCount: this.snapshotBuffer.length,
      patchCount: this.patchBuffer.length,
      startTime: this.startTime,
    }
  }

  disable(): void {
    this.config.enabled = false
  }

  async enable(): Promise<void> {
    this.config.enabled = true
    await this.initialize()
  }

  // Alias methods for integration compatibility
  async startToolCall(
    messageId: string,
    toolCall: {
      toolName: string
      input: Record<string, any>
      toolCallId?: string
    },
  ): Promise<string> {
    // Use the provided toolCallId or generate a new one
    const actualToolCallId = toolCall.toolCallId || uuidv4()
    await this.captureToolCallStart(messageId, actualToolCallId, uuidv4(), toolCall.toolName, toolCall.input)
    return actualToolCallId
  }

  async completeToolCall(
    toolCallId: string,
    result: {
      output: string
      status?: "completed" | "failed"
    },
  ): Promise<void> {
    await this.captureToolCallComplete(toolCallId, result)
  }

  async captureMessage(message: {
    id: string
    role: string
    content: string
    metadata?: Record<string, any>
  }): Promise<void> {
    if (message.role === "user") {
      await this.captureUserMessage(message.id, message.content, message.metadata)
    } else if (message.role === "assistant") {
      await this.captureAssistantMessage(message.id, message.content, message.metadata)
    }
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
    if (!this.config.enabled || !this.currentSessionId || !this.config.captureFiles) return ""

    const id = uuidv4()
    const data: FileOperationData = {
      id,
      sessionId: this.currentSessionId,
      messageId: operation.messageId || this.currentMessageId || undefined,
      toolCallId: operation.toolCallId,
      operationType: operation.operationType,
      filePath: operation.filePath,
      fileContent: operation.fileContent,
      fileMime: operation.fileMime,
      fileSize: operation.fileSize,
      offset: operation.offset,
      limit: operation.limit,
      diffContent: operation.diffContent,
      diffHash: operation.diffHash,
      diffStats: operation.diffStats,
      operationOrder: this.fileOpBuffer.length,
      metadata: operation.metadata,
    }

    await trajectoryStorage.createFileOperation(data)
    this.fileOpBuffer.push(data)

    return id
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
    if (!this.config.enabled || !this.currentSessionId || !this.config.captureSnapshots) return ""

    const id = uuidv4()
    const data: SnapshotData = {
      id,
      sessionId: this.currentSessionId,
      messageId: snapshot.messageId || this.currentMessageId || undefined,
      stepId: snapshot.stepId,
      snapshotHash: snapshot.snapshotHash,
      workingDirectory: snapshot.workingDirectory,
      fileCount: snapshot.fileCount,
      fileList: snapshot.fileList,
      timeCreated: Date.now(),
      snapshotOrder: this.snapshotBuffer.length,
      metadata: snapshot.metadata,
    }

    await trajectoryStorage.createSnapshot(data)
    this.snapshotBuffer.push(data)

    return id
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
    if (!this.config.enabled || !this.currentSessionId || !this.config.capturePatches) return ""

    const id = uuidv4()
    const data: PatchData = {
      id,
      sessionId: this.currentSessionId,
      messageId: patch.messageId || this.currentMessageId || undefined,
      stepId: patch.stepId,
      patchHash: patch.patchHash,
      filePath: patch.filePath,
      fileDiff: patch.fileDiff,
      additions: patch.additions,
      deletions: patch.deletions,
      diffStats: patch.diffStats,
      originalContent: patch.originalContent,
      patchedContent: patch.patchedContent,
      timeCreated: Date.now(),
      patchOrder: this.patchBuffer.length,
      metadata: patch.metadata,
    }

    await trajectoryStorage.createPatch(data)
    this.patchBuffer.push(data)

    return id
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
    if (!this.config.enabled || !this.currentSessionId) return ""

    const id = uuidv4()
    const data: SessionCompactionData = {
      id,
      sessionId: this.currentSessionId,
      model: compaction.model,
      providerId: compaction.providerId,
      summary: compaction.summary,
      tokensBefore: compaction.tokensBefore,
      tokensAfter: compaction.tokensAfter,
      timeCreated: Date.now(),
    }

    await trajectoryStorage.createSessionCompaction(data)
    this.compactionBuffer.push(data)

    return id
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
    if (!this.config.enabled || !this.currentSessionId) return ""

    const id = uuidv4()
    const data: ToolAttachmentData = {
      id,
      sessionId: this.currentSessionId,
      messageId: attachment.messageId || this.currentMessageId || undefined,
      toolCallId: attachment.toolCallId,
      filename: attachment.filename,
      mime: attachment.mime,
      url: attachment.url,
      sourceType: attachment.sourceType,
      sourcePath: attachment.sourcePath,
      sourceRange: attachment.sourceRange,
      timeCreated: Date.now(),
    }

    await trajectoryStorage.createToolAttachment(data)

    return id
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
    if (!this.config.enabled || !this.currentSessionId) return ""

    const id = uuidv4()
    const data: RetryData = {
      id,
      sessionId: this.currentSessionId,
      messageId: retry.messageId,
      attemptNumber: retry.attemptNumber,
      errorName: retry.errorName,
      errorMessage: retry.errorMessage,
      errorDetails: retry.errorDetails,
      errorStack: retry.errorStack,
      status: retry.status || "pending",
      timeCreated: Date.now(),
      metadata: retry.metadata,
    }

    await trajectoryStorage.createRetry(data)
    this.retryBuffer.push(data)

    return id
  }

  async captureExecutionLog(log: {
    stepId?: string
    toolCallId?: string
    logLevel: "debug" | "info" | "warn" | "error"
    source?: string
    message: string
    data?: Record<string, any>
  }): Promise<number> {
    if (!this.config.enabled || !this.currentSessionId) return 0

    const data: ExecutionLogData = {
      sessionId: this.currentSessionId,
      stepId: log.stepId,
      toolCallId: log.toolCallId,
      logLevel: log.logLevel,
      source: log.source,
      message: log.message,
      data: log.data,
      timeCreated: Date.now(),
    }

    const id = await trajectoryStorage.createExecutionLog(data)
    this.executionLogBuffer.push(data)

    return id
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
    if (!this.config.enabled || !this.currentSessionId) return 0

    const data: ApiCallLogData = {
      messageId: apiCall.messageId || this.currentMessageId || undefined,
      providerId: apiCall.providerId,
      modelId: apiCall.modelId,
      endpoint: apiCall.endpoint,
      requestBody: apiCall.requestBody,
      responseBody: apiCall.responseBody,
      statusCode: apiCall.statusCode,
      latencyMs: apiCall.latencyMs,
      cost: apiCall.cost,
      tokensInput: apiCall.tokensInput,
      tokensOutput: apiCall.tokensOutput,
      errorMessage: apiCall.errorMessage,
      errorCode: apiCall.errorCode,
      timeCreated: Date.now(),
      metadata: apiCall.metadata,
    }

    const id = await trajectoryStorage.createApiCallLog(data)
    this.apiCallLogBuffer.push(data)

    return id
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
    if (!this.config.enabled || !this.currentSessionId) return ""

    const data: PermissionRequestData = {
      sessionId: this.currentSessionId,
      permissionType: request.permissionType,
      action: request.action,
      pattern: request.pattern,
      toolName: request.toolName,
      inputData: request.inputData,
      status: request.status || "pending",
      userResponse: request.userResponse,
      responseMessage: request.responseMessage,
      timeCreated: Date.now(),
      respondedAt: request.respondedAt,
      metadata: request.metadata,
    }

    const id = await trajectoryStorage.createPermissionRequest(data)
    this.permissionRequestBuffer.push(data)

    return id
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
    if (!this.config.enabled || !this.currentSessionId) return 0

    const data: CostStatisticData = {
      sessionId: this.currentSessionId,
      providerId: stat.providerId,
      modelId: stat.modelId,
      costInput: stat.costInput,
      costOutput: stat.costOutput,
      costCacheRead: stat.costCacheRead,
      costCacheWrite: stat.costCacheWrite,
      costReasoning: stat.costReasoning,
      totalCost: stat.totalCost,
      tokensInput: stat.tokensInput,
      tokensOutput: stat.tokensOutput,
      tokensReasoning: stat.tokensReasoning,
      tokensCacheRead: stat.tokensCacheRead,
      tokensCacheWrite: stat.tokensCacheWrite,
      apiCalls: stat.apiCalls,
      periodStart: stat.periodStart || Date.now(),
      periodEnd: stat.periodEnd,
      metadata: stat.metadata,
    }

    const id = await trajectoryStorage.createCostStatistic(data)
    return id
  }
}

export const trajectoryCapture = new TrajectoryCapture()
