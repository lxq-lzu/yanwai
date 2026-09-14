/**
 * 集中读取环境变量。只在这里读 process.env,其余模块从这里取配置对象。
 */

// 把 .env 加载进 process.env。用 Node 内置的 loadEnvFile(Node 20.6+/24 都有),
// 不引入 dotenv 依赖。.env 不存在时(比如全新 clone、或测试环境)静默跳过,不抛错——
// 否则 MOCK 默认 true 会掩盖这个问题,变成一个不容易发现的"为什么真实模式起不来"。
try {
  process.loadEnvFile();
} catch {
  // 没有 .env 文件,忽略;真实部署环境变量可能由平台直接注入,不依赖这个文件
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num(process.env.PORT, 8787),
  /** 监听地址。默认 127.0.0.1(安全);经反向代理访问时用环境变量 HOST 覆盖。 */
  host: process.env.HOST ?? '127.0.0.1',

  /**
   * 管理后台鉴权令牌。空字符串 = 管理后台未配置,admin 路由返回 503 不裸奔公网。
   * 由 ADMIN_TOKEN 环境变量注入,只用于 admin 路由的 header 比对,不进任何日志/回显。
   */
  adminToken: process.env.ADMIN_TOKEN ?? '',

  /** MOCK=1 时全部走 Mock Provider,零网络请求。见 02 文档「明确不做」之外的关键保险项。 */
  mock: bool(process.env.MOCK, true),

  /** 记录真实原文+上下文+路由决策到本地开发日志,仅本机开。 */
  devCapture: bool(process.env.DEV_CAPTURE, false),

  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  },

  zhihu: {
    accessSecret: process.env.ZHIHU_ACCESS_SECRET ?? '',
    oauthAppId: process.env.ZHIHU_OAUTH_APP_ID ?? '',
    oauthAppKey: process.env.ZHIHU_OAUTH_APP_KEY ?? '',
    oauthRedirectUri: process.env.ZHIHU_OAUTH_REDIRECT_URI ?? '',
    /** 内容 API(搜索/热榜/全网搜索)Base,走 Bearer Access Secret。与 quota 校准同源。 */
    contentApiBase: process.env.ZHIHU_CONTENT_API_BASE ?? 'https://developer.zhihu.com',
    /** 直答 Chat Completions Base。06 文档写 openapi.zhihu.com,官方 http-api.md 写 developer.zhihu.com,
     *  以官方原始协议为准,部署验证时若不一致改 ZHIHU_ZHIDA_API_BASE。 */
    zhidaApiBase: process.env.ZHIHU_ZHIDA_API_BASE ?? 'https://developer.zhihu.com',
    /** 直答模型档位。06 文档/task 写 zhida-plus,官方 http-api.md 列 zhida-fast-1p5/thinking-1p5/agent,
     *  以部署后实测为准,可配置。 */
    zhidaModel: process.env.ZHIHU_ZHIDA_MODEL ?? 'zhida-plus',
    /** 社区 API(moltbook)AK/SK。app_key=你的知乎用户 token,app_secret=申请到的密钥。见 07 文档第二节。 */
    communityAppKey: process.env.ZHIHU_COMMUNITY_APP_KEY ?? '',
    communityAppSecret: process.env.ZHIHU_COMMUNITY_APP_SECRET ?? '',
    communityApiBase: process.env.ZHIHU_COMMUNITY_API_BASE ?? 'https://openapi.zhihu.com',
    /** OAuth 授权/换 token/用户信息 Base。见 06 文档第三节 + 07 文档第五节。 */
    oauthApiBase: process.env.ZHIHU_OAUTH_API_BASE ?? 'https://openapi.zhihu.com',
  },

  /**
   * 知乎各 API 模块开关。「赛后改配置禁用对应模块」——比赛临时启用的能力赛后逐个关掉,
   * 不用改主链路代码。环境变量 YW_ZHIHU_* 前缀,便于部署平台一键开关。
   *
   * 运行时可变:管理后台「模块开关」读写同一个对象(config.features.*),请求时
   * 生效(zhida/community/oauth 在请求时读;search/hot/global 在 dispatcher 模块加载时
   * 建 Provider,切换需重启,见 STATUS 文档已知差异)。
   */
  features: {
    zhihuSearch: bool(process.env.YW_ZHIHU_SEARCH, true),
    hotList: bool(process.env.YW_ZHIHU_HOT_LIST, true),
    globalSearch: bool(process.env.YW_ZHIHU_GLOBAL_SEARCH, true),
    zhida: bool(process.env.YW_ZHIHU_ZHIDA, true),
    /** 社区 API 默认关——发帖/评论/点赞是外发动作,误触发会污染圈子,赛后也保持关闭。 */
    community: bool(process.env.YW_ZHIHU_COMMUNITY, false),
    oauth: bool(process.env.YW_ZHIHU_OAUTH, true),
  },

  /** zhihu_search 官方日额度 5000,内部预算收紧到 3500,留 1500 给评审窗口。见 02 文档第六节。 */
  searchQuota: {
    dailyBudget: 3500,
    officialDaily: 5000,
    calibrateIntervalMs: 5 * 60 * 1000,
  },

  evidence: {
    /** 证据检索硬上限,到点带着现有的东西走,不等。见 02 文档第三节。 */
    timeoutMs: 2500,
  },

  /**
   * 方向检索 + 综合的整体预算。见 11 文档主题三「交互控制」:整条链路(4 方向并行 +
   * 综合器)加一个整体超时,到点基于已到手资料汇总,不再等,保证「超时不挂死」。
   * 「无限探索」开关跳过这个整体超时(O3 前端通过请求参数覆盖,这里先留全局默认)。
   */
  optimization: {
    /** 方向检索 + 综合的整体预算(ms)。 */
    budgetMs: num(process.env.YW_OPTIMIZATION_BUDGET_MS, 8000),
    /** true 时跳过整体超时(不限时)。默认 false。 */
    unlimited: bool(process.env.YW_OPTIMIZATION_UNLIMITED, false),
  },

  /**
   * 方向清单 + 每个方向的资料源链。全部配置驱动:换场景就换清单、换源链顺序。
   * 见 00 文档「四个方向的本质」+ 10 文档第四节——四个方向只是默认配置,不是写死的。
   *
   * sources 是「降级链」:按序尝试,接口断了自动落到下一个,最终兜底是 llm。
   * 源 id 与 DataSource.id 一一对应:zhihu_search / zhihu_hot / zhihu_global /
   * zhihu_comment / llm(LLM 兜底源由 D3 在 modules/directions/ 提供)。
   */
  directions: [
    { id: 'term', name: '术语解释', enabled: true, sources: ['llm'] },
    { id: 'hotspot', name: '热点关联', enabled: true, sources: ['zhihu_hot', 'zhihu_global', 'llm'] },
    { id: 'subtext', name: '潜台词解读', enabled: true, sources: ['llm', 'zhihu_search'] },
    { id: 'community', name: '社区理解', enabled: true, sources: ['zhihu_search', 'zhihu_comment', 'llm'] },
  ],

  cache: {
    maxEntries: 10_000,
    ttlStableMs: 24 * 60 * 60 * 1000, // 术语/潜台词类,稳定
    ttlTimeSensitiveMs: 2 * 60 * 60 * 1000, // 热点/社区类,有时效性
  },

  session: {
    ttlMs: 30 * 60 * 1000,
  },

  rateLimit: {
    perIpDaily: 200,
  },

  /**
   * CORS 白名单。逗号分隔的 Demo 域名列表,来自 YW_ALLOWED_ORIGINS(域名未定,
   * 先用环境变量占位)。chrome-extension:// 和 localhost 系永远放行,
   * 不依赖环境变量——插件的 origin 每次安装都不同,且本地开发/演示不该被这个开关卡住。
   */
  cors: {
    allowedOrigins: (process.env.YW_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  },

  storage: {
    dir: process.env.YW_DATA_DIR ?? 'data',
    cacheLogFile: 'cache.jsonl',
    devCaptureLogFile: 'dev-capture.local.jsonl',
    /** 超过这个字节数就在启动时压实一次(同 key 只留最新一条) */
    compactThresholdBytes: 5 * 1024 * 1024,
    /**
     * jsonl(默认):落盘 + 内存索引,重启后能回放,详见 02 文档第七节。
     * memory:跳过所有磁盘读写,只保留内存索引——某些部署平台(如知乎 AiWorks)
     * 限制"无数据库读写",不开这个口子等于提前砍掉一个可部署平台(见 B3)。
     * 代价是重启后缓存清零,不是功能缺失,是可接受的降级。
     */
    mode: (process.env.YW_STORAGE === 'memory' ? 'memory' : 'jsonl') as 'jsonl' | 'memory',
  },
};

export type Config = typeof config;
