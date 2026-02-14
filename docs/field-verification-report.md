# OpenCode Trajectory Storage - Field Population Verification Report

## Executive Summary

This report verifies that all database tables have their fields correctly populated during INSERT and UPDATE operations.

## Tables and Field Status

### 1. sessions ✅
**Status**: All fields populated

| Field | Source | Status |
|-------|--------|--------|
| id | capture.ts:startSession | ✅ |
| project_id | capture.ts:startSession | ✅ |
| user_id | capture.ts:startSession | ✅ |
| parent_session_id | capture.ts:startSession | ✅ |
| directory | capture.ts:startSession | ✅ |
| title | capture.ts:startSession | ✅ |
| version | capture.ts:startSession | ✅ |
| permission | capture.ts:startSession | ✅ |
| metadata | capture.ts:startSession | ✅ |
| created_at/updated_at | DEFAULT | ✅ |

### 2. messages ⚠️
**Status**: Partial - Populated at finish-step

| Field | Source | Status |
|-------|--------|--------|
| id | captureAssistantMessage | ✅ |
| session_id | captureAssistantMessage | ✅ |
| parent_id | metadata | ⚠️ (Not passed from processor.ts) |
| role | captureAssistantMessage | ✅ |
| content | captureAssistantMessage | ✅ |
| model | captureAssistantMessage | ✅ (Now passing input.model.id) |
| provider_id | captureAssistantMessage | ✅ (Now passing input.model.provider) |
| agent | metadata | ⚠️ (Not available in processor) |
| variant | metadata | ⚠️ (Not available in processor) |
| system_prompt | metadata | ⚠️ (Not available in processor) |
| finish_reason | captureAssistantMessage | ✅ (Now passing value.finishReason) |
| error | captureAssistantMessage | ✅ |
| cost | captureAssistantMessage | ✅ (Now passing usage.cost) |
| tokens_input | captureAssistantMessage | ✅ (Now passing usage.tokens.input) |
| tokens_output | captureAssistantMessage | ✅ (Now passing usage.tokens.output) |
| tokens_reasoning | captureAssistantMessage | ✅ (Now passing usage.tokens.reasoning) |
| time_created | Date.now() | ✅ |
| time_completed | Date.now() | ✅ |

### 3. message_parts ✅
**Status**: All required fields populated

| Field | Source | Status |
|-------|--------|--------|
| id | uuidv4 | ✅ |
| session_id | captureStep | ✅ |
| message_id | captureStep | ✅ |
| part_type | captureStep | ✅ |
| content | captureStep | ✅ |
| part_order | captureStep | ✅ |

### 4. reasoning_chains ✅
**Status**: Fixed - All fields now populated

| Field | Source | Status |
|-------|--------|--------|
| id | captureReasoningStart | ✅ |
| session_id | captureReasoningStart | ✅ |
| message_id | captureReasoningStart | ✅ |
| content | captureReasoningStart (empty) -> updateReasoningChain | ✅ |
| model | captureReasoningStart | ✅ |
| time_start | Date.now() | ✅ |
| time_end | captureReasoningEnd -> updateReasoningChain | ✅ |
| provider_metadata | captureReasoningStart | ✅ (FIXED: Now passing metadata) |
| part_order | captureReasoningStart | ✅ |

**Fix Applied**: 
- Modified trajectory-integration.ts:handleReasoningStart to pass providerMetadata
- Modified captureReasoning to use ON CONFLICT DO UPDATE instead of creating new records
- Modified captureReasoningEnd to call updateReasoningChain

### 5. tool_calls ✅
**Status**: Fixed - All fields now populated

| Field | Source | Status |
|-------|--------|--------|
| id | captureToolCallStart | ✅ |
| session_id | captureToolCallStart | ✅ |
| message_id | captureToolCallStart | ✅ |
| call_id | captureToolCallStart | ✅ (FIXED: Now passing from processor) |
| tool_name | captureToolCallStart | ✅ |
| input | captureToolCallStart | ✅ |
| output | captureToolCallComplete -> updateToolCall | ✅ |
| status | captureToolCallComplete -> updateToolCall | ✅ |
| time_start | Date.now() | ✅ |
| time_end | captureToolCallComplete | ✅ |
| duration_ms | captureToolCallComplete | ✅ |

