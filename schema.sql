-- ============================================
-- OpenCode Trajectory Storage Schema
-- PostgreSQL + pgvector
-- ============================================
-- Version: 2.0
-- Description: Complete trajectory storage with all fields
-- ============================================

-- ============================================
-- 0. 检查并创建数据库
-- ============================================
-- 注意：需要先连接到 postgres 或 template1 数据库执行
-- 连接示例：psql -h localhost -U postgres -f schema.sql

-- 创建 opencode 数据库（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'opencode') THEN
        CREATE DATABASE opencode;
    END IF;
END $$;

-- 切换到 opencode 数据库
\c opencode

-- ============================================
-- 启用 pgvector 扩展
-- ============================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- 清理旧表（如果存在）
-- ============================================
DROP TABLE IF EXISTS execution_logs CASCADE;
DROP TABLE IF EXISTS api_call_logs CASCADE;
DROP TABLE IF EXISTS cost_statistics CASCADE;
DROP TABLE IF EXISTS user_feedback CASCADE;
DROP TABLE IF EXISTS permission_requests CASCADE;
DROP TABLE IF EXISTS project_context CASCADE;
DROP TABLE IF EXISTS memories CASCADE;
DROP TABLE IF EXISTS knowledge_base CASCADE;
DROP TABLE IF EXISTS vector_embeddings CASCADE;
DROP TABLE IF EXISTS retries CASCADE;
DROP TABLE IF EXISTS session_compactions CASCADE;
DROP TABLE IF EXISTS subtasks CASCADE;
DROP TABLE IF EXISTS tool_attachments CASCADE;
DROP TABLE IF EXISTS file_operations CASCADE;
DROP TABLE IF EXISTS snapshots CASCADE;
DROP TABLE IF EXISTS patches CASCADE;
DROP TABLE IF EXISTS reasoning_chains CASCADE;
DROP TABLE IF EXISTS message_parts CASCADE;
DROP TABLE IF EXISTS steps CASCADE;
DROP TABLE IF EXISTS tool_calls CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS trajectories CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;

