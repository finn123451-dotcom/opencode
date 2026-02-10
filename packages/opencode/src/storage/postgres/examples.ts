import {
  initializeOpenCodeIntegration,
  opencodeIntegration,
  shutdownOpenCodeIntegration,
} from '../storage/postgres';

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

  console.log(`Trajectory stored: ${trajectoryId}`);

  const knowledge = await opencodeIntegration.searchKnowledge('认证模块', {
    category: 'solution',
    limit: 5,
  });

  console.log('Relevant knowledge:', knowledge);

  await shutdownOpenCodeIntegration();
}

async function advancedExample() {
  await initializeOpenCodeIntegration();

  const sessionHistory = await opencodeIntegration.getSessionHistory('session-123');
  console.log('Session history:', sessionHistory);

  const similarContent = await opencodeIntegration.getSimilarContent('如何实现用户登录', {
    limit: 10,
    entityType: 'message',
  });
  console.log('Similar content:', similarContent);

  const popularKnowledge = await opencodeIntegration.getPopularKnowledge(20);
  console.log('Popular knowledge:', popularKnowledge);

  const memories = await opencodeIntegration.getRelevantMemories('session-123');
  console.log('Relevant memories:', memories);
}

export { exampleUsage, advancedExample };
