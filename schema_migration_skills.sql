-- ============================================
-- Skills 演化系统 - Schema Migration
-- 增量变更，保留现有数据
-- 执行：psql -f schema_migration_skills.sql
-- ============================================

-- ============================================
-- 1. 现有表新增字段
-- 使用 ALTER TABLE ... ADD COLUMN IF NOT EXISTS 的变通写法
-- ============================================

-- sessions: goals, context
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS goals JSONB;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS context JSONB;

-- steps: subtask_id
ALTER TABLE steps ADD COLUMN IF NOT EXISTS subtask_id VARCHAR(255);

-- messages: subtask_id  
ALTER TABLE messages ADD COLUMN IF NOT EXISTS subtask_id VARCHAR(255);

-- tool_calls: subtask_id
ALTER TABLE tool_calls ADD COLUMN IF NOT EXISTS subtask_id VARCHAR(255);

-- ============================================
-- 2. 新建表（skill 发现系统）
-- ============================================

-- 2.1 能力聚类结果表
CREATE TABLE IF NOT EXISTS capability_clusters (
    id VARCHAR(255) PRIMARY KEY,
    cluster_id INTEGER NOT NULL,
    centroid VECTOR(1536),
    size INTEGER NOT NULL DEFAULT 0,
    pattern_summary TEXT,
    tool_names TEXT[],
    success_rate DECIMAL(5,4),
    avg_duration_ms BIGINT,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capability_clusters_cluster_id ON capability_clusters(cluster_id);
CREATE INDEX IF NOT EXISTS idx_capability_clusters_status ON capability_clusters(status);

-- 2.2 能力表
CREATE TABLE IF NOT EXISTS capabilities (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    trigger_patterns JSONB NOT NULL DEFAULT '[]',
    input_schema JSONB,
    output_schema JSONB,
    lessons_source JSONB,
    variations JSONB,
    quality_score DECIMAL(3,2) DEFAULT 0,
    success_rate DECIMAL(5,4) DEFAULT 0,
    avg_duration_ms BIGINT,
    sample_count INTEGER DEFAULT 0,
    md_content TEXT,
    review_status VARCHAR(50) DEFAULT 'pending',
    created_by VARCHAR(50) DEFAULT 'auto',
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capabilities_name ON capabilities(name);
CREATE INDEX IF NOT EXISTS idx_capabilities_status ON capabilities(review_status);

-- 2.3 技能表
CREATE TABLE IF NOT EXISTS skills (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    usage_scenarios JSONB NOT NULL DEFAULT '[]',
    md_content TEXT,
    trigger_config JSONB NOT NULL,
    chain_config JSONB NOT NULL,
    error_recovery JSONB,
    effectiveness JSONB DEFAULT '{"success_rate": 0, "times_used": 0}',
    review_status VARCHAR(50) DEFAULT 'pending',
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(review_status);

-- 2.4 技能-能力关联表
CREATE TABLE IF NOT EXISTS skill_capabilities (
    id VARCHAR(255) PRIMARY KEY,
    skill_id VARCHAR(255) NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    capability_id VARCHAR(255) NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(skill_id, capability_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_capabilities_skill_id ON skill_capabilities(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_capabilities_capability_id ON skill_capabilities(capability_id);

-- 2.5 能力效果指标表
CREATE TABLE IF NOT EXISTS capability_metrics (
    id VARCHAR(255) PRIMARY KEY,
    capability_id VARCHAR(255) NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
    session_id VARCHAR(255),
    subtask_id VARCHAR(255),
    times_triggered INTEGER DEFAULT 0,
    times_used INTEGER DEFAULT 0,
    adoption_rate DECIMAL(5,4) DEFAULT 0,
    success BOOLEAN,
    duration_ms BIGINT,
    time_saved_ms BIGINT,
    relevance_score DECIMAL(3,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capability_metrics_capability_id ON capability_metrics(capability_id);
CREATE INDEX IF NOT EXISTS idx_capability_metrics_session_id ON capability_metrics(session_id);

-- 2.6 技能反馈表
CREATE TABLE IF NOT EXISTS skill_feedback (
    id VARCHAR(255) PRIMARY KEY,
    skill_id VARCHAR(255) NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    session_id VARCHAR(255) NOT NULL,
    adopted BOOLEAN NOT NULL,
    result VARCHAR(50),
    time_saved_ms BIGINT,
    user_feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skill_feedback_skill_id ON skill_feedback(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_feedback_session_id ON skill_feedback(session_id);

-- 2.7 Skill 发现用 Subtask 聚合表
-- 注：现有 subtasks 表用于子任务调度，本表用于 skill 发现
CREATE TABLE IF NOT EXISTS skill_subtasks (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
    parent_step_id VARCHAR(255),
    description TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    result TEXT,
    error TEXT,
    tool_names TEXT[],
    message_count INTEGER DEFAULT 0,
    tool_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skill_subtasks_session_id ON skill_subtasks(session_id);
CREATE INDEX IF NOT EXISTS idx_skill_subtasks_status ON skill_subtasks(status);

-- ============================================
-- 向量存储：复用现有的 vector_embeddings 表
-- 通过 entity_type 区分: 'skill_subtask' / 'capability' / 'skill'
-- (该表已在 schema.sql 中创建)
-- ============================================

-- ============================================
-- 完成
-- ============================================
SELECT 'Skills migration completed successfully!' AS status;