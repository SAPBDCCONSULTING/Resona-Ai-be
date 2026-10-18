import { containsPii, redactPii } from './pii-redaction.util';

describe('redactPii', () => {
  it('redacts an email address', () => {
    const out = redactPii('Contact me at jane.doe@example.com for details.');
    expect(out).not.toContain('jane.doe@example.com');
    expect(out).toContain('[REDACTED:email]');
  });

  it('redacts multiple emails in the same string', () => {
    const out = redactPii('cc jane@example.com and john@example.org');
    expect(out).not.toMatch(/@example\.(com|org)/);
    expect(out.match(/\[REDACTED:email\]/g)).toHaveLength(2);
  });

  it('redacts a phone number with common separators', () => {
    for (const phone of ['415-555-0192', '(415) 555-0192', '415.555.0192', '+1 415-555-0192']) {
      const out = redactPii(`Call me at ${phone} tomorrow.`);
      expect(out).toContain('[REDACTED:phone]');
      expect(out).not.toContain(phone);
    }
  });

  it('redacts a US SSN-shaped number', () => {
    const out = redactPii('SSN on file: 123-45-6789.');
    expect(out).toContain('[REDACTED:ssn]');
    expect(out).not.toContain('123-45-6789');
  });

  it('redacts a Bearer token and an OpenAI-style API key', () => {
    const out = redactPii('Authorization: Bearer abcdEFGH12345678tokentoken and sk-abcdefghijklmnop1234');
    expect(out).toContain('[REDACTED:token]');
    expect(out).not.toContain('abcdEFGH12345678tokentoken');
    expect(out).not.toContain('sk-abcdefghijklmnop1234');
  });

  it('leaves ordinary business content with numbers untouched', () => {
    const safe = [
      'Track 3 priorities this quarter.',
      'Q3 2026 engagement pulse — round 1 of 3.',
      'We have 42 open sessions and 11 contacts.',
      'Ticket #4521 was resolved.',
    ];
    for (const text of safe) {
      expect(redactPii(text)).toBe(text);
    }
  });

  it('is deterministic and idempotent', () => {
    const text = 'Reach jane@example.com at 415-555-0192.';
    const once = redactPii(text);
    const twice = redactPii(once);
    expect(twice).toBe(once);
  });

  it('returns falsy input unchanged', () => {
    expect(redactPii('')).toBe('');
  });
});

describe('containsPii', () => {
  it('detects an email', () => {
    expect(containsPii('reach me at a@b.com')).toBe(true);
  });

  it('detects a phone number', () => {
    expect(containsPii('call 415-555-0192')).toBe(true);
  });

  it('returns false for ordinary text', () => {
    expect(containsPii('Track 3 priorities this quarter.')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(containsPii('')).toBe(false);
  });
});
