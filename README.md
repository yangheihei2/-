# Multi-Agent Proof Reviewer (MVP)

一个基于 Next.js (App Router) + TypeScript 的“多身份 AI 互审数学证明”工作流示例。支持 DeepSeek API（OpenAI 兼容接口）流式输出，串行多代理检查、修补、编辑并生成依赖表。

## 功能亮点
- 串行多代理审稿：Prover → Skeptic → CounterexampleHunter → AssumptionAuditor → Fixer → NotationGuardian → Editor → Formalizer
- 每个角色输出严格 JSON（服务端 zod 校验，失败自动重试）
- SSE 流式传输，前端实时查看角色输出
- Issues 漏洞清单、Fixer 修补记录、Final Proof、depsTable 依赖表

## 设计思路（Workflow 思路）
这套 MVP 的核心目标是：**把一个数学证明草稿拆解为多个责任明确的角色，让模型自检、自修复、自编辑**，最终收敛为结构清晰、可继续形式化的证明文本。整体流程遵循：

1. **先有路线图**：Prover 先给证明结构与关键引理。
2. **再做多维审稿**：Skeptic、CounterexampleHunter、AssumptionAuditor 从不同角度提出问题。
3. **集中修补**：Fixer 逐条回应 issues 并修补文本。
4. **统一风格与符号**：NotationGuardian 消除符号冲突。
5. **最终整理**：Editor 产出 finalProof（及 LaTeX）。
6. **依赖表与风险提示**：Formalizer 给出 depsTable 与形式化检查点。

运行时，服务端会把每个角色的输出都校验为严格 JSON（`zod`），不合格时自动重试 1~2 次，从而保证前端可稳定解析展示。

## 环境变量
复制 `.env.example` 到 `.env.local` 并填写：

```bash
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

`DEEPSEEK_BASE_URL` 允许使用 `https://api.deepseek.com/v1`，服务端会自动拼接 `/chat/completions`。

## 本地开发

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

## 角色说明（8 个身份 AI）
> 角色 prompt 与 schema 都集中在 `lib/agents/prompts.ts`，可直接扩展或调整。

### 1) Prover（证明路线）
- **目标**：给出证明思路与结构，明确关键步骤与潜在缺失。
- **输出**：`proofStrategySummary`、`outlineSteps`、`keyLemmas`、`assumptionsUsed`、`missingAssumptions`、`questionsToUser`。

### 2) Skeptic（怀疑者）
- **目标**：对证明逻辑进行最严格的挑战与质疑。
- **输出**：`issues[]`（每条含定位、原因、修复建议）+ `criticalQuestions` + `overallAssessment`。

### 3) CounterexampleHunter（反例猎手）
- **目标**：尝试构造反例或指出缺失假设导致的反例路径。
- **输出**：`candidateCounterexamples[]` + `issues[]`。

### 4) AssumptionAuditor（假设审计）
- **目标**：检查假设是否充分/过强/隐含，给出补充建议。
- **输出**：`issues[]` + `suggestedAssumptions[]` + `minimalityNotes`。

### 5) Fixer（修补者）
- **目标**：对所有 open issues 逐条回应并修订证明。
- **输出**：`fixes[]`（issueId → response/status/patchSummary）、`patchedProof`、`stillOpenIssueIds[]`。

### 6) NotationGuardian（符号守护）
- **目标**：统一符号与术语，避免符号冲突或歧义。
- **输出**：`notationMap[]` + 可选 `issues[]`。

### 7) Editor（编辑者）
- **目标**：输出最终可读的证明文本，并与符号规范合并。
- **输出**：`finalProof`（纯文本）+ `finalProofLatex`（LaTeX）+ `structure[]` + `notationMap[]` + `assumptionsUsed[]` + `openGaps[]`。

### 8) Formalizer（形式化检查）
- **目标**：提供形式化依赖表与风险提示。
- **输出**：`depsTable[]`（每步依赖哪些假设/引理/步骤）+ `checkPoints[]` + `formalizationRisks[]` + `unprovenClaims[]`。

## 目录结构

```
app/
  api/
    run/route.ts
    stream/route.ts
    session/[id]/route.ts
  layout.tsx
  page.tsx
  globals.css
components/
  Timeline.tsx
  IssuesPanel.tsx
  FinalProofPanel.tsx
lib/
  agents/
    prompts.ts
    runAgents.ts
  deepseek/client.ts
  sessions/store.ts
```

## API 简述
- **POST `/api/run`**：创建 session，返回 `sessionId`。
- **GET `/api/stream?sessionId=...`**：SSE 流式输出角色消息、issues、done/error。
- **GET `/api/session/[id]`**：用于刷新/断线重连，返回完整 SessionState。

## 说明
- 仅使用 Node runtime（不要 edge runtime）。
- session 存储在内存 Map 中，便于 MVP 快速迭代。
