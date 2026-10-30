# dsh-model-connection-test

[中文](README.zh.md) | English

A [DeepSeek Harness](https://github.com/deepseek-ai) plugin that adds a **connection test** to **Settings → Models**: one minimal chat round-trip per configured model, with a connected / unstable / failed verdict, the harness failure code, and first-output / total latency.

DeepSeek Harness configures model providers and their catalogs in Settings → Models, but nothing in that page tells you whether a configured model actually answers. This plugin fills that gap with a real end-to-end probe — the same call path the agent itself uses.

## Install

**From the plugin market (dsh-market):** after this repository is listed in [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin), search for **Model Connection Test / 模型连接测试** and install it. No restart is needed in most cases.

**From the CLI (any host):**

```sh
dsh plugin --profile <your-profile> add https://github.com/Willmylife/dsh-model-connection-test
```

**From DeepSeek Harness Desktop:** open the app's own **Settings → Plugins** and install from the market or a Git URL. The Desktop profile is owned by the app's plugin manager while the app runs.

Requires **DSH ≥ 0.2.0** (`engines.dsh`). The plugin is plain JavaScript — no build step, no dependency install, no build scripts to approve.

## What you get

- A **模型连接测试 / Model connection test** panel at the bottom of Settings → Models.
- It lists every currently routable provider group and model from the deployment's live model catalog (`session.modelCatalog`), marking the default pair.
- **Test** next to a row probes that one model; **Test group** sweeps one provider; **Test all** walks the whole catalog with a small concurrency (3), showing a progress bar and an `n/N` counter while it runs.
- Each row reports one of five states: `Connected 1.2s`, `Unstable <CODE>` (the probe retried a transient failure and it still failed — usually worth trying again later), `Failed <CODE>` (a configuration-level answer such as `AUTH` or `NO_ADAPTER`), testing, or not tested.
- The probe retries the same transient failure codes the agent loop retries (`RATE_LIMIT`, `SERVER`, `TRANSPORT`, `EMPTY_RESPONSE`), so one busy second on a relay no longer reads as an unreachable model. Every `<CODE>`, the failure message, and the retry count stay on hover.
- Providers the catalog itself reports as unavailable are listed separately with their reason.
- The catalog can be refreshed without leaving the page.

## How it works

```
Browser (client.js)                          Host (index.js)
─────────────────────                        ────────────────────────────────
settings.models.footer slot                  POST /model-connection-test/api/test
  └─ ctx.remote.session.modelCatalog()       same-origin fence + 4 KiB body cap
  └─ fetch POST { provider, model }  ──────► ctx.llm.stream({
                                               provider, model,
                                               messages: [{ user, "ping" }],
                                               maxTokens ≤ 256, signal
                                             })
                                             one terminal finish chunk  ──────►
  verdict + failure code + latencies  ◄─────────  { ok, code, message, totalMs, firstMs,
                                                   attempts, transient }
```

- The probe runs **inside the Host process** through `ctx.llm.stream`, the only supported path into the provider adapters. Stored credentials resolve there and never reach the browser, the wire, or any log of this plugin.
- The probe reads the terminal chunk of the stream (`type: 'finish'`): `reason.kind` of `stop`, `max-tokens`, or `tool-calls` is a completed request; `error` and `aborted` carry failure details. First-output latency starts at the first text, reasoning, or tool-call output chunk.
- One POST per model, so a hanging model cannot block others; the client keeps its own per-row state.
- A verdict may span one to three provider attempts: transient failures are re-probed with a short backoff (the same codes the agent loop retries; `TIMEOUT` gets one extra attempt at most), and configuration failures — `AUTH`, `MISSING_CREDENTIAL`, `NO_ADAPTER`, … — are final on the first attempt. `transient: true` on a final failure tells the UI to say "unstable" instead of "broken".
- `GET /model-connection-test/api/health` returns `{ ok: true, providers: <n> }` for quick diagnosis.

## Security

- The test route is fenced like dsh-market's: `Host` must be loopback or a deployment-declared authority, cross-site `sec-fetch-site` is refused, `Origin` must match when present, the host's own request gate is honored when published, and bodies are capped at 4 KiB.
- The probe prompt is a fixed short `"ping"` with a small output cap (default 16, hard max 256 tokens), so a full-catalog sweep costs a handful of tokens.
- Per-attempt timeout defaults to 60 s (configurable 1–120 s via the request body; `retries` 0–4, default 2).
- The plugin stores nothing and reports nothing anywhere.

## Publish / marketplace listing

This repository is the installable bundle itself (repo root = package root; plain JS, no build). To make it appear in dsh-market:

1. Keep this repository public on GitHub.
2. Open a PR to [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) adding one entry pointing at this repository (follow that list's README format).
3. The catalog sites (`awesome-dsh-plugin.com`, `dshmarket.com`, the npm index) rebuild daily; the market picks the entry up automatically, usually within a day.

Optional but recommended: also `npm publish` the package (`dsh plugin … add dsh-model-connection-test` then installs from npm, which is the fastest and most verified channel).

## Development

```
index.js           Host half: webServer routes + probe via ctx.llm
client.js          Client half: settings.models.footer slot + panel
cordis.patch.yml   bundle patch (one insert row)
locale/zh|en.json  display metadata (meta.title/description) + UI copy
icon.svg           panel/market icon
```

Extension points and services used (verified against DSH 0.2.1-rc.2):

- `settings.models.footer` (list seat) declared by `@deepseek-ai/dsh-client-ui-settings-models`.
- Client injects `slots`, `locale`, `remote`, `remote.session`; catalog via `ctx.remote.session.modelCatalog()` (returns `RemoteResult`, unwrap `.ok`/`.value`).
- Host injects `webServer` + `llm`; routes via `webServer.register({ kind: 'exact', path, handler })` (handler returns a disposer).
- Probes via `ctx.llm.stream({ provider, model, messages, signal, maxTokens })`; terminal chunk `{ type: 'finish', reason: { kind: 'stop' | 'max-tokens' | 'tool-calls' | 'error' | 'aborted', failure? } }`. A verdict retries transient codes and reports `{ attempts, transient }` alongside the failure.

To hack locally: edit the files, then reinstall the bundle (a directory install links the checkout; a Git install re-downloads). Client bundle changes may need a page refresh; Host changes survive HMR or a restart depending on the change.

## License

MIT — see [LICENSE](LICENSE).
