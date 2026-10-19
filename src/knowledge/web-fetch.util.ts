/**
 * Bounded, SSRF-guarded HTTP fetch for approved web-page ingestion. Built
 * on Node's core https.request (not the global fetch/undici) specifically
 * so a custom `lookup` can be wired in — the mechanism verified directly
 * against the real implementation (see web-ssrf-guard.util.ts) that lets
 * our own DNS resolution be the one the socket actually connects to,
 * rather than a separate pre-check a rebinding attacker could race past.
 *
 * Never forwards any Authorization/Cookie header or other credential —
 * none is ever set on the outbound request, by construction; this is a
 * server-initiated fetch of an admin-approved page, never a proxy of the
 * calling user's own request.
 */

import * as https from 'https';
import { URL } from 'url';
import { createSafeLookup, parseAndValidateUrlShape, WebFetchError } from './web-ssrf-guard.util';

/** The minimal response shape this module actually reads — real IncomingMessage satisfies it; tests supply a plain EventEmitter-based fake. */
export interface MinimalHttpResponse {
  statusCode?: number;
  headers: { location?: string; 'content-type'?: string };
  on(event: 'data', cb: (chunk: Buffer) => void): void;
  on(event: 'end', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  resume(): void;
  destroy(): void;
}

/** The minimal request shape this module actually uses. */
export interface MinimalHttpRequest {
  on(event: 'error', cb: (err: Error) => void): void;
  destroy(err?: Error): void;
  end(): void;
}

export type HttpsRequestFn = (
  url: URL,
  options: { method: string; lookup: unknown; headers: Record<string, string> },
  callback: (res: MinimalHttpResponse) => void,
) => MinimalHttpRequest;

export type FetchApprovedPageLimits = {
  maxRedirects: number;
  maxResponseBytes: number;
  timeoutMs: number;
};

export const DEFAULT_WEB_FETCH_LIMITS: FetchApprovedPageLimits = {
  maxRedirects: 3,
  maxResponseBytes: 5 * 1024 * 1024,
  timeoutMs: 15_000,
};

export type FetchApprovedPageResult = {
  html: Buffer;
  finalUrl: string;
  contentType: string;
};

type SingleRequestOutcome =
  | { kind: 'redirect'; location: string }
  | { kind: 'body'; body: Buffer; contentType: string };

function performSingleRequest(
  url: URL,
  timeoutMs: number,
  maxResponseBytes: number,
  requestFn: HttpsRequestFn,
): Promise<SingleRequestOutcome> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      fn();
    };

    const req = requestFn(
      url,
      {
        method: 'GET',
        lookup: createSafeLookup(),
        headers: { Accept: 'text/html' },
      },
      (res) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          const location = res.headers.location;
          res.resume();
          settle(() => resolve({ kind: 'redirect', location }));
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          settle(() => reject(new WebFetchError('fetch_failed', `The page responded with HTTP ${status}.`)));
          return;
        }

        const rawContentType = (res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        if (rawContentType && rawContentType !== 'text/html') {
          res.resume();
          settle(() =>
            reject(
              new WebFetchError(
                'unexpected_content_type',
                `Expected an HTML page, got "${rawContentType}".`,
              ),
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          if (settled) return;
          total += chunk.length;
          if (total > maxResponseBytes) {
            res.destroy();
            settle(() =>
              reject(
                new WebFetchError(
                  'response_too_large',
                  `The response exceeded the ${maxResponseBytes}-byte limit.`,
                ),
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          settle(() => resolve({ kind: 'body', body: Buffer.concat(chunks), contentType: rawContentType || 'text/html' }));
        });
        res.on('error', () => {
          settle(() => reject(new WebFetchError('fetch_failed', 'The connection failed while reading the response.')));
        });
      },
    );

    // An overall wall-clock bound, independent of socket activity — a slow
    // trickle (a byte every few seconds) would never trip a pure
    // inactivity timeout but must still not be allowed to run forever.
    const deadlineTimer = setTimeout(() => {
      const timeoutErr = new WebFetchError('timeout', 'The request took too long and was stopped.');
      req.destroy(timeoutErr);
    }, timeoutMs);

    req.on('error', (err) => {
      settle(() => reject(err instanceof WebFetchError ? err : new WebFetchError('fetch_failed', 'The request to the approved page failed.')));
    });
    req.end();
  });
}

/**
 * Fetches `startUrl`, following up to `limits.maxRedirects` redirects,
 * re-validating EVERY hop (URL shape, org approval policy, and the
 * connection-time SSRF check) before following it — a redirect target is
 * never trusted just because the original URL was approved. One overall
 * deadline covers the whole chain, not a fresh one per hop.
 */
export async function fetchApprovedWebPage(
  startUrl: string,
  isApproved: (url: URL) => Promise<boolean>,
  limits: FetchApprovedPageLimits = DEFAULT_WEB_FETCH_LIMITS,
  requestFn: HttpsRequestFn = https.request as unknown as HttpsRequestFn,
): Promise<FetchApprovedPageResult> {
  const deadline = Date.now() + limits.timeoutMs;
  let currentUrl = parseAndValidateUrlShape(startUrl);

  if (!(await isApproved(currentUrl))) {
    throw new WebFetchError('not_approved', "This URL is not on the organization's approved list.");
  }

  for (let hop = 0; ; hop++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new WebFetchError('timeout', 'The request took too long and was stopped.');
    }

    const outcome = await performSingleRequest(currentUrl, remainingMs, limits.maxResponseBytes, requestFn);
    if (outcome.kind === 'body') {
      return { html: outcome.body, finalUrl: currentUrl.toString(), contentType: outcome.contentType };
    }

    if (hop >= limits.maxRedirects) {
      throw new WebFetchError('too_many_redirects', `Exceeded the maximum of ${limits.maxRedirects} redirects.`);
    }

    let nextUrl: URL;
    try {
      nextUrl = parseAndValidateUrlShape(new URL(outcome.location, currentUrl).toString());
    } catch {
      throw new WebFetchError('invalid_url', 'A redirect pointed to an invalid URL.');
    }
    if (!(await isApproved(nextUrl))) {
      throw new WebFetchError('not_approved', "A redirect target is not on the organization's approved list.");
    }
    currentUrl = nextUrl;
  }
}
