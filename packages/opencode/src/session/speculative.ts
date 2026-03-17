import { Log } from "../util/log"
import { ulid } from "ulid"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { SessionProcessor } from "./processor"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { sessionTrajectoryTracker } from "./trajectory-integration"
import { Config } from "../config/config"
import { Instance } from "../project/instance"

const logger = Log.create({ service: "speculative" })

interface DaxfsApi {
  branch_create: (info: number, name: string, parent_name: string, out: { current: number | null }) => number
  branch_commit: (info: number, branch: number) => number
  branch_abort: (info: number, branch: number) => number
}

declare global {
  var daxfs: DaxfsApi | undefined
}

interface BranchManager {
  create(branchId: string): Promise<void>
  commit(branchId: string): Promise<void>
  abort(branchId: string): Promise<void>
}

class NoopBranchManager implements BranchManager {
  async create(_branchId: string): Promise<void> {}
  async commit(_branchId: string): Promise<void> {}
  async abort(_branchId: string): Promise<void> {}
}

class DaxfsBranchManager implements BranchManager {
  private daxfsApi: DaxfsApi
  private branches = new Map<string, number>()

  constructor() {
    this.daxfsApi = globalThis.daxfs as DaxfsApi
    if (!this.daxfsApi) {
      throw new Error("daxfs API not available")
    }
  }

  async create(branchId: string): Promise<void> {
    const out = { current: null }
    this.daxfsApi.branch_create(0, branchId, "main", out)
    if (out.current !== null) {
      this.branches.set(branchId, out.current)
    }
    logger.info("daxfs branch created", { branchId })
  }

  async commit(branchId: string): Promise<void> {
    const ctx = this.branches.get(branchId)
    if (ctx !== undefined) {
      this.daxfsApi.branch_commit(0, ctx)
      this.branches.delete(branchId)
    }
    logger.info("daxfs branch committed", { branchId })
  }

  async abort(branchId: string): Promise<void> {
    const ctx = this.branches.get(branchId)
    if (ctx !== undefined) {
      this.daxfsApi.branch_abort(0, ctx)
      this.branches.delete(branchId)
    }
    logger.info("daxfs branch aborted", { branchId })
  }
}

async function createBranchManager(): Promise<BranchManager> {
  const config = await Config.get()
  const branchMode = config.experimental?.speculative_branching ?? "filesystem"

  if (branchMode === "daxfs" && globalThis.daxfs) {
    return new DaxfsBranchManager()
  }

  return new NoopBranchManager()
}

interface Strategy {
  name: string
  description?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  toolPreference?: string[]
  agentMode?: string
  maxSteps?: number
  timeoutMs?: number
  stopOnError?: boolean
}

export type BranchStatus = "pending" | "initializing" | "running" | "completed" | "failed" | "aborted"

export interface BranchResult {
  success: boolean
  finishReason: "stop" | "compact" | "error" | "max_steps" | "aborted" | "timeout"
  toolCallCount: number
  tokenUsage: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  cost: number
  durationMs: number
  error?: string
  finalMessage?: MessageV2.Assistant
}

export interface BranchContext {
  id: string
  strategy: Strategy
  status: BranchStatus
  result?: BranchResult
  startTime: number
  endTime?: number
  error?: Error
}

export interface EvaluateOptions {
  weights?: {
    success: number
    efficiency: number
    speed: number
    trajectory?: number
  }
  requireSuccess?: boolean
  maxBranches?: number
}

export interface RunOptions extends EvaluateOptions {
  timeoutMs?: number
  earlyStopOnSuccess?: boolean
  parallel?: boolean
}

interface ProcessInput {
  user: MessageV2.User
  agent: Agent.Info
  messages: any[]
  system: string[]
  tools: Record<string, any>
  model: Provider.Model
  abort: AbortSignal
  sessionID: string
}

function generateDefaultStrategies(agent: Agent.Info): Strategy[] {
  const agentName = agent.name.toLowerCase()

  const strategySets: Record<string, Strategy[]> = {
    default: [
      {
        name: "conservative",
        description: "优先安全的工具调用，先验证再执行",
        systemPrompt: "优先使用安全的工具调用，先验证文件存在再修改，每步都检查结果。",
        temperature: 0.3,
        maxSteps: (agent.steps ?? 20) * 0.8,
      },
      {
        name: "aggressive",
        description: "快速完成任务，可以批量执行工具调用",
        systemPrompt: "优先快速完成任务，可以批量执行工具调用，减少等待时间。",
        temperature: 0.7,
        maxSteps: (agent.steps ?? 20) * 1.2,
      },
      {
        name: "balanced",
        description: "平衡效率与安全性",
        systemPrompt: "平衡效率与安全性，适当冒险但保持谨慎。",
        temperature: 0.5,
      },
    ],
    code: [
      {
        name: "minimal",
        description: "最小化修改，只做必要更改",
        systemPrompt: "最小化代码修改，只做必要的更改。优先读取现有代码，理解后再修改。",
        temperature: 0.2,
      },
      {
        name: "thorough",
        description: "全面检查，确保代码质量",
        systemPrompt: "全面检查代码，确保修改质量。运行测试，验证边界情况。",
        temperature: 0.4,
      },
    ],
    general: [
      {
        name: "fast",
        description: "快速响应，减少迭代",
        systemPrompt: "快速响应用户请求，减少不必要的迭代。",
        temperature: 0.6,
      },
      {
        name: "careful",
        description: "谨慎思考，每步验证",
        systemPrompt: "谨慎思考，每步都进行验证后再继续。",
        temperature: 0.3,
      },
    ],
  }

  for (const [key, strategies] of Object.entries(strategySets)) {
    if (agentName.includes(key)) {
      return strategies
    }
  }

  return strategySets.default
}

