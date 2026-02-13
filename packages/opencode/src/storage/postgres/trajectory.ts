import { getPool, transaction } from './connection';
import { generateEmbedding, storeEmbedding, searchSimilarEmbeddings } from './embedding';
import { isAIEnabled } from './config';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Log } from "../../util/log";

const logger = Log.create({ service: "trajectory-storage" })

export interface SessionData {
  id: string;
  projectId?: string;
  userId?: string;
  parentSessionId?: string;
  directory: string;
  title?: string;
  version?: string;
  permission?: Record<string, any>[];
  archivedAt?: Date;
  metadata?: Record<string, any>;
}

export interface MessageData {
  id: string;
  sessionId: string;
  parentId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  
  model?: string;
  providerId?: string;
  agent?: string;
  variant?: string;
  systemPrompt?: string;
  
  finishReason?: string;
  error?: Record<string, any>;
  
  cost?: number;
  tokensInput?: number;
  tokensOutput?: number;
  tokensReasoning?: number;
  tokensCacheRead?: number;
  tokensCacheWrite?: number;
  
  pathCwd?: string;
  pathRoot?: string;
  
  summaryTitle?: string;
  summaryBody?: string;
  
  timeCreated: number;
  timeCompleted?: number;
  
  stepOrder?: number;
  isSummary?: boolean;
  
  metadata?: Record<string, any>;
}

export interface MessagePartData {
  id: string;
  messageId: string;
  partType: 'text' | 'reasoning' | 'tool' | 'file' | 'agent' | 'subtask' | 'step-start' | 'step-finish' | 'patch' | 'snapshot' | 'compaction' | 'retry';
  content?: string;
  partOrder: number;
  metadata?: Record<string, any>;
}

export interface ReasoningChainData {
  id: string;
  messageId: string;
  content: string;
  model?: string;
  timeStart: number;
  timeEnd?: number;
  providerMetadata?: Record<string, any>;
  partOrder?: number;
  metadata?: Record<string, any>;
}

export interface ToolCallData {
  id: string;
  messageId: string;
  callId: string;
  toolName: string;
  input: Record<string, any>;
  output?: string;
  rawOutput?: string;
  truncated?: boolean;
  status: 'pending' | 'running' | 'completed' | 'failed';
  errorMessage?: string;
  title?: string;
  outputPath?: string;
  timeCreated: number;
  timeStart: number;
  timeEnd?: number;
  durationMs?: number;
  partOrder?: number;
  attachments?: Array<{
    filename?: string;
    mime?: string;
    url?: string;
    sourceType?: string;
    sourcePath?: string;
    sourceRange?: Record<string, any>;
    fileSize?: number;
  }>;
  metadata?: Record<string, any>;
}

export interface ToolAttachmentData {
  id: string;
  toolCallId: string;
  messageId?: string;
  filename?: string;
  mime?: string;
  url?: string;
  sourceType?: 'file' | 'symbol' | 'resource';
  sourcePath?: string;
  sourceRange?: Record<string, any>;
  fileSize?: number;
  metadata?: Record<string, any>;
}

export interface FileOperationData {
  id: string;
  sessionId: string;
  messageId?: string;
  toolCallId?: string;
  operationType: 'read' | 'write' | 'edit' | 'glob' | 'grep' | 'list' | 'bash';
  filePath: string;
  fileContent?: string;
  fileMime?: string;
  fileSize?: number;
  offset?: number;
  limit?: number;
  diffContent?: string;
  diffHash?: string;
  diffStats?: Record<string, any>;
  operationOrder?: number;
  metadata?: Record<string, any>;
}

export interface SnapshotData {
  id: string;
  sessionId: string;
  messageId?: string;
  stepId?: string;
  snapshotHash: string;
  workingDirectory?: string;
  fileCount?: number;
  fileList?: string[];
  timeCreated: number;
  snapshotOrder?: number;
  metadata?: Record<string, any>;
}

export interface PatchData {
  id: string;
  sessionId: string;
  messageId?: string;
  stepId?: string;
  patchHash: string;
  filePath: string;
  fileDiff?: string;
  additions?: number;
  deletions?: number;
  diffStats?: Record<string, any>;
  originalContent?: string;
  patchedContent?: string;
  timeCreated: number;
  patchOrder?: number;
  metadata?: Record<string, any>;
}

