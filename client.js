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
      panelIntro: '对每个模型发送一次最小对话请求（“ping”，输出上限很小），以真实请求验证连通性。结果仅供参考延迟量级。',
      refresh: '刷新目录',
      testAll: '全部测试',
      testOne: '测试',
      testing: '测试中…',
      idle: '未测试',
      okLabel: '已连通',
      failLabel: '失败',
      firstToken: '首个输出',
      total: '总耗时',
      defaultTag: '默认',
      catalogLoading: '正在读取模型目录…',
      catalogError: '无法读取模型目录',
      noModels: '没有可测试的模型',
      catalogFailures: '目录报告这些提供商暂不可用：',
      hostUnreachable: '无法连接插件宿主接口',
      requestFailed: '请求失败',
    };
    const en = {
      panelTitle: 'Model connection test',
      panelIntro: 'Sends one minimal chat request ("ping", small output cap) per model to verify connectivity with a real request. Latency numbers indicate magnitude only.',
      refresh: 'Refresh catalog',
      testAll: 'Test all',
      testOne: 'Test',
      testing: 'Testing…',
      idle: 'Not tested',
      okLabel: 'Connected',
      failLabel: 'Failed',
      firstToken: 'first output',
      total: 'total',
      defaultTag: 'default',
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
.mct-panel{display:flex;flex-direction:column;gap:12px;margin-top:16px;padding:14px;border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);color:var(--dsw-alias-label-primary)}
.mct-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.mct-title{font-size:14px;font-weight:500;line-height:22px;margin:0}
.mct-intro{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0;max-width:640px}
.mct-actions{margin-left:auto;display:inline-flex;gap:6px;align-self:center}
.mct-btn{box-sizing:border-box;height:28px;padding:0 10px;font:inherit;font-size:12px;line-height:26px;cursor:pointer;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary)}
.mct-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-tertiary)}
.mct-btn:disabled{opacity:.5;cursor:default}
.mct-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.mct-error{color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px;margin:0}
.mct-groups{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}
.mct-group{display:flex;flex-direction:column;gap:6px}
.mct-groupHead{display:flex;align-items:baseline;gap:8px}
.mct-groupName{font-size:13px;font-weight:500;line-height:20px}
.mct-groupId{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);word-break:break-all}
.mct-rows{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}
.mct-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md)}
.mct-modelName{font-size:13px;line-height:20px;flex:none}
.mct-modelId{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);word-break:break-all;min-width:0}
.mct-tag{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);color:var(--dsw-alias-label-secondary);padding:1px 6px;font-size:11px;line-height:16px;flex:none}
.mct-spacer{margin-left:auto;flex:none}
.mct-chip{font-size:12px;line-height:18px;flex:none;text-align:right}
.mct-chipOk{color:var(--dsw-alias-state-success-primary)}
.mct-chipFail{color:var(--dsw-alias-state-error-primary)}
.mct-chipIdle,.mct-chipRunning{color:var(--dsw-alias-label-tertiary)}
.mct-failures{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}
.mct-failures dt{font-weight:500;color:var(--dsw-alias-label-secondary)}
.mct-failures dd{margin:0 0 4px 0;word-break:break-all}
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

    function resultChip(t, result) {
      if (!result || result.status === 'idle') {
        return h('span', { className: 'mct-chip mct-chipIdle', 'aria-label': t('idle') }, t('idle'));
      }
      if (result.status === 'running') {
        return h('span', { className: 'mct-chip mct-chipRunning', role: 'status' }, t('testing'));
      }
      if (result.status === 'ok') {
        const detail = `${t('firstToken')}: ${fmtMs(result.firstMs) || '–'} · ${t('total')}: ${fmtMs(result.totalMs) || '–'}`;
        return h(
          'span',
          { className: 'mct-chip mct-chipOk', title: detail },
          `✓ ${t('okLabel')} ${fmtMs(result.totalMs)}`,
        );
      }
      const code = result.code || 'FAIL';
      const message = result.message ? `${code}: ${result.message}` : code;
      return h(
        'span',
        { className: 'mct-chip mct-chipFail', title: message },
        `✗ ${t('failLabel')} ${code}`,
      );
    }

    function ModelRow({ t, target, result, onTest, busy, defaultTag }) {
      return h('li', { className: 'mct-row' },
        h('span', { className: 'mct-modelName' }, target.modelName),
        defaultTag ? h('span', { className: 'mct-tag' }, defaultTag) : null,
        h('span', { className: 'mct-modelId' }, target.model),
        h('span', { className: 'mct-spacer' }),
        resultChip(t, result),
        h('button', {
          type: 'button',
          className: 'mct-btn',
          disabled: busy,
          'aria-label': `${t('testOne')} ${target.modelName}`,
          onClick: () => onTest(target),
        }, busy ? t('testing') : t('testOne')),
      );
    }

    function Panel({ t, remote }) {
      const [catalog, setCatalog] = React.useState(null);
      const [catalogError, setCatalogError] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      const [results, setResults] = React.useState({});
      const [runningAll, setRunningAll] = React.useState(false);

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
        const key = `${target.provider}::${target.model}`;
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
            setResults((prev) => ({ ...prev, [key]: { status: 'fail', code: `HTTP_${response.status}`, message } }));
            return;
          }
          if (payload.ok === true) {
            setResults((prev) => ({
              ...prev,
              [key]: { status: 'ok', totalMs: payload.totalMs, firstMs: payload.firstMs },
            }));
          } else {
            setResults((prev) => ({
              ...prev,
              [key]: { status: 'fail', code: payload.code, message: payload.message },
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

      const testAll = React.useCallback(async () => {
        if (runningAll || targets.length === 0) return;
        setRunningAll(true);
        try {
          let index = 0;
          const worker = async () => {
            while (index < targets.length) {
              const current = targets[index++];
              await testOne(current);
            }
          };
          const workers = [];
          for (let i = 0; i < Math.min(RUNNING_LIMIT, targets.length); i += 1) workers.push(worker());
          await Promise.all(workers);
        } finally {
          setRunningAll(false);
        }
      }, [runningAll, targets, testOne]);

      const failures = catalog && Array.isArray(catalog.failures) ? catalog.failures : [];
      const defaults = catalog && catalog.default ? catalog.default : null;

      return h('section', { className: 'mct-panel', 'aria-label': t('panelTitle') },
        h('style', MONO_HINT, styles),
        h('div', { className: 'mct-head' },
          h('h3', { className: 'mct-title' }, t('panelTitle')),
          h('div', { className: 'mct-actions' },
            h('button', {
              type: 'button', className: 'mct-btn', onClick: loadCatalog, disabled: loading,
            }, t('refresh')),
            h('button', {
              type: 'button', className: 'mct-btn', onClick: testAll,
              disabled: runningAll || loading || targets.length === 0,
            }, runningAll ? t('testing') : t('testAll')),
          ),
        ),
        h('p', { className: 'mct-intro' }, t('panelIntro')),
        loading && !catalog
          ? h('p', { className: 'mct-meta', role: 'status' }, t('catalogLoading'))
          : null,
        catalogError
          ? h('p', { className: 'mct-error', role: 'alert' }, `${t('catalogError')}: ${catalogError}`)
          : null,
        catalog && targets.length === 0 && !catalogError
          ? h('p', { className: 'mct-meta' }, t('noModels'))
          : null,
        catalog && routableGroups.length > 0
          ? h('ul', { className: 'mct-groups' }, routableGroups.map((group) =>
              h('li', { className: 'mct-group', key: group.id },
                h('div', { className: 'mct-groupHead' },
                  h('span', { className: 'mct-groupName' }, group.name || group.id),
                  h('span', { className: 'mct-groupId' }, group.id),
                  h('span', { className: 'mct-tag' }, `${(group.models || []).length}`),
                ),
                h('ul', { className: 'mct-rows' }, (group.models || []).map((model) => {
                  const target = {
                    provider: group.id,
                    providerName: group.name || group.id,
                    model: model.id,
                    modelName: model.name || model.id,
                  };
                  const key = `${target.provider}::${target.model}`;
                  const result = results[key] || { status: 'idle' };
                  const busy = result.status === 'running';
                  const isDefault = !!defaults && defaults.provider === group.id && defaults.model === model.id;
                  return h(ModelRow, {
                    key: model.id,
                    t, target, result, onTest: testOne, busy,
                    defaultTag: isDefault ? t('defaultTag') : null,
                  });
                })),
              )))
          : null,
        failures.length > 0
          ? h('dl', { className: 'mct-failures' },
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
