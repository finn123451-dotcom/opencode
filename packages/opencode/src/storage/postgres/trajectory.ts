import { getPool, transaction } from "./connection"
import { generateEmbedding, storeEmbedding, searchSimilarEmbeddings } from "./embedding"
import { isAIEnabled } from "./config"
import crypto from "crypto"
import { v4 as uuidv4 } from "uuid"
import { Log } from "../../util/log"

const logger = Log.create({ service: "trajectory-storage" })

export interface SessionData {
  id: string
  projectId?: string
  userId?: string
  parentSessionId?: string
  directory: string
  title?: string
  version?: string
  permission?: Record<string, any>[]
  archivedAt?: Date
  metadata?: Record<string, any>
}

export interface MessageData {
  id: string
  sessionId: string
  branchId?: string
  parentId?: string
  role: "user" | "assistant" | "system"
  content: string

  model?: string
  providerId?: string
  agent?: string
  variant?: string
  systemPrompt?: string

  finishReason?: string
  error?: Record<string, any>

  cost?: number
  tokensInput?: number
  tokensOutput?: number
  tokensReasoning?: number
  tokensCacheRead?: number
  tokensCacheWrite?: number

  pathCwd?: string
  pathRoot?: string

  summaryTitle?: string
  summaryBody?: string

  timeCreated: number
  timeCompleted?: number

  stepOrder?: number
  isSummary?: boolean

  metadata?: Record<string, any>
}

export interface MessagePartData {
  id: string
  sessionId?: string
  branchId?: string
  messageId: string
  partType:
    | "text"
    | "reasoning"
    | "tool"
    | "file"
    | "agent"
    | "subtask"
    | "step-start"
    | "step-finish"
    | "patch"
    | "snapshot"
    | "compaction"
    | "retry"
  content?: string
  partOrder: number
  metadata?: Record<string, any>
}

export interface ReasoningChainData {
  id: string
  sessionId?: string
  branchId?: string
  messageId: string
  content: string
  model?: string
  timeStart: number
  timeEnd?: number
  providerMetadata?: Record<string, any>
  partOrder?: number
  metadata?: Record<string, any>
}

export interface ToolCallData {
  id: string
  sessionId?: string
  branchId?: string
  messageId: string
  callId: string
  toolName: string
  input: Record<string, any>
  output?: string
  rawOutput?: string
  truncated?: boolean
  status: "pending" | "running" | "completed" | "failed"
  errorMessage?: string
  title?: string
  outputPath?: string
  timeCreated: number
  timeStart: number
  timeEnd?: number
  durationMs?: number
  partOrder?: number
  attachments?: Array<{
    filename?: string
    mime?: string
    url?: string
    sourceType?: string
    sourcePath?: string
    sourceRange?: Record<string, any>
    fileSize?: number
  }>
  metadata?: Record<string, any>
}

export interface ToolAttachmentData {
  id: string
  sessionId: string
  branchId?: string
  toolCallId: string
  messageId?: string
  filename?: string
  mime?: string
  url?: string
  sourceType?: "file" | "symbol" | "resource"
  sourcePath?: string
  sourceRange?: Record<string, any>
  fileSize?: number
  metadata?: Record<string, any>
}

export interface BranchSelectionData {
  id: string
  sessionId: string
  winnerBranchId: string
  winnerStrategy: string
  allBranches: Array<{
    id: string
    name: string
    status: string
    success: boolean
    durationMs: number
  }>
  scores: Record<string, number>
  metadata?: Record<string, any>
}

export interface FileOperationData {
  id: string
  sessionId: string
  branchId?: string
  messageId?: string
  toolCallId?: string
  operationType: "read" | "write" | "edit" | "glob" | "grep" | "list" | "bash"
  filePath: string
  fileContent?: string
  fileMime?: string
  fileSize?: number
  offset?: number
  limit?: number
  diffContent?: string
  diffHash?: string
  diffStats?: Record<string, any>
  operationOrder?: number
  metadata?: Record<string, any>
}

export interface SnapshotData {
  id: string
  sessionId: string
  branchId?: string
  messageId?: string
  stepId?: string
  snapshotHash: string
  workingDirectory?: string
  fileCount?: number
  fileList?: string[]
  timeCreated: number
  snapshotOrder?: number
  metadata?: Record<string, any>
}

export interface PatchData {
  id: string
  sessionId: string
  branchId?: string
  messageId?: string
  stepId?: string
  patchHash: string
  filePath: string
  fileDiff?: string
  additions?: number
  deletions?: number
  diffStats?: Record<string, any>
  originalContent?: string
  patchedContent?: string
  timeCreated: number
  patchOrder?: number
  metadata?: Record<string, any>
}

export interface StepData {
  id: string
  sessionId: string
  branchId?: string
  messageId?: string
  stepType: "reasoning" | "tool_call" | "tool_result" | "text" | "error" | "subtask" | "compaction" | "text_generation"
  stepOrder: number
  content?: string
  inputData?: Record<string, any>
  outputData?: Record<string, any>
  snapshotId?: string
  patchId?: string
  toolCallId?: string
  reason?: string
  status?: "active" | "completed" | "failed" | "cancelled"
  tokensInput?: number
  tokensOutput?: number
  tokensReasoning?: number
  cost?: number
  timeStart: number
  timeEnd?: number
  durationMs?: number
  stepGroup?: string
  metadata?: Record<string, any>
}

