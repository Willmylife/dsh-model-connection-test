# dsh-model-connection-test 模型连接测试

中文 | [English](README.md)

一个 [DeepSeek Harness](https://github.com/deepseek-ai) 插件，在 **设置 → 模型** 页面底部增加**连接测试**面板：对每个已配置模型发起一次最小对话请求，给出成功/失败判定、宿主侧失败码，以及首个输出 / 总耗时。

DeepSeek Harness 在 设置 → 模型 中配置模型提供商与模型目录，但页面上没有任何办法知道这些模型当前是否真的可用。本插件用一次真实的端到端请求填补这个空白——走的就是 Agent 自己的调用链路。

## 安装

**插件市场（dsh-market）：** 本仓库被 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 收录后，在市场里搜索 **模型连接测试 / Model Connection Test** 一键安装，多数情况无需重启。

**命令行（任意宿主）：**

```sh
dsh plugin --profile <你的profile> add https://github.com/Willmylife/dsh-model-connection-test
```

**DeepSeek Harness Desktop：** 在应用自己的 **设置 → 插件** 里从市场或 Git 地址安装。应用运行期间，desktop profile 归应用内的插件管理器所有。

需要 **DSH ≥ 0.2.0**（`engines.dsh`）。插件是纯 JavaScript——无构建、无依赖安装、无需批准任何构建脚本。

## 功能

- 设置 → 模型 底部出现 **模型连接测试** 面板。
- 列出当前部署模型目录（`session.modelCatalog`）里全部可路由的提供商分组与模型，并标记默认模型。
- 每行 **测试** 按钮探测该模型；**全部测试** 以小并发（3）遍历整个目录。
- 每个探测结果为 `✓ 已连通 1.2s`（悬停查看首个输出/总耗时）或 `✗ 失败 <CODE>`——`<CODE>` 是宿主 LLM 失败码体系：`NO_ADAPTER`（无适配器）、`MISSING_CREDENTIAL`（缺凭据）、`AUTH`（认证失败）、`RATE_LIMIT`（限流）、`INVALID_CREDENTIAL`（凭据无效）、`TIMEOUT`（超时）等，悬停可看失败详情。
- 目录本身报告不可用的提供商会单独列出并附原因。
- 目录可随时刷新，无需离开页面。

## 工作原理

```
浏览器（client.js）                          宿主（index.js）
─────────────────────                        ────────────────────────────────
settings.models.footer 插槽                  POST /model-connection-test/api/test
  └─ ctx.remote.session.modelCatalog()       同源围栏 + 4KiB 请求体上限
  └─ fetch POST { provider, model }  ──────► ctx.llm.stream({
                                               provider, model,
                                               messages: [{ user, "ping" }],
                                               maxTokens ≤ 256, signal
                                             })
                                             流以一个终结 finish 块收尾  ──────►
  ✓/✗ + 失败码 + 首个输出/总耗时  ◄────────────  { ok, code, message, totalMs, firstMs }
```

- 探测在**宿主进程内**通过 `ctx.llm.stream` 执行——这是进入提供商适配器的唯一受支持路径。已保存的凭据只在宿主侧解析，永远不会到达浏览器、网络请求或本插件的任何日志。
- 探测读取流的终结块（`type: 'finish'`）：`reason.kind` 为 `stop`、`max-tokens` 或 `tool-calls` 表示模型已完成请求；`error` / `aborted` 展示宿主错误码及原因。首个输出延迟从首个文本、推理或工具输出块开始计算。
- 每个模型一次 POST，挂死的模型不会阻塞其它模型；客户端自持每行状态。
- `GET /model-connection-test/api/health` 返回 `{ ok: true, providers: <n> }`，便于快速诊断。

## 安全

- 测试路由的围栏与 dsh-market 相同：`Host` 必须是环回或部署声明的权威地址；拒绝跨站 `sec-fetch-site`；`Origin` 存在时必须匹配；宿主发布了请求门时予以执行；请求体上限 4 KiB。
- 探测提示词是固定短 `"ping"`，输出上限很小（默认 16，硬上限 256 token），全目录扫描只花费个位数 token 量级。
- 单次探测超时默认 60 秒（可通过请求体在 1–120 秒之间调整）。
- 插件不存储任何数据，也不向任何地方上报。

## 上架插件市场

本仓库本身就是可安装的 bundle（仓库根 = 包根目录；纯 JS，无构建）。上架流程：

1. 保持本仓库在 GitHub 上公开。
2. 向 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提交 PR，按该列表 README 的格式加一条指向本仓库的条目。
3. 目录站点（`awesome-dsh-plugin.com`、`dshmarket.com`、npm 索引）每日构建；市场自动收录，通常一天内生效。

建议（可选）：同时 `npm publish` 本包——之后 `dsh plugin … add dsh-model-connection-test` 会走 npm 通道，这是最快、经过最多校验的安装路径。

## 开发

```
index.js           宿主半：webServer 路由 + 基于 ctx.llm 的探测
client.js          客户端半：settings.models.footer 插槽 + 面板
cordis.patch.yml   bundle 补丁（一行 insert）
locale/zh|en.json  展示元数据（meta.title/description）+ 界面文案
icon.svg           面板/市场图标
```

使用的扩展点与服务（已对照 DSH 0.2.1-rc.2 验证）：

- `settings.models.footer`（list 席位），由 `@deepseek-ai/dsh-client-ui-settings-models` 声明。
- 客户端注入 `slots`、`locale`、`remote`、`remote.session`；目录经 `ctx.remote.session.modelCatalog()`（返回 `RemoteResult`，取 `.ok`/`.value`）。
- 宿主注入 `webServer` + `llm`；路由经 `webServer.register({ kind: 'exact', path, handler })`（register 返回 disposer）。
- 探测经 `ctx.llm.stream({ provider, model, messages, signal, maxTokens })`；终结块 `{ type: 'finish', reason: { kind: 'stop' | 'max-tokens' | 'tool-calls' | 'error' | 'aborted', failure? } }`。

本地魔改：直接编辑文件后重新安装 bundle 即可（目录安装是链接，Git 安装会重新下载）。客户端 bundle 变更可能需要刷新页面；宿主变更视情况经 HMR 或重启生效。

## 许可

MIT — 见 [LICENSE](LICENSE)。
