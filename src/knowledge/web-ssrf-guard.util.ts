/**
 * SSRF defenses for approved web-page ingestion. Deliberately hand-written
 * rather than depending on a third-party SSRF-blocking package — prior
 * investigation in this project found repeated, recent bypasses in exactly
 * that category of package (missing ranges, IPv4-in-IPv6-bracket
 * normalization bypasses). This is a plain, fully-auditable allowlist of
 * IP ranges plus a dns.lookup-compatible function that does the actual
 * resolution our HTTP client connects to — not a separate pre-check that
 * a DNS-rebinding attacker could race past.
 */

import { URL } from 'url';
import * as dns from 'dns';

export type WebFetchErrorCode =
  | 'invalid_url'
  | 'disallowed_scheme'
  | 'embedded_credentials'
  | 'dns_resolution_failed'
  | 'forbidden_destination'
  | 'not_approved'
  | 'too_many_redirects'
  | 'response_too_large'
  | 'timeout'
  | 'unexpected_content_type'
  | 'fetch_failed';

/** Every message is written by us — safe to surface directly, unlike a raw network/DNS error. */
export class WebFetchError extends Error {
  readonly code: WebFetchErrorCode;
  constructor(code: WebFetchErrorCode, message: string) {
    super(message);
    this.name = 'WebFetchError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------
// URL shape validation — necessary but not sufficient on its own; the
// real enforcement is the connection-time address check below.
// ---------------------------------------------------------------------

/**
 * HTTPS only. No exception mechanism exists in this implementation — there
 * is no current product requirement that would justify ever fetching over
 * plain HTTP (which would also expose page content and any future
 * redirect chain to on-path tampering), so "the explicit, justified
 * exception" this phase's brief allows for is simply: none is granted.
 */
const ALLOWED_SCHEMES = new Set(['https:']);

export function parseAndValidateUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebFetchError('invalid_url', 'This is not a valid URL.');
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new WebFetchError('disallowed_scheme', 'Only https:// URLs are allowed.');
  }
  if (url.username || url.password) {
    throw new WebFetchError('embedded_credentials', 'URLs with embedded credentials are not allowed.');
  }
  if (!url.hostname) {
    throw new WebFetchError('invalid_url', 'This URL has no hostname.');
  }
  return url;
}

// ---------------------------------------------------------------------
// IP parsing — hand-written, no dependency on net.isIP beyond format
// detection, since we need the actual byte values to range-check.
// ---------------------------------------------------------------------

function parseIPv4ToBytes(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) return null;
  return bytes;
}

function ipv4ToHextetPair(ipv4: string): string | null {
  const bytes = parseIPv4ToBytes(ipv4);
  if (!bytes) return null;
  const hi = (bytes[0] << 8) | bytes[1];
  const lo = (bytes[2] << 8) | bytes[3];
  return `${hi.toString(16)}:${lo.toString(16)}`;
}

/** Rewrites a trailing embedded-IPv4 group (e.g. "::ffff:192.168.1.1") into pure hex hextets so the general parser below never has to special-case it. */
function normalizeEmbeddedIPv4(address: string): string | null {
  if (!address.includes('.')) return address;
  const lastColon = address.lastIndexOf(':');
  if (lastColon === -1) return null;
  const ipv4Part = address.slice(lastColon + 1);
  const hexPair = ipv4ToHextetPair(ipv4Part);
  if (!hexPair) return null;
  return address.slice(0, lastColon + 1) + hexPair;
}

