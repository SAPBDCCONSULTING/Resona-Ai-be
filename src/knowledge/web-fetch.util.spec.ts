import { EventEmitter } from 'events';
import { URL } from 'url';
import {
  DEFAULT_WEB_FETCH_LIMITS,
  fetchApprovedWebPage,
  type FetchApprovedPageLimits,
  type HttpsRequestFn,
  type MinimalHttpRequest,
  type MinimalHttpResponse,
} from './web-fetch.util';
import { WebFetchError } from './web-ssrf-guard.util';

/**
 * A fully in-memory fake HTTP client — no real sockets, no real DNS, no
 * real network calls, as required. This also sidesteps an inherent
 * conflict: a REAL local test server would run on 127.0.0.1/localhost,
 * which this feature's own SSRF guard correctly refuses to connect to —
 * so a fake is the only way to exercise the happy path at all, not just
 * a convenience.
 */
type ScriptedResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  chunks?: Buffer[];
  /** If set, the fake request's destroy() will emit this as a request-level error instead of ever calling the response callback. */
  requestError?: Error;
  /** If true, never settles — used to exercise the timeout path under fake timers. */
  neverResponds?: boolean;
};

function makeFakeResponse(script: ScriptedResponse): MinimalHttpResponse {
  const emitter = new EventEmitter() as unknown as MinimalHttpResponse & EventEmitter;
  (emitter as unknown as { statusCode: number }).statusCode = script.statusCode;
  (emitter as unknown as { headers: Record<string, string> }).headers = script.headers ?? {};
  emitter.resume = jest.fn();
  emitter.destroy = jest.fn();
  return emitter;
}

function makeFakeRequest(): MinimalHttpRequest & EventEmitter {
  const emitter = new EventEmitter() as unknown as MinimalHttpRequest & EventEmitter;
  emitter.end = jest.fn();
  emitter.destroy = jest.fn((err?: Error) => {
    if (err) emitter.emit('error', err);
  });
  return emitter;
}

/** requestFn that serves one scripted response per call, in order, from the given queue. */
function scriptedRequestFn(scripts: ScriptedResponse[]): HttpsRequestFn {
  let callIndex = 0;
  return (_url, _options, callback) => {
    const script = scripts[callIndex] ?? scripts[scripts.length - 1];
    callIndex += 1;
    const req = makeFakeRequest();

    if (script.neverResponds) {
      // Deliberately never calls the response callback — the deadline timer must be what settles this.
      return req;
    }

    process.nextTick(() => {
      if (script.requestError) {
        req.emit('error', script.requestError);
        return;
      }
      const res = makeFakeResponse(script);
      callback(res);
      for (const chunk of script.chunks ?? []) {
        (res as unknown as EventEmitter).emit('data', chunk);
      }
      (res as unknown as EventEmitter).emit('end');
    });
    return req;
  };
}

const FAST_LIMITS: FetchApprovedPageLimits = { ...DEFAULT_WEB_FETCH_LIMITS, timeoutMs: 2000 };
const approveEverything = async () => true;
const approveNothing = async () => false;

