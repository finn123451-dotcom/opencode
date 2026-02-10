import { getPool, transaction } from './connection';
import { generateEmbedding, storeEmbedding, searchSimilarEmbeddings } from './embedding';
import crypto from 'crypto';

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
  cost?: number;
  tokensInput?: number;
  tokensOutput?: number;
  tokensReasoning?: number;
  tokensCacheRead?: number;
  tokensCacheWrite?: number;
  error?: Record<string, any>;
  timeCreated?: Date;
  timeCompleted?: Date;
  stepOrder?: number;
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

export interface TextPartData {
  id: string;
  partId: string;
  textContent: string;
  synthetic?: boolean;
  ignored?: boolean;
  timeStart?: number;
  timeEnd?: number;
  truncated?: boolean;
  metadata?: Record<string, any>;
}

export interface ReasoningChainData {
  id: string;
  messageId: string;
  content: string;
  model?: string;
  providerMetadata?: Record<string, any>;
  timeStart: number;
  timeEnd?: number;
  metadata?: Record<string, any>;
}

export interface ToolCallData {
  id: string;
  messageId: string;
  callId: string;
  toolName: string;
  input: Record<string, any>;
  output?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  title?: string;
  truncated?: boolean;
  outputPath?: string;
  durationMs?: number;
  timeCreated?: Date;
  timeStart?: Date;
  timeEnd?: Date;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export interface ToolAttachmentData {
  id: string;
  toolCallId: string;
  filename?: string;
  mime?: string;
  url?: string;
  sourceType?: 'file' | 'symbol' | 'resource';
  sourcePath?: string;
  sourceRange?: Record<string, any>;
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
  offset?: number;
  limit?: number;
  diffContent?: string;
  diffHash?: string;
  metadata?: Record<string, any>;
}

export interface SnapshotData {
  id: string;
  sessionId: string;
  messageId?: string;
  stepId?: string;
  snapshotHash: string;
  workingDirectory?: string;
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
  diffStats?: Record<string, any>;
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
  reason?: string;
  tokensInput?: number;
  tokensOutput?: number;
  tokensReasoning?: number;
  cost?: number;
  durationMs?: number;
  metadata?: Record<string, any>;
}

export interface SubtaskData {
  id: string;
  sessionId: string;
  parentMessageId: string;
  prompt: string;
  description?: string;
  agent: string;
  modelProviderId?: string;
  modelId?: string;
  command?: string;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt?: Date;
  completedAt?: Date;
  metadata?: Record<string, any>;
}

export interface SessionCompactionData {
  id: string;
  sessionId: string;
  originalMessagesCount?: number;
  compressedContent?: string;
  auto?: boolean;
  metadata?: Record<string, any>;
}

export interface RetryData {
  id: string;
  sessionId: string;
  messageId: string;
  attemptNumber: number;
  errorMessage?: string;
  errorDetails?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface TrajectoryData {
  id: string;
  sessionId: string;
  rootMessageId?: string;
  model?: string;
  agent?: string;
  title?: string;
  description?: string;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  totalSteps?: number;
  totalToolCalls?: number;
  totalDurationMs?: number;
  totalCost?: number;
  totalTokensInput?: number;
  totalTokensOutput?: number;
  createdAt?: Date;
  completedAt?: Date;
  metadata?: Record<string, any>;
}

export interface CompleteTrajectoryData {
  session: SessionData;
  messages: MessageData[];
  parts: MessagePartData[];
  textParts: TextPartData[];
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

export class EnhancedTrajectoryStorage {
  private pool = getPool();

