import { EventEmitter } from 'events';
import { trajectoryStorage, CompleteTrajectoryData, SessionData, MessageData, StepData, ToolCallData, TrajectoryData } from './trajectory';
import { knowledgeBase, memoryManager } from './knowledge';
import { v4 as uuidv4 } from 'uuid';

export interface TrajectoryCaptureConfig {
  enabled: boolean;
  storeEmbeddings: boolean;
  generateKnowledge: boolean;
  captureRate: number;
}

export interface CaptureEvent {
  type: 'session_start' | 'session_end' | 'message' | 'reasoning' | 'tool_call' | 'tool_result' | 'step' | 'error';
  timestamp: Date;
  data: any;
}

export class TrajectoryCapture extends EventEmitter {
  private config: TrajectoryCaptureConfig;
  private currentSessionId: string | null = null;
  private currentTrajectoryId: string | null = null;
  private messageBuffer: MessageData[] = [];
  private stepBuffer: StepData[] = [];
  private toolCallBuffer: ToolCallData[] = [];
  private stepCounter: number = 0;
  private startTime: Date | null = null;

  constructor(config: Partial<TrajectoryCaptureConfig> = {}) {
    super();
    this.config = {
      enabled: config.enabled ?? true,
      storeEmbeddings: config.storeEmbeddings ?? true,
      generateKnowledge: config.generateKnowledge ?? true,
      captureRate: config.captureRate ?? 1.0,
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      console.log('Trajectory capture is disabled');
      return;
    }
    console.log('Trajectory capture initialized');
  }

  async startSession(sessionData: {
    id: string;
    projectId?: string;
    directory?: string;
    title?: string;
    metadata?: Record<string, any>;
  }): Promise<string> {
    this.currentSessionId = sessionData.id;
    this.startTime = new Date();

    const session: SessionData = {
      id: sessionData.id,
      projectId: sessionData.projectId,
      directory: sessionData.directory,
      title: sessionData.title,
      metadata: sessionData.metadata,
    };

    await trajectoryStorage.createSession(session);

    this.emit('session_start', {
      type: 'session_start',
      timestamp: new Date(),
      data: session,
    });

    return sessionData.id;
  }

  async endSession(status: 'completed' | 'failed' | 'cancelled' = 'completed'): Promise<string | null> {
    if (!this.currentSessionId || !this.currentTrajectoryId) {
      return null;
    }

    await trajectoryStorage.updateTrajectory(this.currentTrajectoryId, {
      status,
      totalSteps: this.stepCounter,
      totalDurationMs: this.startTime ? Date.now() - this.startTime.getTime() : undefined,
    });

    const trajectory = await trajectoryStorage.getTrajectoryWithDetails(this.currentTrajectoryId);
    if (trajectory && this.config.generateKnowledge) {
      try {
        await knowledgeBase.generateKnowledgeFromTrajectory(trajectory);
        await memoryManager.extractAndStoreMemories(trajectory);
      } catch (error) {
        console.error('Failed to generate knowledge from completed trajectory:', error);
      }
    }

    this.emit('session_end', {
      type: 'session_end',
      timestamp: new Date(),
      data: { sessionId: this.currentSessionId, trajectoryId: this.currentTrajectoryId, status },
    });

    const trajectoryId = this.currentTrajectoryId;
    this.resetSession();
    return trajectoryId;
  }

  private resetSession(): void {
    this.currentSessionId = null;
    this.currentTrajectoryId = null;
    this.messageBuffer = [];
    this.stepBuffer = [];
    this.toolCallBuffer = [];
    this.stepCounter = 0;
    this.startTime = null;
  }

  async captureMessage(message: {
    id?: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, any>;
  }): Promise<string> {
    if (!this.currentSessionId) {
      throw new Error('No active session');
    }

    const messageId = message.id || uuidv4();
    const messageData: MessageData = {
      id: messageId,
      sessionId: this.currentSessionId,
      role: message.role,
      content: message.content,
      stepOrder: this.messageBuffer.length,
      metadata: message.metadata,
    };

    await trajectoryStorage.createMessage(messageData);
    this.messageBuffer.push(messageData);

    this.emit('message', {
      type: 'message',
      timestamp: new Date(),
      data: messageData,
    });

    return messageId;
  }

  async captureReasoning(messageId: string, reasoning: {
    content: string;
    model?: string;
    metadata?: Record<string, any>;
  }): Promise<string> {
    if (!this.currentSessionId) {
      throw new Error('No active session');
    }

    const reasoningData = {
      id: uuidv4(),
      messageId,
      content: reasoning.content,
      model: reasoning.model,
      metadata: reasoning.metadata,
    };

    await trajectoryStorage.createReasoningChain(reasoningData);

    this.emit('reasoning', {
      type: 'reasoning',
      timestamp: new Date(),
      data: reasoningData,
    });

    return reasoningData.id;
  }

