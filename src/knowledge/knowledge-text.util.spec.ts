import { chunkText, looksLikeBinary, MAX_CHUNK_CHARS } from './knowledge-text.util';

describe('looksLikeBinary', () => {
  it('returns false for plain ASCII text', () => {
    expect(looksLikeBinary(Buffer.from('Hello, world.\nThis is plain text.'))).toBe(false);
  });

  it('returns false for UTF-8 text with multi-byte characters', () => {
    expect(looksLikeBinary(Buffer.from('Café résumé — em dash, naïve.'))).toBe(false);
  });

  it('returns true when a NUL byte appears in the sampled prefix', () => {
    const buf = Buffer.concat([Buffer.from('looks like text'), Buffer.from([0x00]), Buffer.from('more')]);
    expect(looksLikeBinary(buf)).toBe(true);
  });

  it('only samples the first 512 bytes', () => {
    const buf = Buffer.concat([Buffer.alloc(600, 0x41), Buffer.from([0x00])]);
    expect(looksLikeBinary(buf)).toBe(false);
  });
});

describe('chunkText', () => {
  it('returns no chunks for empty or whitespace-only input', () => {
    expect(chunkText('', false)).toEqual([]);
    expect(chunkText('   \n\n  ', false)).toEqual([]);
  });

  it('groups short paragraphs into a single chunk', () => {
    const raw = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const chunks = chunkText(raw, false);
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toContain('First paragraph.');
    expect(chunks[0].text).toContain('Third paragraph.');
    expect(chunks[0].section).toBeNull();
  });

  it('splits a paragraph longer than MAX_CHUNK_CHARS into multiple chunks', () => {
    const longParagraph = 'word '.repeat(400).trim(); // well over MAX_CHUNK_CHARS
    const chunks = chunkText(longParagraph, false);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it('starts a new chunk once accumulated text would exceed MAX_CHUNK_CHARS', () => {
    const para = 'x'.repeat(600);
    const raw = [para, para, para].join('\n\n');
    const chunks = chunkText(raw, false);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it('tracks Markdown headings as the section for subsequent chunks', () => {
    const raw = '# Intro\n\nSome intro text.\n\n## Details\n\nMore detailed text here.';
    const chunks = chunkText(raw, true);
    expect(chunks.find((c) => c.text.includes('Some intro text'))?.section).toBe('Intro');
    expect(chunks.find((c) => c.text.includes('More detailed text'))?.section).toBe('Details');
  });

  it('does not treat a line starting with # as a heading when isMarkdown is false', () => {
    const raw = '# Not a heading\n\nJust plain text treated literally.';
    const chunks = chunkText(raw, false);
    expect(chunks[0].section).toBeNull();
    expect(chunks[0].text).toContain('# Not a heading');
  });

  it('normalizes CRLF line endings and collapses excessive blank lines', () => {
    const raw = 'Para one.\r\n\r\n\r\n\r\nPara two.';
    const chunks = chunkText(raw, false);
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe('Para one.\n\nPara two.');
  });
});