  async createSession(data: SessionData): Promise<string> {
    const query = `
      INSERT INTO sessions (
        id, project_id, user_id, parent_session_id, directory, title,
        version, permission, archived_at, metadata
      )
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

  async createMessage(data: MessageData): Promise<string> {
    const query = `
      INSERT INTO messages (
        id, session_id, parent_id, role, content, model, provider_id,
        agent, variant, system_prompt, finish_reason, cost,
        tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
        error, time_created, time_completed, step_order, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      ON CONFLICT (id) DO UPDATE SET
        parent_id = COALESCE($3, messages.parent_id),
        content = $5,
        model = COALESCE($6, messages.model),
        provider_id = COALESCE($7, messages.provider_id),
        agent = COALESCE($8, messages.agent),
        variant = COALESCE($9, messages.variant),
        system_prompt = COALESCE($10, messages.system_prompt),
        finish_reason = COALESCE($11, messages.finish_reason),
        cost = COALESCE($12, messages.cost),
        tokens_input = COALESCE($13, messages.tokens_input),
        tokens_output = COALESCE($14, messages.tokens_output),
        tokens_reasoning = COALESCE($15, messages.tokens_reasoning),
        tokens_cache_read = COALESCE($16, messages.tokens_cache_read),
        tokens_cache_write = COALESCE($17, messages.tokens_cache_write),
        error = COALESCE($18, messages.error),
        time_completed = COALESCE($20, messages.time_completed),
        step_order = COALESCE($21, messages.step_order),
        metadata = COALESCE($22, messages.metadata)::jsonb
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.parentId || null,
      data.role,
      data.content,
      data.model || null,
      data.providerId || null,
      data.agent || null,
      data.variant || null,
      data.systemPrompt || null,
      data.finishReason || null,
      data.cost || 0,
      data.tokensInput || 0,
      data.tokensOutput || 0,
      data.tokensReasoning || 0,
      data.tokensCacheRead || 0,
      data.tokensCacheWrite || 0,
      JSON.stringify(data.error || null),
      data.timeCreated || new Date(),
      data.timeCompleted || null,
      data.stepOrder || null,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async createMessagePart(data: MessagePartData): Promise<string> {
    const query = `
      INSERT INTO message_parts (id, message_id, part_type, content, part_order, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        part_type = $3,
        content = COALESCE($4, message_parts.content),
        part_order = COALESCE($5, message_parts.part_order),
        metadata = COALESCE($6, message_parts.metadata)::jsonb
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.messageId,
      data.partType,
      data.content || null,
      data.partOrder,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async createTextPart(data: TextPartData): Promise<string> {
    const query = `
      INSERT INTO text_parts (id, part_id, text_content, synthetic, ignored, time_start, time_end, truncated, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        text_content = $3,
        synthetic = COALESCE($4, text_parts.synthetic),
        ignored = COALESCE($5, text_parts.ignored),
        time_start = COALESCE($6, text_parts.time_start),
        time_end = COALESCE($7, text_parts.time_end),
        truncated = COALESCE($8, text_parts.truncated),
        metadata = COALESCE($9, text_parts.metadata)::jsonb
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.partId,
      data.textContent,
      data.synthetic || false,
      data.ignored || false,
      data.timeStart || null,
      data.timeEnd || null,
      data.truncated || false,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async createReasoningChain(data: ReasoningChainData): Promise<string> {
    const query = `
      INSERT INTO reasoning_chains (id, message_id, content, model, provider_metadata, time_start, time_end, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        content = $3,
        model = COALESCE($4, reasoning_chains.model),
        provider_metadata = COALESCE($5, reasoning_chains.provider_metadata),
        time_start = COALESCE($6, reasoning_chains.time_start),
        time_end = COALESCE($7, reasoning_chains.time_end),
        metadata = COALESCE($8, reasoning_chains.metadata)::jsonb
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.messageId,
      data.content,
      data.model || null,
      JSON.stringify(data.providerMetadata || {}),
      data.timeStart,
      data.timeEnd || null,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async createToolCall(data: ToolCallData): Promise<string> {
    const query = `
      INSERT INTO tool_calls (
        id, message_id, call_id, tool_name, input, output, status,
        title, truncated, output_path, duration_ms, time_created,
        time_start, time_end, error_message, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (id) DO UPDATE SET
        call_id = $3,
        tool_name = $4,
        input = $5,
        output = COALESCE($6, tool_calls.output),
        status = COALESCE($7, tool_calls.status),
        title = COALESCE($8, tool_calls.title),
        truncated = COALESCE($9, tool_calls.truncated),
        output_path = COALESCE($10, tool_calls.output_path),
        duration_ms = COALESCE($11, tool_calls.duration_ms),
        time_start = COALESCE($12, tool_calls.time_start),
        time_end = COALESCE($13, tool_calls.time_end),
        error_message = COALESCE($15, tool_calls.error_message),
        metadata = COALESCE($16, tool_calls.metadata)::jsonb
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.messageId,
      data.callId,
      data.toolName,
      JSON.stringify(data.input),
      data.output || null,
      data.status,
      data.title || null,
      data.truncated || false,
      data.outputPath || null,
      data.durationMs || null,
      data.timeCreated || new Date(),
      data.timeStart || null,
      data.timeEnd || null,
      data.errorMessage || null,
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
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      values.push(updates.title);
    }
    if (updates.truncated !== undefined) {
      setClauses.push(`truncated = $${paramIndex++}`);
      values.push(updates.truncated);
    }
    if (updates.durationMs !== undefined) {
      setClauses.push(`duration_ms = $${paramIndex++}`);
      values.push(updates.durationMs);
    }
    if (updates.timeEnd !== undefined) {
      setClauses.push(`time_end = $${paramIndex++}`);
      values.push(updates.timeEnd);
    }
    if (updates.errorMessage !== undefined) {
      setClauses.push(`error_message = $${paramIndex++}`);
      values.push(updates.errorMessage);
    }

    if (setClauses.length === 0) return;

    values.push(id);
    await this.pool.query(
      `UPDATE tool_calls SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  }

  async createStep(data: StepData): Promise<string> {
    const query = `
      INSERT INTO steps (
        id, trajectory_id, session_id, message_id, step_type, step_order,
        content, input_data, output_data, snapshot_id, patch_id, reason,
        tokens_input, tokens_output, tokens_reasoning, cost, duration_ms, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (id) DO UPDATE SET
        step_type = $5,
        step_order = COALESCE($6, steps.step_order),
        content = COALESCE($7, steps.content),
        input_data = COALESCE($8, steps.input_data),
        output_data = COALESCE($9, steps.output_data),
        snapshot_id = COALESCE($10, steps.snapshot_id),
        patch_id = COALESCE($11, steps.patch_id),
        reason = COALESCE($12, steps.reason),
        tokens_input = COALESCE($13, steps.tokens_input),
        tokens_output = COALESCE($14, steps.tokens_output),
        tokens_reasoning = COALESCE($15, steps.tokens_reasoning),
        cost = COALESCE($16, steps.cost),
        duration_ms = COALESCE($17, steps.duration_ms),
        metadata = COALESCE($18, steps.metadata)::jsonb
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.trajectoryId || null,
      data.sessionId,
      data.messageId || null,
      data.stepType,
      data.stepOrder,
      data.content || null,
      JSON.stringify(data.inputData || {}),
      JSON.stringify(data.outputData || {}),
      data.snapshotId || null,
      data.patchId || null,
      data.reason || null,
      data.tokensInput || null,
      data.tokensOutput || null,
      data.tokensReasoning || null,
      data.cost || null,
      data.durationMs || null,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async createTrajectory(data: TrajectoryData): Promise<string> {
    const query = `
      INSERT INTO trajectories (
        id, session_id, root_message_id, model, agent, title, description,
        status, total_steps, total_tool_calls, total_duration_ms,
        total_cost, total_tokens_input, total_tokens_output, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (id) DO UPDATE SET
        model = COALESCE($4, trajectories.model),
        agent = COALESCE($5, trajectories.agent),
        title = COALESCE($6, trajectories.title),
        description = COALESCE($7, trajectories.description),
        status = COALESCE($8, trajectories.status),
        total_steps = COALESCE($9, trajectories.total_steps),
        total_tool_calls = COALESCE($10, trajectories.total_tool_calls),
        total_duration_ms = COALESCE($11, trajectories.total_duration_ms),
        total_cost = COALESCE($12, trajectories.total_cost),
        total_tokens_input = COALESCE($13, trajectories.total_tokens_input),
        total_tokens_output = COALESCE($14, trajectories.total_tokens_output),
        metadata = COALESCE($15, trajectories.metadata)::jsonb
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.rootMessageId || null,
      data.model || null,
      data.agent || null,
      data.title || null,
      data.description || null,
      data.status,
      data.totalSteps || null,
      data.totalToolCalls || null,
      data.totalDurationMs || null,
      data.totalCost || null,
      data.totalTokensInput || null,
      data.totalTokensOutput || null,
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

    if (setClauses.length === 0) return;

    values.push(id);
    await this.pool.query(
      `UPDATE trajectories SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  }

  async storeCompleteTrajectory(data: CompleteTrajectoryData): Promise<string> {
    return transaction(async (client) => {
      await client.query('BEGIN');

      try {
        await this.createSession(data.session);

        for (const message of data.messages) {
          await this.createMessage(message);
        }

        for (const part of data.parts) {
          await this.createMessagePart(part);
        }

        for (const textPart of data.textParts) {
          await this.createTextPart(textPart);
        }

        for (const reasoning of data.reasoningChains) {
          await this.createReasoningChain(reasoning);
        }

        for (const toolCall of data.toolCalls) {
          await this.createToolCall(toolCall);
        }

        for (const attachment of data.attachments) {
          await this.createToolAttachment(attachment);
        }

        for (const fileOp of data.fileOperations) {
          await this.createFileOperation(fileOp);
        }

        for (const snapshot of data.snapshots) {
          await this.createSnapshot(snapshot);
        }

        for (const patch of data.patches) {
          await this.createPatch(patch);
        }

        for (const step of data.steps) {
          await this.createStep(step);
        }

        for (const subtask of data.subtasks) {
          await this.createSubtask(subtask);
        }

        for (const compaction of data.compactions) {
          await this.createSessionCompaction(compaction);
        }

        for (const retry of data.retries) {
          await this.createRetry(retry);
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

  async createToolAttachment(data: ToolAttachmentData): Promise<string> {
    const query = `
      INSERT INTO tool_attachments (id, tool_call_id, filename, mime, url, source_type, source_path, source_range, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.toolCallId,
      data.filename || null,
      data.mime || null,
      data.url || null,
      data.sourceType || null,
      data.sourcePath || null,
      JSON.stringify(data.sourceRange || null),
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async createFileOperation(data: FileOperationData): Promise<string> {
    const query = `
      INSERT INTO file_operations (
        id, session_id, message_id, tool_call_id, operation_type, file_path,
        file_content, file_mime, offset, limit, diff_content, diff_hash, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.messageId || null,
      data.toolCallId || null,
      data.operationType,
      data.filePath,
      data.fileContent || null,
      data.fileMime || null,
      data.offset || null,
      data.limit || null,
      data.diffContent || null,
      data.diffHash || null,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async createSnapshot(data: SnapshotData): Promise<string> {
    const query = `
      INSERT INTO snapshots (id, session_id, message_id, step_id, snapshot_hash, working_directory, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.messageId || null,
      data.stepId || null,
      data.snapshotHash,
      data.workingDirectory || null,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async createPatch(data: PatchData): Promise<string> {
    const query = `
      INSERT INTO patches (id, session_id, message_id, step_id, patch_hash, file_path, file_diff, diff_stats, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.messageId || null,
      data.stepId || null,
      data.patchHash,
      data.filePath,
      data.fileDiff || null,
      JSON.stringify(data.diffStats || {}),
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async createSubtask(data: SubtaskData): Promise<string> {
    const query = `
      INSERT INTO subtasks (
        id, session_id, parent_message_id, prompt, description, agent,
        model_provider_id, model_id, command, result, status, created_at, completed_at, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        prompt = $4,
        description = COALESCE($5, subtasks.description),
        result = COALESCE($10, subtasks.result),
        status = COALESCE($11, subtasks.status),
        completed_at = COALESCE($13, subtasks.completed_at),
        metadata = COALESCE($14, subtasks.metadata)::jsonb
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.parentMessageId,
      data.prompt,
      data.description || null,
      data.agent,
      data.modelProviderId || null,
      data.modelId || null,
      data.command || null,
      data.result || null,
      data.status,
      data.createdAt || new Date(),
      data.completedAt || null,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async createSessionCompaction(data: SessionCompactionData): Promise<string> {
    const query = `
      INSERT INTO session_compactions (id, session_id, original_messages_count, compressed_content, auto, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.originalMessagesCount || null,
      data.compressedContent || null,
      data.auto || false,
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async createRetry(data: RetryData): Promise<string> {
    const query = `
      INSERT INTO retries (id, session_id, message_id, attempt_number, error_message, error_details, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.messageId,
      data.attemptNumber,
      data.errorMessage || null,
      JSON.stringify(data.errorDetails || {}),
      JSON.stringify(data.metadata || {}),
    ]);

    return result.rows[0].id;
  }

  async getTrajectory(trajectoryId: string): Promise<any> {
    const result = await this.pool.query(
      'SELECT * FROM trajectories WHERE id = $1',
      [trajectoryId]
    );
    return result.rows[0] || null;
  }

  async getSession(sessionId: string): Promise<any> {
    const result = await this.pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [sessionId]
    );
    return result.rows[0] || null;
  }

  async getMessagesBySession(sessionId: string): Promise<any[]> {
    const result = await this.pool.query(
      'SELECT * FROM messages WHERE session_id = $1 ORDER BY time_created ASC',
      [sessionId]
    );
    return result.rows;
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

  async searchSimilarContent(
    query: string,
    options: { limit?: number; entityType?: string } = {}
  ): Promise<Array<{ id: string; entity_type: string; entity_id: string; content: string; similarity: number }>> {
    const queryEmbedding = await generateEmbedding(query);
    return searchSimilarEmbeddings(
      queryEmbedding,
      options.entityType,
      { limit: options.limit || 10 }
    );
  }
}

export const enhancedTrajectoryStorage = new EnhancedTrajectoryStorage();
