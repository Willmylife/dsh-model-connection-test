/**
 * dsh-model-connection-test — Client half (Web).
 *
 * Registers one list entry into the `settings.models.footer` seat of
 * `@deepseek-ai/dsh-client-ui-settings-models`, which renders after the
 * provider rows and the add controls on the Settings -> Models page.
 *
 * The panel reads the deployment's model catalog through the existing
 * `session.modelCatalog` Remote (provider-grouped, already filtered to
 * currently routable providers) and probes one model per POST to the Host
 * route registered by this bundle's Host half. Credentials stay in the Host.
 *
 * A verdict is one of five row states: idle, running, connected, unstable
 * (the Host retried a transient failure and it still failed — the model may
 * work again shortly), and failed (a configuration-level answer such as
 * AUTH or NO_ADAPTER). The visual language follows the models page itself:
 * the same card surface, hairline row separators, 28px row-scale buttons,
 * and state tokens, so the panel sits in the page as a native block.
 *
 * Per harness plugin practice this module:
 *   - requires only `react` from the browser module table;
 *   - registers no side effects outside `apply`, and none at factory time;
 *   - styles with `--dsw-alias-*` theme tokens only, under an `mct-` prefix;
 *   - routes visible text through the Client locale service.
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-connection-test',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-model-connection-test';

    const zh = {
      panelTitle: '模型连接测试',
      panelIntro: '对每个模型发送一次最小对话请求（“ping”，输出上限很小），以真实请求验证连通性。瞬时故障会自动重试；结果仅供参考延迟量级。',
      refresh: '刷新目录',
      testAll: '全部测试',
      testOne: '测试',
      testGroup: '测试本组',
      testing: '测试中…',
      idle: '未测试',
      okLabel: '已连通',
      warnLabel: '不稳定',
      failLabel: '失败',
      firstToken: '首个输出',
      total: '总耗时',
      defaultTag: '默认',
      groupCount: '{n} 个模型',
      totalModels: '共 {n} 个模型',
      retriedOk: '重试 {n} 次后连通',
      retriedTimes: '已重试 {n} 次仍未通过',
      transientHint: '多为暂时性故障，稍后重试可能恢复',
      expandGroup: '展开分组',
      collapseGroup: '收起分组',
      catalogLoading: '正在读取模型目录…',
      catalogError: '无法读取模型目录',
      noModels: '没有可测试的模型',
      catalogFailures: '目录报告这些提供商暂不可用：',
      hostUnreachable: '无法连接插件宿主接口',
      requestFailed: '请求失败',
    };
    const en = {
      panelTitle: 'Model connection test',
      panelIntro: 'Sends one minimal chat request ("ping", small output cap) per model to verify connectivity with a real request. Transient failures are retried; latency numbers indicate magnitude only.',
      refresh: 'Refresh catalog',
      testAll: 'Test all',
      testOne: 'Test',
      testGroup: 'Test group',
      testing: 'Testing…',
      idle: 'Not tested',
      okLabel: 'Connected',
      warnLabel: 'Unstable',
      failLabel: 'Failed',
      firstToken: 'first output',
      total: 'total',
      defaultTag: 'default',
      groupCount: '{n} models',
      totalModels: '{n} models',
      retriedOk: 'connected after {n} extra attempt(s)',
      retriedTimes: 'still failing after {n} extra attempt(s)',
      transientHint: 'Usually transient — a retry later may succeed',
      expandGroup: 'Expand group',
      collapseGroup: 'Collapse group',
      catalogLoading: 'Loading the model catalog…',
      catalogError: 'Failed to load the model catalog',
      noModels: 'No testable models',
      catalogFailures: 'The catalog reports these providers as currently unavailable:',
      hostUnreachable: 'Cannot reach the plugin host endpoint',
      requestFailed: 'Request failed',
    };

    const ROUTE_TEST = 'model-connection-test/api/test';
    const RUNNING_LIMIT = 3;

    /** Same-origin path the way dsh-market builds it: pathname under the page. */
    function apiPath(relative) {
      if (typeof document === 'undefined') return `/${relative}`;
      return new URL(relative, document.baseURI).pathname;
    }

    function fmtMs(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
      return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
    }

    const styles = `
.mct-panel{position:relative;display:flex;flex-direction:column;gap:10px;margin-top:4px;padding:12px 14px;border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);color:var(--dsw-alias-label-primary);overflow:hidden}
.mct-progress{position:absolute;top:0;left:0;height:2px;background:var(--dsw-alias-state-business-primary);transition:width .25s ease}
.mct-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.mct-title{font-size:14px;font-weight:500;line-height:22px;margin:0;flex:none}
.mct-headMeta{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;min-width:0}
.mct-headMeta .mct-sep{opacity:.6}
.mct-countOk{color:var(--dsw-alias-state-success-primary);font-variant-numeric:tabular-nums}
.mct-countWarn{color:var(--dsw-alias-state-warn-label);font-variant-numeric:tabular-nums}
.mct-countFail{color:var(--dsw-alias-state-error-primary);font-variant-numeric:tabular-nums}
.mct-actions{margin-left:auto;display:inline-flex;gap:8px;align-self:center;flex:none}
.mct-btn{box-sizing:border-box;height:28px;padding:0 10px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap}
.mct-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.mct-btn:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline:none}
.mct-btn:disabled{opacity:.4;cursor:default}
.mct-btnPrimary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.mct-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.mct-intro{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}
.mct-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}
.mct-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:0}
.mct-skeleton{display:flex;flex-direction:column;gap:8px}
.mct-skeletonRow{height:26px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);animation:mctPulse 1.4s ease-in-out infinite}
.mct-skeletonRow:nth-child(2){animation-delay:.15s}
.mct-skeletonRow:nth-child(3){animation-delay:.3s}
.mct-groups{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.mct-group{display:flex;flex-direction:column}
.mct-group+.mct-group{margin-top:10px}
.mct-groupHead{display:flex;align-items:center;gap:4px;min-width:0;border-radius:var(--dsw-radius-sm);padding:0 2px 0 4px}
.mct-groupHead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mct-groupToggle{display:flex;align-items:center;gap:8px;min-width:0;flex:1;height:30px;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mct-groupToggle:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline:none;border-radius:var(--dsw-radius-xs)}
.mct-caret{flex:none;width:5px;height:5px;border-bottom:1.5px solid var(--dsw-alias-label-secondary);border-right:1.5px solid var(--dsw-alias-label-secondary);transform:rotate(-45deg);transition:transform .12s ease}
.mct-caretOpen{transform:rotate(45deg)}
.mct-groupName{font-size:13px;font-weight:500;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}
.mct-groupCount{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);flex:none}
.mct-groupDots{display:inline-flex;align-items:center;gap:3px;flex:none}
.mct-miniDot{width:5px;height:5px;border-radius:50%;flex:none}
.mct-iconBtn{box-sizing:border-box;width:26px;height:26px;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.mct-iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mct-iconBtn:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline:none}
.mct-iconBtn:disabled{opacity:.4;cursor:default}
.mct-play{width:0;height:0;border-style:solid;border-width:5px 0 5px 8px;border-color:transparent transparent transparent currentColor;margin-left:2px}
.mct-playBusy{width:8px;height:8px;margin:0;border-radius:50%;background:currentColor;animation:mctPulse .9s ease-in-out infinite}
.mct-rows{display:flex;flex-direction:column;margin:0;padding:0 0 0 20px;list-style:none}
.mct-row{display:grid;grid-template-columns:10px minmax(0,1fr) 136px 64px;align-items:center;gap:8px;min-height:36px;padding:7px 2px 7px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.mct-row:first-child{border-top:none}
.mct-dot{width:8px;height:8px;border-radius:50%;box-sizing:border-box;justify-self:center}
.mct-dotIdle{border:1.5px solid var(--dsw-alias-border-l4);background:transparent}
.mct-dotRunning{background:var(--dsw-alias-state-business-primary);animation:mctBlink .9s ease-in-out infinite}
.mct-dotOk{background:var(--dsw-alias-state-success-primary)}
.mct-dotWarn{background:var(--dsw-alias-state-warn-label)}
.mct-dotFail{background:var(--dsw-alias-state-error-primary)}
.mct-model{display:inline-flex;align-items:center;gap:6px;min-width:0}
.mct-modelName{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.mct-tag{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);color:var(--dsw-alias-label-tertiary);padding:1px 6px;font-size:11px;line-height:16px;flex:none}
.mct-result{font-size:12px;line-height:18px;justify-self:end;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.mct-resultIdle{color:var(--dsw-alias-label-tertiary)}
.mct-resultRunning{color:var(--dsw-alias-state-business-primary)}
.mct-resultOk{color:var(--dsw-alias-state-success-primary)}
.mct-resultWarn{color:var(--dsw-alias-state-warn-label)}
.mct-resultFail{color:var(--dsw-alias-state-error-primary)}
.mct-btnRow{width:64px;padding:0}
.mct-notice{display:flex;flex-direction:column;gap:2px;margin:0;font-size:12px;line-height:18px}
.mct-notice dt{font-weight:500;color:var(--dsw-alias-state-warn-label)}
.mct-notice dd{margin:0 0 2px 0;color:var(--dsw-alias-label-tertiary);word-break:break-all}
@keyframes mctPulse{50%{opacity:.35}}
@keyframes mctBlink{0%,100%{opacity:1}50%{opacity:.3}}
@media (prefers-reduced-motion:reduce){.mct-skeletonRow,.mct-dotRunning,.mct-playBusy,.mct-progress{animation:none;transition:none}}
`;

    const MONO_HINT = { key: 'mct-style-once' };

    /** Flatten a loaded catalog into probe targets, in catalog order. */
    function targetsOf(catalog) {
      const routable = new Set(catalog.routableProviders || []);
      const targets = [];
      for (const group of catalog.groups || []) {
        if (!routable.has(group.id)) continue;
        for (const model of group.models || []) {
          targets.push({
            provider: group.id,
            providerName: group.name || group.id,
            model: model.id,
            modelName: model.name || model.id,
          });
        }
      }
      return targets;
    }

    function keyOf(target) {
      return `${target.provider}::${target.model}`;
    }

    /** One line describing a finished verdict for the row tooltip. */
    function detailOf(t, result) {
      if (result.status === 'ok') {
        let detail = `${t('firstToken')}: ${fmtMs(result.firstMs) || '–'} · ${t('total')}: ${fmtMs(result.totalMs) || '–'}`;
        if (typeof result.attempts === 'number' && result.attempts > 1) {
          detail += `\n${t('retriedOk', { n: result.attempts - 1 })}`;
        }
        return detail;
      }
      let detail = result.message ? `${result.code}: ${result.message}` : result.code;
      if (typeof result.attempts === 'number' && result.attempts > 1) {
        detail += `\n${t('retriedTimes', { n: result.attempts - 1 })}`;
      }
      if (result.transient) detail += `\n${t('transientHint')}`;
      return detail;
    }

    /** The trailing cell: one short status word, never longer than the column. */
    function ResultCell({ t, result }) {
      const state = result ? result.status : 'idle';
      if (state === 'idle') {
        return h('span', { className: 'mct-result mct-resultIdle' }, t('idle'));
      }
      if (state === 'running') {
        return h('span', { className: 'mct-result mct-resultRunning', role: 'status' }, t('testing'));
      }
      if (state === 'ok') {
        const latency = fmtMs(result.totalMs);
        return h(
          'span',
          { className: 'mct-result mct-resultOk', title: detailOf(t, result) },
          latency ? `${t('okLabel')} ${latency}` : t('okLabel'),
        );
      }
      const className = state === 'warn' ? 'mct-result mct-resultWarn' : 'mct-result mct-resultFail';
      const label = state === 'warn' ? t('warnLabel') : t('failLabel');
      return h(
        'span',
        { className, title: detailOf(t, result) },
        `${label} · ${result.code || 'FAIL'}`,
      );
    }

    function StatusDot({ state }) {
      return h('span', { className: `mct-dot mct-dot${state[0].toUpperCase()}${state.slice(1)}`, 'aria-hidden': true });
    }

    function ModelRow({ t, target, result, onTest, busy, defaultTag }) {
      const state = result ? result.status : 'idle';
      return h('li', { className: 'mct-row' },
        h(StatusDot, { state }),
        h('span', { className: 'mct-model' },
          h('span', { className: 'mct-modelName', title: target.model }, target.modelName),
          defaultTag ? h('span', { className: 'mct-tag' }, defaultTag) : null,
        ),
        h(ResultCell, { t, result }),
        h('button', {
          type: 'button',
          className: 'mct-btn mct-btnRow',
          disabled: busy,
          'aria-label': `${t('testOne')} ${target.modelName}`,
          onClick: () => onTest(target),
        }, state === 'running' ? t('testing') : t('testOne')),
      );
    }

    /** Miniature verdict dots for one provider group header. */
    function groupDots(results, groupModels) {
      const counts = { ok: 0, warn: 0, fail: 0 };
      for (const model of groupModels) {
        const result = results[keyOf(model)];
        if (!result) continue;
        if (result.status === 'ok') counts.ok += 1;
        else if (result.status === 'warn') counts.warn += 1;
        else if (result.status === 'fail') counts.fail += 1;
      }
      const dots = [];
      const push = (cls, n) => {
        for (let i = 0; i < n && dots.length < 6; i += 1) {
          dots.push(h('span', { key: `${cls}${i}`, className: `mct-miniDot ${cls}` }));
        }
      };
      push('mct-dotOk', counts.ok);
      push('mct-dotWarn', counts.warn);
      push('mct-dotFail', counts.fail);
      return dots;
    }

    function Panel({ t, remote }) {
      const [catalog, setCatalog] = React.useState(null);
      const [catalogError, setCatalogError] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      const [results, setResults] = React.useState({});
      const [batch, setBatch] = React.useState(null);
      const [collapsedGroups, setCollapsedGroups] = React.useState(null);
      const batchRef = React.useRef(false);

      const toggleGroup = React.useCallback((groupId) => {
        setCollapsedGroups((previous) => ({
          ...previous,
          [groupId]: previous[groupId] !== true,
        }));
      }, []);

      const loadCatalog = React.useCallback(async () => {
        setLoading(true);
        setCatalogError(null);
        try {
          const session = remote && remote.session;
          if (!session || typeof session.modelCatalog !== 'function') {
            throw new Error('session.modelCatalog is not available');
          }
          const answer = await session.modelCatalog();
          if (!answer || answer.ok !== true) {
            throw new Error((answer && answer.error && answer.error.message) || 'modelCatalog failed');
          }
          setCatalog(answer.value);
          setCollapsedGroups((previous) => {
            const next = {};
            for (const group of answer.value.groups || []) {
              next[group.id] = previous?.[group.id] ?? true;
            }
            return next;
          });
        } catch (error) {
          setCatalogError(String((error && error.message) || error));
        } finally {
          setLoading(false);
        }
      }, [remote]);

      React.useEffect(() => {
        loadCatalog();
      }, [loadCatalog]);

      const testOne = React.useCallback(async (target) => {
        const key = keyOf(target);
        setResults((prev) => ({ ...prev, [key]: { status: 'running' } }));
        try {
          const response = await fetch(apiPath(ROUTE_TEST), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: target.provider, model: target.model }),
          });
          let payload = null;
          try {
            payload = await response.json();
          } catch {
            payload = null;
          }
          if (!response.ok || payload === null) {
            const message = (payload && payload.error) || `${t('requestFailed')} (HTTP ${response.status})`;
            const status = response.status === 429 || response.status >= 500 ? 'warn' : 'fail';
            setResults((prev) => ({ ...prev, [key]: { status, code: `HTTP_${response.status}`, message, transient: status === 'warn' } }));
            return;
          }
          if (payload.ok === true) {
            setResults((prev) => ({
              ...prev,
              [key]: { status: 'ok', totalMs: payload.totalMs, firstMs: payload.firstMs, attempts: payload.attempts },
            }));
          } else {
            setResults((prev) => ({
              ...prev,
              [key]: {
                status: payload.transient === true ? 'warn' : 'fail',
                code: payload.code,
                message: payload.message,
                transient: payload.transient === true,
                attempts: payload.attempts,
              },
            }));
          }
        } catch (error) {
          setResults((prev) => ({
            ...prev,
            [key]: { status: 'fail', code: 'HOST_UNREACHABLE', message: `${t('hostUnreachable')}: ${String((error && error.message) || error)}` },
          }));
        }
      }, [t]);

      const targets = catalog ? targetsOf(catalog) : [];
      const routableGroups = catalog
        ? (catalog.groups || []).filter((group) => targets.some((target) => target.provider === group.id))
        : [];

      /** Walk one list of targets with a small worker pool and one progress counter. */
      const runBatch = React.useCallback(async (list) => {
        if (batchRef.current || list.length === 0) return;
        batchRef.current = true;
        setBatch({ done: 0, total: list.length });
        try {
          let index = 0;
          const worker = async () => {
            while (index < list.length) {
              const current = list[index++];
              await testOne(current);
              setBatch((previous) => (previous === null ? previous : { done: previous.done + 1, total: previous.total }));
            }
          };
          const workers = [];
          for (let i = 0; i < Math.min(RUNNING_LIMIT, list.length); i += 1) workers.push(worker());
          await Promise.all(workers);
        } finally {
          batchRef.current = false;
          setBatch(null);
        }
      }, [testOne]);

      const testAll = React.useCallback(() => {
        runBatch(targets);
      }, [runBatch, targets]);

      const testGroup = React.useCallback((group) => {
        runBatch(targets.filter((target) => target.provider === group.id));
      }, [runBatch, targets]);

      const counts = { ok: 0, warn: 0, fail: 0 };
      for (const target of targets) {
        const result = results[keyOf(target)];
        if (!result) continue;
        if (result.status === 'ok') counts.ok += 1;
        else if (result.status === 'warn') counts.warn += 1;
        else if (result.status === 'fail') counts.fail += 1;
      }
      const started = counts.ok + counts.warn + counts.fail > 0;
      const busy = batch !== null;
      const failures = catalog && Array.isArray(catalog.failures) ? catalog.failures : [];
      const defaults = catalog && catalog.default ? catalog.default : null;

      const metaChips = [];
      if (targets.length > 0) {
        metaChips.push(h('span', { key: 'total' }, t('totalModels', { n: targets.length })));
      }
      if (started) {
        if (counts.ok > 0) metaChips.push(h('span', { className: 'mct-countOk', key: 'ok' }, `✓ ${counts.ok}`));
        if (counts.warn > 0) metaChips.push(h('span', { className: 'mct-countWarn', key: 'warn' }, `⚠ ${counts.warn}`));
        if (counts.fail > 0) metaChips.push(h('span', { className: 'mct-countFail', key: 'fail' }, `✗ ${counts.fail}`));
      }

      return h('section', { className: 'mct-panel', 'aria-label': t('panelTitle') },
        h('style', MONO_HINT, styles),
        busy && batch.total > 0
          ? h('div', {
              className: 'mct-progress',
              style: { width: `${Math.round((batch.done / batch.total) * 100)}%` },
            })
          : null,
        h('div', { className: 'mct-head' },
          h('h3', { className: 'mct-title' }, t('panelTitle')),
          metaChips.length > 1 ? h('span', { className: 'mct-headMeta', role: 'status', 'aria-live': 'polite' },
            metaChips.reduce((nodes, chip, index) => {
              if (index > 0) nodes.push(h('span', { className: 'mct-sep', key: `sep${index}` }, '·'));
              nodes.push(chip);
              return nodes;
            }, []),
          ) : (metaChips.length === 1 ? h('span', { className: 'mct-headMeta' }, metaChips[0]) : null),
          h('div', { className: 'mct-actions' },
            h('button', {
              type: 'button', className: 'mct-btn', onClick: loadCatalog, disabled: loading || busy,
            }, t('refresh')),
            h('button', {
              type: 'button', className: 'mct-btn mct-btnPrimary', onClick: testAll,
              disabled: busy || loading || targets.length === 0,
            }, busy && batch ? `${t('testing')} ${batch.done}/${batch.total}` : t('testAll')),
          ),
        ),
        h('p', { className: 'mct-intro' }, t('panelIntro')),
        loading && !catalog
          ? h('div', { className: 'mct-skeleton', 'aria-hidden': true },
              h('div', { className: 'mct-skeletonRow' }),
              h('div', { className: 'mct-skeletonRow' }),
              h('div', { className: 'mct-skeletonRow' }),
            )
          : null,
        loading && !catalog ? h('p', { className: 'mct-meta', role: 'status' }, t('catalogLoading')) : null,
        catalogError
          ? h('p', { className: 'mct-error', role: 'alert' }, `${t('catalogError')}: ${catalogError}`)
          : null,
        catalog && targets.length === 0 && !catalogError
          ? h('p', { className: 'mct-meta' }, t('noModels'))
          : null,
        catalog && routableGroups.length > 0
          ? h('ul', { className: 'mct-groups' }, routableGroups.map((group) => {
              const collapsed = collapsedGroups === null || collapsedGroups[group.id] === true;
              const groupModelsId = `mct-models-${group.id}`;
              const groupLabel = group.name || group.id;
              const models = group.models || [];
              return h('li', { className: 'mct-group', key: group.id },
                h('div', { className: 'mct-groupHead' },
                  h('button', {
                    type: 'button',
                    className: 'mct-groupToggle',
                    'aria-expanded': !collapsed,
                    'aria-controls': groupModelsId,
                    'aria-label': `${collapsed ? t('expandGroup') : t('collapseGroup')}: ${groupLabel}`,
                    onClick: () => toggleGroup(group.id),
                  },
                    h('span', { className: `mct-caret${collapsed ? '' : ' mct-caretOpen'}`, 'aria-hidden': true }),
                    h('span', { className: 'mct-groupName', title: group.id }, groupLabel),
                    h('span', { className: 'mct-groupCount' }, t('groupCount', { n: models.length })),
                  ),
                  h('span', { className: 'mct-groupDots', 'aria-hidden': true },
                    groupDots(results, models.map((model) => ({ provider: group.id, model: model.id }))),
                  ),
                  h('button', {
                    type: 'button',
                    className: 'mct-iconBtn',
                    disabled: busy,
                    'aria-label': `${t('testGroup')} ${groupLabel}`,
                    title: t('testGroup'),
                    onClick: () => testGroup(group),
                  }, h('span', { className: busy ? 'mct-playBusy' : 'mct-play', 'aria-hidden': true })),
                ),
                collapsed ? null : h('ul', {
                  className: 'mct-rows',
                  id: groupModelsId,
                }, models.map((model) => {
                  const target = {
                    provider: group.id,
                    providerName: groupLabel,
                    model: model.id,
                    modelName: model.name || model.id,
                  };
                  const key = keyOf(target);
                  const result = results[key] || { status: 'idle' };
                  const rowBusy = busy || result.status === 'running';
                  const isDefault = !!defaults && defaults.provider === group.id && defaults.model === model.id;
                  return h(ModelRow, {
                    key: model.id,
                    t, target, result, onTest: testOne, busy: rowBusy,
                    defaultTag: isDefault ? t('defaultTag') : null,
                  });
                })),
              );
            }))
          : null,
        failures.length > 0
          ? h('dl', { className: 'mct-notice' },
              h('dt', null, t('catalogFailures')),
              failures.map((failure) =>
                h('dd', { key: failure.id || failure.name },
                  `${failure.name || failure.id}: ${failure.message || ''}`)),
            )
          : null,
      );
    }

    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'model-connection-test: dictionaries',
      );
      const t = ctx.locale.bind(NS);
      ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
        name: 'settings.models.footer',
        id: 'model-connection-test',
        order: 10,
        locale: NS,
        inject: () => ({ t, remote: ctx.remote }),
      }, Panel));
    }

    return { inject: ['slots', 'locale', 'remote', 'remote.session'], apply };
  },
});
