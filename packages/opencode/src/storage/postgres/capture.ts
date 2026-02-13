import { EventEmitter } from 'events';
import { trajectoryStorage, CompleteTrajectoryData, SessionData, MessageData, StepData, ToolCallData, TrajectoryData, MessagePartData, ReasoningChainData, ToolAttachmentData, FileOperationData, SnapshotData, PatchData, SubtaskData, SessionCompactionData, RetryData } from './trajectory';
import { knowledgeBase, memoryManager } from './knowledge';
import { v4 as uuidv4 } from 'uuid';
import { Log } from "../../util/log";

const logger = Log.create({ service: "trajectory-capture" })

export interface TrajectoryCaptureConfig {
  enabled: boolean;
  storeEmbeddings: boolean;
  generateKnowledge: boolean;
  captureRate: number;
  captureFiles: boolean;
  captureSnapshots: boolean;
  capturePatches: boolean;
}

export interface CaptureEvent {
  type: string;
  timestamp: Date;
  data: any;
}

export class TrajectoryCapture extends EventEmitter {
  private config: TrajectoryCaptureConfig;
  private currentSessionId: string | null = null;
  private currentTrajectoryId: string | null = null;
  private currentMessageId: string | null = null;
  private stepCounter: number = 0;
  private toolCallCounter: number = 0;
  private startTime: Date | null = null;

  private sessionBuffer: Partial<SessionData> | null = null;
  private messageBuffer: MessageData[] = [];
  private partBuffer: MessagePartData[] = [];
  private reasoningBuffer: ReasoningChainData[] = [];
  private toolCallBuffer: ToolCallData[] = [];
  private attachmentBuffer: ToolAttachmentData[] = [];
  private fileOpBuffer: FileOperationData[] = [];
  private snapshotBuffer: SnapshotData[] = [];
  private patchBuffer: PatchData[] = [];
  private stepBuffer: StepData[] = [];
  private subtaskBuffer: SubtaskData[] = [];
  private compactionBuffer: SessionCompactionData[] = [];
  private retryBuffer: RetryData[] = [];

  constructor(config: Partial<TrajectoryCaptureConfig> = {}) {
    super();
    this.config = {
      enabled: config.enabled ?? true,
      storeEmbeddings: config.storeEmbeddings ?? true,
      generateKnowledge: config.generateKnowledge ?? true,
      captureRate: config.captureRate ?? 1.0,
      captureFiles: config.captureFiles ?? true,
      captureSnapshots: config.captureSnapshots ?? true,
      capturePatches: config.capturePatches ?? true,
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      logger.info("capture is disabled");
      return;
    }
    logger.info("initialized");
  }

  async startSession(sessionInfo: {
    sessionId: string;
    projectId?: string;
    userId?: string;
    parentSessionId?: string;
    directory: string;
    title?: string;
    version?: string;
    permission?: Record<string, any>[];
  }): Promise<string> {
    if (!this.config.enabled) return sessionInfo.sessionId;

    this.currentSessionId = sessionInfo.sessionId;
    this.startTime = new Date();

    this.sessionBuffer = {
      id: sessionInfo.sessionId,
      projectId: sessionInfo.projectId,
      userId: sessionInfo.userId,
      parentSessionId: sessionInfo.parentSessionId,
      directory: sessionInfo.directory,
      title: sessionInfo.title,
      version: sessionInfo.version,
      permission: sessionInfo.permission,
    };

    await trajectoryStorage.createSession(this.sessionBuffer as SessionData);

    this.emit('session_start', {
      type: 'session_start',
      timestamp: new Date(),
      data: sessionInfo,
    });

    return sessionInfo.sessionId;
  }

  async endSession(status: 'completed' | 'failed' | 'cancelled' = 'completed'): Promise<string | null> {
    if (!this.config.enabled || !this.currentSessionId) return null;

    const trajectoryId = this.currentTrajectoryId;

    if (trajectoryId && this.config.generateKnowledge) {
      try {
        const trajectory = await trajectoryStorage.getTrajectory(trajectoryId);
        if (trajectory) {
          await knowledgeBase.generateKnowledgeFromTrajectory(trajectory as any);
          await memoryManager.extractAndStoreMemories(trajectory as any);
        }
      } catch (error) {
        logger.error("failed to generate knowledge from completed trajectory", { error });
      }
    }

    this.emit('session_end', {
      type: 'session_end',
      timestamp: new Date(),
      data: { sessionId: this.currentSessionId, trajectoryId, status },
    });

    this.resetSession();
    return trajectoryId;
  }

