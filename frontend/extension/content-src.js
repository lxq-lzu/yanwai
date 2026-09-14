/**
 * esbuild 打包入口 → 输出单文件经典脚本 content.js
 *
 * 为什么打包：lib 编译产物是 ESM（import/export），而 Chrome content script
 * 既不认 content_scripts 的 "type": "module"，动态 import() 又会被 WAR 拦截。
 * 用 esbuild 把 app.ts 及其全部依赖打进一个 IIFE 经典脚本，彻底绕开 ESM 加载。
 *
 * 请求链路（2026-09-14 起）：content script **直接** fetch 后端，不再经 background
 * service worker 转发。之前的 proxyFetch → chrome.runtime.connect → SW → fetch 链路
 * 在发出网络请求前就断掉（nginx 完全收不到请求），整条移除。
 * 后端 CORS 已放行 zhihu 域（www / zhuanlan / 任意子域），content script 的
 * cross-origin fetch 走正常 CORS 即可。
 */
import { createYanwaiApp } from '../src/app.js';

const BACKEND = 'https://yanwai.lixq.net';

// 启动。baseUrl 指向后端，app 内的 fetch 直接发往后端（origin = 知乎域，后端已放行）。
createYanwaiApp({ baseUrl: BACKEND });

// 右键菜单触发：background 点「言外解析」后发消息，这里派发一次 mouseup，
// 让 selection watcher 读取当前选区、走与自动划词完全相同的解析路径。
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'yanwai-analyze') {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true }));
  }
});
