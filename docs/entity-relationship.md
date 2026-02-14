# OpenCode Trajectory Storage - Entity Relationship Diagram

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           OpenCode Trajectory Storage                                │
│                              Database Schema ER Diagram                              │
└─────────────────────────────────────────────────────────────────────────────────────┘

                                    ┌─────────────┐
                                    │  sessions  │  (Root Table)
                                    │     id PK   │
                                    └──────┬──────┘
                                           │
          ┌────────────────────────────────┼────────────────────────────────┐
          │                                │                                │
          ▼                                ▼                                ▼
┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
│    messages     │          │   trajectories   │          │  subtasks       │
│      id PK      │◄──FK────│      id PK       │          │      id PK      │
│ session_id FK  │          │ session_id FK    │          │ session_id FK   │
│ parent_id FK   │          │ root_message_id  │          │ parent_msg_id FK│
│      ...       │          │      ...         │          │      ...        │
└────────┬────────┘          └────────┬────────┘          └─────────────────┘
         │                             │
         │              ┌──────────────┼──────────────┐
         │              │              │              │
         │              ▼              ▼              ▼
         │    ┌─────────────────┐ ┌─────────────┐ ┌─────────────┐
         │    │     steps      │ │   retries   │ │session_comp.│
         │    │      id PK     │ │    id PK    │ │    id PK    │
         │    │session_id FK   │ │session_id FK│ │session_id FK│
         │    │trajectory_id FK│ │message_id FK│ │     ...     │
         │    │ message_id FK │ │     ...     │ └─────────────┘
         │    │ tool_call_id FK│ └─────────────┘
         │    │      ...       │
         │    └────────┬───────┘
         │             │
         │    ┌────────┼────────┐
         │    │        │        │
         │    ▼        ▼        ▼
         │ ┌────────┐ ┌─────────┐ ┌────────────┐
         │ │snapshots│ │ patches │ │file_operations│
         │ │ id PK  │ │  id PK  │ │    id PK    │
         │ │session_│ │session_ │ │session_id FK │
         │ │  id FK │ │  id FK  │ │message_id FK │
         │ └────────┘ └─────────┘ │tool_call_id FK│
         │                        └───────────────┘
         │
         ▼
┌─────────────────────┐   ┌───────────────────┐   ┌─────────────────────┐
│  message_parts      │   │ reasoning_chains  │   │    tool_calls      │
│       id PK        │   │      id PK       │   │       id PK        │
│ session_id FK      │◄──│session_id FK     │◄──│session_id FK       │
│ message_id FK      │   │message_id FK     │   │message_id FK       │
│      ...           │   │      ...        │   │      ...           │
└─────────────────────┘   └───────────────────┘   └──────────┬──────────┘
                                                            │
                                              ┌─────────────┴─────────────┐
                                              │                         │
                                              ▼                         ▼
                                    ┌─────────────────┐     ┌─────────────────┐
                                    │tool_attachments │     │file_operations  │
                                    │      id PK      │     │      id PK      │
                                    │tool_call_id FK  │     │      ...        │
                                    │ message_id FK   │     │      ...        │
                                    └─────────────────┘     └─────────────────┘
```

## Detailed Entity Relationship

### Core Tables (会话核心)

| Table | PK | Foreign Keys | Description |
|-------|-----|--------------|-------------|
| **sessions** | id | parent_session_id | 根表，OpenCode 会话 |
| **messages** | id | session_id (FK), parent_id | 会话消息 |
| **trajectories** | id | session_id (FK) | 会话轨迹汇总 |

### Execution Tables (执行记录)

| Table | PK | Foreign Keys | Description |
|-------|-----|--------------|-------------|
| **steps** | id | session_id (FK), trajectory_id (FK), message_id (FK), tool_call_id (FK), snapshot_id, patch_id | 执行步骤 |
| **tool_calls** | id | session_id (FK), message_id (FK) | 工具调用 |
| **subtasks** | id | session_id (FK), parent_message_id (FK) | 子任务 |
| **retries** | id | session_id (FK), message_id (FK) | 重试记录 |
| **session_compactions** | id | session_id (FK) | 会话压缩记录 |

### Content Tables (内容记录)

| Table | PK | Foreign Keys | Description |
|-------|-----|--------------|-------------|
| **message_parts** | id | session_id (FK), message_id (FK) | 消息片段 |
| **reasoning_chains** | id | session_id (FK), message_id (FK) | 思维链 |
| **snapshots** | id | session_id (FK), message_id (FK), step_id | 文件快照 |
| **patches** | id | session_id (FK), message_id (FK), step_id | 代码补丁 |
| **file_operations** | id | session_id (FK), message_id (FK), tool_call_id (FK) | 文件操作 |
| **tool_attachments** | id | tool_call_id (FK), message_id (FK) | 工具附件 |

### AI & Knowledge Tables (AI 知识)

| Table | PK | Foreign Keys | Description |
|-------|-----|--------------|-------------|
| **vector_embeddings** | id | - | 向量存储 (pgvector) |
| **knowledge_base** | id | session_id (FK), trajectory_id (FK), embedding_id (FK) | 知识库 |
| **memories** | id | source_trajectory_id (FK) | 记忆存储 |

### Logging & Analytics Tables (日志分析)

| Table | PK | Foreign Keys | Description |
|-------|-----|--------------|-------------|
| **execution_logs** | id | session_id (FK), trajectory_id (FK), step_id (FK), tool_call_id (FK) | 执行日志 |
| **api_call_logs** | id | trajectory_id (FK), message_id (FK) | API 调用日志 |
| **cost_statistics** | id | session_id (FK), trajectory_id (FK) | 成本统计 |
| **permission_requests** | id | session_id (FK), trajectory_id (FK) | 权限请求 |
| **user_feedback** | id | session_id (FK), trajectory_id (FK), message_id (FK), step_id (FK) | 用户反馈 |
| **project_context** | id | source_session_id, source_trajectory_id | 项目上下文 |

## Relationship Summary

```
sessions (1) ──────< (N) messages
sessions (1) ──────< (N) trajectories
sessions (1) ──────< (N) steps
sessions (1) ──────< (N) tool_calls
sessions (1) ──────< (N) subtasks
sessions (1) ──────< (N) retries
sessions (1) ──────< (N) snapshots
sessions (1) ──────< (N) patches
sessions (1) ──────< (N) file_operations
sessions (1) ──────< (N) session_compactions

