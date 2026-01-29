# Multi-Agent Proof Reviewer (MVP)

一个基于 Next.js (App Router) + TypeScript 的“多身份 AI 互审数学证明”工作流示例。支持 DeepSeek API（OpenAI 兼容接口）流式输出，串行多代理检查、修补、编辑并生成依赖表。

## 功能亮点
- 串行多代理审稿：Prover → Skeptic → CounterexampleHunter → AssumptionAuditor → Fixer → NotationGuardian → Editor → Formalizer
- 每个角色输出严格 JSON（服务端 zod 校验，失败自动重试）
- SSE 流式传输，前端实时查看角色输出
- Issues 漏洞清单、Fixer 修补记录、Final Proof、depsTable 依赖表

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

## 说明
- 仅使用 Node runtime（不要 edge runtime）。
- session 存储在内存 Map 中，便于 MVP 快速迭代。
