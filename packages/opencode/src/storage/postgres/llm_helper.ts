// LLM Helper - Simple wrapper for OpenAI API calls
import { isAIEnabled } from "./config"
import { Log } from "../../util/log"

const logger = Log.create({ service: "llm-helper" })

// ============================================
// Types
// ============================================

export interface LLMMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface LLMCompletionOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  stop?: string[]
}

export interface LLMCompletionResponse {
  content: string
  finishReason: string
}

// ============================================
// OpenAI Chat Completion
// ============================================

export async function callLLM(
  messages: LLMMessage[],
  options: LLMCompletionOptions = {},
): Promise<LLMCompletionResponse> {
  if (!isAIEnabled()) {
    throw new Error("AI features are disabled")
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required")
  }

  const model = options.model || "gpt-4o"
  const temperature = options.temperature ?? 0.7
  const maxTokens = options.maxTokens || 4096

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stop: options.stop || undefined,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    logger.error("LLM call failed", { error, status: response.status })
    throw new Error(`LLM call failed: ${error}`)
  }

  const data = await response.json()
  const choice = data.choices[0]

  return {
    content: choice.message?.content || "",
    finishReason: choice.finish_reason || "unknown",
  }
}

// ============================================
// JSON Output Helper
// ============================================

export async function callLLMJson<T>(messages: LLMMessage[], options: LLMCompletionOptions = {}): Promise<T> {
  const response = await callLLM(messages, {
    ...options,
    model: options.model || "gpt-4o-mini",
  })

  try {
    // Try to extract JSON from response
    const content = response.content.trim()
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1] || jsonMatch[0])
    }
    return JSON.parse(content)
  } catch (error) {
    logger.error("failed to parse JSON from LLM response", { content: response.content })
    throw new Error("Failed to parse JSON from LLM response")
  }
}

// ============================================
// Prompt Templates
// ============================================

export const SYSTEM_PROMPTS = {
  softwareEngineer: `You are a professional software engineering expert. Your task is to analyze agent trajectories and extract useful capabilities and skills.`,

  capabilityExtractor: `You are a capability extraction specialist. Given a cluster of similar agent tasks (subtasks), analyze them to identify the common pattern and create a reusable capability definition.`,

  skillComposer: `You are a skill composition specialist. Given a set of capabilities, analyze their co-occurrence patterns and create meaningful skill compositions.`,

  qualityReviewer: `You are a quality assurance specialist. Review capability and skill definitions for correctness, completeness, and usefulness.`,
}

export const USER_PROMPTS = {
  extractCapability: (clusterData: { subtasks: any[]; toolNames: string[]; size: number }) => `
Analyze the following cluster of similar subtasks and extract a reusable capability.

## Cluster Data
- Size: ${clusterData.size} subtasks
- Common tools: ${clusterData.toolNames.join(", ")}

## Subtasks (sample)
${clusterData.subtasks.map((s, i) => `${i + 1}. ${s.description || s.result || "N/A"}`).join("\n")}

## Output Format (JSON)
\`\`\`json
{
  "name": "capability_name_in_snake_case",
  "description": "1-2 sentence description of what this capability does",
  "trigger_patterns": ["pattern1", "pattern2", "pattern3"],
  "input_schema": { "type": "object", "properties": { ... } },
  "output_schema": { "type": "object", "properties": { ... } },
  "variations": [
    { "pattern": "scenario pattern", "focus": "what to focus on" }
  ]
}
\`\`\`
`,

  composeSkill: (capabilities: any[]) => `
Analyze the following capabilities and create skill compositions based on co-occurrence patterns.

## Capabilities
${capabilities.map((c, i) => `${i + 1}. ${c.name}: ${c.description}`).join("\n")}

## Output Format (JSON)
\`\`\`json
[
  {
    "name": "skill_name_in_snake_case",
    "description": "1-2 sentence description",
    "trigger_config": [
      { "type": "semantic", "condition": "search query", "weight": 0.8 },
      { "type": "error_pattern", "condition": "error regex", "weight": 0.9 }
    ],
    "chain_config": [
      { "capability_id": "uuid", "role": "required", "order": 1 },
      { "capability_id": "uuid", "role": "optional", "order": 2 }
    ],
    "usage_scenarios": ["scenario 1", "scenario 2"]
  }
]
\`\`\`
`,

  analyzeCooccurrence: (capabilities: any[], usageStats: any) => `
Analyze the following capabilities and their usage statistics to identify composition opportunities.

## Capabilities
${capabilities.map((c) => `- ${c.name}: ${c.description}`).join("\n")}

## Co-occurrence Data
${JSON.stringify(usageStats, null, 2)}

## Output Format (JSON)
\`\`\`json
{
  "suggested_skills": [
    {
      "name": "skill_name",
      "description": "description",
      "required_capabilities": ["cap1", "cap2"],
      "optional_capabilities": ["cap3"],
      "trigger_patterns": ["pattern1"]
    }
  ]
}
\`\`\`
`,
}
