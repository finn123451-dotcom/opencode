import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { MessageV2 } from "./message-v2";
import { opencodeIntegration, isStorageEnabled } from "../storage/postgres";
import { Config } from "@/config/config";
import { Log } from "../util/log";

const logger = Log.create({ service: "trajectory-tracker" })

export interface TrajectoryEventMap {
  'session:start': { sessionId: string; messageId: string };
  'session:end': { sessionId: string; trajectoryId?: string };
  'message:user': { messageId: string; content: string };
  'message:assistant': { messageId: string; content: string };
  'reasoning:start': { messageId: string; reasoningId: string };
  'reasoning:delta': { messageId: string; reasoningId: string; text: string };
  'reasoning:end': { messageId: string; reasoningId: string; content: string };
  'tool:start': { messageId: string; toolCallId: string; toolName: string; input: any };
  'tool:result': { messageId: string; toolCallId: string; toolName: string; output: string; status: string };
  'tool:error': { messageId: string; toolCallId: string; error: string };
  'text:start': { messageId: string; partId: string };
  'text:delta': { messageId: string; partId: string; text: string };
  'text:end': { messageId: string; partId: string; content: string };
  'step:start': { messageId: string; stepId: string };
  'step:end': { messageId: string; stepId: string; stepData: any };
  'error': { messageId: string; error: string; stack?: string };
}

