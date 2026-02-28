# 数学证明助手（Proof Assistant）

一个面向“证明思路整理 + 证明草稿生成”的 Web 项目。  
你输入**定理陈述**和**已知条件**，系统会先给你可行的证明路线，再生成可渲染（MathJax）的证明文本。

---

## 这个项目可以做什么？

### 1) 自动生成“可执行”的证明思路
- 根据你输入的问题，先返回：
  - `Possible Proof Ideas`（可能的证明路线）
  - `Candidate Theorems`（候选定理 + 为什么有用）
- 适合在正式写证明前，先做“路线筛选”。

### 2) 生成证明草稿（支持公式渲染）
- 支持把证明结果切换为：
  - **Compiled**（MathJax 渲染视图）
  - **Source**（原始文本）
- 方便你二次编辑并粘贴到论文、笔记或教学材料。

### 3) 多模型可切换
- `Gemini 2.5 Flash`
- `DeepSeek Chat`
- `DeepSeek Reasoner`

你可以在界面中切换模型，对比不同模型的证明风格与严谨度。

---

## AI 思路（工作流）

这个项目不是“直接一句话吐证明”，而是分阶段执行：

1. **问题理解**：读取 Theorem + Assumptions。  
2. **参考线索匹配**：根据关键词匹配内置文献候选（模拟检索与重排）。  
3. **Generator**：生成候选证明与可能思路。  
4. **Verifier**：判定 `PASS / MINOR_FIX / REGENERATE`。  
5. **Reviser**：若是可局部修复问题，按反馈进行最小修订后回到 Verifier。  
6. **Regenerate**：若是严重缺陷，回到 Generator 重新生成。  
7. **终止策略**：达到轮次上限时返回“最佳可用解 + 风险说明”。  
8. **前端编译展示**：用 MathJax 渲染，得到接近“编译后”的阅读体验。

> 这样设计的好处：
> - 用户先看到“为什么这么证”，而不是只看到“结果”。
> - 更适合教学、讨论和多人协作审稿。

---

## 项目架构

- **前端**：React + Vite
- **后端**：Vercel Serverless Functions
- **模型接入**：Gemini / DeepSeek
- **渲染**：MathJax

### API 路由
- `POST /api/generate-ideas`：Gemini 思路生成
- `POST /api/generate-ideas-deepseek`：DeepSeek 思路生成
- `POST /api/generate-proof`：Gemini 证明生成
- `POST /api/generate-proof-deepseek`：DeepSeek 证明生成
- `POST /api/verify-proof`：Gemini 证明校验
- `POST /api/verify-proof-deepseek`：DeepSeek 证明校验
- `POST /api/revise-proof`：Gemini 小修订
- `POST /api/revise-proof-deepseek`：DeepSeek 小修订

---

## 快速开始（本地）

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

创建 `.env.local`（或在 Vercel 配环境变量）：

```env
GEMINI_API_KEY=your_gemini_key
DEEPSEEK_API_KEY=your_deepseek_key
```

> 只使用 Gemini 时，可只配置 `GEMINI_API_KEY`。  
> 若在 UI 选择 DeepSeek 模型，则必须配置 `DEEPSEEK_API_KEY`。

### 3. 启动开发环境

```bash
npm run dev
```

默认访问：`http://localhost:3000`

### 4. 质量检查

```bash
npm run lint
npm run build
```

---

## 部署（Vercel）

1. 将仓库推送到 GitHub。  
2. 在 Vercel 导入该仓库。  
3. 配置环境变量：
   - `GEMINI_API_KEY`
   - `DEEPSEEK_API_KEY`（如需 DeepSeek）
4. 点击 Deploy。

---

## 适用场景

- 数学课程作业中的证明草稿探索
- 论文写作前的证明路径头脑风暴
- 团队讨论时快速对比不同证明策略
- 教学中展示“从想法到证明”的完整链路

---

## 注意事项

- 本项目输出的是 **AI 生成证明草稿**，不保证 100% 正确。  
- 用于作业、论文或正式发表前，请务必人工校验关键步骤。  
- 对高难度命题，建议结合文献与人工推导共同验证。

---

## 项目结构

```text
.
├─ api/
│  ├─ generate-ideas.ts
│  ├─ generate-ideas-deepseek.ts
│  ├─ generate-proof.ts
│  ├─ generate-proof-deepseek.ts
│  ├─ verify-proof.ts
│  ├─ verify-proof-deepseek.ts
│  ├─ revise-proof.ts
│  └─ revise-proof-deepseek.ts
├─ src/
│  ├─ App.tsx
│  ├─ main.tsx
│  └─ index.css
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
└─ vercel.json
```
