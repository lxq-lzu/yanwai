# 言外（Yanwai）

> 别人做的是「问 AI」，言外做的是「不用会问」。

**在线体验**：<https://yanwai.lixq.net>（网页 Demo，无需安装即可划词）

知乎的内容门槛不在字面，在背景。一段话里可能同时藏着专业术语、三年前的站内旧事、一个只有圈内人懂的梗、以及一层阴阳怪气。新用户和跨领域用户看得懂每个字，却不知道这段话在说什么、在骂谁、在维护谁。

**言外**在知乎页面内做到**划词即解析**：不跳转、不打断阅读、不需要用户先会提问。选中一段文字，气泡先在选区旁给出一句大白话（约 600ms），再按需流式补全融合正文——只讲真正相关的术语、背景、潜台词或社区看法，字面直白的内容就地结束，并带 `[1]`、`[2]` 来源锚点可跳回原文。解释来自知乎自己（同问题下的其他回答与评论），不是模型编的。

## 目录

- [项目结构](#项目结构)
- [本地跑通](#本地跑通)
- [浏览器插件](#浏览器插件)
- [配置](#配置)
- [测试](#测试)

## 项目结构

```
├── backend/            # Express 后端：路由、意图路由、证据检索、NDJSON 流式输出
├── frontend/
│   ├── src/            # 划词采集 + Shadow DOM 气泡渲染 + 流式客户端（TypeScript）
│   ├── dist/           # tsc 编译产物（不入库，见下文）
│   └── web/index.html  # 网页 Demo（评审主入口，真实知乎问答快照）
├── docs/               # 产品方案、技术架构、提交清单等
└── tests/              # tsx --test 测试
```

## 本地跑通

> 环境要求：Node.js ≥ 18（原生 `fetch` 与 `loadEnvFile`）。

```bash
# 1. 安装依赖
npm install

# 2. 构建前端（必需步骤）
npm run build:frontend

# 3. 启动（默认 Mock 模式，零网络请求）
npm run dev
```

浏览器打开 **http://localhost:8787**（默认端口，可用 `PORT` 覆盖）。

### ⚠️ `npm run build:frontend` 是必需步骤

`frontend/dist/` 是 tsc 编译产物，**不入库**。全新 clone 后若跳过这一步直接启动，`/src/app.js` 会 404，Demo 页白屏。`npm run dev` / `npm start` 已通过 `predev` / `prestart` 钩子自动先跑构建；只有当你手动 `node` 起服务或改动过 `frontend/src/` 后，才需要显式执行一次。

## 配置

后端统一从环境变量读取配置（见 `backend/config.ts`），推荐写到 `.env`（不入库）：

| 变量 | 说明 | 默认 |
|---|---|---|
| `MOCK` | `1` 走离线 Mock，零网络请求；`0` 走真实模型 | `1` |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥，`MOCK=0` 时必需 | 空 |
| `DEEPSEEK_MODEL` | 模型名 | `deepseek-chat` |
| `PORT` | 监听端口 | `8787` |
| `ZHIHU_ACCESS_SECRET` | 知乎数据开放平台 Access Secret，用于 `zhihu_search` 证据检索 | 空 |
| `YW_ALLOWED_ORIGINS` | CORS 白名单（逗号分隔），公网部署时收紧 | 空 |
| `YW_STORAGE` | `jsonl` 落盘缓存 / `memory` 纯内存（部分平台禁磁盘写时用） | `jsonl` |

**真实模型链路**（替代 Mock）：

```bash
# .env
MOCK=0
DEEPSEEK_API_KEY=sk-...
# 可选
ZHIHU_ACCESS_SECRET=...

npm run dev
```

## 浏览器插件

插件是 content script 直接 fetch 后端（不经 background 转发），用 esbuild 打包成单文件：

```bash
npm run build:extension   # 生成 frontend/extension/content.js
```

在 Chrome/Edge 的 `chrome://extensions` 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `frontend/extension/` 目录。安装后在知乎页面划选文字即可解析。

## 测试

```bash
npm test          # tsx --test 全量测试
npm run typecheck # tsc --noEmit 类型检查
```
