/**
 * Conservative, deterministic PII redaction for LOG lines — never for live
 * AI request/response content or user-facing text, which this file does
 * not touch. Redacting a legitimate business conversation before it
 * reaches the model (or before it reaches the user) would corrupt real
 * content — e.g. an employee legitimately mentioning a manager's email in
 * 1:1 feedback — so this is applied only at our own logging boundaries.
 *
 * Supported, high-confidence patterns only:
 *   - Email addresses
 *   - Phone numbers (7+ digits, with common separators/parentheses, an
 *     optional leading +country code)
 *   - US Social Security Number format (###-##-####)
 *   - Bearer-token / API-key-shaped strings (long opaque alphanumeric runs
 *     after "Bearer ", or an OpenAI-style "sk-..." prefix)
 *
 * Explicitly NOT attempted (documented limitation, not a guarantee):
 *   - Names, physical addresses, dates of birth, or any PII that requires
 *     context/semantics rather than a reliable literal pattern.
 *   - Obfuscated formats (e.g. "john dot doe at example dot com").
 *   - Non-US identifier formats beyond the generic phone-number pattern.
 * This is a defense-in-depth log-hygiene layer, not a comprehensive PII
 * detector — it will have false negatives on anything above, and (rarely)
 * false positives on legitimate numeric business content that happens to
 * match the phone-number shape (e.g. a long order/ticket number).
 */

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Phone: optional leading +, then digits/separators totaling 7+ digits.
// Deliberately requires at least one separator or 7+ consecutive digits so
// it doesn't fire on short unrelated numbers (e.g. "track 3 priorities").
const PHONE_PATTERN =
  /(?<!\d)(\+?\d{1,3}[\s.-]?)?(\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3,4}[\s.-]?\d{3,4}(?!\d)/g;

const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;

const TOKEN_PATTERN = /\b(Bearer\s+[A-Za-z0-9._-]{10,}|sk-[A-Za-z0-9]{10,})\b/g;

const PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'email', pattern: EMAIL_PATTERN },
  { label: 'ssn', pattern: SSN_PATTERN },
  { label: 'token', pattern: TOKEN_PATTERN },
  { label: 'phone', pattern: PHONE_PATTERN },
];

/** True if any supported high-confidence PII pattern matches. */
export function containsPii(text: string): boolean {
  if (!text) return false;
  return PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

/**
 * Replaces each supported pattern with a labeled placeholder
 * (e.g. "[REDACTED:email]"), preserving surrounding text so a log line
 * stays readable. Deterministic and side-effect-free.
 */
export function redactPii(text: string): string {
  if (!text) return text;
  let result = text;
  for (const { label, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, `[REDACTED:${label}]`);
  }
  return result;
}