**Fix Applied**:
- Modified integration.ts:captureToolCallStart to accept and pass callId
- Modified trajectory-integration.ts:handleToolCallStart to accept callId parameter
- Modified processor.ts to pass toolCallId as callId

### 6. steps ⚠️
**Status**: New implementation - Step tracking added

| Field | Source | Status |
|-------|--------|--------|
| id | captureStep | ✅ |
| trajectory_id | captureStep | ✅ |
| session_id | captureStep | ✅ |
| message_id | captureStep | ✅ |
| step_type | captureStep | ✅ |
| step_order | captureStep | ✅ |
| content | captureStep | ✅ |
| input_data | captureStep | ✅ |
| output_data | captureStep/handleStepEnd | ✅ |
| tokens_input | handleStepEnd | ✅ (NEW) |
| tokens_output | handleStepEnd | ✅ (NEW) |
| cost | handleStepEnd | ✅ (NEW) |
| time_start | Date.now() | ✅ |
| time_end | handleStepEnd | ✅ (NEW) |

**New Implementation**:
- Added updateStep method in trajectory.ts
- Added captureStepStart method in trajectory-integration.ts
- Modified processor.ts to call captureStepStart in start-step
- Modified processor.ts to call handleStepEnd in finish-step
- Modified captureStep to support stepId parameter for updates

### 7. trajectories ✅
**Status**: All fields populated at session end

| Field | Source | Status |
|-------|--------|--------|
| id | uuidv4 | ✅ |
| session_id | capture.ts | ✅ |
| model | messageBuffer | ✅ |
| agent | messageBuffer | ✅ |
| title | messageBuffer | ✅ |
| total_steps | stepCounter | ✅ |
| total_tool_calls | toolCallCounter | ✅ |
| time_created | Date.now() | ✅ |

### 8-23. Other Tables
**Status**: Currently not actively used in real-time flow

These tables are populated through storeCompleteTrajectory or not used:
- tool_attachments
- file_operations
- snapshots
- patches
- subtasks
- session_compactions
- retries
- vector_embeddings
- knowledge_base
- memories
- execution_logs
- permission_requests
- user_feedback
- cost_statistics
- api_call_logs
- project_context

## Summary of Changes Made

### 1. trajectory.ts
- Added `updateStep()` method to update step records
- Added `updateReasoningChain()` method
- createMessage already uses ON CONFLICT DO UPDATE

### 2. capture.ts
- Modified `captureStep()` to support stepId parameter for updates
- Modified `captureReasoning()` to update instead of insert duplicates
- Modified `captureReasoningEnd()` to call updateReasoningChain
- captureToolCallStart already calls updateToolCall for completion

### 3. integration.ts
- Modified `captureToolCallStart()` to accept and pass callId
- Modified `captureReasoning()` to accept providerMetadata
- captureAssistantMessage already accepts all metadata fields

### 4. trajectory-integration.ts
- Modified `handleReasoningStart()` to pass providerMetadata
- Modified `handleToolCallStart()` to accept and pass callId
- Added `captureStepStart()` method
- Modified `handleStepEnd()` to pass tokens and cost
- Modified `captureAssistantMessage()` to accept metadata

### 5. processor.ts
- Added `currentStepId` variable to track current step
- Added call to `sessionTrajectoryTracker.captureStepStart()` in start-step
- Added call to `sessionTrajectoryTracker.captureAssistantMessage()` in finish-step
- Modified call to `sessionTrajectoryTracker.handleStepEnd()` to pass tokens and cost
- Modified call to `sessionTrajectoryTracker.handleToolCallStart()` to pass toolCallId as callId

## Recommendations

1. **Missing Fields in messages**:
   - parent_id: Need to identify parent message in processor.ts
   - agent: Need to get agent info from context
   - variant: Need to get variant info from context
   - system_prompt: Need to store system prompt separately

2. **For Future Enhancement**:
   - Consider adding real-time message updates during streaming
   - Store tool_attachments when tools return file data
   - Store snapshots at meaningful checkpoints
   - Store patches when code changes are made

## Conclusion

All critical fields are now populated correctly. The main issues were:
1. reasoning_chains creating duplicate records - FIXED
2. tool_calls missing call_id - FIXED
3. steps not tracking tokens/cost - FIXED (NEW)
4. messages missing metadata - FIXED (Now passing model, provider, tokens, cost, finishReason)

The remaining unfilled fields (parent_id, agent, variant, system_prompt) require additional context that needs to be passed from higher-level code.
