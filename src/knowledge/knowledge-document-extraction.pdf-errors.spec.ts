/**
 * Separate from knowledge-document-extraction.util.spec.ts because this
 * file needs a module-level jest.mock('unpdf', ...) — unpdf's CJS export
 * properties are not configurable, so jest.spyOn cannot override them
 * directly; mocking the whole module is the only way to simulate a
 * PDF.js-shaped rejection. Keeping it in its own file means the main spec
 * file can exercise the real unpdf library everywhere else.
 */
const getDocumentProxyMock = jest.fn();

jest.mock('unpdf', () => ({
  ...jest.requireActual('unpdf'),
  getDocumentProxy: (...args: unknown[]) => getDocumentProxyMock(...args),
}));

import { DocumentExtractionError, extractPdfChunks, type PdfExtractionLimits } from './knowledge-document-extraction.util';

const FAST_PDF_LIMITS: PdfExtractionLimits = { maxPages: 300, maxExtractedChars: 5_000_000, timeoutMs: 5_000 };
const MINIMAL_PDF = Buffer.from('%PDF-1.4\n%%EOF'); // only needs to pass the magic-byte check here

describe('extractPdfChunks — PDF.js error mapping (mocked unpdf)', () => {
  afterEach(() => {
    getDocumentProxyMock.mockReset();
  });

  it('maps a PDF.js PasswordException to a safe, specific "password_protected" error', async () => {
    const passwordError = Object.assign(new Error('needs a password'), { name: 'PasswordException' });
    getDocumentProxyMock.mockRejectedValueOnce(passwordError);

    await expect(extractPdfChunks(MINIMAL_PDF, FAST_PDF_LIMITS)).rejects.toMatchObject({
      code: 'password_protected',
    });
  });

  it('never surfaces the raw underlying parser error message — only our own safe, pre-written text', async () => {
    const sensitiveRawError = Object.assign(
      new Error('INTERNAL PARSER STACK: /etc/secrets leaked here'),
      { name: 'SomeInternalPdfJsError' },
    );
    getDocumentProxyMock.mockRejectedValueOnce(sensitiveRawError);

    try {
      await extractPdfChunks(MINIMAL_PDF, FAST_PDF_LIMITS);
      throw new Error('expected extractPdfChunks to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(DocumentExtractionError);
      expect((err as Error).message).not.toContain('/etc/secrets');
    }
  });
});