messages (1) ──────< (N) message_parts
messages (1) ──────< (N) reasoning_chains
messages (1) ──────< (N) tool_calls
messages (1) ──────< (N) retries

trajectories (1) ─< (N) steps
trajectories (1) ─< (N) knowledge_base
trajectories (1) ─< (N) memories

tool_calls (1) ────< (N) tool_attachments
tool_calls (1) ────< (N) file_operations
tool_calls (1) ────< (N) execution_logs

steps (1) ────────< (N) snapshots
steps (1) ────────< (N) patches
steps (1) ────────< (N) execution_logs
```

## Query Examples

### 1. Get complete session data with all related entities
```sql
SELECT 
    s.*,
    json_build_object(
        'messages', COALESCE(messages.data, '[]'),
        'tool_calls', COALESCE(tool_calls.data, '[]'),
        'steps', COALESCE(steps.data, '[]'),
        'trajectories', COALESCE(trajectories.data, '[]')
    ) as related_data
FROM sessions s
LEFT JOIN LATERAL (
    SELECT json_agg(m) as data FROM messages m WHERE m.session_id = s.id
) messages ON true
LEFT JOIN LATERAL (
    SELECT json_agg(tc) as data FROM tool_calls tc WHERE tc.session_id = s.id
) tool_calls ON true
LEFT JOIN LATERAL (
    SELECT json_agg(st) as data FROM steps st WHERE st.session_id = s.id
) steps ON true
LEFT JOIN LATERAL (
    SELECT json_agg(tr) as data FROM trajectories tr WHERE tr.session_id = s.id
) trajectories ON true
WHERE s.id = 'session-uuid';
```

### 2. Get tool call execution flow
```sql
SELECT 
    tc.*,
    m.content as message_content,
    m.role as message_role,
    json_agg(ta) FILTER (WHERE ta IS NOT NULL) as attachments
FROM tool_calls tc
LEFT JOIN messages m ON m.id = tc.message_id
LEFT JOIN tool_attachments ta ON ta.tool_call_id = tc.id
WHERE tc.session_id = 'session-uuid'
GROUP BY tc.id, m.content, m.role
ORDER BY tc.time_created;
```

### 3. Get step execution with related tool calls and patches
```sql
SELECT 
    st.*,
    tc.tool_name,
    tc.output as tool_output,
    p.file_path,
    p.file_diff
FROM steps st
LEFT JOIN tool_calls tc ON tc.id = st.tool_call_id
LEFT JOIN patches p ON p.step_id = st.id
WHERE st.session_id = 'session-uuid'
ORDER BY st.step_order;
```

## Index Recommendations

| Table | Index | Purpose |
|-------|-------|---------|
| messages | idx_messages_session_id | Query messages by session |
| messages | idx_messages_time_created | Sort by time |
| tool_calls | idx_tool_calls_session_id | Query by session |
| tool_calls | idx_tool_calls_tool_name | Analyze tool usage |
| steps | idx_steps_session_id | Query steps by session |
| steps | idx_steps_step_type | Filter by step type |
| vector_embeddings | idx_vector_embeddings_hnsw | Vector similarity search |
| knowledge_base | idx_knowledge_base_category | Filter by category |
| memories | idx_memories_scope | Query by scope |