export interface StepData {
  id: string;
  trajectoryId?: string;
  sessionId: string;
  messageId?: string;
  stepType: 'reasoning' | 'tool_call' | 'tool_result' | 'text' | 'error' | 'subtask' | 'compaction' | 'text_generation';
  stepOrder: number;
  content?: string;
  inputData?: Record<string, any>;
  outputData?: Record<string, any>;
  snapshotId?: string;
  patchId?: string;
  toolCallId?: string;
  reason?: string;
  status?: 'active' | 'completed' | 'failed' | 'cancelled';
  tokensInput?: number;
  tokensOutput?: number;
  tokensReasoning?: number;
  cost?: number;
  timeStart: number;
  timeEnd?: number;
  durationMs?: number;
  stepGroup?: string;
  metadata?: Record<string, any>;
}

export interface SubtaskData {
  id: string;
  sessionId: string;
  parentMessageId: string;
  prompt: string;
  description?: string;
  agent: string;
  command?: string;
  modelProviderId?: string;
  modelId?: string;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  errorMessage?: string;
  timeCreated: number;
  timeStart?: number;
  timeEnd?: number;
  durationMs?: number;
  metadata?: Record<string, any>;
}

export interface SessionCompactionData {
  id: string;
  sessionId: string;
  originalMessagesCount?: number;
  compressedMessagesCount?: number;
  compressedContent?: string;
  compressionRatio?: number;
  auto?: boolean;
  timeCreated: number;
  metadata?: Record<string, any>;
}

export interface RetryData {
  id: string;
  sessionId: string;
  messageId: string;
  attemptNumber: number;
  errorName?: string;
  errorMessage?: string;
  errorDetails?: Record<string, any>;
  errorStack?: string;
  status?: 'pending' | 'completed' | 'failed';
  timeCreated: number;
  metadata?: Record<string, any>;
}

export interface TrajectoryData {
  id: string;
  sessionId: string;
  rootMessageId?: string;
  model?: string;
  providerId?: string;
  agent?: string;
  title?: string;
  description?: string;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  totalSteps?: number;
  totalToolCalls?: number;
  totalSubtasks?: number;
  totalCompactions?: number;
  totalDurationMs?: number;
  totalCost?: number;
  totalTokensInput?: number;
  totalTokensOutput?: number;
  totalTokensReasoning?: number;
  totalTokensCacheRead?: number;
  totalTokensCacheWrite?: number;
  totalFileReads?: number;
  totalFileWrites?: number;
  totalPatches?: number;
  totalSnapshots?: number;
  timeCreated: number;
  timeCompleted?: number;
  durationMs?: number;
  qualityScore?: number;
  efficiencyScore?: number;
  metadata?: Record<string, any>;
}

export interface CompleteTrajectoryData {
  session: SessionData;
  messages: MessageData[];
  parts: MessagePartData[];
  textParts?: any[];
  reasoningChains: ReasoningChainData[];
  toolCalls: ToolCallData[];
  attachments: ToolAttachmentData[];
  fileOperations: FileOperationData[];
  snapshots: SnapshotData[];
  patches: PatchData[];
  steps: StepData[];
  subtasks: SubtaskData[];
  compactions: SessionCompactionData[];
  retries: RetryData[];
  trajectory: TrajectoryData;
}

export class TrajectoryStorage {
  private _pool: ReturnType<typeof getPool> | null = null;

  private get pool() {
    if (!this._pool) {
      this._pool = getPool();
    }
    return this._pool;
  }