function normalizeOptions(options: RunOptions | undefined, strategies: Strategy[]): RunOptions {
  const maxBranches = options?.maxBranches ?? Math.min(strategies.length, 3)

  return {
    weights: {
      success: options?.weights?.success ?? 0.4,
      efficiency: options?.weights?.efficiency ?? 0.3,
      speed: options?.weights?.speed ?? 0.1,
      trajectory: options?.weights?.trajectory ?? 0.2,
    },
    requireSuccess: options?.requireSuccess ?? true,
    maxBranches,
    timeoutMs: options?.timeoutMs ?? 60000,
    earlyStopOnSuccess: options?.earlyStopOnSuccess ?? true,
    parallel: options?.parallel ?? true,
  }
}

function prepareBranchInput(input: ProcessInput, strategy: Strategy): ProcessInput {
  const modifiedInput: ProcessInput = {
    user: input.user,
    agent: input.agent,
    messages: input.messages,
    system: strategy.systemPrompt ? [...input.system, strategy.systemPrompt] : input.system,
    tools: input.tools,
    model: input.model,
    abort: input.abort,
    sessionID: input.sessionID,
  }

  return modifiedInput
}

function calculateBranchScore(branch: BranchContext, options: RunOptions): number {
  if (!branch.result) {
    return 0
  }

  const weights = options.weights ?? { success: 0.4, efficiency: 0.3, speed: 0.1, trajectory: 0.2 }

  const successScore = branch.result.success ? 1 : 0

  const totalTokens =
    branch.result.tokenUsage.input + branch.result.tokenUsage.output + branch.result.tokenUsage.reasoning
  const efficiencyScore = totalTokens > 0 ? Math.max(0, 1 - totalTokens / 100000) : 0.5

  const speedScore = branch.result.durationMs > 0 ? Math.max(0, 1 - branch.result.durationMs / 120000) : 0.5

  return weights.success * successScore + weights.efficiency * efficiencyScore + weights.speed * speedScore
}

