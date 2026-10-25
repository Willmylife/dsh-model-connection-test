/**
 * dsh-model-connection-test — Host half.
 *
 * Registers two exact HTTP routes on the harness web server:
 *
 *   POST /model-connection-test/api/test    probe one model
 *   GET  /model-connection-test/api/health  liveness + registered provider count
 *
 * A probe streams one minimal chat completion through the harness LLM service
 * (`ctx.llm.stream`), which resolves stored credentials inside the Host
 * process. The browser never sees, holds, or sends any credential: it only
 * names a provider route and a model id.
 *
 * Every stream ends with one terminal finish chunk; success, failure, and
 * cancellation are all reduced to one verdict shape:
 *
 *   { ok, code, message, totalMs, firstMs, timedOut }
 *
 * Route fencing mirrors dsh-market: loopback/declared-authority Host check,
 * `sec-fetch-site` cross-site refusal, Origin equality when present, the
 * host's own request gate when the `connection` service publishes one, and a
 * size-capped JSON body reader. An absent Host or Origin is allowed, because
 * the Desktop build's proxy strips both (#dsh-market #648).
 */

const ROUTE_TEST = '/model-connection-test/api/test';
const ROUTE_HEALTH = '/model-connection-test/api/health';

const MAX_BODY_BYTES = 4096;
const DEFAULT_TIMEOUT_MS = 30000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;
const DEFAULT_MAX_TOKENS = 16;
const MAX_MAX_TOKENS = 256;
const MAX_PROMPT_CHARS = 200;
const DEFAULT_PROMPT = 'ping';

/** Write a JSON payload with no-store caching. */
function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

/** Whether a `Host` header names a loopback authority (mirrors dsh-market #678). */
function loopbackAuthority(host) {
  if (typeof host !== 'string') return false;
  const lower = host.toLowerCase();
  // IPv6 literals keep their brackets; `[::1]:3080` -> `[::1]`.
  const name = lower.startsWith('[') ? lower.slice(0, lower.indexOf(']') + 1) : lower.split(':')[0];
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

/** Parse a bare `host[:port]` authority, or null; entries must survive URL parsing unchanged. */
function parseAuthority(value) {
  try {
    const url = new URL(`http://${value}`);
    const canonical = url.port === '' ? url.hostname : `${url.hostname}:${url.port}`;
    return canonical === String(value).toLowerCase() ? url : null;
  } catch {
    return null;
  }
}

/** Whether a request authority is one of the deployment's declared ones. */
function trustedAuthority(host, trustedHosts) {
  const hostUrl = parseAuthority(host);
  if (hostUrl === null || !Array.isArray(trustedHosts)) return false;
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry);
    if (entryUrl === null) return false;
    return entryUrl.port === '' ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
  });
}

/**
 * Same-origin fence for the mutating route. A cross-site page is refused, as
 * is a rebinding page: `Host` is the one header such a page cannot forge, so
 * it has to name a loopback or declared authority when present.
 */
