import { DocumentExtractionError } from './knowledge-document-extraction.util';
import { extractWebPageChunks } from './knowledge-web-extraction.util';

describe('extractWebPageChunks', () => {
  it('extracts readable text and heading/section info from a normal page', () => {
    const html = `
      <html><body>
        <header><nav>Home | About</nav></header>
        <main>
          <h1>Article Title</h1>
          <p>This is the real article content.</p>
        </main>
        <footer>Copyright 2026</footer>
      </body></html>`;
    const chunks = extractWebPageChunks(html);
    const allText = chunks.map((c) => c.text).join(' ');
    expect(allText).toContain('This is the real article content.');
    expect(chunks.find((c) => c.section === 'Article Title')).toBeDefined();
    for (const c of chunks) expect(c.page).toBeNull();
  });

  it('never includes script or style content in extracted text', () => {
    const html = `
      <html><body>
        <script>var secret = "should never appear"; fetch('/evil');</script>
        <style>.hidden { display: none; } /* color: red */</style>
        <p>Visible paragraph text.</p>
      </body></html>`;
    const chunks = extractWebPageChunks(html);
    const allText = chunks.map((c) => c.text).join(' ');
    expect(allText).not.toContain('should never appear');
    expect(allText).not.toContain('fetch');
    expect(allText).not.toContain('display: none');
    expect(allText).toContain('Visible paragraph text.');
  });

  it('removes nav/header/footer/aside chrome entirely, including their text content', () => {
    const html = `
      <html><body>
        <nav>Site navigation links here</nav>
        <aside>Related articles sidebar content</aside>
        <p>Main article body.</p>
        <footer>Footer boilerplate text</footer>
      </body></html>`;
    const chunks = extractWebPageChunks(html);
    const allText = chunks.map((c) => c.text).join(' ');
    expect(allText).not.toContain('Site navigation links');
    expect(allText).not.toContain('Related articles sidebar');
    expect(allText).not.toContain('Footer boilerplate');
    expect(allText).toContain('Main article body.');
  });

  it('never includes HTML comment content', () => {
    const html = `<html><body><!-- secret internal note --><p>Real text.</p></body></html>`;
    const chunks = extractWebPageChunks(html);
    const allText = chunks.map((c) => c.text).join(' ');
    expect(allText).not.toContain('secret internal note');
  });

  it('rejects extracted text over the configured character limit', () => {
    const html = `<html><body><p>${'word '.repeat(1000)}</p></body></html>`;
    expect(() => extractWebPageChunks(html, 10)).toThrow(DocumentExtractionError);
  });

  it('returns no chunks for an empty/whitespace-only page', () => {
    expect(extractWebPageChunks('<html><body>   </body></html>')).toEqual([]);
  });
});