  private resetSession(): void {
    this.currentSessionId = null;
    this.currentTrajectoryId = null;
    this.currentMessageId = null;
    this.stepCounter = 0;
    this.toolCallCounter = 0;
    this.startTime = null;
    this.sessionBuffer = null;
    this.messageBuffer = [];
    this.partBuffer = [];
    this.reasoningBuffer = [];
    this.toolCallBuffer = [];
    this.attachmentBuffer = [];
    this.fileOpBuffer = [];
    this.snapshotBuffer = [];
    this.patchBuffer = [];
    this.stepBuffer = [];
    this.subtaskBuffer = [];
    this.compactionBuffer = [];
    this.retryBuffer = [];
  }

  async captureUserMessage(messageId: string, content: string, metadata?: {
    parentId?: string;
    model?: string;
    providerId?: string;
    agent?: string;
    variant?: string;
    systemPrompt?: string;
    tokens?: number;
  }): Promise<void> {
    if (!this.config.enabled || !this.currentSessionId) return;

    const messageData: MessageData = {
      id: messageId,
      sessionId: this.currentSessionId,
      parentId: metadata?.parentId,
      role: 'user',
      content,
      model: metadata?.model,
      providerId: metadata?.providerId,
      agent: metadata?.agent,
      variant: metadata?.variant,
      systemPrompt: metadata?.systemPrompt,
      timeCreated: Date.now(),
      stepOrder: this.messageBuffer.length,
    };

    await trajectoryStorage.createMessage(messageData);
    this.messageBuffer.push(messageData);
    this.currentMessageId = messageId;

    this.emit('message', {
      type: 'user_message',
      timestamp: new Date(),
      data: messageData,
    });
  }

  async captureAssistantMessage(messageId: string, content: string, metadata?: {
    parentId?: string;
    model?: string;
    providerId?: string;
    agent?: string;
    variant?: string;
    finishReason?: string;
    cost?: number;
    tokensInput?: number;
    tokensOutput?: number;
    tokensReasoning?: number;
  }): Promise<void> {
    if (!this.config.enabled || !this.currentSessionId) return;

    const messageData: MessageData = {
      id: messageId,
      sessionId: this.currentSessionId,
      parentId: metadata?.parentId,
      role: 'assistant',
      content,
      model: metadata?.model,
      providerId: metadata?.providerId,
      agent: metadata?.agent,
      variant: metadata?.variant,
      finishReason: metadata?.finishReason,
      cost: metadata?.cost,
      tokensInput: metadata?.tokensInput,
      tokensOutput: metadata?.tokensOutput,
      tokensReasoning: metadata?.tokensReasoning,
      timeCreated: Date.now(),
      timeCompleted: Date.now(),
      stepOrder: this.messageBuffer.length,
    };

    await trajectoryStorage.createMessage(messageData);
    this.messageBuffer.push(messageData);
    this.currentMessageId = messageId;

    this.emit('message', {
      type: 'assistant_message',
      timestamp: new Date(),
      data: messageData,
    });
  }

  async captureReasoningStart(messageId: string, reasoningId: string, metadata?: {
    model?: string;
    providerMetadata?: Record<string, any>;
  }): Promise<void> {
    if (!this.config.enabled || !this.currentSessionId) return;

    const reasoningData: ReasoningChainData = {
      id: reasoningId,
      messageId,
      content: '',
      model: metadata?.model,
      providerMetadata: metadata?.providerMetadata,
      timeStart: Date.now(),
    };

    await trajectoryStorage.createReasoningChain(reasoningData);
    this.reasoningBuffer.push(reasoningData);

    this.emit('reasoning_start', {
      type: 'reasoning_start',
      timestamp: new Date(),
      data: reasoningData,
    });
  }

  async captureReasoningDelta(reasoningId: string, text: string): Promise<void> {
    if (!this.config.enabled) return;

    const reasoning = this.reasoningBuffer.find(r => r.id === reasoningId);
    if (reasoning) {
      reasoning.content += text;
    }
  }

  async captureReasoningEnd(reasoningId: string, fullContent: string): Promise<void> {
    if (!this.config.enabled) return;

    const reasoning = this.reasoningBuffer.find(r => r.id === reasoningId);
    if (reasoning) {
      reasoning.content = fullContent;
      reasoning.timeEnd = Date.now();
    }

    this.emit('reasoning_end', {
      type: 'reasoning_end',
      timestamp: new Date(),
      data: { id: reasoningId, content: fullContent },
    });
  }

