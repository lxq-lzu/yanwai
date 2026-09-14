# 言外 · 浏览器插件（MV3）

把前端核心（`frontend/src`）打包成 Chrome MV3 插件，让**真实知乎页面**能划词解析。

## 目录结构

```
extension/
├── manifest.json      # MV3：content_scripts(知乎域名) + background + host_permissions
├── content.js         # 内容脚本：覆盖 fetch 经 background 转发 + 动态 import lib/app.js
├── background.js      # service worker：转发请求到后端，保持 NDJSON 流式
└── lib/               # 复用 frontend/dist 的编译产物（npm run build:extension 生成）
```

## 为什么请求走 background 转发

内容脚本跑在 `https://*.zhihu.com` 页面里，直接 `fetch http://localhost:8787` 会被浏览器
**mixed content**（https 页面发 http 请求）拦截，且 CORS origin 是 `zhihu.com`（后端 B2 白名单
只放行 `chrome-extension://` 和 `localhost`）。

走 background（service worker）转发后：

- origin 变成 `chrome-extension://…`，后端 CORS 已放行，**不用改后端**；
- service worker 不受页面 mixed content 限制。

content script 只发消息给 background，background 真正 fetch 后端，逐 chunk 转发回来，**不缓冲**
整个响应体（NDJSON 流式不变）。

## 本地跑通

1. 后端：`npm run dev`（`MOCK=0`，`npm run build:frontend` 已自动执行）
2. 打包前端产物进 lib：`npm run build:extension`（首次克隆后必需）
3. `chrome://extensions` 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `frontend/extension/`
4. 打开真实知乎问题页，划词 → 气泡出现、一句话先到、`[ref:N]` 可点

## 说明

- `lib/` 是 `frontend/dist` 的拷贝（编译产物），由 `npm run build:extension` 生成，随插件一起加载。
- `frontend/src`、`backend/` 未被改动；本目录只新增 manifest / content / background 三个薄壳。
