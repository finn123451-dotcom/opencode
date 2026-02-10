# OpenCode Trajectory Storage & Knowledge Base

基于 PostgreSQL + pgvector 的 OpenCode 二次开发模块，实现完整的轨迹存储、知识库和记忆系统。

## 功能特性

- **完整轨迹捕获**: 记录用户输入、思维链、工具链、执行步骤、响应等所有数据
- **向量存储**: 使用 pgvector 实现语义搜索和相似度查询
- **知识库生成**: 自动从会话中提取模式、解决方案、最佳实践
- **记忆系统**: 持久化用户偏好、项目上下文、会话历史
- **高可用性**: 支持事务、重试、连接池

## 安装

### 1. 安装依赖

```bash
npm install pg better-sqlite3 openai uuid zod
```

### 2. 创建数据库

```bash
# 执行 schema.sql 创建数据库表
psql -U postgres -d opencode -f schema.sql
```

### 3. 配置环境变量

```bash
export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=opencode
export PGUSER=opencode
export PGPASSWORD=your_password
export OPENAI_API_KEY=your_api_key
```

## 快速开始

### 基础使用

```typescript
import {
  initializeOpenCodeIntegration,
  opencodeIntegration,
  shutdownOpenCodeIntegration,
} from './storage/postgres';

async function main() {
  // 初始化
  await initializeOpenCodeIntegration({
    host: 'localhost',
    port: 5432,
    database: 'opencode',
    user: 'opencode',
    password: 'your_password',
  });

  // 开始会话
  await opencodeIntegration.startSession({
    sessionId: 'session-123',
    projectId: 'project-456',
    directory: '/path/to/project',
    title: '开发新功能',
  });

  // 捕获用户消息
  await opencodeIntegration.captureUserMessage(
    'msg-1',
    '请帮我创建一个新的用户认证模块'
  );

  // 捕获工具调用
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

  // 完成轨迹
  const trajectoryId = await opencodeIntegration.completeTrajectory(
    '用户认证模块开发',
    '完成用户认证模块的初始实现'
  );

  // 搜索知识
  const knowledge = await opencodeIntegration.searchKnowledge('认证模块');
  console.log(knowledge);

  // 关闭
  await shutdownOpenCodeIntegration();
}

main();
```

### 高级功能

```typescript
// 获取会话历史
const sessionHistory = await opencodeIntegration.getSessionHistory('session-123');

// 搜索相似内容
const similarContent = await opencodeIntegration.getSimilarContent(
  '如何实现用户登录',
  { limit: 10 }
);

// 获取热门知识
const popularKnowledge = await opencodeIntegration.getPopularKnowledge(20);

// 获取相关记忆
const memories = await opencodeIntegration.getRelevantMemories('session-123');
```

## 数据库架构

### 核心表

- **sessions**: 会话信息
- **messages**: 消息记录（用户输入、AI响应）
- **reasoning_chains**: 思维链/推理过程
- **tool_calls**: 工具调用记录
- **steps**: 详细执行步骤
- **trajectories**: 完整执行轨迹
- **vector_embeddings**: 向量嵌入（pgvector）
- **knowledge_base**: 知识库
- **memories**: 记忆存储
- **execution_logs**: 执行日志
- **user_feedback**: 用户反馈

## 配置选项

### PostgreSQL 配置

```typescript
interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
}
```

### 存储配置

```typescript
interface TrajectoryStorageConfig {
  enabled: boolean;
  postgres: PostgresConfig;
  storeEmbeddings: boolean;
  generateKnowledge: boolean;
  captureRate: number;
  batchSize: number;
  flushInterval: number;
}
```

## API 参考

### TrajectoryCapture

- `startSession(data)`: 开始新会话
- `endSession(status)`: 结束会话
- `captureMessage(message)`: 捕获消息
- `captureReasoning(messageId, reasoning)`: 捕获推理过程
- `startToolCall(messageId, toolCall)`: 开始工具调用
- `completeToolCall(toolCallId, result)`: 完成工具调用
- `captureStep(messageId, step)`: 捕获执行步骤
- `captureError(messageId, error)`: 捕获错误
- `storeCompleteTrajectory(title, description)`: 存储完整轨迹

### KnowledgeBase

- `createKnowledge(data)`: 创建知识条目
- `searchKnowledge(query, options)`: 搜索知识
- `getKnowledge(knowledgeId)`: 获取知识
- `generateKnowledgeFromTrajectory(trajectory)`: 从轨迹生成知识
- `getPopularKnowledge(limit)`: 获取热门知识

### MemoryManager

- `createMemory(data)`: 创建记忆
- `getMemory(type, scope, key)`: 获取记忆
- `getMemoriesByScope(scope)`: 获取范围内的记忆
- `extractAndStoreMemories(trajectory)`: 从轨迹提取记忆

## 与 OpenCode 集成

### 方式 1: 独立运行

```typescript
import { opencodeIntegration } from './storage/postgres';

await opencodeIntegration.initialize();
```

### 方式 2: 集成到现有流程

在 `src/session/processor.ts` 中添加钩子：

```typescript
import { opencodeIntegration } from '../storage/postgres';

class SessionProcessor {
  async processMessage(message: Message) {
    await opencodeIntegration.captureUserMessage(
      message.id,
      message.content
    );

    // 原有处理逻辑...
    
    await opencodeIntegration.captureAssistantMessage(
      response.id,
      response.content
    );
  }
}
```

## 性能优化

### 批量操作

```typescript
// 批量存储嵌入
await batchStoreEmbeddings([
  { entityType: 'message', entityId: 'id1', content: '内容1', embedding: [...] },
  { entityType: 'message', entityId: 'id2', content: '内容2', embedding: [...] },
]);
```

### 异步处理

```typescript
// 不阻塞主流程
opencodeIntegration.startSession(data).catch(console.error);
```

## 监控

```typescript
import { healthCheck } from './storage/postgres';

const status = await healthCheck();
console.log(status);
// { storage: true, database: true, embeddings: true }
```

## 目录结构

```
packages/opencode/src/storage/postgres/
├── schema.sql           # 数据库 schema
├── connection.ts        # PostgreSQL 连接管理
├── embedding.ts         # 向量嵌入操作
├── trajectory.ts        # 轨迹存储
├── knowledge.ts         # 知识库和记忆
├── capture.ts           # 轨迹捕获钩子
├── config.ts           # 配置管理
├── integration.ts      # OpenCode 集成
├── examples.ts         # 使用示例
└── index.ts            # 导出入口
```

## 许可证

MIT