  async captureReasoning(messageId: string, reasoning: {
    reasoningId?: string;
    content: string;
    model?: string;
  }): Promise<string | void> {
    if (!this.config.enabled || !this.currentSessionId) return;

    // Use provided reasoningId or generate a new one
    const actualReasoningId = reasoning.reasoningId || uuidv4();
    await this.captureReasoningStart(messageId, actualReasoningId, { model: reasoning.model });

    if (reasoning.content) {
      await this.captureReasoningDelta(actualReasoningId, reasoning.content);
      await this.captureReasoningEnd(actualReasoningId, reasoning.content);
    }

    return actualReasoningId;
  }

  async captureToolCallStart(messageId: string, toolCallId: string, callId: string, toolName: string, input: Record<string, any>, metadata?: {
    title?: string;
  }): Promise<string> {
    if (!this.config.enabled || !this.currentSessionId) return '';

    const toolCallData: ToolCallData = {
      id: toolCallId,
      messageId,
      callId,
      toolName,
      input,
      status: 'running',
      title: metadata?.title,
      timeCreated: Date.now(),
      timeStart: Date.now(),
    };

    await trajectoryStorage.createToolCall(toolCallData);
    this.toolCallBuffer.push(toolCallData);
    this.toolCallCounter++;

    await this.captureStep(messageId, {
      stepType: 'tool_call',
      content: `${toolName}(${JSON.stringify(input)})`,
      inputData: input,
    });

    this.emit('tool_call_start', {
      type: 'tool_call_start',
      timestamp: new Date(),
      data: toolCallData,
    });

    return toolCallId;
  }

  async captureToolCallComplete(toolCallId: string, result: {
    output: string;
    status?: 'completed' | 'failed';
    title?: string;
    truncated?: boolean;
    outputPath?: string;
    durationMs?: number;
    attachments?: Array<{
      filename?: string;
      mime?: string;
      url?: string;
      sourceType?: string;
      sourcePath?: string;
    }>;
  }): Promise<void> {
    if (!this.config.enabled) return;

    const toolCall = this.toolCallBuffer.find(tc => tc.id === toolCallId);
    if (toolCall) {
      toolCall.output = result.output;
      toolCall.status = result.status || 'completed';
      toolCall.title = result.title || toolCall.title;
      toolCall.truncated = result.truncated;
      toolCall.outputPath = result.outputPath;
       toolCall.durationMs = result.durationMs || (toolCall.timeStart ? Date.now() - toolCall.timeStart : undefined);
       toolCall.timeEnd = Date.now();

      await trajectoryStorage.updateToolCall(toolCallId, {
        output: result.output,
        status: toolCall.status,
        title: toolCall.title,
        truncated: toolCall.truncated,
        durationMs: toolCall.durationMs,
        timeEnd: toolCall.timeEnd,
      });
    }

    this.emit('tool_call_complete', {
      type: 'tool_call_complete',
      timestamp: new Date(),
      data: { toolCallId, ...result },
    });
  }

  async captureStep(messageId: string, step: {
    stepType: 'reasoning' | 'tool_call' | 'tool_result' | 'text' | 'error' | 'subtask' | 'compaction' | 'text_generation';
    content?: string;
    inputData?: Record<string, any>;
    outputData?: Record<string, any>;
    reason?: string;
    durationMs?: number;
  }): Promise<string> {
    if (!this.config.enabled || !this.currentSessionId) return '';

    const stepId = uuidv4();
    const stepData: StepData = {
      id: stepId,
      trajectoryId: this.currentTrajectoryId || undefined,
      sessionId: this.currentSessionId,
      messageId,
      stepType: step.stepType,
      stepOrder: ++this.stepCounter,
      content: step.content,
      inputData: step.inputData,
      outputData: step.outputData,
      reason: step.reason,
      durationMs: step.durationMs,
      timeStart: Date.now(),
    };

    await trajectoryStorage.createStep(stepData);
    this.stepBuffer.push(stepData);

    this.emit('step', {
      type: 'step',
      timestamp: new Date(),
      data: stepData,
    });

    return stepId;
  }

