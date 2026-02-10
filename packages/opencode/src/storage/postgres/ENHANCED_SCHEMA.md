# Enhanced Trajectory Schema - 完整字段说明

## 概述

增强版 schema 记录了 OpenCode 所有核心交互数据，包括完整的轨迹、执行步骤、工具调用、思维链、文件操作、代码快照、补丁等。

## 表结构及字段说明

### 1. sessions - 会话表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 会话唯一标识 |
| project_id | VARCHAR(255) | 项目ID |
| user_id | VARCHAR(255) | 用户ID |
| parent_session_id | VARCHAR(255) | 父会话ID（分支会话） |
| directory | TEXT | 工作目录 |
| title | VARCHAR(500) | 会话标题 |
| version | VARCHAR(50) | OpenCode 版本 |
| permission | JSONB | 权限配置 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |
| archived_at | TIMESTAMP | 归档时间 |
| metadata | JSONB | 额外元数据 |

### 2. messages - 消息表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 消息唯一标识 |
| session_id | VARCHAR(255) | 所属会话 |
| parent_id | VARCHAR(255) | 父消息ID |
| role | VARCHAR(50) | 角色: user/assistant/system |
| content | TEXT | 消息内容 |
| model | VARCHAR(255) | 使用的模型 |
| provider_id | VARCHAR(255) | 模型提供商 |
| agent | VARCHAR(255) | 使用的代理 |
| variant | VARCHAR(100) | 模型变体 |
| system_prompt | TEXT | 系统提示词 |
| finish_reason | VARCHAR(100) | 结束原因 |
| cost | DECIMAL | 成本 |
| tokens_input | INTEGER | 输入 token 数 |
| tokens_output | INTEGER | 输出 token 数 |
| tokens_reasoning | INTEGER | 推理 token 数 |
| tokens_cache_read | INTEGER | 缓存读取 token |
| tokens_cache_write | INTEGER | 缓存写入 token |
| error | JSONB | 错误信息 |
| time_created | TIMESTAMP | 创建时间 |
| time_completed | TIMESTAMP | 完成时间 |
| step_order | INTEGER | 步骤顺序 |
| metadata | JSONB | 额外元数据 |

### 3. message_parts - 消息部分表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 部分唯一标识 |
| message_id | VARCHAR(255) | 所属消息 |
| part_type | VARCHAR(50) | 部分类型 |
| content | TEXT | 内容 |
| part_order | INTEGER | 顺序 |
| created_at | TIMESTAMP | 创建时间 |
| metadata | JSONB | 额外元数据 |

### 4. text_parts - 文本部分表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 唯一标识 |
| part_id | VARCHAR(255) | 消息部分ID |
| text_content | TEXT | 文本内容 |
| synthetic | BOOLEAN | 是否合成 |
| ignored | BOOLEAN | 是否忽略 |
| time_start | BIGINT | 开始时间戳 |
| time_end | BIGINT | 结束时间戳 |
| truncated | BOOLEAN | 是否截断 |

### 5. reasoning_chains - 思维链表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 唯一标识 |
| message_id | VARCHAR(255) | 所属消息 |
| content | TEXT | 推理内容 |
| model | VARCHAR(255) | 推理模型 |
| provider_metadata | JSONB | 提供商元数据 |
| time_start | BIGINT | 开始时间戳 |
| time_end | BIGINT | 结束时间戳 |
| created_at | TIMESTAMP | 创建时间 |
| metadata | JSONB | 额外元数据 |

### 6. tool_calls - 工具调用表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 唯一标识 |
| message_id | VARCHAR(255) | 所属消息 |
| call_id | VARCHAR(255) | 调用ID |
| tool_name | VARCHAR(255) | 工具名称 |
| input | JSONB | 输入参数 |
| output | TEXT | 输出结果 |
| status | VARCHAR(50) | 状态 |
| title | VARCHAR(500) | 标题 |
| truncated | BOOLEAN | 是否截断 |
| output_path | TEXT | 输出路径 |
| duration_ms | INTEGER | 持续时间 |
| time_created | TIMESTAMP | 创建时间 |
| time_start | TIMESTAMP | 开始时间 |
| time_end | TIMESTAMP | 结束时间 |
| error_message | TEXT | 错误信息 |

