import {
  createSafeLookup,
  isForbiddenAddress,
  parseAndValidateUrlShape,
  WebFetchError,
} from './web-ssrf-guard.util';

describe('parseAndValidateUrlShape', () => {
  it('accepts a well-formed https URL', () => {
    const url = parseAndValidateUrlShape('https://example.com/page?x=1');
    expect(url.hostname).toBe('example.com');
  });

  it('rejects a malformed URL', () => {
    expect(() => parseAndValidateUrlShape('not a url at all')).toThrow(
      expect.objectContaining({ code: 'invalid_url' }),
    );
  });

  it('rejects http (only https is allowed, with no exception mechanism)', () => {
    expect(() => parseAndValidateUrlShape('http://example.com/')).toThrow(
      expect.objectContaining({ code: 'disallowed_scheme' }),
    );
  });

  it('rejects other schemes (ftp, file, javascript, data)', () => {
    for (const url of ['ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi']) {
      expect(() => parseAndValidateUrlShape(url)).toThrow(WebFetchError);
    }
  });

  it('rejects a URL with embedded credentials', () => {
    expect(() => parseAndValidateUrlShape('https://user:pass@example.com/')).toThrow(
      expect.objectContaining({ code: 'embedded_credentials' }),
    );
  });
});

describe('isForbiddenAddress — IPv4', () => {
  const forbidden = [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '100.100.0.1',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.169.254', // cloud metadata (AWS/GCP/Azure all use this)
    '169.254.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1', // multicast
    '240.0.0.1', // reserved
    '255.255.255.255', // broadcast
  ];
  it.each(forbidden)('rejects %s', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  const allowed = [
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255', // just outside 172.16/12
    '172.32.0.1', // just outside 172.16/12
    '169.253.255.255', // just outside 169.254/16
    '169.255.0.1', // just outside 169.254/16
    '100.63.255.255', // just outside 100.64/10
    '100.128.0.1', // just outside 100.64/10
    '223.255.255.255', // just outside 224/4
  ];
  it.each(allowed)('allows %s', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(false);
  });
});

describe('isForbiddenAddress — IPv6', () => {
  const forbidden = [
    '::1', // loopback
    '::', // unspecified
    'fc00::1', // unique-local
    'fd00::1', // unique-local
    'fe80::1', // link-local
    'ff02::1', // multicast
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:169.254.169.254', // IPv4-mapped cloud metadata — the exact bypass class a known third-party package missed
    '::ffff:10.0.0.1', // IPv4-mapped private
    '0:0:0:0:0:ffff:a9fe:a9fe', // fully-expanded IPv4-mapped 169.254.169.254
    '64:ff9b::169.254.169.254', // NAT64-mapped cloud metadata
  ];
  it.each(forbidden)('rejects %s', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  const allowed = ['2606:4700:4700::1111', '2001:4860:4860::8888'];
  it.each(allowed)('allows %s', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(false);
  });
});

describe('isForbiddenAddress — fails closed on anything unparseable', () => {
  it('treats garbage input as forbidden rather than allowed', () => {
    expect(isForbiddenAddress('not-an-ip-address')).toBe(true);
    expect(isForbiddenAddress('')).toBe(true);
    expect(isForbiddenAddress('999.999.999.999')).toBe(true);
  });
});

describe('createSafeLookup', () => {
  // rawLookup is an injectable parameter specifically so these tests never
  // touch the real dns module or any real network/DNS traffic — a fake
  // resolver is passed in directly rather than mocking Node's dns module.
  function fakeLookup(addresses: { address: string; family: number }[] | Error) {
    return (
      _hostname: string,
      _opts: { all: true; verbatim: true },
      cb: (err: Error | null, addrs?: { address: string; family: number }[]) => void,
    ) => {
      if (addresses instanceof Error) cb(addresses);
      else cb(null, addresses);
    };
  }
  function safeLookupWith(addresses: { address: string; family: number }[] | Error) {
    return createSafeLookup(fakeLookup(addresses) as never);
  }

  it('calls back with an array when options.all is true (matching how http(s).request actually invokes it)', (done) => {
    const safeLookup = safeLookupWith([{ address: '93.184.216.34', family: 4 }]);
    safeLookup('example.com', { all: true }, (err, result) => {
      expect(err).toBeNull();
      expect(result).toEqual([{ address: '93.184.216.34', family: 4 }]);
      done();
    });
  });

  it('calls back with a single address/family when options.all is false', (done) => {
    const safeLookup = safeLookupWith([{ address: '93.184.216.34', family: 4 }]);
    safeLookup('example.com', {}, (err, address, family) => {
      expect(err).toBeNull();
      expect(address).toBe('93.184.216.34');
      expect(family).toBe(4);
      done();
    });
  });

  it('rejects when the resolved address is a private/loopback/metadata IP', (done) => {
    const safeLookup = safeLookupWith([{ address: '169.254.169.254', family: 4 }]);
    safeLookup('attacker.example', { all: true }, (err) => {
      expect(err).toBeInstanceOf(WebFetchError);
      expect((err as unknown as { code: string }).code).toBe('forbidden_destination');
      done();
    });
  });

  it('rejects the whole lookup if ANY resolved address among several is forbidden, even if others are public', (done) => {
    const safeLookup = safeLookupWith([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    safeLookup('multi-homed.example', { all: true }, (err) => {
      expect(err).toBeInstanceOf(WebFetchError);
      done();
    });
  });

  it('rejects when DNS resolution returns zero addresses', (done) => {
    const safeLookup = safeLookupWith([]);
    safeLookup('nowhere.example', { all: true }, (err) => {
      expect(err).toBeInstanceOf(WebFetchError);
      expect((err as unknown as { code: string }).code).toBe('dns_resolution_failed');
      done();
    });
  });

  it('propagates a genuine DNS resolution failure as-is', (done) => {
    const dnsError = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    const safeLookup = safeLookupWith(dnsError);
    safeLookup('does-not-exist.invalid', { all: true }, (err) => {
      expect(err).toBe(dnsError);
      done();
    });
  });
});
