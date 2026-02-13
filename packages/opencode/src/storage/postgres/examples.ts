import {
  initializeOpenCodeIntegration,
  opencodeIntegration,
  shutdownOpenCodeIntegration,
} from '../storage/postgres';
import { Log } from "../../util/log";

const logger = Log.create({ service: "trajectory-examples" })

async function exampleUsage() {
  await initializeOpenCodeIntegration({
    host: 'localhost',
    port: 5432,
    database: 'opencode',
    user: 'opencode',
    password: 'your_password',
  });

  await opencodeIntegration.startSession({
    sessionId: 'session-123',
    projectId: 'project-456',
    directory: '/path/to/project',
    title: '开发新功能',
    metadata: {
      userId: 'user-789',
      environment: 'development',
    },
  });

  await opencodeIntegration.captureUserMessage(
    'msg-1',
    '请帮我创建一个新的用户认证模块',
    { timestamp: new Date().toISOString() }
  );

  const toolCallId = await opencodeIntegration.captureToolCallStart(
    'msg-1',
    {
      toolName: 'BashTool',
      input: { command: 'npm init -y' },
    }
  );

  await opencodeIntegration.captureToolCallComplete(toolCallId, {
    output: 'Package initialized successfully',
    status: 'completed',
  });

  await opencodeIntegration.captureAssistantMessage(
    'msg-2',
    '我已经创建了项目结构，现在开始实现认证模块',
    { stepType: 'text' }
  );

  const trajectoryId = await opencodeIntegration.completeTrajectory(
    '用户认证模块开发',
    '完成用户认证模块的初始实现'
  );

  logger.info("trajectory stored", { trajectoryId });

  const knowledge = await opencodeIntegration.searchKnowledge('认证模块', {
    category: 'solution',
    limit: 5,
  });

  logger.info("relevant knowledge found", { count: knowledge.length });

  await shutdownOpenCodeIntegration();
}

async function advancedExample() {
  await initializeOpenCodeIntegration();

  const sessionHistory = await opencodeIntegration.getSessionHistory('session-123');
  logger.info("session history", { sessionId: 'session-123' });

  const similarContent = await opencodeIntegration.getSimilarContent('如何实现用户登录', {
    limit: 10,
    entityType: 'message',
  });
  logger.info("similar content found", { count: similarContent.length });

  const popularKnowledge = await opencodeIntegration.getPopularKnowledge(20);
  logger.info("popular knowledge", { count: popularKnowledge.length });

  const memories = await opencodeIntegration.getRelevantMemories('session-123');
  logger.info("relevant memories", { count: memories.length });
}

export { exampleUsage, advancedExample };
