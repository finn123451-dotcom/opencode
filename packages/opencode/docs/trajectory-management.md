# 轨迹管理 (Trajectory Management)

## 概述

轨迹管理是 OpenCode 系统中用于完整记录和追踪 AI 对话会话过程的模块。它捕获并持久化整个会话的生命周期，包括用户交互、AI 推理、工具调用、文件操作等关键数据。

## 核心功能

### 1. 会话记录 (Session Recording)

- 记录会话基本信息（项目 ID、目录、权限等）
- 支持会话标题和描述
- 追踪会话状态（活跃/已完成/失败/已取消）

### 2. 消息追踪 (Message Tracking)

- 捕获用户消息和 AI 助手回复
- 记录消息角色（user/assistant/system）
- 追踪 token 消耗和成本
- 支持消息摘要生成

### 3. 推理过程记录 (Reasoning Tracking)

- 记录 AI 的推理链（reasoning chains）
- 追踪推理开始和结束时间
- 存储推理内容用于分析和优化

### 4. 工具调用记录 (Tool Call Tracking)

- 捕获所有工具调用（read、write、edit、grep 等）
- 记录工具输入输出
- 追踪工具执行状态和耗时
- 支持附件和文件元数据

### 5. 步骤追踪 (Step Tracking)

- 将会话分解为可执行的步骤
- 记录每个步骤的类型（推理/工具调用/文本生成等）
- 追踪步骤执行时间和 token 消耗

### 6. 文件操作历史 (File Operation History)

- 记录所有文件读取、写入、编辑操作
- 存储文件差异（diff）信息
- 追踪快照（snapshots）和补丁（patches）

### 7. 错误追踪 (Error Tracking)

- 捕获并记录执行过程中的错误
- 支持错误重试信息
- 存储错误堆栈用于调试

### 8. 向量嵌入存储 (Vector Embedding Storage)

- 将消息、步骤、工具调用转换为向量嵌入
- 支持语义相似度搜索
- 基于 pgvector 实现

### 9. 知识生成 (Knowledge Generation)

- 从完成轨迹中提取知识
- 自动生成知识条目到知识库
- 支持记忆提取和存储

## 数据模型

### 核心表结构

| 表名                | 用途                             |
| ------------------- | -------------------------------- |
| `sessions`          | 会话基本信息                     |
| `messages`          | 对话消息                         |
| `message_parts`     | 消息组成部分（文本/推理/工具等） |
| `reasoning_chains`  | AI 推理链                        |
| `tool_calls`        | 工具调用记录                     |
| `tool_attachments`  | 工具附件                         |
| `steps`             | 执行步骤                         |
| `file_operations`   | 文件操作记录                     |
| `snapshots`         | 文件快照                         |
| `patches`           | 补丁/差异                        |
| `subtasks`          | 子任务                           |
| `compactions`       | 会话压缩                         |
| `retries`           | 重试记录                         |
| `trajectories`      | 轨迹汇总信息                     |
| `vector_embeddings` | 向量嵌入                         |
| `knowledge_base`    | 知识库                           |

## 配置选项

```typescript
interface TrajectoryCaptureConfig {
  enabled: boolean // 是否启用
  storeEmbeddings: boolean // 是否存储向量嵌入
  generateKnowledge: boolean // 是否生成知识
  captureRate: number // 捕获采样率
  captureFiles: boolean // 是否捕获文件内容
  captureSnapshots: boolean // 是否捕获快照
  capturePatches: boolean // 是否捕获补丁
}
```

## 使用场景

### 1. 会话回溯

通过轨迹记录，可以完整回溯任何历史会话的完整过程，便于分析和复盘。

### 2. 成本分析

追踪 token 消耗和成本，支持按会话、按时间等维度进行成本分析。

### 3. 性能优化

通过分析推理链和工具调用耗时，识别性能瓶颈。

### 4. 错误调试

错误记录和堆栈信息有助于快速定位和修复问题。

### 5. 语义搜索

向量嵌入支持语义相似度搜索，可以快速找到相关的历史会话。

### 6. 知识复用

从轨迹中提取的知识可以复用于未来的会话，提升 AI 能力。

### 7. 模型评估

通过轨迹数据可以评估 AI 模型的输出质量、效率等指标。