export interface SubtaskData {
  id: string
  sessionId: string
  parentMessageId: string
  prompt: string
  description?: string
  agent: string
  command?: string
  modelProviderId?: string
  modelId?: string
  result?: string
  status: "pending" | "running" | "completed" | "failed"
  errorMessage?: string
  timeCreated: number
  timeStart?: number
  timeEnd?: number
  durationMs?: number
  metadata?: Record<string, any>
}

export interface SessionCompactionData {
  id: string
  sessionId: string
  originalMessagesCount?: number
  compressedMessagesCount?: number
  compressedContent?: string
  compressionRatio?: number
  auto?: boolean
  timeCreated: number
  metadata?: Record<string, any>
}

export interface RetryData {
  id: string
  sessionId: string
  messageId: string
  attemptNumber: number
  errorName?: string
  errorMessage?: string
  errorDetails?: Record<string, any>
  errorStack?: string
  status?: "pending" | "completed" | "failed"
  timeCreated: number
  metadata?: Record<string, any>
}

export interface ExecutionLogData {
  sessionId: string
  stepId?: string
  toolCallId?: string
  logLevel: "debug" | "info" | "warn" | "error"
  source?: string
  message: string
  data?: Record<string, any>
  timeCreated: number
}

export interface ApiCallLogData {
  messageId?: string
  providerId: string
  modelId?: string
  endpoint?: string
  requestBody?: Record<string, any>
  responseBody?: Record<string, any>
  statusCode?: number
  latencyMs?: number
  cost?: number
  tokensInput?: number
  tokensOutput?: number
  errorMessage?: string
  errorCode?: string
  timeCreated: number
  metadata?: Record<string, any>
}

export interface CostStatisticData {
  sessionId: string
  providerId?: string
  modelId?: string
  costInput?: number
  costOutput?: number
  costCacheRead?: number
  costCacheWrite?: number
  costReasoning?: number
  totalCost?: number
  tokensInput?: number
  tokensOutput?: number
  tokensReasoning?: number
  tokensCacheRead?: number
  tokensCacheWrite?: number
  apiCalls?: number
  periodStart: number
  periodEnd?: number
  metadata?: Record<string, any>
}

export interface PermissionRequestData {
  sessionId: string
  permissionType: string
  action: string
  pattern?: string
  toolName?: string
  inputData?: Record<string, any>
  status: "pending" | "approved" | "denied"
  userResponse?: string
  responseMessage?: string
  timeCreated: number
  respondedAt?: number
  metadata?: Record<string, any>
}

export interface TrajectoryData {
  id: string
  sessionId: string
  rootMessageId?: string
  model?: string
  providerId?: string
  agent?: string
  title?: string
  description?: string
  status: "active" | "completed" | "failed" | "cancelled"
  totalSteps?: number
  totalToolCalls?: number
  totalSubtasks?: number
  totalCompactions?: number
  totalDurationMs?: number
  totalCost?: number
  totalTokensInput?: number
  totalTokensOutput?: number
  totalTokensReasoning?: number
  totalTokensCacheRead?: number
  totalTokensCacheWrite?: number
  totalFileReads?: number
  totalFileWrites?: number
  totalPatches?: number
  totalSnapshots?: number
  timeCreated: number
  timeCompleted?: number
  durationMs?: number
  qualityScore?: number
  efficiencyScore?: number
  metadata?: Record<string, any>
}

export interface CompleteTrajectoryData {
  session: SessionData
  messages: MessageData[]
  parts: MessagePartData[]
  textParts?: any[]
  reasoningChains: ReasoningChainData[]
  toolCalls: ToolCallData[]
  attachments: ToolAttachmentData[]
  fileOperations: FileOperationData[]
  snapshots: SnapshotData[]
  patches: PatchData[]
  steps: StepData[]
  subtasks: SubtaskData[]
  compactions: SessionCompactionData[]
  retries: RetryData[]
  trajectory?: TrajectoryData
}

export class TrajectoryStorage {
  private _pool: ReturnType<typeof getPool> | null = null