### 7. tool_attachments - 工具附件表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 唯一标识 |
| tool_call_id | VARCHAR(255) | 所属工具调用 |
| filename | VARCHAR(500) | 文件名 |
| mime | VARCHAR(255) | MIME类型 |
| url | TEXT | URL |
| source_type | VARCHAR(50) | 源类型 |
| source_path | TEXT | 源路径 |
| source_range | JSONB | 源范围 |

### 8. file_operations - 文件操作表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 唯一标识 |
| session_id | VARCHAR(255) | 所属会话 |
| message_id | VARCHAR(255) | 所属消息 |
| tool_call_id | VARCHAR(255) | 工具调用ID |
| operation_type | VARCHAR(50) | 操作类型 |
| file_path | TEXT | 文件路径 |
| file_content | TEXT | 文件内容 |
| file_mime | VARCHAR(255) | MIME类型 |
| offset | INTEGER | 偏移量 |
| limit | INTEGER | 限制 |
| diff_content | TEXT | 差异内容 |
| diff_hash | VARCHAR(255) | 差异哈希 |

### 9. snapshots - 快照表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 唯一标识 |
| session_id | VARCHAR(255) | 所属会话 |
| message_id | VARCHAR(255) | 所属消息 |
| step_id | VARCHAR(255) | 步骤ID |
| snapshot_hash | VARCHAR(255) | 快照哈希 |
| working_directory | TEXT | 工作目录 |

### 10. patches - 补丁表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 唯一标识 |
| session_id | VARCHAR(255) | 所属会话 |
| message_id | VARCHAR(255) | 所属消息 |
| step_id | VARCHAR(255) | 步骤ID |
| patch_hash | VARCHAR(255) | 补丁哈希 |
| file_path | TEXT | 文件路径 |
| file_diff | TEXT | 文件差异 |
| diff_stats | JSONB | 差异统计 |

### 11. steps - 步骤表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 唯一标识 |
| trajectory_id | VARCHAR(255) | 轨迹ID |
| session_id | VARCHAR(255) | 会话ID |
| message_id | VARCHAR(255) | 消息ID |
| step_type | VARCHAR(100) | 步骤类型 |
| step_order | INTEGER | 顺序 |
| content | TEXT | 内容 |
| input_data | JSONB | 输入数据 |
| output_data | JSONB | 输出数据 |
| snapshot_id | VARCHAR(255) | 快照ID |
| patch_id | VARCHAR(255) | 补丁ID |
| reason | VARCHAR(100) | 结束原因 |
| tokens_input | INTEGER | 输入token |
| tokens_output | INTEGER | 输出token |
| tokens_reasoning | INTEGER | 推理token |
| cost | DECIMAL | 成本 |
| duration_ms | INTEGER | 持续时间 |

### 12. subtasks - 子任务表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 唯一标识 |
| session_id | VARCHAR(255) | 所属会话 |
| parent_message_id | VARCHAR(255) | 父消息ID |
| prompt | TEXT | 提示词 |
| description | VARCHAR(500) | 描述 |
| agent | VARCHAR(255) | 代理 |
| model_provider_id | VARCHAR(255) | 模型提供商 |
| model_id | VARCHAR(255) | 模型 |
| command | VARCHAR(500) | 命令 |
| result | TEXT | 结果 |
| status | VARCHAR(50) | 状态 |

### 13. session_compactions - 会话压缩表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 唯一标识 |
| session_id | VARCHAR(255) | 所属会话 |
| original_messages_count | INTEGER | 原始消息数 |
| compressed_content | TEXT | 压缩内容 |
| auto | BOOLEAN | 是否自动 |