  async captureError(messageId: string, error: {
    message: string;
    stack?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    if (!this.config.enabled) return;

    await this.captureStep(messageId, {
      stepType: 'error',
      content: error.message,
      outputData: { error: error.message, stack: error.stack, ...error.metadata },
    });

    this.emit('error', {
      type: 'error',
      timestamp: new Date(),
      data: { messageId, ...error },
    });
  }

  async createTrajectory(title?: string, description?: string): Promise<string> {
    if (!this.config.enabled || !this.currentSessionId || this.messageBuffer.length === 0) {
      throw new Error('No active session or no messages to create trajectory');
    }

    const trajectoryId = uuidv4();
    const trajectoryData: TrajectoryData = {
      id: trajectoryId,
      sessionId: this.currentSessionId,
      rootMessageId: this.messageBuffer[0]?.id,
      model: this.messageBuffer.find(m => m.role === 'assistant')?.model,
      agent: this.messageBuffer.find(m => m.role === 'assistant')?.agent,
      title: title || this.messageBuffer[0]?.content?.substring(0, 100) || '未命名轨迹',
      description,
      status: 'active',
      totalSteps: this.stepCounter,
      totalToolCalls: this.toolCallCounter,
      totalDurationMs: this.startTime ? Date.now() - this.startTime.getTime() : undefined,
      timeCreated: this.startTime?.getTime() || Date.now(),
    };

    await trajectoryStorage.createTrajectory(trajectoryData);
    this.currentTrajectoryId = trajectoryId;

    for (const step of this.stepBuffer) {
      await trajectoryStorage.createStep({ ...step, trajectoryId });
    }

    return trajectoryId;
  }

  async storeCompleteTrajectory(title?: string, description?: string): Promise<string> {
    if (!this.config.enabled || !this.currentSessionId) {
      throw new Error('No active session');
    }

    const trajectoryId = await this.createTrajectory(title, description);

    const completeData: CompleteTrajectoryData = {
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
      trajectory: {
        id: trajectoryId,
        sessionId: this.currentSessionId,
        model: this.messageBuffer.find(m => m.role === 'assistant')?.model,
        agent: this.messageBuffer.find(m => m.role === 'assistant')?.agent,
        title: title || this.messageBuffer[0]?.content?.substring(0, 100),
        description,
        status: 'active',
        totalSteps: this.stepCounter,
        totalToolCalls: this.toolCallCounter,
        totalDurationMs: this.startTime ? Date.now() - this.startTime.getTime() : undefined,
        timeCreated: this.startTime?.getTime() || Date.now(),
      },
    };

    await trajectoryStorage.storeCompleteTrajectory(completeData);

    return trajectoryId;
  }

  async searchKnowledge(query: string, options?: { category?: string; limit?: number }): Promise<any[]> {
    if (!this.config.enabled) return [];
    return knowledgeBase.searchKnowledge(query, options);
  }

  async getRelevantMemories(scope: string): Promise<any[]> {
    if (!this.config.enabled) return [];
    return memoryManager.getMemoriesByScope(scope);
  }

  getConfig(): TrajectoryCaptureConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<TrajectoryCaptureConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  getStats(): {
    sessionId: string | null;
    trajectoryId: string | null;
    messageCount: number;
    stepCount: number;
    toolCallCount: number;
    fileOperationCount: number;
    snapshotCount: number;
    patchCount: number;
    startTime: Date | null;
  } {
    return {
      sessionId: this.currentSessionId,
      trajectoryId: this.currentTrajectoryId,
      messageCount: this.messageBuffer.length,
      stepCount: this.stepCounter,
      toolCallCount: this.toolCallCounter,
      fileOperationCount: this.fileOpBuffer.length,
      snapshotCount: this.snapshotBuffer.length,
      patchCount: this.patchBuffer.length,
      startTime: this.startTime,
    };
  }

  disable(): void {
    this.config.enabled = false;
  }

  async enable(): Promise<void> {
    this.config.enabled = true;
    await this.initialize();
  }

  // Alias methods for integration compatibility
  async startToolCall(messageId: string, toolCall: {
    toolName: string;
    input: Record<string, any>;
    toolCallId?: string;
  }): Promise<string> {
    // Use the provided toolCallId or generate a new one
    const actualToolCallId = toolCall.toolCallId || uuidv4();
    await this.captureToolCallStart(messageId, actualToolCallId, uuidv4(), toolCall.toolName, toolCall.input);
    return actualToolCallId;
  }

  async completeToolCall(toolCallId: string, result: {
    output: string;
    status?: 'completed' | 'failed';
  }): Promise<void> {
    await this.captureToolCallComplete(toolCallId, result);
  }

  async captureMessage(message: {
    id: string;
    role: string;
    content: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    if (message.role === 'user') {
      await this.captureUserMessage(message.id, message.content, message.metadata);
    } else if (message.role === 'assistant') {
      await this.captureAssistantMessage(message.id, message.content, message.metadata);
    }
  }
}

export const trajectoryCapture = new TrajectoryCapture();
