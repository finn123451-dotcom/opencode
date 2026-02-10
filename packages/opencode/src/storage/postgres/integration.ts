import { trajectoryCapture, TrajectoryCaptureConfig } from './capture';
import { configureTrajectoryStorage, getTrajectoryStorageConfig, initializeStorage } from './config';
import { trajectoryStorage } from './trajectory';
import { knowledgeBase, memoryManager } from './knowledge';

export interface OpenCodeIntegrationConfig {
  autoCapture: boolean;
  captureSessionStart: boolean;
  captureMessages: boolean;
  captureToolCalls: boolean;
  captureReasoning: boolean;
  captureErrors: boolean;
  generateKnowledgeOnComplete: boolean;
  storeMemories: boolean;
}

export class OpenCodeIntegration {
  private config: OpenCodeIntegrationConfig;
  private initialized: boolean = false;

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
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await initializeStorage();
    await trajectoryCapture.initialize();
    
    this.initialized = true;
    console.log('OpenCode integration initialized');
  }

  async startSession(sessionInfo: {
    sessionId: string;
    projectId?: string;
    directory?: string;
    title?: string;
    metadata?: Record<string, any>;
  }): Promise<string> {
    await this.ensureInitialized();
    return await trajectoryCapture.startSession(sessionInfo);
  }

  async endSession(status: 'completed' | 'failed' | 'cancelled' = 'completed'): Promise<string | null> {
    await this.ensureInitialized();
    return await trajectoryCapture.endSession(status);
  }

  async captureUserMessage(messageId: string, content: string, metadata?: Record<string, any>): Promise<void> {
    await this.ensureInitialized();
    await trajectoryCapture.captureMessage({
      id: messageId,
      role: 'user',
      content,
      metadata,
    });
  }

  async captureAssistantMessage(messageId: string, content: string, metadata?: Record<string, any>): Promise<void> {
    await this.ensureInitialized();
    await trajectoryCapture.captureMessage({
      id: messageId,
      role: 'assistant',
      content,
      metadata,
    });
  }

  async captureReasoning(messageId: string, reasoning: {
    content: string;
    model?: string;
  }): Promise<void> {
    await this.ensureInitialized();
    if (this.config.captureReasoning) {
      await trajectoryCapture.captureReasoning(messageId, reasoning);
    }
  }

  async captureToolCallStart(messageId: string, toolCall: {
    toolName: string;
    input: Record<string, any>;
  }): Promise<string> {
    await this.ensureInitialized();
    if (this.config.captureToolCalls) {
      return await trajectoryCapture.startToolCall(messageId, toolCall);
    }
    return '';
  }

  async captureToolCallComplete(toolCallId: string, result: {
    output: string;
    status?: 'completed' | 'failed';
  }): Promise<void> {
    await this.ensureInitialized();
    if (this.config.captureToolCalls && toolCallId) {
      await trajectoryCapture.completeToolCall(toolCallId, result);
    }
  }

  async captureError(messageId: string, error: {
    message: string;
    stack?: string;
  }): Promise<void> {
    await this.ensureInitialized();
    if (this.config.captureErrors) {
      await trajectoryCapture.captureError(messageId, error);
    }
  }

  async completeTrajectory(title?: string, description?: string): Promise<string> {
    await this.ensureInitialized();
    const trajectoryId = await trajectoryCapture.storeCompleteTrajectory(title, description);
    
    if (this.config.generateKnowledgeOnComplete) {
      const trajectory = await trajectoryStorage.getTrajectoryWithDetails(trajectoryId);
      if (trajectory) {
        await knowledgeBase.generateKnowledgeFromTrajectory(trajectory);
        if (this.config.storeMemories) {
          await memoryManager.extractAndStoreMemories(trajectory);
        }
      }
    }
    
    return trajectoryId;
  }

  async searchKnowledge(query: string, options?: {
    category?: string;
    limit?: number;
  }): Promise<any[]> {
    await this.ensureInitialized();
    return await knowledgeBase.searchKnowledge(query, options);
  }

  async getRelevantMemories(scope: string): Promise<any[]> {
    await this.ensureInitialized();
    return await memoryManager.getMemoriesByScope(scope);
  }

  async getSessionHistory(sessionId: string): Promise<{
    messages: any[];
    toolCalls: any[];
    steps: any[];
  }> {
    await this.ensureInitialized();
    
    const [messages, toolCalls, steps] = await Promise.all([
      trajectoryStorage.getMessagesBySession(sessionId),
      trajectoryStorage.getToolCallsBySession(sessionId),
      trajectoryStorage.getStepsBySession(sessionId),
    ]);
    
    return { messages, toolCalls, steps };
  }

  async getSimilarContent(query: string, options?: {
    limit?: number;
    entityType?: string;
  }): Promise<any[]> {
    await this.ensureInitialized();
    return await trajectoryStorage.searchSimilarContent(query, options);
  }

  async getPopularKnowledge(limit?: number): Promise<any[]> {
    await this.ensureInitialized();
    return await knowledgeBase.getPopularKnowledge(limit);
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  getStats(): ReturnType<typeof trajectoryCapture.getStats> {
    return trajectoryCapture.getStats();
  }

  updateCaptureConfig(config: Partial<TrajectoryCaptureConfig>): void {
    trajectoryCapture.updateConfig(config);
  }

  isEnabled(): boolean {
    return trajectoryCapture.isEnabled();
  }
}

export const opencodeIntegration = new OpenCodeIntegration();

export async function initializeOpenCodeIntegration(
  pgConfig?: {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
  }
): Promise<void> {
  if (pgConfig) {
    configureTrajectoryStorage({
      postgres: {
        host: pgConfig.host || 'localhost',
        port: pgConfig.port || 5432,
        database: pgConfig.database || 'opencode',
        user: pgConfig.user || 'opencode',
        password: pgConfig.password || '',
      },
    });
  }
  
  await opencodeIntegration.initialize();
}

export async function shutdownOpenCodeIntegration(): Promise<void> {
  await opencodeIntegration.endSession('completed');
}