  private get pool() {
    if (!this._pool) {
      this._pool = getPool()
    }
    return this._pool
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
    `

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
    ])

    return result.rows[0].id
  }

  async getSession(sessionId: string): Promise<any> {
    const result = await this.pool.query("SELECT * FROM sessions WHERE id = $1", [sessionId])
    return result.rows[0] || null
  }

  async updateSessionSystemPrompt(sessionId: string, systemPrompt: string): Promise<void> {
    const query = `
      UPDATE sessions SET
        system_prompt = $2,
        updated_at = NOW()
      WHERE id = $1
    `
    await this.pool.query(query, [sessionId, systemPrompt])
  }

  async updateSessionSummary(
    sessionId: string,
    data: {
      title?: string
      description?: string
      totalSteps?: number
      totalToolCalls?: number
      totalDurationMs?: number
    },
  ): Promise<void> {
    const updates: string[] = []
    const values: any[] = [sessionId]
    let paramIndex = 2

    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`)
      values.push(data.title)
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`)
      values.push(data.description)
    }
    if (data.totalSteps !== undefined) {
      updates.push(`total_steps = $${paramIndex++}`)
      values.push(data.totalSteps)
    }
    if (data.totalToolCalls !== undefined) {
      updates.push(`total_tool_calls = $${paramIndex++}`)
      values.push(data.totalToolCalls)
    }
    if (data.totalDurationMs !== undefined) {
      updates.push(`duration_ms = $${paramIndex++}`)
      values.push(data.totalDurationMs)
    }

    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`)
      const query = `UPDATE sessions SET ${updates.join(", ")} WHERE id = $1`
      await this.pool.query(query, values)
    }
  }

  async createLlmMessages(sessionId: string, messages: any[]): Promise<void> {
    // Check if session exists
    const sessionCheck = await this.pool.query("SELECT id FROM sessions WHERE id = $1", [sessionId])
    if (sessionCheck.rows.length === 0) {
      return // Skip if session doesn't exist
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      // Try to find corresponding message in messages table
      let messageId = msg.messageId || msg.id || null
      let model = msg.model || null
      let providerId = msg.providerId || msg.provider_id || null
      let toolName = msg.toolName || msg.tool_name || null
      let toolCallId = msg.toolCallId || msg.tool_call_id || null
      let toolCalls = msg.toolCalls || msg.tool_calls || null

      // If no messageId, try to find by content and role
      if (!messageId && msg.content) {
        const msgCheck = await this.pool.query(
          "SELECT id, model, provider_id FROM messages WHERE session_id = $1 AND role = $2 AND content = $3 ORDER BY time_created DESC LIMIT 1",
          [sessionId, msg.role || "user", typeof msg.content === "string" ? msg.content.substring(0, 100) : ""],
        )
        if (msgCheck.rows.length > 0) {
          messageId = msgCheck.rows[0].id
          model = model || msgCheck.rows[0].model
          providerId = providerId || msgCheck.rows[0].provider_id
        }
      }

      const query = `
        INSERT INTO llm_messages (id, session_id, message_id, role, content, name, tool_calls, tool_call_id, tool_name, model, provider_id, time_created, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO NOTHING
      `
      await this.pool.query(query, [
        msg.id || uuidv4(),
        sessionId,
        messageId,
        msg.role || "user",
        typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        msg.name || null,
        toolCalls ? JSON.stringify(toolCalls) : null,
        toolCallId,
        toolName,
        model,
        providerId,
        msg.timeCreated || Date.now(),
        JSON.stringify(msg.metadata || {}),
      ])
    }
  }

  async createMessage(data: MessageData): Promise<string> {
    // Check if session exists, if not set session_id to NULL
    let sessionId = data.sessionId
    if (sessionId) {
      const checkResult = await this.pool.query("SELECT id FROM sessions WHERE id = $1", [sessionId])
      if (checkResult.rows.length === 0) {
        sessionId = null
      }
    }

    const query = `
      INSERT INTO messages (
        id, session_id, branch_id, parent_id, role, content,
        model, provider_id, agent, variant, system_prompt,
        finish_reason, error,
        cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
        path_cwd, path_root,
        summary_title, summary_body,
        time_created, time_completed,
        step_order, is_summary,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
      ON CONFLICT (id) DO UPDATE SET
        session_id = COALESCE($2, messages.session_id),
        branch_id = COALESCE($3, messages.branch_id),
        parent_id = COALESCE($4, messages.parent_id),
        content = $6,
        model = COALESCE($7, messages.model),
        provider_id = COALESCE($8, messages.provider_id),
        agent = COALESCE($9, messages.agent),
        variant = COALESCE($10, messages.variant),
        system_prompt = COALESCE($11, messages.system_prompt),
        finish_reason = COALESCE($12, messages.finish_reason),
        error = COALESCE($13, messages.error),
        cost = COALESCE($14, messages.cost),
        tokens_input = COALESCE($15, messages.tokens_input),
        tokens_output = COALESCE($16, messages.tokens_output),
        tokens_reasoning = COALESCE($17, messages.tokens_reasoning),
        tokens_cache_read = COALESCE($18, messages.tokens_cache_read),
        tokens_cache_write = COALESCE($19, messages.tokens_cache_write),
        path_cwd = COALESCE($20, messages.path_cwd),
        path_root = COALESCE($21, messages.path_root),
        summary_title = COALESCE($22, messages.summary_title),
        summary_body = COALESCE($23, messages.summary_body),
        time_created = $24,
        time_completed = COALESCE($25, messages.time_completed),
        step_order = COALESCE($26, messages.step_order),
        is_summary = COALESCE($27, messages.is_summary),
        metadata = COALESCE($28, messages.metadata)::jsonb,
        updated_at = NOW()
      RETURNING id
    `

    const result = await this.pool.query(query, [
      data.id,
      sessionId,
      data.branchId || null,
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
    ])

    return result.rows[0].id
  }

  async getMessagesBySession(sessionId: string): Promise<any[]> {
    const result = await this.pool.query("SELECT * FROM messages WHERE session_id = $1 ORDER BY time_created ASC", [
      sessionId,
    ])
    return result.rows
  }

  async createReasoningChain(data: ReasoningChainData): Promise<string> {
    // Skip validation, let the foreign key constraint handle nullification
    // This ensures we don't lose data even if the message doesn't exist yet
    const sessionId = data.sessionId
    const messageId = data.messageId

    const query = `
      INSERT INTO reasoning_chains (id, session_id, branch_id, message_id, content, model, time_start, time_end, provider_metadata, part_order, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        content = $5,
        branch_id = COALESCE($3, reasoning_chains.branch_id),
        model = COALESCE($6, reasoning_chains.model),
        time_start = COALESCE($7, reasoning_chains.time_start),
        time_end = COALESCE($8, reasoning_chains.time_end),
        provider_metadata = COALESCE($9, reasoning_chains.provider_metadata),
        part_order = COALESCE($10, reasoning_chains.part_order),
        metadata = COALESCE($11, reasoning_chains.metadata)::jsonb
      RETURNING id
    `

    const result = await this.pool.query(query, [
      data.id,
      sessionId,
      data.branchId || null,
      messageId,
      data.content,
      data.model || null,
      data.timeStart,
      data.timeEnd || null,
      JSON.stringify(data.providerMetadata || {}),
      data.partOrder || 0,
      JSON.stringify(data.metadata || {}),
    ])

    return result.rows[0].id
  }

  async updateReasoningChain(
    id: string,
    data: {
      content?: string
      timeEnd?: number
      messageId?: string
    },
  ): Promise<void> {
    // Check if messageId is valid before updating
    let messageId = data.messageId
    if (messageId) {
      try {
        const checkResult = await this.pool.query("SELECT id FROM messages WHERE id = $1", [messageId])
        if (checkResult.rows.length === 0) {
          messageId = undefined
        }
      } catch {
        messageId = undefined
      }
    }

    const updates: string[] = []
    const values: any[] = [id]
    let paramIndex = 2

    if (data.content !== undefined) {
      updates.push(`content = $${paramIndex++}`)
      values.push(data.content)
    }
    if (data.timeEnd !== undefined) {
      updates.push(`time_end = $${paramIndex++}`)
      values.push(data.timeEnd)
    }
    if (messageId !== undefined) {
      updates.push(`message_id = $${paramIndex++}`)
      values.push(messageId)
    }

    if (updates.length > 0) {
      const query = `UPDATE reasoning_chains SET ${updates.join(", ")} WHERE id = $1`
      await this.pool.query(query, values)
    }
  }

  async createToolCall(data: ToolCallData): Promise<string> {
    // Skip validation, let the foreign key constraint handle nullification
    const sessionId = data.sessionId
    const messageId = data.messageId

    const query = `
      INSERT INTO tool_calls (
        id, session_id, branch_id, message_id, call_id, tool_name, input, output, raw_output, truncated,
        status, error_message, title, output_path,
        time_created, time_start, time_end, duration_ms, part_order, attachments, metadata,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        branch_id = COALESCE($3, tool_calls.branch_id),
        message_id = COALESCE($4, tool_calls.message_id),
        call_id = $5,
        tool_name = $6,
        input = $7,
        output = COALESCE($8, tool_calls.output),
        raw_output = COALESCE($9, tool_calls.raw_output),
        truncated = COALESCE($10, tool_calls.truncated),
        status = COALESCE($11, tool_calls.status),
        error_message = COALESCE($12, tool_calls.error_message),
        title = COALESCE($13, tool_calls.title),
        output_path = COALESCE($14, tool_calls.output_path),
        time_created = $15,
        time_start = COALESCE($16, tool_calls.time_start),
        time_end = COALESCE($17, tool_calls.time_end),
        duration_ms = COALESCE($18, tool_calls.duration_ms),
        part_order = COALESCE($19, tool_calls.part_order),
        attachments = COALESCE($20, tool_calls.attachments),
        metadata = COALESCE($21, tool_calls.metadata)::jsonb,
        updated_at = NOW()
      RETURNING id
    `

    const result = await this.pool.query(query, [
      data.id,
      sessionId,
      data.branchId || null,
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
    ])

    return result.rows[0].id
  }

  async updateToolCall(id: string, updates: Partial<ToolCallData>): Promise<void> {
    const setClauses: string[] = []
    const values: any[] = []
    let paramIndex = 1

    if (updates.output !== undefined) {
      setClauses.push(`output = $${paramIndex++}`)
      values.push(updates.output)
    }
    if (updates.rawOutput !== undefined) {
      setClauses.push(`raw_output = $${paramIndex++}`)
      values.push(updates.rawOutput)
    }
    if (updates.truncated !== undefined) {
      setClauses.push(`truncated = $${paramIndex++}`)
      values.push(updates.truncated)
    }
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`)
      values.push(updates.status)
    }
    if (updates.errorMessage !== undefined) {
      setClauses.push(`error_message = $${paramIndex++}`)
      values.push(updates.errorMessage)
    }
    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`)
      values.push(updates.title)
    }
    if (updates.durationMs !== undefined) {
      setClauses.push(`duration_ms = $${paramIndex++}`)
      values.push(updates.durationMs)
    }
    if (updates.timeEnd !== undefined) {
      setClauses.push(`time_end = $${paramIndex++}`)
      values.push(updates.timeEnd)
    }
    if (updates.attachments !== undefined) {
      setClauses.push(`attachments = $${paramIndex++}`)
      values.push(JSON.stringify(updates.attachments))
    }

    if (setClauses.length === 0) return

    values.push(id)
    await this.pool.query(`UPDATE tool_calls SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`, values)
  }

  async createStep(data: StepData): Promise<string> {
    // Skip validation, let the foreign key constraint handle nullification
    const sessionId = data.sessionId
    const messageId = data.messageId

    const query = `
      INSERT INTO steps (
        id, session_id, branch_id, message_id, step_type, step_order,
        content, input_data, output_data, snapshot_id, patch_id, tool_call_id,
        reason, status,
        tokens_input, tokens_output, tokens_reasoning, cost,
        time_start, time_end, duration_ms, step_group,
        metadata, created_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW())
      ON CONFLICT (id) DO UPDATE SET
        session_id = COALESCE($2, steps.session_id),
        branch_id = COALESCE($3, steps.branch_id),
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
    `

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.branchId || null,
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
      data.status || "active",
      data.tokensInput || 0,
      data.tokensOutput || 0,
      data.tokensReasoning || 0,
      data.cost || 0,
      data.timeStart,
      data.timeEnd || null,
      data.durationMs || null,
      data.stepGroup || null,
      JSON.stringify(data.metadata || {}),
    ])

    return result.rows[0].id
  }

  async updateStep(id: string, updates: Partial<StepData>): Promise<void> {
    const setClauses: string[] = []
    const values: any[] = []
    let paramIndex = 1

    if (updates.content !== undefined) {
      setClauses.push(`content = $${paramIndex++}`)
      values.push(updates.content)
    }
    if (updates.inputData !== undefined) {
      setClauses.push(`input_data = $${paramIndex++}`)
      values.push(JSON.stringify(updates.inputData))
    }
    if (updates.outputData !== undefined) {
      setClauses.push(`output_data = $${paramIndex++}`)
      values.push(JSON.stringify(updates.outputData))
    }
    if (updates.snapshotId !== undefined) {
      setClauses.push(`snapshot_id = $${paramIndex++}`)
      values.push(updates.snapshotId)
    }
    if (updates.patchId !== undefined) {
      setClauses.push(`patch_id = $${paramIndex++}`)
      values.push(updates.patchId)
    }
    if (updates.toolCallId !== undefined) {
      setClauses.push(`tool_call_id = $${paramIndex++}`)
      values.push(updates.toolCallId)
    }
    if (updates.reason !== undefined) {
      setClauses.push(`reason = $${paramIndex++}`)
      values.push(updates.reason)
    }
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`)
      values.push(updates.status)
    }
    if (updates.tokensInput !== undefined) {
      setClauses.push(`tokens_input = $${paramIndex++}`)
      values.push(updates.tokensInput)
    }
    if (updates.tokensOutput !== undefined) {
      setClauses.push(`tokens_output = $${paramIndex++}`)
      values.push(updates.tokensOutput)
    }
    if (updates.tokensReasoning !== undefined) {
      setClauses.push(`tokens_reasoning = $${paramIndex++}`)
      values.push(updates.tokensReasoning)
    }
    if (updates.cost !== undefined) {
      setClauses.push(`cost = $${paramIndex++}`)
      values.push(updates.cost)
    }
    if (updates.timeEnd !== undefined) {
      setClauses.push(`time_end = $${paramIndex++}`)
      values.push(updates.timeEnd)
    }
    if (updates.durationMs !== undefined) {
      setClauses.push(`duration_ms = $${paramIndex++}`)
      values.push(updates.durationMs)
    }
    if (updates.stepGroup !== undefined) {
      setClauses.push(`step_group = $${paramIndex++}`)
      values.push(updates.stepGroup)
    }
    if (updates.metadata !== undefined) {
      setClauses.push(`metadata = $${paramIndex++}`)
      values.push(JSON.stringify(updates.metadata))
    }

    if (setClauses.length === 0) return

    values.push(id)
    await this.pool.query(`UPDATE steps SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`, values)
  }

  async createTrajectory(data: TrajectoryData): Promise<string> {
    // trajectories table removed - no-op
    return data.id || ""
  }

  async getSessionComplete(sessionId: string): Promise<any> {
    const result = await this.pool.query("SELECT * FROM sessions WHERE id = $1", [sessionId])
    return result.rows[0] || null
  }

  async getSessionWithDetails(sessionId: string): Promise<CompleteTrajectoryData | null> {
    const sessionResult = await this.pool.query("SELECT * FROM sessions WHERE id = $1", [sessionId])

    if (sessionResult.rows.length === 0) {
      return null
    }

    const session = sessionResult.rows[0]

    const [messagesResult, reasoningResult, toolCallsResult, stepsResult] = await Promise.all([
      this.pool.query("SELECT * FROM messages WHERE session_id = $1 ORDER BY time_created", [sessionId]),
      this.pool.query(`SELECT rc.* FROM reasoning_chains rc WHERE rc.session_id = $1 ORDER BY rc.time_start`, [
        sessionId,
      ]),
      this.pool.query(`SELECT tc.* FROM tool_calls tc WHERE tc.session_id = $1 ORDER BY tc.time_created`, [sessionId]),
      this.pool.query(`SELECT s.* FROM steps s WHERE s.session_id = $1 ORDER BY s.step_order`, [sessionId]),
    ])

    return {
      session: sessionResult.rows[0],
      messages: messagesResult.rows,
      reasoningChains: reasoningResult.rows,
      toolCalls: toolCallsResult.rows,
      steps: stepsResult.rows,
      trajectory,
    } as any
  }

  async storeCompleteTrajectory(data: CompleteTrajectoryData): Promise<string> {
    const sessionId = data.session?.id || ""

    // Update session with trajectory data
    if (sessionId) {
      await this.updateSessionSummary(sessionId, {
        title: data.trajectory?.title,
        description: data.trajectory?.description,
        totalSteps: data.steps?.length || 0,
        totalToolCalls: data.toolCalls?.length || 0,
        totalDurationMs: data.trajectory?.totalDurationMs,
      })
    }

    // Store messages
    for (const message of data.messages || []) {
      await this.createMessage(message)
    }

    // Store message parts
    for (const part of data.parts || []) {
      await this.createMessagePart(part)
    }

    // Store reasoning chains
    for (const reasoning of data.reasoningChains || []) {
      await this.createReasoningChain(reasoning)
    }

    // Store tool calls
    for (const toolCall of data.toolCalls || []) {
      await this.createToolCall(toolCall)
    }

    // Store steps
    for (const step of data.steps || []) {
      await this.createStep(step)
    }

    return sessionId
  }

  async createMessagePart(data: MessagePartData): Promise<string> {
    // Check if message exists, if not set message_id to NULL due to foreign key constraint
    let messageId = data.messageId
    if (messageId) {
      try {
        const checkResult = await this.pool.query("SELECT id FROM messages WHERE id = $1", [messageId])
        if (checkResult.rows.length === 0) {
          messageId = null
        }
      } catch {
        messageId = null
      }
    }

    // Check if session exists
    let sessionId = data.sessionId
    if (sessionId) {
      try {
        const checkResult = await this.pool.query("SELECT id FROM sessions WHERE id = $1", [sessionId])
        if (checkResult.rows.length === 0) {
          sessionId = null
        }
      } catch {
        sessionId = null
      }
    }

    const query = `
      INSERT INTO message_parts (id, session_id, branch_id, message_id, part_type, content, part_order, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `

    const result = await this.pool.query(query, [
      data.id,
      sessionId,
      data.branchId || null,
      messageId,
      data.partType,
      data.content || null,
      data.partOrder,
      JSON.stringify(data.metadata || {}),
    ])

    return result.rows[0].id
  }

  async storeTrajectoryWithEmbeddings(data: CompleteTrajectoryData): Promise<string> {
    const sessionId = data.session?.id || ""

    if (!isAIEnabled()) {
      logger.debug("AI features are disabled, skipping embedding storage")
      return sessionId
    }

    try {
      for (const message of data.messages) {
        if (message.content && message.content.length > 10) {
          const embedding = await generateEmbedding(message.content)
          await storeEmbedding("message", message.id, message.content, embedding)
        }
      }

      for (const step of data.steps) {
        if (step.content && step.content.length > 10) {
          const embedding = await generateEmbedding(step.content)
          await storeEmbedding("step", step.id, step.content, embedding)
        }
      }

      for (const toolCall of data.toolCalls) {
        const combinedContent = `${toolCall.toolName} ${JSON.stringify(toolCall.input)}`
        if (combinedContent.length > 10) {
          const embedding = await generateEmbedding(combinedContent)
          await storeEmbedding("tool_call", toolCall.id, combinedContent, embedding)
        }
      }
    } catch (error) {
      logger.error("failed to store embeddings for session", { error })
    }

    return sessionId
  }

  async searchSimilarContent(
    query: string,
    options: { limit?: number; entityType?: string } = {},
  ): Promise<Array<{ id: string; entity_type: string; entity_id: string; content: string; similarity: number }>> {
    if (!isAIEnabled()) {
      logger.warn("AI features are disabled, search will return empty results")
      return []
    }

    const queryEmbedding = await generateEmbedding(query)
    return searchSimilarEmbeddings(queryEmbedding, options.entityType, { limit: options.limit || 10 })
  }

  async getToolCallsBySession(sessionId: string): Promise<any[]> {
    const result = await this.pool.query(
      `
      SELECT tc.* FROM tool_calls tc
      JOIN messages m ON tc.message_id = m.id
      WHERE m.session_id = $1
      ORDER BY tc.time_created ASC
    `,
      [sessionId],
    )
    return result.rows
  }

  async getStepsBySession(sessionId: string): Promise<any[]> {
    const result = await this.pool.query(
      `
      SELECT s.* FROM steps s
      WHERE s.session_id = $1
      ORDER BY s.step_order ASC
    `,
      [sessionId],
    )
    return result.rows
  }

  async getReasoningChainsBySession(sessionId: string): Promise<any[]> {
    const result = await this.pool.query(
      `
      SELECT rc.* FROM reasoning_chains rc
      JOIN messages m ON rc.message_id = m.id
      WHERE m.session_id = $1
      ORDER BY rc.time_start ASC
    `,
      [sessionId],
    )
    return result.rows
  }

  async createExecutionLog(data: ExecutionLogData): Promise<number> {
    const query = `
      INSERT INTO execution_logs (session_id, step_id, tool_call_id, log_level, source, message, data, time_created)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `

    const result = await this.pool.query(query, [
      data.sessionId,
      data.stepId || null,
      data.toolCallId || null,
      data.logLevel,
      data.source || null,
      data.message,
      JSON.stringify(data.data || {}),
      data.timeCreated,
    ])

    return result.rows[0].id
  }

  async createApiCallLog(data: ApiCallLogData): Promise<number> {
    const query = `
      INSERT INTO api_call_logs (message_id, provider_id, model_id, endpoint, request_body, response_body, status_code, latency_ms, cost, tokens_input, tokens_output, error_message, error_code, time_created, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id
    `

    const result = await this.pool.query(query, [
      data.messageId || null,
      data.providerId,
      data.modelId || null,
      data.endpoint || null,
      JSON.stringify(data.requestBody || {}),
      JSON.stringify(data.responseBody || {}),
      data.statusCode || null,
      data.latencyMs || null,
      data.cost || 0,
      data.tokensInput || 0,
      data.tokensOutput || 0,
      data.errorMessage || null,
      data.errorCode || null,
      data.timeCreated,
      JSON.stringify(data.metadata || {}),
    ])

    return result.rows[0].id
  }

  async createCostStatistic(data: CostStatisticData): Promise<number> {
    const query = `
      INSERT INTO cost_statistics (session_id, provider_id, model_id, cost_input, cost_output, cost_cache_read, cost_cache_write, cost_reasoning, total_cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, api_calls, period_start, period_end, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING id
    `

    const result = await this.pool.query(query, [
      data.sessionId,
      data.providerId || null,
      data.modelId || null,
      data.costInput || 0,
      data.costOutput || 0,
      data.costCacheRead || 0,
      data.costCacheWrite || 0,
      data.costReasoning || 0,
      data.totalCost || 0,
      data.tokensInput || 0,
      data.tokensOutput || 0,
      data.tokensReasoning || 0,
      data.tokensCacheRead || 0,
      data.tokensCacheWrite || 0,
      data.apiCalls || 0,
      data.periodStart,
      data.periodEnd || null,
      JSON.stringify(data.metadata || {}),
    ])

    return result.rows[0].id
  }

  async createPermissionRequest(data: PermissionRequestData): Promise<string> {
    const query = `
      INSERT INTO permission_requests (id, session_id, permission_type, action, pattern, tool_name, input_data, status, user_response, response_message, time_created, responded_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE SET
        status = COALESCE($8, permission_requests.status),
        user_response = COALESCE($9, permission_requests.user_response),
        response_message = COALESCE($10, permission_requests.response_message),
        responded_at = COALESCE($12, permission_requests.responded_at),
        metadata = COALESCE($13, permission_requests.metadata)::jsonb
      RETURNING id
    `

    const id = data.id || uuidv4()
    const result = await this.pool.query(query, [
      id,
      data.sessionId,
      data.permissionType,
      data.action,
      data.pattern || null,
      data.toolName || null,
      JSON.stringify(data.inputData || {}),
      data.status,
      data.userResponse || null,
      data.responseMessage || null,
      data.timeCreated,
      data.respondedAt || null,
      JSON.stringify(data.metadata || {}),
    ])

    return result.rows[0].id
  }

  async createFileOperation(data: FileOperationData): Promise<string> {
    // file_operations table removed from schema - no-op
    return data.id || ""
  }

  async createSnapshot(data: SnapshotData): Promise<string> {
    // Skip validation, let the foreign key constraint handle nullification
    const sessionId = data.sessionId
    const messageId = data.messageId

    const query = `
      INSERT INTO snapshots (id, session_id, branch_id, message_id, step_id, snapshot_hash, working_directory, file_count, file_list, time_created, snapshot_order, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      ON CONFLICT (id) DO UPDATE SET
        branch_id = COALESCE($3, snapshots.branch_id),
        message_id = COALESCE($4, snapshots.message_id),
        step_id = COALESCE($5, snapshots.step_id),
        snapshot_hash = COALESCE($6, snapshots.snapshot_hash),
        working_directory = COALESCE($7, snapshots.working_directory),
        file_count = COALESCE($8, snapshots.file_count),
        file_list = COALESCE($9, snapshots.file_list),
        snapshot_order = COALESCE($11, snapshots.snapshot_order),
        metadata = COALESCE($12, snapshots.metadata)::jsonb
      RETURNING id
    `

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.branchId || null,
      messageId,
      data.stepId || null,
      data.snapshotHash,
      data.workingDirectory || null,
      data.fileCount || 0,
      JSON.stringify(data.fileList || []),
      data.timeCreated,
      data.snapshotOrder || 0,
      JSON.stringify(data.metadata || {}),
    ])

    return result.rows[0].id
  }

  async createPatch(data: PatchData): Promise<string> {
    // Check if message exists, if not set message_id to NULL due to foreign key constraint
    let messageId = data.messageId
    if (messageId) {
      try {
        const checkResult = await this.pool.query("SELECT id FROM messages WHERE id = $1", [messageId])
        if (checkResult.rows.length === 0) {
          messageId = null
        }
      } catch {
        messageId = null
      }
    }

    const query = `
      INSERT INTO patches (id, session_id, branch_id, message_id, step_id, patch_hash, file_path, file_diff, additions, deletions, diff_stats, original_content, patched_content, time_created, patch_order, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      ON CONFLICT (id) DO UPDATE SET
        branch_id = COALESCE($3, patches.branch_id),
        message_id = COALESCE($4, patches.message_id),
        step_id = COALESCE($5, patches.step_id),
        patch_hash = COALESCE($6, patches.patch_hash),
        file_path = COALESCE($7, patches.file_path),
        file_diff = COALESCE($8, patches.file_diff),
        additions = COALESCE($9, patches.additions),
        deletions = COALESCE($10, patches.deletions),
        diff_stats = COALESCE($11, patches.diff_stats),
        original_content = COALESCE($12, patches.original_content),
        patched_content = COALESCE($13, patches.patched_content),
        time_created = COALESCE($14, patches.time_created),
        patch_order = COALESCE($15, patches.patch_order),
        metadata = COALESCE($16, patches.metadata)::jsonb
      RETURNING id
    `

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.branchId || null,
      messageId,
      data.stepId || null,
      data.patchHash,
      data.filePath,
      data.fileDiff || null,
      data.additions || 0,
      data.deletions || 0,
      JSON.stringify(data.diffStats || {}),
      data.originalContent || null,
      data.patchedContent || null,
      data.timeCreated,
      data.patchOrder || 0,
      JSON.stringify(data.metadata || {}),
    ])

    return result.rows[0].id
  }

  async createSessionCompaction(data: SessionCompactionData): Promise<string> {
    const query = `
      INSERT INTO session_compactions (id, session_id, model, provider_id, summary, tokens_before, tokens_after, time_created)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        model = COALESCE($3, session_compactions.model),
        provider_id = COALESCE($4, session_compactions.provider_id),
        summary = COALESCE($5, session_compactions.summary),
        tokens_before = COALESCE($6, session_compactions.tokens_before),
        tokens_after = COALESCE($7, session_compactions.tokens_after)
      RETURNING id
    `

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.model || null,
      data.providerId || null,
      data.summary || null,
      data.tokensBefore || null,
      data.tokensAfter || null,
      data.timeCreated,
    ])

    return result.rows[0].id
  }

  async createToolAttachment(data: ToolAttachmentData): Promise<string> {
    // Skip validation, let the foreign key constraint handle nullification
    const sessionId = data.sessionId
    const messageId = data.messageId

    const query = `
      INSERT INTO tool_attachments (id, session_id, branch_id, message_id, tool_call_id, filename, mime, url, source_type, source_path, source_range, time_created)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        branch_id = COALESCE($3, tool_attachments.branch_id),
        tool_call_id = COALESCE($5, tool_attachments.tool_call_id),
        filename = COALESCE($6, tool_attachments.filename),
        mime = COALESCE($7, tool_attachments.mime),
        url = COALESCE($8, tool_attachments.url),
        source_type = COALESCE($9, tool_attachments.source_type),
        source_path = COALESCE($10, tool_attachments.source_path),
        source_range = COALESCE($11, tool_attachments.source_range)
      RETURNING id
    `

    const result = await this.pool.query(query, [
      data.id,
      sessionId,
      data.branchId || null,
      messageId,
      data.toolCallId || null,
      data.filename,
      data.mime || null,
      data.url || null,
      data.sourceType || null,
      data.sourcePath || null,
      JSON.stringify(data.sourceRange || {}),
      data.timeCreated,
    ])

    return result.rows[0].id
  }

  async createRetry(data: RetryData): Promise<string> {
    const query = `
      INSERT INTO retries (id, session_id, message_id, attempt_number, error_name, error_message, error_details, error_stack, status, time_created, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        error_name = COALESCE($5, retries.error_name),
        error_message = COALESCE($6, retries.error_message),
        error_details = COALESCE($7, retries.error_details),
        error_stack = COALESCE($8, retries.error_stack),
        status = COALESCE($9, retries.status),
        metadata = COALESCE($11, retries.metadata)::jsonb
      RETURNING id
    `

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.messageId,
      data.attemptNumber,
      data.errorName || null,
      data.errorMessage || null,
      JSON.stringify(data.errorDetails || {}),
      data.errorStack || null,
      data.status || "pending",
      data.timeCreated,
      JSON.stringify(data.metadata || {}),
    ])

    return result.rows[0].id
  }

  async createBranchSelection(data: BranchSelectionData): Promise<string> {
    const query = `
      INSERT INTO branch_selections (id, session_id, winner_branch_id, winner_strategy, all_branches, scores, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        winner_branch_id = COALESCE($3, branch_selections.winner_branch_id),
        winner_strategy = COALESCE($4, branch_selections.winner_strategy),
        all_branches = COALESCE($5, branch_selections.all_branches),
        scores = COALESCE($6, branch_selections.scores),
        metadata = COALESCE($7, branch_selections.metadata)::jsonb
      RETURNING id
    `

    const result = await this.pool.query(query, [
      data.id,
      data.sessionId,
      data.winnerBranchId,
      data.winnerStrategy,
      JSON.stringify(data.allBranches),
      JSON.stringify(data.scores),
      JSON.stringify(data.metadata || {}),
    ])

    return result.rows[0].id
  }
}

export const trajectoryStorage = new TrajectoryStorage()