function parseIPv6ToBytes(input: string): number[] | null {
  const zoneIdx = input.indexOf('%');
  const withoutZone = zoneIdx === -1 ? input : input.slice(0, zoneIdx);
  const address = normalizeEmbeddedIPv4(withoutZone);
  if (address === null) return null;

  const doubleColonParts = address.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseSide = (s: string): number[] | null => {
    if (s === '') return [];
    const hextetStrings = s.split(':');
    const hextets = hextetStrings.map((h) => (/^[0-9a-fA-F]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
    if (hextets.some((h) => Number.isNaN(h))) return null;
    return hextets;
  };

  const left = parseSide(doubleColonParts[0]);
  if (left === null) return null;

  let hextets: number[];
  if (doubleColonParts.length === 2) {
    const right = parseSide(doubleColonParts[1]);
    if (right === null) return null;
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    hextets = [...left, ...Array(missing).fill(0), ...right];
  } else {
    if (left.length !== 8) return null;
    hextets = left;
  }
  if (hextets.length !== 8) return null;

  const bytes: number[] = [];
  for (const h of hextets) bytes.push((h >> 8) & 0xff, h & 0xff);
  return bytes;
}

// ---------------------------------------------------------------------
// Forbidden-range checks
// ---------------------------------------------------------------------

/**
 * IANA special-purpose IPv4 ranges: this-network, private (RFC1918),
 * shared/CGNAT, loopback, link-local (also covers the 169.254.169.254
 * cloud metadata address every major provider uses), documentation/
 * benchmarking TEST-NET ranges, multicast, and reserved/broadcast.
 */
function isForbiddenIPv4(bytes: number[]): boolean {
  const [a, b, c] = bytes;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && b >= 18 && b <= 19) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true; // multicast (224/4) + reserved (240/4) + broadcast
  return false;
}

/**
 * IPv6 equivalents: unspecified, loopback, unique-local (fc00::/7,
 * the IPv6 analogue of RFC1918 private space), link-local (fe80::/10),
 * multicast (ff00::/8). IPv4-mapped (::ffff:0:0/96) and the NAT64
 * well-known prefix (64:ff9b::/96) are unwrapped to their embedded IPv4
 * and re-checked against the IPv4 rules above — this is exactly the
 * bypass class a known third-party SSRF package failed to close.
 */
function isForbiddenIPv6(bytes: number[]): boolean {
  const isV4Mapped = bytes.slice(0, 10).every((v) => v === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isV4Mapped) return isForbiddenIPv4(bytes.slice(12, 16));

  const isNat64 =
    bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((v) => v === 0);
  if (isNat64) return isForbiddenIPv4(bytes.slice(12, 16));

  if (bytes.every((v) => v === 0)) return true; // ::
  if (bytes.slice(0, 15).every((v) => v === 0) && bytes[15] === 1) return true; // ::1
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10
  if (bytes[0] === 0xff) return true; // ff00::/8
  return false;
}

/** Fails closed: an address this cannot parse as either IPv4 or IPv6 is treated as forbidden, never allowed through. */
export function isForbiddenAddress(address: string): boolean {
  const v4 = parseIPv4ToBytes(address);
  if (v4) return isForbiddenIPv4(v4);
  const v6 = parseIPv6ToBytes(address);
  if (v6) return isForbiddenIPv6(v6);
  return true;
}

// ---------------------------------------------------------------------
// Connection-time DNS enforcement
// ---------------------------------------------------------------------

/**
 * A dns.lookup-compatible function for http(s).request's `lookup` option.
 * This IS the resolution the HTTP client connects to — not a separate
 * earlier check a DNS-rebinding attacker could race past by answering
 * differently the second time. Every resolved address is checked; if any
 * is forbidden, the whole lookup fails rather than silently picking a
 * "safe-looking" one among several (a multi-homed answer mixing public
 * and private addresses is itself suspicious).
 *
 * Must handle both of dns.lookup's callback contracts: options.all is
 * set by Node's own http/net/tls internals in practice, requiring an
 * array-shaped callback; verified directly against the real
 * http(s).request implementation before relying on this.
 */
type RawLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
  callback: (err: NodeJS.ErrnoException | null, addresses: { address: string; family: number }[]) => void,
) => void;

/**
 * `rawLookup` is injectable purely for testing (a fake resolver, no real
 * DNS traffic) — defaults to the real dns.lookup in every real call site.
 */
export function createSafeLookup(rawLookup: RawLookup = dns.lookup as unknown as RawLookup): (
  hostname: string,
  options: { all?: boolean; family?: number; hints?: number },
  callback: (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void,
) => void {
  return (hostname, options, callback) => {
    rawLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      // address is unused whenever err is set — the required second
      // parameter is satisfied with an empty placeholder in every error
      // branch below, matching Node's own LookupFunction contract shape.
      if (err) {
        callback(err, []);
        return;
      }
      const list = addresses;
      if (list.length === 0) {
        callback(new WebFetchError('dns_resolution_failed', `${hostname} did not resolve to any address.`), []);
        return;
      }
      const forbidden = list.find((a) => isForbiddenAddress(a.address));
      if (forbidden) {
        callback(
          new WebFetchError(
            'forbidden_destination',
            `${hostname} resolves to a non-public address and cannot be fetched.`,
          ),
          [],
        );
        return;
      }
      if (options.all) {
        callback(null, list);
      } else {
        callback(null, list[0].address, list[0].family);
      }
    });
  };
}