-- ============================================
-- 1. 会话表
-- ============================================
CREATE TABLE sessions (
    id VARCHAR(255) PRIMARY KEY,
    project_id VARCHAR(255),
    user_id VARCHAR(255),
    parent_session_id VARCHAR(255),
    directory TEXT NOT NULL,
    title VARCHAR(500),
    version VARCHAR(50),
    permission JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    archived_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_sessions_project_id ON sessions(project_id);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_parent_id ON sessions(parent_session_id);
CREATE INDEX idx_sessions_created_at ON sessions(created_at DESC);
CREATE INDEX idx_sessions_directory ON sessions(directory);

-- ============================================
-- 2. 消息表
-- ============================================
CREATE TABLE messages (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    parent_id VARCHAR(255),
    role VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    model VARCHAR(255),
    provider_id VARCHAR(255),
    agent VARCHAR(255),
    variant VARCHAR(100),
    system_prompt TEXT,
    finish_reason VARCHAR(100),
    error JSONB,
    cost DECIMAL(10, 6) DEFAULT 0,
    tokens_input INTEGER DEFAULT 0,
    tokens_output INTEGER DEFAULT 0,
    tokens_reasoning INTEGER DEFAULT 0,
    tokens_cache_read INTEGER DEFAULT 0,
    tokens_cache_write INTEGER DEFAULT 0,
    path_cwd VARCHAR(500),
    path_root VARCHAR(500),
    summary_title VARCHAR(500),
    summary_body TEXT,
    time_created BIGINT NOT NULL,
    time_completed BIGINT,
    step_order INTEGER,
    is_summary BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_parent_id ON messages(parent_id);
CREATE INDEX idx_messages_role ON messages(role);
CREATE INDEX idx_messages_model ON messages(model);
CREATE INDEX idx_messages_agent ON messages(agent);
CREATE INDEX idx_messages_provider_id ON messages(provider_id);
CREATE INDEX idx_messages_time_created ON messages(time_created DESC);
CREATE INDEX idx_messages_finish_reason ON messages(finish_reason);

-- ============================================
-- 3. 消息部分表
-- ============================================
CREATE TABLE message_parts (
    id VARCHAR(255) PRIMARY KEY,
    message_id VARCHAR(255) REFERENCES messages(id) ON DELETE CASCADE,
    part_type VARCHAR(50) NOT NULL,
    content TEXT,
    part_order INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_message_parts_message_id ON message_parts(message_id);
CREATE INDEX idx_message_parts_type ON message_parts(part_type);

-- ============================================
-- 4. 思维链表
-- ============================================
CREATE TABLE reasoning_chains (
    id VARCHAR(255) PRIMARY KEY,
    message_id VARCHAR(255) REFERENCES messages(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    model VARCHAR(255),
    time_start BIGINT NOT NULL,
    time_end BIGINT,
    provider_metadata JSONB DEFAULT '{}',
    part_order INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_reasoning_message_id ON reasoning_chains(message_id);
CREATE INDEX idx_reasoning_model ON reasoning_chains(model);
CREATE INDEX idx_reasoning_time_start ON reasoning_chains(time_start DESC);
CREATE INDEX idx_reasoning_part_order ON reasoning_chains(part_order);

-- ============================================
-- 5. 工具调用表
-- ============================================
CREATE TABLE tool_calls (
    id VARCHAR(255) PRIMARY KEY,
    message_id VARCHAR(255) REFERENCES messages(id) ON DELETE CASCADE,
    call_id VARCHAR(255) NOT NULL,
    tool_name VARCHAR(255) NOT NULL,
    input JSONB NOT NULL,
    output TEXT,
    raw_output TEXT,
    truncated BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) DEFAULT 'pending',
    error_message TEXT,
    title VARCHAR(500),
    output_path VARCHAR(500),
    time_created BIGINT NOT NULL,
    time_start BIGINT NOT NULL,
    time_end BIGINT,
    duration_ms INTEGER,
    part_order INTEGER DEFAULT 0,
    attachments JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tool_calls_message_id ON tool_calls(message_id);
CREATE INDEX idx_tool_calls_call_id ON tool_calls(call_id);
CREATE INDEX idx_tool_calls_tool_name ON tool_calls(tool_name);
CREATE INDEX idx_tool_calls_status ON tool_calls(status);
CREATE INDEX idx_tool_calls_time_created ON tool_calls(time_created DESC);
CREATE INDEX idx_tool_calls_duration_ms ON tool_calls(duration_ms DESC);
CREATE INDEX idx_tool_calls_part_order ON tool_calls(part_order);

-- ============================================
-- 6. 工具附件表
-- ============================================
CREATE TABLE tool_attachments (
    id VARCHAR(255) PRIMARY KEY,
    tool_call_id VARCHAR(255) REFERENCES tool_calls(id) ON DELETE CASCADE,
    message_id VARCHAR(255) REFERENCES messages(id) ON DELETE CASCADE,
    filename VARCHAR(500),
    mime VARCHAR(255),
    url TEXT,
    source_type VARCHAR(50),
    source_path TEXT,
    source_range JSONB,
    file_size BIGINT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tool_attachments_tool_call_id ON tool_attachments(tool_call_id);
CREATE INDEX idx_tool_attachments_message_id ON tool_attachments(message_id);
CREATE INDEX idx_tool_attachments_filename ON tool_attachments(filename);

-- ============================================
-- 7. 文件操作表
-- ============================================
CREATE TABLE file_operations (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    message_id VARCHAR(255) REFERENCES messages(id) ON DELETE CASCADE,
    tool_call_id VARCHAR(255) REFERENCES tool_calls(id) ON DELETE SET NULL,
    operation_type VARCHAR(50) NOT NULL,
    file_path TEXT NOT NULL,
    file_content TEXT,
    file_mime VARCHAR(255),
    file_size BIGINT,
    file_offset INTEGER,
    file_limit INTEGER,
    diff_content TEXT,
    diff_hash VARCHAR(255),
    diff_stats JSONB DEFAULT '{}',
    operation_order INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_file_operations_session_id ON file_operations(session_id);
CREATE INDEX idx_file_operations_message_id ON file_operations(message_id);
CREATE INDEX idx_file_operations_tool_call_id ON file_operations(tool_call_id);
CREATE INDEX idx_file_operations_operation_type ON file_operations(operation_type);
CREATE INDEX idx_file_operations_file_path ON file_operations(file_path);
CREATE INDEX idx_file_operations_operation_order ON file_operations(operation_order);

-- ============================================
-- 8. 快照表
-- ============================================
CREATE TABLE snapshots (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    message_id VARCHAR(255) REFERENCES messages(id) ON DELETE CASCADE,
    step_id VARCHAR(255),
    snapshot_hash VARCHAR(255) NOT NULL,
    working_directory VARCHAR(500),
    file_count INTEGER DEFAULT 0,
    file_list JSONB DEFAULT '[]',
    time_created BIGINT NOT NULL,
    snapshot_order INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_snapshots_session_id ON snapshots(session_id);
CREATE INDEX idx_snapshots_message_id ON snapshots(message_id);
CREATE INDEX idx_snapshots_hash ON snapshots(snapshot_hash);
CREATE INDEX idx_snapshots_time_created ON snapshots(time_created DESC);
CREATE INDEX idx_snapshots_order ON snapshots(snapshot_order);

-- ============================================
-- 9. 补丁表
-- ============================================
CREATE TABLE patches (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    message_id VARCHAR(255) REFERENCES messages(id) ON DELETE CASCADE,
    step_id VARCHAR(255),
    patch_hash VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_diff TEXT,
    additions INTEGER DEFAULT 0,
    deletions INTEGER DEFAULT 0,
    diff_stats JSONB DEFAULT '{}',
    original_content TEXT,
    patched_content TEXT,
    time_created BIGINT NOT NULL,
    patch_order INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_patches_session_id ON patches(session_id);
CREATE INDEX idx_patches_message_id ON patches(message_id);
CREATE INDEX idx_patches_hash ON patches(patch_hash);
CREATE INDEX idx_patches_file_path ON patches(file_path);
CREATE INDEX idx_patches_time_created ON patches(time_created DESC);
CREATE INDEX idx_patches_order ON patches(patch_order);

-- ============================================
-- 10. 步骤表
-- ============================================
CREATE TABLE steps (
    id VARCHAR(255) PRIMARY KEY,
    trajectory_id VARCHAR(255),
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    message_id VARCHAR(255) REFERENCES messages(id) ON DELETE CASCADE,
    step_type VARCHAR(100) NOT NULL,
    step_order INTEGER NOT NULL,
    content TEXT,
    input_data JSONB,
    output_data JSONB,
    snapshot_id VARCHAR(255),
    patch_id VARCHAR(255),
    tool_call_id VARCHAR(255),
    reason VARCHAR(100),
    status VARCHAR(50) DEFAULT 'active',
    tokens_input INTEGER DEFAULT 0,
    tokens_output INTEGER DEFAULT 0,
    tokens_reasoning INTEGER DEFAULT 0,
    cost DECIMAL(10, 6) DEFAULT 0,
    time_start BIGINT NOT NULL,
    time_end BIGINT,
    duration_ms INTEGER,
    step_group VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_steps_trajectory_id ON steps(trajectory_id);
CREATE INDEX idx_steps_session_id ON steps(session_id);
CREATE INDEX idx_steps_message_id ON steps(message_id);
CREATE INDEX idx_steps_step_type ON steps(step_type);
CREATE INDEX idx_steps_order ON steps(step_order);
CREATE INDEX idx_steps_time_start ON steps(time_start DESC);
CREATE INDEX idx_steps_status ON steps(status);
CREATE INDEX idx_steps_tool_call_id ON steps(tool_call_id);
CREATE INDEX idx_steps_group ON steps(step_group);

-- ============================================
-- 11. 子任务表
-- ============================================
CREATE TABLE subtasks (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    parent_message_id VARCHAR(255) REFERENCES messages(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    description TEXT,
    agent VARCHAR(255) NOT NULL,
    command VARCHAR(500),
    model_provider_id VARCHAR(255),
    model_id VARCHAR(255),
    result TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    error_message TEXT,
    time_created BIGINT NOT NULL,
    time_start BIGINT,
    time_end BIGINT,
    duration_ms INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_subtasks_session_id ON subtasks(session_id);
CREATE INDEX idx_subtasks_parent_message_id ON subtasks(parent_message_id);
CREATE INDEX idx_subtasks_agent ON subtasks(agent);
CREATE INDEX idx_subtasks_status ON subtasks(status);
CREATE INDEX idx_subtasks_time_created ON subtasks(time_created DESC);

-- ============================================
-- 12. 压缩会话表
-- ============================================
CREATE TABLE session_compactions (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    original_messages_count INTEGER,
    compressed_messages_count INTEGER,
    compressed_content TEXT,
    compression_ratio DECIMAL(5, 2),
    auto BOOLEAN DEFAULT FALSE,
    time_created BIGINT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_session_compactions_session_id ON session_compactions(session_id);
CREATE INDEX idx_session_compactions_time_created ON session_compactions(time_created DESC);
CREATE INDEX idx_session_compactions_auto ON session_compactions(auto);

-- ============================================
-- 13. 重试记录表
-- ============================================
CREATE TABLE retries (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    message_id VARCHAR(255) REFERENCES messages(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    error_name VARCHAR(100),
    error_message TEXT,
    error_details JSONB,
    error_stack TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    time_created BIGINT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_retries_session_id ON retries(session_id);
CREATE INDEX idx_retries_message_id ON retries(message_id);
CREATE INDEX idx_retries_attempt ON retries(attempt_number);
CREATE INDEX idx_retries_time_created ON retries(time_created DESC);
CREATE INDEX idx_retries_error_name ON retries(error_name);

-- ============================================
-- 14. 轨迹表
-- ============================================
CREATE TABLE trajectories (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    root_message_id VARCHAR(255),
    model VARCHAR(255),
    provider_id VARCHAR(255),
    agent VARCHAR(255),
    title VARCHAR(500),
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',
    total_steps INTEGER DEFAULT 0,
    total_tool_calls INTEGER DEFAULT 0,
    total_subtasks INTEGER DEFAULT 0,
    total_compactions INTEGER DEFAULT 0,
    total_duration_ms INTEGER,
    total_cost DECIMAL(10, 6) DEFAULT 0,
    total_tokens_input BIGINT DEFAULT 0,
    total_tokens_output BIGINT DEFAULT 0,
    total_tokens_reasoning BIGINT DEFAULT 0,
    total_tokens_cache_read BIGINT DEFAULT 0,
    total_tokens_cache_write BIGINT DEFAULT 0,
    total_file_reads INTEGER DEFAULT 0,
    total_file_writes INTEGER DEFAULT 0,
    total_patches INTEGER DEFAULT 0,
    total_snapshots INTEGER DEFAULT 0,
    time_created BIGINT NOT NULL,
    time_completed BIGINT,
    duration_ms INTEGER,
    quality_score DECIMAL(5, 2),
    efficiency_score DECIMAL(5, 2),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_trajectories_session_id ON trajectories(session_id);
CREATE INDEX idx_trajectories_model ON trajectories(model);
CREATE INDEX idx_trajectories_agent ON trajectories(agent);
CREATE INDEX idx_trajectories_provider_id ON trajectories(provider_id);
CREATE INDEX idx_trajectories_status ON trajectories(status);
CREATE INDEX idx_trajectories_time_created ON trajectories(time_created DESC);
CREATE INDEX idx_trajectories_duration_ms ON trajectories(duration_ms DESC);
CREATE INDEX idx_trajectories_cost ON trajectories(total_cost DESC);
CREATE INDEX idx_trajectories_tokens ON trajectories(total_tokens_input DESC);

-- ============================================
-- 15. 向量存储表
-- ============================================
CREATE TABLE vector_embeddings (
    id VARCHAR(255) PRIMARY KEY,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    content TEXT,
    content_hash VARCHAR(255),
    embedding VECTOR(1536),
    model VARCHAR(255) DEFAULT 'text-embedding-3-small',
    dimension INTEGER DEFAULT 1536,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_vector_embeddings_entity ON vector_embeddings(entity_type, entity_id);
-- 注意：HNSW 索引需要 pgvector 0.7.0+
CREATE INDEX idx_vector_embeddings_hnsw ON vector_embeddings USING hnsw (embedding vector_cosine_ops);

-- ============================================
-- 16. 知识库表
-- ============================================
CREATE TABLE knowledge_base (
    id VARCHAR(255) PRIMARY KEY,
    trajectory_id VARCHAR(255) REFERENCES trajectories(id) ON DELETE SET NULL,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE SET NULL,
    source_type VARCHAR(50) NOT NULL,
    source_id VARCHAR(255),
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(100),
    keywords TEXT[],
    confidence_score FLOAT DEFAULT 0.0,
    usage_count INTEGER DEFAULT 0,
    helpful_count INTEGER DEFAULT 0,
    unhelpful_count INTEGER DEFAULT 0,
    embedding_id VARCHAR(255) REFERENCES vector_embeddings(id),
    time_created BIGINT NOT NULL,
    last_used_at BIGINT,
    expires_at BIGINT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_knowledge_base_trajectory_id ON knowledge_base(trajectory_id);
CREATE INDEX idx_knowledge_base_session_id ON knowledge_base(session_id);
CREATE INDEX idx_knowledge_base_category ON knowledge_base(category);
CREATE INDEX idx_knowledge_base_keywords ON knowledge_base USING GIN(keywords);
CREATE INDEX idx_knowledge_base_usage_count ON knowledge_base(usage_count DESC);
CREATE INDEX idx_knowledge_base_time_created ON knowledge_base(time_created DESC);
CREATE INDEX idx_knowledge_base_confidence ON knowledge_base(confidence_score DESC);

-- ============================================
-- 17. 记忆表
-- ============================================
CREATE TABLE memories (
    id VARCHAR(255) PRIMARY KEY,
    type VARCHAR(100) NOT NULL,
    scope VARCHAR(255),
    mem_key VARCHAR(255) NOT NULL,
    value JSONB NOT NULL,
    confidence FLOAT DEFAULT 1.0,
    importance_score INTEGER DEFAULT 0,
    usage_count INTEGER DEFAULT 0,
    source_trajectory_id VARCHAR(255) REFERENCES trajectories(id) ON DELETE SET NULL,
    source_type VARCHAR(50),
    time_created BIGINT NOT NULL,
    last_accessed_at BIGINT,
    expires_at BIGINT,
    last_updated_at BIGINT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 添加唯一约束（与代码 ON CONFLICT (type, scope, mem_key) 对应）
ALTER TABLE memories ADD CONSTRAINT uk_memories_type_scope_mem_key UNIQUE (type, scope, mem_key);

CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_scope ON memories(scope);
CREATE INDEX idx_memories_key ON memories(mem_key);
CREATE INDEX idx_memories_confidence ON memories(confidence DESC);
CREATE INDEX idx_memories_usage_count ON memories(usage_count DESC);
CREATE INDEX idx_memories_time_created ON memories(time_created DESC);

-- ============================================
-- 18. 执行日志表
-- ============================================
CREATE TABLE execution_logs (
    id SERIAL PRIMARY KEY,
    trajectory_id VARCHAR(255) REFERENCES trajectories(id) ON DELETE CASCADE,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    step_id VARCHAR(255) REFERENCES steps(id) ON DELETE SET NULL,
    tool_call_id VARCHAR(255) REFERENCES tool_calls(id) ON DELETE SET NULL,
    log_level VARCHAR(20) NOT NULL,
    source VARCHAR(100),
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    time_created BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_execution_logs_trajectory_id ON execution_logs(trajectory_id);
CREATE INDEX idx_execution_logs_session_id ON execution_logs(session_id);
CREATE INDEX idx_execution_logs_step_id ON execution_logs(step_id);
CREATE INDEX idx_execution_logs_tool_call_id ON execution_logs(tool_call_id);
CREATE INDEX idx_execution_logs_level ON execution_logs(log_level);
CREATE INDEX idx_execution_logs_time_created ON execution_logs(time_created DESC);
CREATE INDEX idx_execution_logs_source ON execution_logs(source);

-- ============================================
-- 19. 权限请求表
-- ============================================
CREATE TABLE permission_requests (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    trajectory_id VARCHAR(255) REFERENCES trajectories(id) ON DELETE SET NULL,
    permission_type VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    pattern VARCHAR(500),
    tool_name VARCHAR(255),
    input_data JSONB,
    status VARCHAR(50) DEFAULT 'pending',
    user_response VARCHAR(50),
    response_message TEXT,
    time_created BIGINT NOT NULL,
    responded_at BIGINT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_permission_requests_session_id ON permission_requests(session_id);
CREATE INDEX idx_permission_requests_trajectory_id ON permission_requests(trajectory_id);
CREATE INDEX idx_permission_requests_status ON permission_requests(status);
CREATE INDEX idx_permission_requests_permission_type ON permission_requests(permission_type);
CREATE INDEX idx_permission_requests_time_created ON permission_requests(time_created DESC);

-- ============================================
-- 20. 用户交互表
-- ============================================
CREATE TABLE user_feedback (
    id VARCHAR(255) PRIMARY KEY,
    trajectory_id VARCHAR(255) REFERENCES trajectories(id) ON DELETE CASCADE,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    message_id VARCHAR(255) REFERENCES messages(id) ON DELETE SET NULL,
    step_id VARCHAR(255) REFERENCES steps(id) ON DELETE SET NULL,
    feedback_type VARCHAR(50) NOT NULL,
    content TEXT,
    original_ai_content TEXT,
    corrected_content TEXT,
    rating INTEGER,
    time_created BIGINT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_user_feedback_trajectory_id ON user_feedback(trajectory_id);
CREATE INDEX idx_user_feedback_session_id ON user_feedback(session_id);
CREATE INDEX idx_user_feedback_type ON user_feedback(feedback_type);
CREATE INDEX idx_user_feedback_time_created ON user_feedback(time_created DESC);
CREATE INDEX idx_user_feedback_rating ON user_feedback(rating DESC);

-- ============================================
-- 21. 成本统计表
-- ============================================
CREATE TABLE cost_statistics (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    trajectory_id VARCHAR(255) REFERENCES trajectories(id) ON DELETE SET NULL,
    provider_id VARCHAR(255),
    model_id VARCHAR(255),
    cost_input DECIMAL(10, 6) DEFAULT 0,
    cost_output DECIMAL(10, 6) DEFAULT 0,
    cost_cache_read DECIMAL(10, 6) DEFAULT 0,
    cost_cache_write DECIMAL(10, 6) DEFAULT 0,
    cost_reasoning DECIMAL(10, 6) DEFAULT 0,
    total_cost DECIMAL(10, 6) DEFAULT 0,
    tokens_input BIGINT DEFAULT 0,
    tokens_output BIGINT DEFAULT 0,
    tokens_reasoning BIGINT DEFAULT 0,
    tokens_cache_read BIGINT DEFAULT 0,
    tokens_cache_write BIGINT DEFAULT 0,
    api_calls INTEGER DEFAULT 0,
    period_start BIGINT NOT NULL,
    period_end BIGINT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cost_statistics_session_id ON cost_statistics(session_id);
CREATE INDEX idx_cost_statistics_trajectory_id ON cost_statistics(trajectory_id);
CREATE INDEX idx_cost_statistics_provider ON cost_statistics(provider_id, model_id);
CREATE INDEX idx_cost_statistics_period ON cost_statistics(period_start DESC);
CREATE INDEX idx_cost_statistics_total_cost ON cost_statistics(total_cost DESC);

-- ============================================
-- 22. API 调用日志表
-- ============================================
CREATE TABLE api_call_logs (
    id SERIAL PRIMARY KEY,
    trajectory_id VARCHAR(255) REFERENCES trajectories(id) ON DELETE SET NULL,
    message_id VARCHAR(255) REFERENCES messages(id) ON DELETE SET NULL,
    provider_id VARCHAR(255) NOT NULL,
    model_id VARCHAR(255),
    endpoint VARCHAR(500),
    request_body JSONB,
    response_body JSONB,
    status_code INTEGER,
    latency_ms INTEGER,
    cost DECIMAL(10, 6) DEFAULT 0,
    tokens_input BIGINT DEFAULT 0,
    tokens_output BIGINT DEFAULT 0,
    error_message TEXT,
    error_code VARCHAR(100),
    time_created BIGINT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_api_call_logs_trajectory_id ON api_call_logs(trajectory_id);
CREATE INDEX idx_api_call_logs_message_id ON api_call_logs(message_id);
CREATE INDEX idx_api_call_logs_provider ON api_call_logs(provider_id, model_id);
CREATE INDEX idx_api_call_logs_time_created ON api_call_logs(time_created DESC);
CREATE INDEX idx_api_call_logs_latency_ms ON api_call_logs(latency_ms DESC);
CREATE INDEX idx_api_call_logs_status ON api_call_logs(status_code);

-- ============================================
-- 23. 项目上下文表
-- ============================================
CREATE TABLE project_context (
    id VARCHAR(255) PRIMARY KEY,
    project_id VARCHAR(255) NOT NULL,
    context_type VARCHAR(100) NOT NULL,
    context_key VARCHAR(255) NOT NULL,
    value JSONB NOT NULL,
    source_file_path TEXT,
    source_session_id VARCHAR(255),
    source_trajectory_id VARCHAR(255),
    confidence_score FLOAT DEFAULT 1.0,
    importance_score INTEGER DEFAULT 0,
    time_created BIGINT NOT NULL,
    updated_at BIGINT,
    expires_at BIGINT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at_ts TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_project_context_project_id ON project_context(project_id);
CREATE INDEX idx_project_context_type ON project_context(context_type);
CREATE INDEX idx_project_context_key ON project_context(context_key);
CREATE INDEX idx_project_context_time_created ON project_context(time_created DESC);
CREATE INDEX idx_project_context_confidence ON project_context(confidence_score DESC);

-- ============================================
-- 实用视图
-- ============================================
CREATE OR REPLACE VIEW complete_session_summary AS
SELECT
    s.id AS session_id,
    s.title,
    s.directory,
    s.user_id,
    s.created_at,
    s.updated_at,
    COUNT(DISTINCT m.id) AS total_messages,
    COUNT(DISTINCT m.id) FILTER (WHERE m.role = 'user') AS user_messages,
    COUNT(DISTINCT m.id) FILTER (WHERE m.role = 'assistant') AS assistant_messages,
    SUM(m.tokens_input) AS total_tokens_input,
    SUM(m.tokens_output) AS total_tokens_output,
    SUM(m.tokens_reasoning) AS total_tokens_reasoning,
    SUM(m.tokens_input + m.tokens_output + m.tokens_reasoning) AS total_tokens,
    SUM(m.cost) AS total_cost,
    COUNT(DISTINCT tc.id) AS total_tool_calls,
    COUNT(DISTINCT tc.id) FILTER (WHERE tc.status = 'completed') AS successful_tool_calls,
    COUNT(DISTINCT tc.id) FILTER (WHERE tc.status = 'failed') AS failed_tool_calls,
    COUNT(DISTINCT t.id) AS total_trajectories,
    COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'completed') AS completed_trajectories,
    COALESCE(SUM(tc.duration_ms), 0) AS total_duration_ms,
    AVG(tc.duration_ms) FILTER (WHERE tc.status = 'completed') AS avg_tool_duration_ms
FROM sessions s
LEFT JOIN messages m ON m.session_id = s.id
LEFT JOIN tool_calls tc ON tc.message_id = m.id
LEFT JOIN trajectories t ON t.session_id = s.id
GROUP BY s.id, s.title, s.directory, s.user_id, s.created_at, s.updated_at;

CREATE OR REPLACE VIEW complete_trajectory_summary AS
SELECT
    t.id AS trajectory_id,
    t.session_id,
    t.title,
    t.description,
    t.model,
    t.agent,
    t.provider_id,
    t.status,
    TO_TIMESTAMP(t.time_created / 1000)::TIMESTAMP AS time_created,
    TO_TIMESTAMP(t.time_completed / 1000)::TIMESTAMP AS time_completed,
    t.duration_ms,
    t.total_tokens_input,
    t.total_tokens_output,
    t.total_tokens_reasoning,
    t.total_tokens_input + t.total_tokens_output + t.total_tokens_reasoning AS total_tokens,
    t.total_cost,
    t.total_steps,
    t.total_tool_calls,
    t.total_subtasks,
    t.total_compactions,
    t.total_file_reads,
    t.total_file_writes,
    t.total_patches,
    t.total_snapshots,
    t.quality_score,
    t.efficiency_score,
    (SELECT COUNT(*) FROM knowledge_base kb WHERE kb.trajectory_id = t.id) AS knowledge_entries,
    (SELECT COUNT(*) FROM steps s WHERE s.trajectory_id = t.id AND s.step_type = 'error') AS error_steps
FROM trajectories t
ORDER BY t.time_created DESC;

CREATE OR REPLACE VIEW complete_tool_call_detail AS
SELECT
    tc.id AS tool_call_id,
    tc.message_id,
    tc.call_id,
    tc.tool_name,
    tc.input,
    tc.output,
    tc.raw_output,
    tc.truncated,
    tc.status,
    tc.error_message,
    tc.title,
    tc.output_path,
    TO_TIMESTAMP(tc.time_created / 1000)::TIMESTAMP AS time_created,
    TO_TIMESTAMP(tc.time_start / 1000)::TIMESTAMP AS time_start,
    TO_TIMESTAMP(tc.time_end / 1000)::TIMESTAMP AS time_end,
    tc.duration_ms,
    tc.part_order,
    tc.attachments,
    m.role AS message_role,
    m.model AS message_model,
    m.agent AS message_agent,
    m.session_id
FROM tool_calls tc
LEFT JOIN messages m ON tc.message_id = m.id
ORDER BY tc.time_created ASC;

CREATE OR REPLACE VIEW complete_reasoning_detail AS
SELECT
    rc.id AS reasoning_id,
    rc.message_id,
    rc.content,
    rc.model,
    TO_TIMESTAMP(rc.time_start / 1000)::TIMESTAMP AS time_start,
    TO_TIMESTAMP(rc.time_end / 1000)::TIMESTAMP AS time_end,
    rc.time_end - rc.time_start AS duration_ms,
    rc.part_order,
    m.role AS message_role,
    m.model AS message_model,
    m.agent AS message_agent,
    m.session_id
FROM reasoning_chains rc
LEFT JOIN messages m ON rc.message_id = m.id
ORDER BY rc.time_start ASC;

-- ============================================
-- 完成提示
-- ============================================
SELECT 'Schema created successfully!' AS status;
SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = 'public';
