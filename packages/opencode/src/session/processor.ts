import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/config/config"
import { SessionCompaction } from "./compaction"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { sessionTrajectoryTracker } from "./trajectory-integration"

const logger = Log.create({ service: "session-processor" })

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0
    let needsCompaction = false
    let currentStepId: string | undefined

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput) {
        log.info("process")
        needsCompaction = false
        const shouldBreak = (await Config.get()).experimental?.continue_loop_on_deny !== true

        if (sessionTrajectoryTracker.isEnabled()) {
          await sessionTrajectoryTracker.startSessionIfNeeded(input.sessionID, input.assistantMessage.id, {
            directory: streamInput.sessionID,
          })
        }

        while (true) {
          try {
            let currentText: MessageV2.TextPart | undefined
            let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}
            const stream = await LLM.stream(streamInput)

            for await (const value of stream.fullStream) {
              input.abort.throwIfAborted()
              switch (value.type) {
                case "start":
                  SessionStatus.set(input.sessionID, { type: "busy" })
                  break

                case "reasoning-start":
                  if (value.id in reasoningMap) {
                    continue
                  }
                  reasoningMap[value.id] = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "reasoning",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  if (sessionTrajectoryTracker.isEnabled()) {
                    await sessionTrajectoryTracker.handleReasoningStart(
                      input.assistantMessage.id,
                      value.id,
                      value.providerMetadata,
                    )
                  }
                  break

                case "reasoning-delta":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text += value.text
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    if (part.text) await Session.updatePart({ part, delta: value.text })
                    if (sessionTrajectoryTracker.isEnabled()) {
                      await sessionTrajectoryTracker.handleReasoningDelta(value.id, value.text)
                    }
                  }
                  break

                case "reasoning-end":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text = part.text.trimEnd()

                    part.time = {
                      ...part.time,
                      end: Date.now(),
                    }
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    await Session.updatePart(part)
                    if (sessionTrajectoryTracker.isEnabled()) {
                      await sessionTrajectoryTracker.handleReasoningEnd(input.assistantMessage.id, value.id)
                    }
                    delete reasoningMap[value.id]
                  }
                  break

                case "tool-input-start":
                  const part = await Session.updatePart({
                    id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "tool",
                    tool: value.toolName,
                    callID: value.id,
                    state: {
                      status: "pending",
                      input: {},
                      raw: "",
                    },
                  })
                  toolcalls[value.id] = part as MessageV2.ToolPart
                  break

                case "tool-input-delta":
                  break

                case "tool-input-end":
                  break

                case "tool-call": {
                  const match = toolcalls[value.toolCallId]
                  if (match) {
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state: {
                        status: "running",
                        input: value.input,
                        time: {
                          start: Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    })
                    toolcalls[value.toolCallId] = part as MessageV2.ToolPart

                    if (sessionTrajectoryTracker.isEnabled()) {
                      await sessionTrajectoryTracker.handleToolCallStart(
                        input.assistantMessage.id,
                        value.toolCallId,
                        value.toolName,
                        value.input,
                        value.toolCallId,
                      )
                    }

                    const parts = await MessageV2.parts(input.assistantMessage.id)
                    const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)

                    if (
                      lastThree.length === DOOM_LOOP_THRESHOLD &&
                      lastThree.every(
                        (p) =>
                          p.type === "tool" &&
                          p.tool === value.toolName &&
                          p.state.status !== "pending" &&
                          JSON.stringify(p.state.input) === JSON.stringify(value.input),
                      )
                    ) {
                      const agent = await Agent.get(input.assistantMessage.agent)
                      await PermissionNext.ask({
                        permission: "doom_loop",
                        patterns: [value.toolName],
                        sessionID: input.assistantMessage.sessionID,
                        metadata: {
                          tool: value.toolName,
                          input: value.input,
                        },
                        always: [value.toolName],
                        ruleset: agent.permission,
                      })
                    }
                  }
                  break
                }
                case "tool-result": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "completed",
                        input: value.input ?? match.state.input,
                        output: value.output.output,
                        metadata: value.output.metadata,
                        title: value.output.title,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                        attachments: value.output.attachments,
                      },
                    })

                    if (sessionTrajectoryTracker.isEnabled()) {
                      await sessionTrajectoryTracker.handleToolCallResult(
                        input.assistantMessage.id,
                        value.toolCallId,
                        value.output.output,
                        "completed",
                      )
                      // Capture tool attachments
                      if (value.output.attachments?.length) {
                        for (const attachment of value.output.attachments) {
                          await sessionTrajectoryTracker.captureToolAttachment({
                            messageId: input.assistantMessage.id,
                            toolCallId: value.toolCallId,
                            filename: attachment.filename,
                            mime: attachment.mime,
                            url: attachment.url,
                            sourceType: attachment.source?.type,
                            sourcePath: attachment.source?.path,
                            sourceRange: attachment.source?.range,
                          })
                        }
                      }
                    }

                    delete toolcalls[value.toolCallId]
                  }
                  break
                }

                case "tool-error": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "error",
                        input: value.input ?? match.state.input,
                        error: (value.error as any).toString(),
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                      },
                    })

                    if (sessionTrajectoryTracker.isEnabled()) {
                      await sessionTrajectoryTracker.handleToolCallError(
                        input.assistantMessage.id,
                        value.toolCallId,
                        (value.error as any).toString(),
                      )
                    }

                    if (
                      value.error instanceof PermissionNext.RejectedError ||
                      value.error instanceof Question.RejectedError
                    ) {
                      blocked = shouldBreak
                    }
                    delete toolcalls[value.toolCallId]
                  }
                  break
                }
                case "error":
                  if (sessionTrajectoryTracker.isEnabled()) {
                    await sessionTrajectoryTracker.handleError(
                      input.assistantMessage.id,
                      value.error?.message || String(value.error),
                      value.error?.stack,
                    )
                  }
                  throw value.error

                case "start-step":
                  snapshot = await Snapshot.track()
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    snapshot,
                    type: "step-start",
                  })
                  if (sessionTrajectoryTracker.isEnabled()) {
                    currentStepId = await sessionTrajectoryTracker.captureStepStart(
                      input.assistantMessage.id,
                      value.stepId,
                    )
                    await sessionTrajectoryTracker.captureSnapshot({
                      messageId: input.assistantMessage.id,
                      stepId: value.stepId,
                      snapshotHash: snapshot?.hash || "",
                      workingDirectory: input.assistantMessage.path.cwd,
                      fileCount: snapshot?.files?.length || 0,
                      fileList: snapshot?.files?.map((f) => f.path) || [],
                    })
                  }
                  break

                case "finish-step":
                  const usage = Session.getUsage({
                    model: input.model,
                    usage: value.usage,
                    metadata: value.providerMetadata,
                  })
                  input.assistantMessage.finish = value.finishReason
                  input.assistantMessage.cost += usage.cost
                  input.assistantMessage.tokens = usage.tokens
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    reason: value.finishReason,
                    snapshot: await Snapshot.track(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "step-finish",
                    tokens: usage.tokens,
                    cost: usage.cost,
                  })
                  await Session.updateMessage(input.assistantMessage)
                  // Capture assistant message with complete metadata
                  if (sessionTrajectoryTracker.isEnabled()) {
                    const parts = await MessageV2.parts(input.assistantMessage.id)
                    // Get text content from parts
                    const textContent =
                      parts
                        .filter((p) => p.type === "text")
                        .map((p) => (p as any).text || (p as any).content || "")
                        .join("\n") ||
                      input.assistantMessage.summary?.body ||
                      ""

                    logger.info("capturing assistant message details", {
                      messageId: input.assistantMessage.id,
                      partsCount: parts.length,
                      textContentLength: textContent.length,
                    })

                    await sessionTrajectoryTracker.captureAssistantMessage(input.assistantMessage.id, textContent, {
                      agent: input.assistantMessage.agent,
                      parentId: input.assistantMessage.parentID,
                      model: input.model.id,
                      providerId: input.model.providerID,
                      finishReason: value.finishReason,
                      cost: usage.cost,
                      tokensInput: usage.tokens.input,
                      tokensOutput: usage.tokens.output,
                      tokensReasoning: usage.tokens.reasoning,
                    })
                    // Capture message parts
                    for (const part of parts) {
                      await sessionTrajectoryTracker.captureMessagePart(input.assistantMessage.id, {
                        partType: part.type,
                        content: (part as any).text || (part as any).content || "",
                        partOrder: part.index,
                        metadata: {
                          tool: (part as any).tool,
                          input: (part as any).input,
                          status: (part as any).state?.status,
                        },
                      })
                    }
                    // Capture cost statistics
                    await sessionTrajectoryTracker.captureCostStatistic({
                      providerId: input.model.provider,
                      modelId: input.model.id,
                      costInput: usage.costInput,
                      costOutput: usage.costOutput,
                      costReasoning: usage.costReasoning,
                      totalCost: usage.cost,
                      tokensInput: usage.tokens.input,
                      tokensOutput: usage.tokens.output,
                      tokensReasoning: usage.tokens.reasoning,
                      tokensCacheRead: usage.tokens.cache.read,
                      tokensCacheWrite: usage.tokens.cache.write,
                      apiCalls: 1,
                    })
                  }
                  if (sessionTrajectoryTracker.isEnabled() && currentStepId) {
                    // First capture snapshot if exists
                    if (snapshot) {
                      const patch = await Snapshot.patch(snapshot)
                      if (patch.files.length) {
                        await Session.updatePart({
                          id: Identifier.ascending("part"),
                          messageID: input.assistantMessage.id,
                          sessionID: input.sessionID,
                          type: "patch",
                          hash: patch.hash,
                          files: patch.files,
                        })
                        if (sessionTrajectoryTracker.isEnabled()) {
                          for (const file of patch.files) {
                            await sessionTrajectoryTracker.capturePatch({
                              messageId: input.assistantMessage.id,
                              stepId: currentStepId,
                              patchHash: patch.hash,
                              filePath: file.path,
                              fileDiff: file.content,
                              additions: file.additions,
                              deletions: file.deletions,
                              diffStats: { additions: file.additions, deletions: file.deletions },
                            })
                          }
                        }
                      }
                      snapshot = undefined
                    }
                    // Now call handleStepEnd with snapshot_id and patch_id already captured
                    await sessionTrajectoryTracker.handleStepEnd(input.assistantMessage.id, currentStepId, {
                      reason: value.finishReason,
                      tokensInput: usage.tokens.input,
                      tokensOutput: usage.tokens.output,
                      cost: usage.cost,
                    })
                    currentStepId = undefined
                  }
                  SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  })
                  if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model })) {
                    needsCompaction = true
                  }
                  break

                case "text-start":
                  currentText = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "text",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  break

                case "text-delta":
                  if (currentText) {
                    currentText.text += value.text
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    if (currentText.text)
                      await Session.updatePart({
                        part: currentText,
                        delta: value.text,
                      })
                  }
                  break

                case "text-end":
                  if (currentText) {
                    currentText.text = currentText.text.trimEnd()
                    const textOutput = await Plugin.trigger(
                      "experimental.text.complete",
                      {
                        sessionID: input.sessionID,
                        messageID: input.assistantMessage.id,
                        partID: currentText.id,
                      },
                      { text: currentText.text },
                    )
                    currentText.text = textOutput.text
                    currentText.time = {
                      start: Date.now(),
                      end: Date.now(),
                    }
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    await Session.updatePart(currentText)
                  }
                  currentText = undefined
                  break

                case "finish":
                  break

                default:
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
              if (needsCompaction) break
            }
          } catch (e: any) {
            log.error("process", {
              error: e,
              stack: JSON.stringify(e.stack),
            })
            const error = MessageV2.fromError(e, { providerID: input.model.providerID })
            const retry = SessionRetry.retryable(error)
            if (retry !== undefined) {
              attempt++
              const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)
              SessionStatus.set(input.sessionID, {
                type: "retry",
                attempt,
                message: retry,
                next: Date.now() + delay,
              })
              await SessionRetry.sleep(delay, input.abort).catch(() => {})
              continue
            }
            input.assistantMessage.error = error
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            })
          }
          if (snapshot) {
            const patch = await Snapshot.patch(snapshot)
            if (patch.files.length) {
              await Session.updatePart({
                id: Identifier.ascending("part"),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "patch",
                hash: patch.hash,
                files: patch.files,
              })
            }
            snapshot = undefined
          }
          const p = await MessageV2.parts(input.assistantMessage.id)
          for (const part of p) {
            if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: "error",
                  error: "Tool execution aborted",
                  time: {
                    start: Date.now(),
                    end: Date.now(),
                  },
                },
              })
            }
          }
          input.assistantMessage.time.completed = Date.now()
          await Session.updateMessage(input.assistantMessage)
          if (needsCompaction) return "compact"
          if (blocked) return "stop"
          if (input.assistantMessage.error) return "stop"
          return "continue"
        }
      },
    }
    return result
  }
}