### 14. retries - 重试记录表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 唯一标识 |
| session_id | VARCHAR(255) | 所属会话 |
| message_id | VARCHAR(255) | 消息ID |
| attempt_number | INTEGER | 重试次数 |
| error_message | TEXT | 错误信息 |
| error_details | JSONB | 错误详情 |

### 15. trajectories - 轨迹表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(255) | 唯一标识 |
| session_id | VARCHAR(255) | 所属会话 |
| root_message_id | VARCHAR(255) | 根消息ID |
| model | VARCHAR(255) | 模型 |
| agent | VARCHAR(255) | 代理 |
| title | VARCHAR(500) | 标题 |
| description | TEXT | 描述 |
| status | VARCHAR(50) | 状态 |
| total_steps | INTEGER | 总步骤数 |
| total_tool_calls | INTEGER | 总工具调用数 |
| total_duration_ms | INTEGER | 总持续时间 |
| total_cost | DECIMAL | 总成本 |
| total_tokens_input | BIGINT | 总输入token |
| total_tokens_output | BIGINT | 总输出token |

## 捕获的事件类型

### 核心事件
- `session_start` - 会话开始
- `session_end` - 会话结束
- `user_message` - 用户消息
- `assistant_message` - AI响应消息

### 推理事件
- `reasoning_start` - 推理开始
- `reasoning_delta` - 推理增量
- `reasoning_end` - 推理结束

### 工具调用事件
- `tool_call_start` - 工具调用开始
- `tool_call_complete` - 工具调用完成
- `tool_call_error` - 工具调用错误
- `file_operation` - 文件操作

### 执行流程事件
- `step` - 执行步骤
- `snapshot` - 代码快照
- `patch` - 代码补丁
- `subtask` - 子任务
- `compaction` - 会话压缩
- `retry` - 重试记录
- `error` - 错误

## 视图

### session_summaries - 会话摘要视图
提供会话的聚合统计信息，包括消息数、工具调用数、总成本等。

### tool_usage_stats - 工具使用统计视图
按工具名称聚合使用统计，包括调用次数、成功/失败次数、平均持续时间等。

### daily_cost_stats - 每日成本统计视图
按日期和模型聚合成本和 token 使用统计。

## 使用示例

```typescript
import { enhancedTrajectoryCapture } from './storage/postgres';

// 初始化
await enhancedTrajectoryCapture.initialize();

// 开始会话
await enhancedTrajectoryCapture.startSession({
  sessionId: 'session-123',
  projectId: 'project-456',
  directory: '/path/to/project',
  title: '开发新功能',
});

// 捕获用户消息
await enhancedTrajectoryCapture.captureUserMessage(
  'msg-1',
  '请帮我创建一个新的用户认证模块',
  {
    model: 'claude-sonnet-4',
    providerId: 'anthropic',
    agent: 'build',
  }
);

// 捕获工具调用
const toolCallId = await enhancedTrajectoryCapture.captureToolCallStart(
  'msg-1',
  'tool-call-1',
  'call-123',
  'BashTool',
  { command: 'npm init -y' }
);

await enhancedTrajectoryCapture.captureToolCallComplete(toolCallId, {
  output: 'Package initialized successfully',
  status: 'completed',
});

// 捕获文件操作
await enhancedTrajectoryCapture.captureFileOperation({
  operationType: 'read',
  filePath: '/src/auth.ts',
  fileContent: '...',
});

// 捕获代码快照
await enhancedTrajectoryCapture.captureSnapshot(
  'abc123hash',
  '/path/to/project'
);

// 捕获代码补丁
await enhancedTrajectoryCapture.capturePatch(
  'def456hash',
  '/src/auth.ts',
  '...diff content...',
  { additions: 50, deletions: 10 }
);

// 结束并存储完整轨迹
const trajectoryId = await enhancedTrajectoryCapture.storeCompleteTrajectory(
  '用户认证模块开发',
  '完成用户认证模块的初始实现'
);
```