async function executeSingleBranch(
  branch: BranchContext,
  input: ProcessInput,
  options: RunOptions,
  branchManager: BranchManager,
): Promise<BranchContext> {
  const startTime = Date.now()

  try {
    branch.status = "initializing"

    await branchManager.create(branch.id)

    sessionTrajectoryTracker.setBranch(branch.id)

    const branchInput = prepareBranchInput(input, branch.strategy)

    branch.status = "running"

    const timeoutMs = branch.strategy.timeoutMs ?? options.timeoutMs ?? 60000
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => {
      timeoutController.abort(new Error("Branch execution timeout"))
    }, timeoutMs)

    try {
      const combinedAbort = new AbortController()
      timeoutController.signal.addEventListener("abort", () => {
        combinedAbort.abort()
      })

      const processor = SessionProcessor.create({
        assistantMessage: (await Session.updateMessage({
          id: Identifier.ascending("message"),
          parentID: input.user.id,
          role: "assistant",
          mode: branch.strategy.agentMode ?? input.agent.name,
          agent: branch.strategy.agentMode ?? input.agent.name,
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: input.model.id,
          providerID: input.model.providerID,
          time: {
            created: Date.now(),
          },
          sessionID: input.sessionID,
        })) as MessageV2.Assistant,
        sessionID: input.sessionID,
        model: input.model,
        abort: combinedAbort.signal,
      })

      let result: "stop" | "compact" | "error" | "continue" = "continue"
      while (result === "continue") {
        result = await processor.process({
          user: input.user,
          agent: input.agent,
          abort: combinedAbort.signal,
          sessionID: input.sessionID,
          system: branchInput.system,
          messages: [...MessageV2.toModelMessages(branchInput.messages, input.model)],
          tools: input.tools as Record<string, any>,
          model: input.model,
        })
      }

      const isSuccess = result === "stop" || result === "compact"
      branch.result = {
        success: isSuccess,
        finishReason: result === "stop" ? "stop" : result === "compact" ? "compact" : "max_steps",
        toolCallCount: 0,
        tokenUsage: processor.message.tokens ?? {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        cost: processor.message.cost ?? 0,
        durationMs: Date.now() - startTime,
        finalMessage: processor.message,
      }

      branch.status = "completed"
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    branch.status = "failed"
    branch.error = error as Error
    branch.result = {
      success: false,
      finishReason: error instanceof Error && error.name === "AbortError" ? "timeout" : "error",
      toolCallCount: 0,
      tokenUsage: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      cost: 0,
      durationMs: Date.now() - startTime,
      error: (error as Error).message,
    }

    logger.error("branch execution failed", { branchId: branch.id, error })
  } finally {
    sessionTrajectoryTracker.setBranch(null)
    branch.endTime = Date.now()
  }

  return branch
}

function evaluateBranches(branches: BranchContext[], options: RunOptions): BranchContext {
  let bestBranch = branches[0]
  let bestScore = -1

  for (const branch of branches) {
    if (branch.status !== "completed" && branch.status !== "failed") {
      continue
    }

    const score = calculateBranchScore(branch, options)

    if (score > bestScore) {
      bestScore = score
      bestBranch = branch
    }
  }

  if (options.requireSuccess) {
    const successfulBranches = branches.filter((b) => b.result?.success)
    if (successfulBranches.length > 0) {
      let successfulBest = successfulBranches[0]
      let successfulBestScore = -1

      for (const branch of successfulBranches) {
        const score = calculateBranchScore(branch, options)
        if (score > successfulBestScore) {
          successfulBestScore = score
          successfulBest = branch
        }
      }

      return successfulBest
    }
  }

  return bestBranch
}

async function finalize(winner: BranchContext, losers: BranchContext[], branchManager: BranchManager): Promise<void> {
  for (const loser of losers) {
    try {
      await branchManager.abort(loser.id)
    } catch (error) {
      logger.error("failed to abort branch", { branchId: loser.id, error })
    }
  }

  try {
    await branchManager.commit(winner.id)
  } catch (error) {
    logger.error("failed to commit branch", { branchId: winner.id, error })
  }
}

export async function run(
  sessionID: string,
  input: ProcessInput,
  strategies?: Strategy[],
  options?: RunOptions,
): Promise<BranchContext> {
  const actualStrategies = strategies && strategies.length > 0 ? strategies : generateDefaultStrategies(input.agent)

  const opts = normalizeOptions(options, actualStrategies)

  const branchManager = await createBranchManager()

  const branches: BranchContext[] = actualStrategies.slice(0, opts.maxBranches).map((strategy) => ({
    id: `speculative-${ulid()}-${strategy.name}`,
    strategy,
    status: "pending" as BranchStatus,
    startTime: 0,
  }))

  let completedBranches: BranchContext[]

  if (opts.parallel) {
    const branchPromises = branches.map((branch) =>
      executeSingleBranch(branch, input, { ...opts, earlyStopOnSuccess: false }, branchManager),
    )

    completedBranches = await Promise.all(branchPromises)
  } else {
    completedBranches = []
    for (const branch of branches) {
      const result = await executeSingleBranch(branch, input, opts, branchManager)
      completedBranches.push(result)

      if (opts.earlyStopOnSuccess && result.result?.success) {
        for (const other of branches) {
          if (other.id !== branch.id && other.status === "pending") {
            other.status = "aborted"
          }
        }
        break
      }
    }
  }

  const allFailed = completedBranches.every((b) => b.status === "failed")
  if (allFailed) {
    logger.error("all speculative branches failed, falling back to sequential", { sessionID })
    throw new Error("All speculative branches failed")
  }

  const winner = evaluateBranches(completedBranches, opts)

  const losers = completedBranches.filter((b) => b.id !== winner.id)

  await finalize(winner, losers, branchManager)

  if (sessionTrajectoryTracker.isEnabled()) {
    try {
      await sessionTrajectoryTracker.captureBranchSelection({
        sessionId: sessionID,
        winnerBranchId: winner.id,
        winnerStrategy: winner.strategy.name,
        allBranches: completedBranches.map((b) => ({
          id: b.id,
          name: b.strategy.name,
          status: b.status,
          success: b.result?.success ?? false,
          durationMs: b.result?.durationMs ?? 0,
        })),
        scores: Object.fromEntries(completedBranches.map((b) => [b.id, calculateBranchScore(b, opts)])),
      })
    } catch (error) {
      logger.error("failed to capture branch selection", { error })
    }
  }

  logger.info("speculative execution completed", {
    sessionID,
    winnerBranchId: winner.id,
    winnerStrategy: winner.strategy.name,
  })

  return winner
}

export const speculativeRun = run