  async startToolCall(messageId: string, toolCall: {
    toolName: string;
    input: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<string> {
    if (!this.currentSessionId) {
      throw new Error('No active session');
    }

    const toolCallId = uuidv4();
    const toolCallData: ToolCallData = {
      id: toolCallId,
      messageId,
      toolName: toolCall.toolName,
      input: toolCall.input,
      status: 'running',
      startTime: new Date(),
      metadata: toolCall.metadata,
    };

    await trajectoryStorage.createToolCall(toolCallData);
    this.toolCallBuffer.push(toolCallData);

    await this.captureStep(messageId, {
      stepType: 'tool_call',
      content: `${toolCall.toolName}(${JSON.stringify(toolCall.input)})`,
      inputData: toolCall.input,
    });

    this.emit('tool_call', {
      type: 'tool_call',
      timestamp: new Date(),
      data: toolCallData,
    });

    return toolCallId;
  }

  async completeToolCall(
    toolCallId: string,
    result: {
      output: string;
      status?: 'completed' | 'failed';
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const toolCall = this.toolCallBuffer.find(tc => tc.id === toolCallId);
    if (!toolCall) {
      console.warn(`Tool call ${toolCallId} not found in buffer`);
      return;
    }

    toolCall.output = result.output;
    toolCall.status = result.status || 'completed';
    toolCall.endTime = new Date();
    if (toolCall.startTime) {
      toolCall.durationMs = toolCall.endTime.getTime() - toolCall.startTime.getTime();
    }
    if (result.metadata) {
      toolCall.metadata = { ...toolCall.metadata, ...result.metadata };
    }

    await trajectoryStorage.updateToolCall(toolCallId, {
      output: result.output,
      status: toolCall.status,
      durationMs: toolCall.durationMs,
      endTime: toolCall.endTime,
    });

    await this.captureStep(toolCall.messageId, {
      stepType: 'tool_result',
      content: result.output,
      outputData: { output: result.output, ...result.metadata },
    });

    this.emit('tool_result', {
      type: 'tool_result',
      timestamp: new Date(),
      data: { toolCallId, ...result },
    });
  }

  async captureStep(messageId: string, step: {
    stepType: 'reasoning' | 'tool_call' | 'tool_result' | 'text' | 'error';
    content?: string;
    inputData?: Record<string, any>;
    outputData?: Record<string, any>;
    durationMs?: number;
    metadata?: Record<string, any>;
  }): Promise<string> {
    if (!this.currentSessionId) {
      throw new Error('No active session');
    }

    const stepId = uuidv4();
    const stepData: StepData = {
      id: stepId,
      messageId,
      trajectoryId: this.currentTrajectoryId || undefined,
      stepType: step.stepType,
      stepOrder: ++this.stepCounter,
      content: step.content,
      inputData: step.inputData,
      outputData: step.outputData,
      durationMs: step.durationMs,
      metadata: step.metadata,
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

  async createTrajectory(title?: string, description?: string): Promise<string> {
    if (!this.currentSessionId || this.messageBuffer.length === 0) {
      throw new Error('No active session or no messages to create trajectory');
    }

    const trajectoryId = uuidv4();
    const trajectoryData: TrajectoryData = {
      id: trajectoryId,
      sessionId: this.currentSessionId,
      messageId: this.messageBuffer[this.messageBuffer.length - 1].id,
      title: title || this.messageBuffer[0]?.content?.substring(0, 100) || '未命名轨迹',
      description,
      status: 'active',
      totalSteps: this.stepCounter,
    };

    await trajectoryStorage.createTrajectory(trajectoryData);
    this.currentTrajectoryId = trajectoryId;

    for (const step of this.stepBuffer) {
      await trajectoryStorage.createStep({ ...step, trajectoryId });
    }

    return trajectoryId;
  }

  async storeCompleteTrajectory(title?: string, description?: string): Promise<string> {
    if (!this.currentSessionId) {
      throw new Error('No active session');
    }

    const trajectoryId = await this.createTrajectory(title, description);

    const completeData: CompleteTrajectoryData = {
      session: this.messageBuffer[0]?.metadata?.sessionData || {
        id: this.currentSessionId,
        title: this.messageBuffer[0]?.content?.substring(0, 100),
      },
      messages: [...this.messageBuffer],
      reasoningChains: [],
      toolCalls: [...this.toolCallBuffer],
      steps: [...this.stepBuffer],
      trajectory: {
        id: trajectoryId,
        sessionId: this.currentSessionId,
        messageId: this.messageBuffer[this.messageBuffer.length - 1]?.id,
        title: title || this.messageBuffer[0]?.content?.substring(0, 100),
        description,
        status: 'active',
        totalSteps: this.stepCounter,
      },
    };

    if (this.config.storeEmbeddings) {
      return await trajectoryStorage.storeTrajectoryWithEmbeddings(completeData);
    } else {
      return await trajectoryStorage.storeCompleteTrajectory(completeData);
    }
  }

  async captureError(messageId: string, error: {
    message: string;
    stack?: string;
    metadata?: Record<string, any>;
  }): Promise<string> {
    return await this.captureStep(messageId, {
      stepType: 'error',
      content: error.message,
      outputData: { error: error.message, stack: error.stack, ...error.metadata },
      metadata: error.metadata,
    });
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

  getCurrentTrajectoryId(): string | null {
    return this.currentTrajectoryId;
  }

  getStats(): {
    sessionId: string | null;
    trajectoryId: string | null;
    messageCount: number;
    stepCount: number;
    toolCallCount: number;
    startTime: Date | null;
  } {
    return {
      sessionId: this.currentSessionId,
      trajectoryId: this.currentTrajectoryId,
      messageCount: this.messageBuffer.length,
      stepCount: this.stepCounter,
      toolCallCount: this.toolCallBuffer.length,
      startTime: this.startTime,
    };
  }
}

export const trajectoryCapture = new TrajectoryCapture();