describe('fetchApprovedWebPage', () => {
  it('fetches a simple 200 HTML page successfully', async () => {
    const requestFn = scriptedRequestFn([
      { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, chunks: [Buffer.from('<html>hi</html>')] },
    ]);
    const result = await fetchApprovedWebPage('https://example.com/page', approveEverything, FAST_LIMITS, requestFn);
    expect(result.html.toString()).toBe('<html>hi</html>');
    expect(result.contentType).toBe('text/html');
    expect(result.finalUrl).toBe('https://example.com/page');
  });

  it('never issues a network call at all for a URL that is not approved', async () => {
    const requestFn = jest.fn() as unknown as HttpsRequestFn;
    await expect(
      fetchApprovedWebPage('https://example.com/page', approveNothing, FAST_LIMITS, requestFn),
    ).rejects.toMatchObject({ code: 'not_approved' });
    expect(requestFn).not.toHaveBeenCalled();
  });

  it('rejects a malformed URL before any approval check or network call', async () => {
    const requestFn = jest.fn() as unknown as HttpsRequestFn;
    const isApproved = jest.fn();
    await expect(
      fetchApprovedWebPage('not a url', isApproved, FAST_LIMITS, requestFn),
    ).rejects.toMatchObject({ code: 'invalid_url' });
    expect(isApproved).not.toHaveBeenCalled();
    expect(requestFn).not.toHaveBeenCalled();
  });

  it('follows an approved redirect to its approved target', async () => {
    const requestFn = scriptedRequestFn([
      { statusCode: 302, headers: { location: 'https://example.com/final' } },
      { statusCode: 200, headers: { 'content-type': 'text/html' }, chunks: [Buffer.from('final page')] },
    ]);
    const approved = new Set(['https://example.com/start', 'https://example.com/final']);
    const isApproved = async (url: URL) => approved.has(url.toString());

    const result = await fetchApprovedWebPage('https://example.com/start', isApproved, FAST_LIMITS, requestFn);
    expect(result.finalUrl).toBe('https://example.com/final');
    expect(result.html.toString()).toBe('final page');
  });

  it('rejects a redirect to a URL that is not itself approved, even though the start URL was', async () => {
    const requestFn = scriptedRequestFn([
      { statusCode: 302, headers: { location: 'https://attacker.example/evil' } },
    ]);
    const isApproved = async (url: URL) => url.toString() === 'https://example.com/start';

    await expect(
      fetchApprovedWebPage('https://example.com/start', isApproved, FAST_LIMITS, requestFn),
    ).rejects.toMatchObject({ code: 'not_approved' });
  });

  it('rejects a redirect loop once it exceeds the configured maximum', async () => {
    const requestFn: HttpsRequestFn = (_url, _options, callback) => {
      const req = makeFakeRequest();
      process.nextTick(() => {
        const res = makeFakeResponse({ statusCode: 302, headers: { location: 'https://example.com/loop' } });
        callback(res);
        (res as unknown as EventEmitter).emit('end');
      });
      return req;
    };
    await expect(
      fetchApprovedWebPage(
        'https://example.com/loop',
        approveEverything,
        { ...FAST_LIMITS, maxRedirects: 2 },
        requestFn,
      ),
    ).rejects.toMatchObject({ code: 'too_many_redirects' });
  });

  it('rejects a response over the configured size limit, destroying the connection', async () => {
    const bigChunk = Buffer.alloc(1000, 'a');
    const requestFn = scriptedRequestFn([
      { statusCode: 200, headers: { 'content-type': 'text/html' }, chunks: [bigChunk, bigChunk] },
    ]);
    await expect(
      fetchApprovedWebPage(
        'https://example.com/huge',
        approveEverything,
        { ...FAST_LIMITS, maxResponseBytes: 1500 },
        requestFn,
      ),
    ).rejects.toMatchObject({ code: 'response_too_large' });
  });

  it('rejects a non-HTML content type', async () => {
    const requestFn = scriptedRequestFn([
      { statusCode: 200, headers: { 'content-type': 'application/json' }, chunks: [Buffer.from('{}')] },
    ]);
    await expect(
      fetchApprovedWebPage('https://example.com/api', approveEverything, FAST_LIMITS, requestFn),
    ).rejects.toMatchObject({ code: 'unexpected_content_type' });
  });

  it('rejects a non-2xx/3xx HTTP status', async () => {
    const requestFn = scriptedRequestFn([{ statusCode: 500 }]);
    await expect(
      fetchApprovedWebPage('https://example.com/broken', approveEverything, FAST_LIMITS, requestFn),
    ).rejects.toMatchObject({ code: 'fetch_failed' });
  });

  it('propagates a request-level network error safely', async () => {
    const requestFn = scriptedRequestFn([{ statusCode: 0, requestError: new Error('ECONNRESET') }]);
    await expect(
      fetchApprovedWebPage('https://example.com/flaky', approveEverything, FAST_LIMITS, requestFn),
    ).rejects.toBeInstanceOf(WebFetchError);
  });

  it('times out a request that never responds, using the overall deadline, and destroys the connection', async () => {
    jest.useFakeTimers();
    try {
      const requestFn = scriptedRequestFn([{ statusCode: 0, neverResponds: true }]);
      const promise = fetchApprovedWebPage(
        'https://example.com/slow',
        approveEverything,
        { ...FAST_LIMITS, timeoutMs: 1000 },
        requestFn,
      );
      const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' });
      await jest.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('never sets any Authorization or Cookie header on the outbound request', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const requestFn: HttpsRequestFn = (_url, options, callback) => {
      capturedHeaders = options.headers;
      const req = makeFakeRequest();
      process.nextTick(() => {
        const res = makeFakeResponse({ statusCode: 200, headers: { 'content-type': 'text/html' } });
        callback(res);
        (res as unknown as EventEmitter).emit('end');
      });
      return req;
    };
    await fetchApprovedWebPage('https://example.com/page', approveEverything, FAST_LIMITS, requestFn);
    expect(capturedHeaders).toBeDefined();
    expect(Object.keys(capturedHeaders!).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(Object.keys(capturedHeaders!).map((h) => h.toLowerCase())).not.toContain('cookie');
  });
});