  async createSession(data: SessionData): Promise<string> {
    const query = `
      INSERT INTO sessions (id, project_id, user_id, parent_session_id, directory, title, version, permission, archived_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        project_id = COALESCE($2, sessions.project_id),
        user_id = COALESCE($3, sessions.user_id),
        parent_session_id = COALESCE($4, sessions.parent_session_id),
        directory = COALESCE($5, sessions.directory),
        title = COALESCE($6, sessions.title),
        version = COALESCE($7, sessions.version),
        permission = COALESCE($8, sessions.permission),
        archived_at = COALESCE($9, sessions.archived_at),
        metadata = COALESCE($10, sessions.metadata)::jsonb,
        updated_at = NOW()
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.projectId || null,
      data.userId || null,
      data.parentSessionId || null,
      data.directory,
      data.title || null,
      data.version || null,
      JSON.stringify(data.permission || []),
      data.archivedAt || null,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async getSession(sessionId: string): Promise<any> {
    const result = await this.pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [sessionId]
    );
    return result.rows[0] || null;
  }

  async createMessage(data: MessageData): Promise<string> {
    // Check if session exists, if not set session_id to NULL
    let sessionId = data.sessionId;
    if (sessionId) {
      const checkResult = await this.pool.query(
        'SELECT id FROM sessions WHERE id = $1',
        [sessionId]
      );
      if (checkResult.rows.length === 0) {
        sessionId = null;
      }
    }

    const query = `
      INSERT INTO messages (
        id, session_id, parent_id, role, content,
        model, provider_id, agent, variant, system_prompt,
        finish_reason, error,
        cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
        path_cwd, path_root,
        summary_title, summary_body,
        time_created, time_completed,
        step_order, is_summary,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
      ON CONFLICT (id) DO UPDATE SET
        session_id = COALESCE($2, messages.session_id),
        parent_id = COALESCE($3, messages.parent_id),
        content = $5,
        model = COALESCE($6, messages.model),
        provider_id = COALESCE($7, messages.provider_id),
        agent = COALESCE($8, messages.agent),
        variant = COALESCE($9, messages.variant),
        system_prompt = COALESCE($10, messages.system_prompt),
        finish_reason = COALESCE($11, messages.finish_reason),
        error = COALESCE($12, messages.error),
        cost = COALESCE($13, messages.cost),
        tokens_input = COALESCE($14, messages.tokens_input),
        tokens_output = COALESCE($15, messages.tokens_output),
        tokens_reasoning = COALESCE($16, messages.tokens_reasoning),
        tokens_cache_read = COALESCE($17, messages.tokens_cache_read),
        tokens_cache_write = COALESCE($18, messages.tokens_cache_write),
        path_cwd = COALESCE($19, messages.path_cwd),
        path_root = COALESCE($20, messages.path_root),
        summary_title = COALESCE($21, messages.summary_title),
        summary_body = COALESCE($22, messages.summary_body),
        time_created = $23,
        time_completed = COALESCE($24, messages.time_completed),
        step_order = COALESCE($25, messages.step_order),
        is_summary = COALESCE($26, messages.is_summary),
        metadata = COALESCE($27, messages.metadata)::jsonb,
        updated_at = NOW()
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      sessionId,
      data.parentId || null,
      data.role,
      data.content,
      data.model || null,
      data.providerId || null,
      data.agent || null,
      data.variant || null,
      data.systemPrompt || null,
      data.finishReason || null,
      JSON.stringify(data.error || null),
      data.cost || 0,
      data.tokensInput || 0,
      data.tokensOutput || 0,
      data.tokensReasoning || 0,
      data.tokensCacheRead || 0,
      data.tokensCacheWrite || 0,
      data.pathCwd || null,
      data.pathRoot || null,
      data.summaryTitle || null,
      data.summaryBody || null,
      data.timeCreated,
      data.timeCompleted || null,
      data.stepOrder || null,
      data.isSummary ?? false,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async getMessagesBySession(sessionId: string): Promise<any[]> {
    const result = await this.pool.query(
      'SELECT * FROM messages WHERE session_id = $1 ORDER BY time_created ASC',
      [sessionId]
    );
    return result.rows;
  }

  async createReasoningChain(data: ReasoningChainData): Promise<string> {
    // Check if message exists, if not set message_id to NULL
    let messageId = data.messageId;
    if (messageId) {
      const checkResult = await this.pool.query(
        'SELECT id FROM messages WHERE id = $1',
        [messageId]
      );
      if (checkResult.rows.length === 0) {
        messageId = null;
      }
    }

    const query = `
      INSERT INTO reasoning_chains (id, message_id, content, model, time_start, time_end, provider_metadata, part_order, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        content = $3,
        message_id = COALESCE($2, reasoning_chains.message_id),
        model = COALESCE($4, reasoning_chains.model),
        time_start = COALESCE($5, reasoning_chains.time_start),
        time_end = COALESCE($6, reasoning_chains.time_end),
        provider_metadata = COALESCE($7, reasoning_chains.provider_metadata),
        part_order = COALESCE($8, reasoning_chains.part_order),
        metadata = COALESCE($9, reasoning_chains.metadata)::jsonb
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      messageId,
      data.content,
      data.model || null,
      data.timeStart,
      data.timeEnd || null,
      JSON.stringify(data.providerMetadata || {}),
      data.partOrder || 0,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async createToolCall(data: ToolCallData): Promise<string> {
    // Check if message exists, if not set message_id to NULL
    let messageId = data.messageId;
    if (messageId) {
      const checkResult = await this.pool.query(
        'SELECT id FROM messages WHERE id = $1',
        [messageId]
      );
      if (checkResult.rows.length === 0) {
        messageId = null;
      }
    }

    const query = `
      INSERT INTO tool_calls (
        id, message_id, call_id, tool_name, input, output, raw_output, truncated,
        status, error_message, title, output_path,
        time_created, time_start, time_end, duration_ms, part_order, attachments, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (id) DO UPDATE SET
        message_id = COALESCE($2, tool_calls.message_id),
        call_id = $3,
        tool_name = $4,
        input = $5,
        output = COALESCE($6, tool_calls.output),
        raw_output = COALESCE($7, tool_calls.raw_output),
        truncated = COALESCE($8, tool_calls.truncated),
        status = COALESCE($9, tool_calls.status),
        error_message = COALESCE($10, tool_calls.error_message),
        title = COALESCE($11, tool_calls.title),
        output_path = COALESCE($12, tool_calls.output_path),
        time_created = $13,
        time_start = COALESCE($14, tool_calls.time_start),
        time_end = COALESCE($15, tool_calls.time_end),
        duration_ms = COALESCE($16, tool_calls.duration_ms),
        part_order = COALESCE($17, tool_calls.part_order),
        attachments = COALESCE($18, tool_calls.attachments),
        metadata = COALESCE($19, tool_calls.metadata)::jsonb,
        updated_at = NOW()
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      messageId,
      data.callId,
      data.toolName,
      JSON.stringify(data.input),
      data.output || null,
      data.rawOutput || null,
      data.truncated ?? false,
      data.status,
      data.errorMessage || null,
      data.title || null,
      data.outputPath || null,
      data.timeCreated,
      data.timeStart,
      data.timeEnd || null,
      data.durationMs || null,
      data.partOrder || 0,
      JSON.stringify(data.attachments || []),
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async updateToolCall(
    id: string,
    updates: Partial<ToolCallData>
  ): Promise<void> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.output !== undefined) {
      setClauses.push(`output = $${paramIndex++}`);
      values.push(updates.output);
    }
    if (updates.rawOutput !== undefined) {
      setClauses.push(`raw_output = $${paramIndex++}`);
      values.push(updates.rawOutput);
    }
    if (updates.truncated !== undefined) {
      setClauses.push(`truncated = $${paramIndex++}`);
      values.push(updates.truncated);
    }
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.errorMessage !== undefined) {
      setClauses.push(`error_message = $${paramIndex++}`);
      values.push(updates.errorMessage);
    }
    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      values.push(updates.title);
    }
    if (updates.durationMs !== undefined) {
      setClauses.push(`duration_ms = $${paramIndex++}`);
      values.push(updates.durationMs);
    }
    if (updates.timeEnd !== undefined) {
      setClauses.push(`time_end = $${paramIndex++}`);
      values.push(updates.timeEnd);
    }
    if (updates.attachments !== undefined) {
      setClauses.push(`attachments = $${paramIndex++}`);
      values.push(JSON.stringify(updates.attachments));
    }

    if (setClauses.length === 0) return;

    values.push(id);
    await this.pool.query(
      `UPDATE tool_calls SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  }

  async createStep(data: StepData): Promise<string> {
    // Check if message and trajectory exist, if not set to NULL
    let messageId = data.messageId;
    if (messageId) {
      const checkResult = await this.pool.query(
        'SELECT id FROM messages WHERE id = $1',
        [messageId]
      );
      if (checkResult.rows.length === 0) {
        messageId = null;
      }
    }

    let trajectoryId = data.trajectoryId;
    if (trajectoryId) {
      const checkResult = await this.pool.query(
        'SELECT id FROM trajectories WHERE id = $1',
        [trajectoryId]
      );
      if (checkResult.rows.length === 0) {
        trajectoryId = null;
      }
    }

    const query = `
      INSERT INTO steps (
        id, trajectory_id, session_id, message_id, step_type, step_order,
        content, input_data, output_data, snapshot_id, patch_id, tool_call_id,
        reason, status,
        tokens_input, tokens_output, tokens_reasoning, cost,
        time_start, time_end, duration_ms, step_group,
        metadata
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      ON CONFLICT (id) DO UPDATE SET
        trajectory_id = COALESCE($2, steps.trajectory_id),
        session_id = COALESCE($3, steps.session_id),
        message_id = COALESCE($4, steps.message_id),
        step_type = $5,
        step_order = COALESCE($6, steps.step_order),
        content = COALESCE($7, steps.content),
        input_data = COALESCE($8, steps.input_data),
        output_data = COALESCE($9, steps.output_data),
        snapshot_id = COALESCE($10, steps.snapshot_id),
        patch_id = COALESCE($11, steps.patch_id),
        tool_call_id = COALESCE($12, steps.tool_call_id),
        reason = COALESCE($13, steps.reason),
        status = COALESCE($14, steps.status),
        tokens_input = COALESCE($15, steps.tokens_input),
        tokens_output = COALESCE($16, steps.tokens_output),
        tokens_reasoning = COALESCE($17, steps.tokens_reasoning),
        cost = COALESCE($18, steps.cost),
        time_start = COALESCE($19, steps.time_start),
        time_end = COALESCE($20, steps.time_end),
        duration_ms = COALESCE($21, steps.duration_ms),
        step_group = COALESCE($22, steps.step_group),
        metadata = COALESCE($23, steps.metadata)::jsonb
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      trajectoryId,
      data.sessionId,
      messageId,
      data.stepType,
      data.stepOrder,
      data.content || null,
      JSON.stringify(data.inputData || {}),
      JSON.stringify(data.outputData || {}),
      data.snapshotId || null,
      data.patchId || null,
      data.toolCallId || null,
      data.reason || null,
      data.status || 'active',
      data.tokensInput || 0,
      data.tokensOutput || 0,
      data.tokensReasoning || 0,
      data.cost || 0,
      data.timeStart,
      data.timeEnd || null,
      data.durationMs || null,
      data.stepGroup || null,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async createTrajectory(data: TrajectoryData): Promise<string> {
    // Check if session exists, if not set session_id to NULL
    let sessionId = data.sessionId;
    if (sessionId) {
      const checkResult = await this.pool.query(
        'SELECT id FROM sessions WHERE id = $1',
        [sessionId]
      );
      if (checkResult.rows.length === 0) {
        sessionId = null;
      }
    }

    const query = `
      INSERT INTO trajectories (
        id, session_id, root_message_id, model, provider_id, agent, title, description,
        status, total_steps, total_tool_calls, total_subtasks, total_compactions,
        total_duration_ms, total_cost,
        total_tokens_input, total_tokens_output, total_tokens_reasoning, total_tokens_cache_read, total_tokens_cache_write,
        total_file_reads, total_file_writes, total_patches, total_snapshots,
        time_created, time_completed, duration_ms, quality_score, efficiency_score,
        metadata
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
      ON CONFLICT (id) DO UPDATE SET
        session_id = COALESCE($2, trajectories.session_id),
        model = COALESCE($4, trajectories.model),
        provider_id = COALESCE($5, trajectories.provider_id),
        agent = COALESCE($6, trajectories.agent),
        title = COALESCE($7, trajectories.title),
        description = COALESCE($8, trajectories.description),
        status = COALESCE($9, trajectories.status),
        total_steps = COALESCE($10, trajectories.total_steps),
        total_tool_calls = COALESCE($11, trajectories.total_tool_calls),
        total_subtasks = COALESCE($12, trajectories.total_subtasks),
        total_compactions = COALESCE($13, trajectories.total_compactions),
        total_duration_ms = COALESCE($14, trajectories.total_duration_ms),
        total_cost = COALESCE($15, trajectories.total_cost),
        total_tokens_input = COALESCE($16, trajectories.total_tokens_input),
        total_tokens_output = COALESCE($17, trajectories.total_tokens_output),
        total_tokens_reasoning = COALESCE($18, trajectories.total_tokens_reasoning),
        total_tokens_cache_read = COALESCE($19, trajectories.total_tokens_cache_read),
        total_tokens_cache_write = COALESCE($20, trajectories.total_tokens_cache_write),
        total_file_reads = COALESCE($21, trajectories.total_file_reads),
        total_file_writes = COALESCE($22, trajectories.total_file_writes),
        total_patches = COALESCE($23, trajectories.total_patches),
        total_snapshots = COALESCE($24, trajectories.total_snapshots),
        time_completed = COALESCE($26, trajectories.time_completed),
        duration_ms = COALESCE($27, trajectories.duration_ms),
        quality_score = COALESCE($28, trajectories.quality_score),
        efficiency_score = COALESCE($29, trajectories.efficiency_score),
        metadata = COALESCE($30, trajectories.metadata)::jsonb,
        updated_at = NOW()
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      sessionId,
      data.rootMessageId || null,
      data.model || null,
      data.providerId || null,
      data.agent || null,
      data.title || null,
      data.description || null,
      data.status || 'active',
      data.totalSteps || 0,
      data.totalToolCalls || 0,
      data.totalSubtasks || 0,
      data.totalCompactions || 0,
      data.totalDurationMs || null,
      data.totalCost || 0,
      data.totalTokensInput || 0,
      data.totalTokensOutput || 0,
      data.totalTokensReasoning || 0,
      data.totalTokensCacheRead || 0,
      data.totalTokensCacheWrite || 0,
      data.totalFileReads || 0,
      data.totalFileWrites || 0,
      data.totalPatches || 0,
      data.totalSnapshots || 0,
      data.timeCreated,
      data.timeCompleted || null,
      data.durationMs || null,
      data.qualityScore || null,
      data.efficiencyScore || null,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async updateTrajectory(
    id: string,
    updates: Partial<TrajectoryData>
  ): Promise<void> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);
      if (updates.status === 'completed' || updates.status === 'failed') {
        setClauses.push(`time_completed = $${paramIndex++}`);
        values.push(Date.now());
        setClauses.push(`completed_at = NOW()`);
      }
    }
    if (updates.totalSteps !== undefined) {
      setClauses.push(`total_steps = $${paramIndex++}`);
      values.push(updates.totalSteps);
    }
    if (updates.totalToolCalls !== undefined) {
      setClauses.push(`total_tool_calls = $${paramIndex++}`);
      values.push(updates.totalToolCalls);
    }
    if (updates.totalDurationMs !== undefined) {
      setClauses.push(`total_duration_ms = $${paramIndex++}`);
      values.push(updates.totalDurationMs);
    }
    if (updates.totalCost !== undefined) {
      setClauses.push(`total_cost = $${paramIndex++}`);
      values.push(updates.totalCost);
    }
    if (updates.totalTokensInput !== undefined) {
      setClauses.push(`total_tokens_input = $${paramIndex++}`);
      values.push(updates.totalTokensInput);
    }
    if (updates.totalTokensOutput !== undefined) {
      setClauses.push(`total_tokens_output = $${paramIndex++}`);
      values.push(updates.totalTokensOutput);
    }

    if (setClauses.length === 0) return;

    values.push(id);
    await this.pool.query(
      `UPDATE trajectories SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  }

  async getTrajectory(trajectoryId: string): Promise<any> {
    const result = await this.pool.query(
      'SELECT * FROM trajectories WHERE id = $1',
      [trajectoryId]
    );
    return result.rows[0] || null;
  }

  async getTrajectoryWithDetails(trajectoryId: string): Promise<CompleteTrajectoryData | null> {
    const trajectoryResult = await this.pool.query(
      'SELECT * FROM trajectories WHERE id = $1',
      [trajectoryId]
    );

    if (trajectoryResult.rows.length === 0) {
      return null;
    }

    const trajectory = trajectoryResult.rows[0];
    const sessionId = trajectory.session_id;

    const [
      sessionResult,
      messagesResult,
      reasoningResult,
      toolCallsResult,
      stepsResult,
    ] = await Promise.all([
      this.pool.query('SELECT * FROM sessions WHERE id = $1', [sessionId]),
      this.pool.query('SELECT * FROM messages WHERE session_id = $1 ORDER BY time_created', [sessionId]),
      this.pool.query(`
        SELECT rc.* FROM reasoning_chains rc
        JOIN messages m ON rc.message_id = m.id
        WHERE m.session_id = $1 ORDER BY rc.time_start
      `, [sessionId]),
      this.pool.query(`
        SELECT tc.* FROM tool_calls tc
        JOIN messages m ON tc.message_id = m.id
        WHERE m.session_id = $1 ORDER BY tc.time_created
      `, [sessionId]),
      this.pool.query(`
        SELECT s.* FROM steps s
        WHERE s.session_id = $1 ORDER BY s.step_order
      `, [sessionId]),
    ]);

    return {
      session: sessionResult.rows[0],
      messages: messagesResult.rows,
      reasoningChains: reasoningResult.rows,
      toolCalls: toolCallsResult.rows,
      steps: stepsResult.rows,
      trajectory,
    } as any;
  }

  async storeCompleteTrajectory(data: CompleteTrajectoryData): Promise<string> {
    return transaction(async (client) => {
      await client.query('BEGIN');

      try {
        await this.createSession(data.session);

        for (const message of data.messages) {
          await this.createMessage(message);
        }

        for (const part of data.parts || []) {
          await this.createMessagePart(part);
        }

        for (const reasoning of data.reasoningChains) {
          await this.createReasoningChain(reasoning);
        }

        for (const toolCall of data.toolCalls) {
          await this.createToolCall(toolCall);
        }

        for (const step of data.steps) {
          await this.createStep(step);
        }

        await this.createTrajectory(data.trajectory);

        await client.query('COMMIT');
        return data.trajectory.id;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async createMessagePart(data: MessagePartData): Promise<string> {
    // Check if message exists, if not set message_id to NULL
    let messageId = data.messageId;
    if (messageId) {
      const checkResult = await this.pool.query(
        'SELECT id FROM messages WHERE id = $1',
        [messageId]
      );
      if (checkResult.rows.length === 0) {
        messageId = null;
      }
    }

    const query = `
      INSERT INTO message_parts (id, message_id, part_type, content, part_order, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      messageId,
      data.partType,
      data.content || null,
      data.partOrder,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async storeTrajectoryWithEmbeddings(data: CompleteTrajectoryData): Promise<string> {
    const trajectoryId = await this.storeCompleteTrajectory(data);

    if (!isAIEnabled()) {
      logger.debug("AI features are disabled, skipping embedding storage");
      return trajectoryId;
    }

    try {
      for (const message of data.messages) {
        if (message.content && message.content.length > 10) {
          const embedding = await generateEmbedding(message.content);
          await storeEmbedding(
            'message',
            message.id,
            message.content,
            embedding
          );
        }
      }

      for (const step of data.steps) {
        if (step.content && step.content.length > 10) {
          const embedding = await generateEmbedding(step.content);
          await storeEmbedding(
            'step',
            step.id,
            step.content,
            embedding
          );
        }
      }

      for (const toolCall of data.toolCalls) {
        const combinedContent = `${toolCall.toolName} ${JSON.stringify(toolCall.input)}`;
        if (combinedContent.length > 10) {
          const embedding = await generateEmbedding(combinedContent);
          await storeEmbedding(
            'tool_call',
            toolCall.id,
            combinedContent,
            embedding
          );
        }
      }
    } catch (error) {
      logger.error("failed to store embeddings for trajectory", { error });
    }

    return trajectoryId;
  }

  async searchSimilarContent(
    query: string,
    options: { limit?: number; entityType?: string } = {}
  ): Promise<Array<{ id: string; entity_type: string; entity_id: string; content: string; similarity: number }>> {
    if (!isAIEnabled()) {
      logger.warn("AI features are disabled, search will return empty results");
      return [];
    }
    
    const queryEmbedding = await generateEmbedding(query);
    return searchSimilarEmbeddings(
      queryEmbedding,
      options.entityType,
      { limit: options.limit || 10 }
    );
  }

  async getToolCallsBySession(sessionId: string): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT tc.* FROM tool_calls tc
      JOIN messages m ON tc.message_id = m.id
      WHERE m.session_id = $1
      ORDER BY tc.time_created ASC
    `, [sessionId]);
    return result.rows;
  }

  async getStepsBySession(sessionId: string): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT s.* FROM steps s
      WHERE s.session_id = $1
      ORDER BY s.step_order ASC
    `, [sessionId]);
    return result.rows;
  }

  async getReasoningChainsBySession(sessionId: string): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT rc.* FROM reasoning_chains rc
      JOIN messages m ON rc.message_id = m.id
      WHERE m.session_id = $1
      ORDER BY rc.time_start ASC
    `, [sessionId]);
    return result.rows;
  }
}

export const trajectoryStorage = new TrajectoryStorage();