export class SessionTrajectoryTracker extends EventEmitter {
  private sessionId: string | null = null;
  private currentMessageId: string | null = null;
  private activeToolCalls: Map<string, { toolName: string; startTime: number; input: any }> = new Map();
  private activeReasoning: Map<string, { text: string; startTime: number }> = new Map();
  private trajectoryId: string | null = null;
  private enabled: boolean = false;
  private config: {
    captureMessages: boolean;
    captureReasoning: boolean;
    captureTools: boolean;
    captureSteps: boolean;
    captureErrors: boolean;
    generateKnowledge: boolean;
  } = {
    captureMessages: true,
    captureReasoning: true,
    captureTools: true,
    captureSteps: true,
    captureErrors: true,
    generateKnowledge: true,
  };

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    try {
      const cfg = await Config.get();
      const configEnabled = cfg.experimental?.trajectoryStorage ?? false;
      const envEnabled = isStorageEnabled();
      
      if (cfg.experimental?.trajectoryStorage !== undefined) {
        this.enabled = configEnabled;
      } else {
        this.enabled = envEnabled;
      }
      
      if (this.enabled) {
        await opencodeIntegration.initialize();
        logger.info("storage enabled and initialized");
      } else {
        logger.info("storage is disabled");
      }
    } catch (error) {
      logger.error("failed to initialize trajectory tracker", { error });
    }
  }

  async startSession(sessionId: string, initialMessageId: string, sessionInfo?: {
    projectId?: string;
    directory?: string;
    title?: string;
  }): Promise<void> {
    if (!this.enabled) return;

    this.sessionId = sessionId;
    this.currentMessageId = initialMessageId;

    try {
      await opencodeIntegration.startSession({
        sessionId,
        projectId: sessionInfo?.projectId,
        directory: sessionInfo?.directory,
        title: sessionInfo?.title,
      });
    } catch (error) {
      logger.error("failed to start session in trajectory", { error });
    }
  }

  async endSession(status: 'completed' | 'failed' | 'cancelled' = 'completed'): Promise<string | null> {
    if (!this.enabled || !this.sessionId) return null;

    const sessionId = this.sessionId;
    this.sessionId = null;
    this.currentMessageId = null;
    this.activeToolCalls.clear();
    this.activeReasoning.clear();

    try {
      return await opencodeIntegration.endSession(status);
    } catch (error) {
      logger.error("failed to end session in trajectory", { error });
      return null;
    }
  }

  async captureUserMessage(messageId: string, content: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await opencodeIntegration.captureUserMessage(messageId, content);
    } catch (error) {
      logger.error("failed to capture user message", { error });
    }
  }

  async captureAssistantMessage(messageId: string, content: string, metadata?: {
    model?: string;
    providerId?: string;
    finishReason?: string;
    cost?: number;
    tokensInput?: number;
    tokensOutput?: number;
    tokensReasoning?: number;
  }): Promise<void> {
    if (!this.enabled) return;

    this.currentMessageId = messageId;

    try {
      await opencodeIntegration.captureAssistantMessage(messageId, content, metadata);
    } catch (error) {
      logger.error("failed to capture assistant message", { error });
    }
  }

  async handleReasoningStart(messageId: string, reasoningId: string, metadata?: any): Promise<void> {
    if (!this.enabled || !this.config.captureReasoning) return;

    this.activeReasoning.set(reasoningId, { text: '', startTime: Date.now() });

    try {
      await opencodeIntegration.captureReasoning(messageId, {
        reasoningId,
        content: '',
        model: metadata?.model,
        providerMetadata: metadata,
      });
    } catch (error) {
      logger.error("failed to capture reasoning start", { error });
    }
  }
  }

  async handleReasoningDelta(reasoningId: string, text: string): Promise<void> {
    if (!this.enabled) return;

    const reasoning = this.activeReasoning.get(reasoningId);
    if (reasoning) {
      reasoning.text += text;
    }
  }

  async handleReasoningEnd(messageId: string, reasoningId: string): Promise<void> {
    if (!this.enabled || !this.config.captureReasoning) return;

    const reasoning = this.activeReasoning.get(reasoningId);
    if (reasoning) {
      try {
        await opencodeIntegration.captureReasoning(messageId, {
          content: reasoning.text,
        });
      } catch (error) {
        logger.error("failed to capture reasoning end", { error });
      }
      this.activeReasoning.delete(reasoningId);
    }
  }

  async handleToolCallStart(messageId: string, toolCallId: string, toolName: string, input: any, callId?: string): Promise<void> {
    if (!this.enabled || !this.config.captureTools) return;

    this.activeToolCalls.set(toolCallId, { toolName, startTime: Date.now(), input });

    try {
      await opencodeIntegration.captureToolCallStart(messageId, {
        toolName,
        input,
        toolCallId,
        callId,
      });
    } catch (error) {
      logger.error("failed to capture tool call start", { error });
    }
  }

  async handleToolCallResult(
    messageId: string,
    toolCallId: string,
    output: string,
    status: 'completed' | 'failed' = 'completed'
  ): Promise<void> {
    if (!this.enabled || !this.config.captureTools) return;

    const toolCall = this.activeToolCalls.get(toolCallId);
    if (toolCall) {
      try {
        await opencodeIntegration.captureToolCallComplete(toolCallId, {
          output,
          status,
        });
      } catch (error) {
        logger.error("failed to capture tool call result", { error });
      }
      this.activeToolCalls.delete(toolCallId);
    }
  }

  async handleToolCallError(messageId: string, toolCallId: string, error: string): Promise<void> {
    if (!this.enabled || !this.config.captureTools) return;

    const toolCall = this.activeToolCalls.get(toolCallId);
    if (toolCall) {
      try {
        await opencodeIntegration.captureToolCallComplete(toolCallId, {
          output: error,
          status: 'failed',
        });
      } catch (err) {
        logger.error("failed to capture tool call error", { error: err });
      }
      this.activeToolCalls.delete(toolCallId);
    }
  }

  async handleTextStart(messageId: string, partId: string): Promise<void> {
    if (!this.enabled || !this.config.captureSteps) return;
  }

  async handleTextDelta(partId: string, text: string): Promise<void> {
    if (!this.enabled) return;
  }

  async handleTextEnd(messageId: string, partId: string, content: string): Promise<void> {
    if (!this.enabled || !this.config.captureSteps) return;
  }

  async handleStepStart(messageId: string, stepId: string, snapshot?: string): Promise<void> {
    if (!this.enabled || !this.config.captureSteps) return;
  }

  async captureStepStart(messageId: string, stepId?: string): Promise<string> {
    if (!this.enabled || !this.config.captureSteps) return '';

    try {
      return await opencodeIntegration.captureStep(messageId, {
        stepId,
        stepType: 'text_generation',
      });
    } catch (error) {
      logger.error("failed to capture step start", { error });
      return '';
    }
  }

  async handleStepEnd(messageId: string, stepId: string, stepData: {
    reason?: string;
    tokensInput?: number;
    tokensOutput?: number;
    tokensReasoning?: number;
    cost?: number;
    patch?: { hash: string; files: any[] };
  }): Promise<void> {
    if (!this.enabled || !this.config.captureSteps) return;

    try {
      if (this.currentMessageId) {
        await opencodeIntegration.captureStep(this.currentMessageId, {
          stepId,
          stepType: stepData.reason === 'patch' ? 'text' : 'text_generation',
          content: stepData.patch?.files ? JSON.stringify(stepData.patch.files) : undefined,
          outputData: stepData,
          reason: stepData.reason,
          tokensInput: stepData.tokensInput,
          tokensOutput: stepData.tokensOutput,
          tokensReasoning: stepData.tokensReasoning,
          cost: stepData.cost,
        });
      }
    } catch (error) {
      logger.error("failed to capture step end", { error });
    }
  }

  async handleError(messageId: string, error: string, stack?: string): Promise<void> {
    if (!this.enabled || !this.config.captureErrors) return;

    try {
      await opencodeIntegration.captureError(messageId, {
        message: error,
        stack,
      });
    } catch (err) {
      logger.error("failed to capture error", { error: err });
    }
  }

  async completeTrajectory(title?: string, description?: string): Promise<string | null> {
    if (!this.enabled) return null;

    try {
      return await opencodeIntegration.completeTrajectory(title, description);
    } catch (error) {
      logger.error("failed to complete trajectory", { error });
      return null;
    }
  }

  async searchKnowledge(query: string, options?: { category?: string; limit?: number }): Promise<any[]> {
    if (!this.enabled) return [];

    try {
      return await opencodeIntegration.searchKnowledge(query, options);
    } catch (error) {
      logger.error("failed to search knowledge", { error });
      return [];
    }
  }

  async getRelevantMemories(scope: string): Promise<any[]> {
    if (!this.enabled) return [];

    try {
      return await opencodeIntegration.getRelevantMemories(scope);
    } catch (error) {
      logger.error("failed to get memories", { error });
      return [];
    }
  }

  getActiveToolCalls(): Array<{ toolCallId: string; toolName: string; startTime: number; input: any }> {
    return Array.from(this.activeToolCalls.entries()).map(([id, data]) => ({
      toolCallId: id,
      ...data,
    }));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getCurrentMessageId(): string | null {
    return this.currentMessageId;
  }

  disable(): void {
    this.enabled = false;
  }

  async enable(): Promise<void> {
    await this.initialize();
  }
}

export const sessionTrajectoryTracker = new SessionTrajectoryTracker();