function sameOrigin(request, trustedHosts) {
  const host = request.headers.host;
  if (host !== undefined && !loopbackAuthority(host) && !trustedAuthority(host, trustedHosts)) return false;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  // An absent Origin is not a cross-site request: browsers send it on every
  // POST, so absence means the caller is not a page (Desktop proxy case).
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Read and parse a JSON request body, rejecting anything over `maxBytes`. */
async function readJsonBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Validate one probe request; returns { ok: true, value } or { ok: false, error }. */
function validateTarget(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const { provider, model } = body;
  if (typeof provider !== 'string' || provider.length === 0 || provider.length > 120) {
    return { ok: false, error: 'provider must be a non-empty string (<= 120 chars)' };
  }
  if (typeof model !== 'string' || model.length === 0 || model.length > 200) {
    return { ok: false, error: 'model must be a non-empty string (<= 200 chars)' };
  }
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (body.timeoutMs !== undefined) {
    if (typeof body.timeoutMs !== 'number' || !Number.isFinite(body.timeoutMs)) {
      return { ok: false, error: 'timeoutMs must be a number' };
    }
    timeoutMs = Math.min(Math.max(Math.round(body.timeoutMs), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
  }
  let maxTokens = DEFAULT_MAX_TOKENS;
  if (body.maxTokens !== undefined) {
    if (typeof body.maxTokens !== 'number' || !Number.isInteger(body.maxTokens) || body.maxTokens < 1) {
      return { ok: false, error: 'maxTokens must be a positive integer' };
    }
    maxTokens = Math.min(body.maxTokens, MAX_MAX_TOKENS);
  }
  let prompt = DEFAULT_PROMPT;
  if (body.prompt !== undefined) {
    if (typeof body.prompt !== 'string') return { ok: false, error: 'prompt must be a string' };
    prompt = body.prompt.slice(0, MAX_PROMPT_CHARS);
    if (prompt.length === 0) prompt = DEFAULT_PROMPT;
  }
  return { ok: true, value: { provider, model, timeoutMs, maxTokens, prompt } };
}

/**
 * Stream one minimal completion through the LLM service and reduce it to a
 * verdict. The stream vocabulary stays opaque on purpose: only the terminal
 * `type: 'finish'` chunk and its `reason.kind`/`reason.failure` shape are
 * read, so chunk-kind changes upstream cannot break the probe.
 */
async function probeModel(llm, target) {
  const { provider, model, timeoutMs, maxTokens, prompt } = target;
  const started = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let firstMs;
  let chunks = 0;
  try {
    const stream = llm.stream({
      provider,
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      signal: controller.signal,
      maxTokens,
    });
    for await (const chunk of stream) {
      chunks += 1;
      if (firstMs === undefined) firstMs = Date.now() - started;
      if (chunk && chunk.type === 'finish') {
        const reason = chunk.reason;
        const totalMs = Date.now() - started;
        if (reason && reason.kind === 'finish') {
          return {
            ok: true,
            code: null,
            message: `stream completed after ${chunks} chunk(s)`,
            totalMs,
            firstMs,
            timedOut: false,
          };
        }
        const failure = reason && reason.failure;
        const code = timedOut
          ? 'TIMEOUT'
          : typeof (failure && failure.code) === 'string'
            ? failure.code
            : 'UNKNOWN';
        const message =
          typeof (failure && failure.message) === 'string' && failure.message
            ? failure.message
            : `stream ended with ${reason && reason.kind}`;
        return { ok: false, code, message, totalMs, firstMs, timedOut };
      }
    }
    return {
      ok: false,
      code: 'NO_TERMINAL_CHUNK',
      message: 'the model stream ended without its terminal finish chunk',
      totalMs: Date.now() - started,
      firstMs,
      timedOut: false,
    };
  } catch (error) {
    const code = timedOut
      ? 'TIMEOUT'
      : typeof (error && error.code) === 'string'
        ? error.code
        : 'PROBE_ERROR';
    const message = (error && typeof error.message === 'string' && error.message) || String(error);
    return { ok: false, code, message, totalMs: Date.now() - started, firstMs, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bundle entry. The HTTP surface is registered only once both `webServer`
 * and `llm` are available, and its disposer owns route withdrawal.
 */
export function apply(ctx) {
  ctx.inject(['webServer', 'llm'], (hostCtx) => {
    hostCtx.effect(() => {
      const webServer = hostCtx.get('webServer');
      const llm = hostCtx.get('llm');
      // Read per request, not at mount: the connection service starts after
      // its own async init, so a mount-time read would freeze an empty fence.
      const readConnection = () => {
        try {
          return ctx.get('connection');
        } catch {
          return undefined;
        }
      };
      const testHandler = async (request, response) => {
        try {
          const connection = readConnection();
          const trustedHosts =
            Array.isArray(connection && connection.trustedHosts) ? connection.trustedHosts : [];
          if (!sameOrigin(request, trustedHosts)) {
            sendJson(response, 403, { error: 'untrusted origin' });
            return;
          }
          const gate =
            connection && typeof connection.requestRejection === 'function'
              ? connection.requestRejection
              : undefined;
          if (gate !== undefined) {
            let status;
            try {
              status = gate.call(connection, request);
            } catch {
              // A gate that throws has not admitted anything; fail closed.
              status = 403;
            }
            if (status !== undefined) {
              sendJson(response, status, {
                error:
                  status === 401
                    ? 'DSH login required: reopen the URL dsh printed at startup'
                    : 'request refused by the host',
              });
              return;
            }
          }
          if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'POST' });
            response.end();
            return;
          }
          let body;
          try {
            body = await readJsonBody(request, MAX_BODY_BYTES);
          } catch {
            sendJson(response, 400, { error: 'invalid JSON body' });
            return;
          }
          const validated = validateTarget(body);
          if (!validated.ok) {
            sendJson(response, 400, { error: validated.error });
            return;
          }
          sendJson(response, 200, await probeModel(llm, validated.value));
        } catch (error) {
          sendJson(response, 500, { error: (error && error.message) || 'internal error' });
        }
      };
      const healthHandler = (request, response) => {
        if (request.method !== 'GET') {
          response.writeHead(405, { allow: 'GET' });
          response.end();
          return;
        }
        let providers;
        try {
          providers = typeof llm.listProviders === 'function' ? llm.listProviders().length : 0;
        } catch {
          providers = 0;
        }
        sendJson(response, 200, {
          ok: true,
          plugin: 'dsh-model-connection-test',
          providers,
        });
      };
      const disposers = [
        webServer.register({ kind: 'exact', path: ROUTE_TEST, handler: testHandler }),
        webServer.register({ kind: 'exact', path: ROUTE_HEALTH, handler: healthHandler }),
      ];
      return () => {
        for (const dispose of disposers) {
          try {
            if (typeof dispose === 'function') dispose();
          } catch {
            // Route withdrawal must never mask the original teardown reason.
          }
        }
      };
    }, 'model-connection-test: http routes');
  });
}
