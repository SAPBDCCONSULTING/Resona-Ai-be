/**
 * PDF and DOCX extraction for the Knowledge Base ingestion pipeline.
 *
 * Isolated from knowledge.service.ts (which owns GridFS/Mongo/lifecycle) so
 * these functions stay pure enough to unit test directly against small
 * local fixture buffers — no Mongo/GridFS/Nest dependencies, same
 * convention as knowledge-text.util.ts, which this module reuses for
 * chunking rather than duplicating that logic.
 *
 * HONEST LIMITATION, stated once here rather than repeated per function:
 * the `timeoutMs` bound below only stops *us* from waiting on an
 * extraction call — it does not and cannot forcibly halt CPU-bound work
 * already running synchronously inside unpdf's bundled PDF.js or inside
 * mammoth's XML traversal, because neither runs in a real worker thread in
 * this setup (unpdf's "worker" is inlined into the same JS realm, not an
 * actual worker_thread, and mammoth is plain synchronous-under-the-hood
 * JS). A sufficiently pathological file can still consume CPU on this
 * process past the timeout. The ZIP-structure pre-check for DOCX and the
 * page/char ceilings for PDF are the real bound on how much WORK a file
 * can cause in the first place; the timeout is a secondary, defense-in-
 * depth measure, not a guarantee. True isolation would require running
 * extraction in a separate worker_thread or child process that can be
 * forcibly terminated — not implemented this phase; see the final report.
 */

import { extractText, getDocumentProxy } from 'unpdf';
import * as mammoth from 'mammoth';
import { chunkText, type ExtractedChunk } from './knowledge-text.util';

export const PDF_MIME_TYPE = 'application/pdf';
export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type DocumentExtractionErrorCode =
  | 'malformed'
  | 'password_protected'
  | 'too_many_pages'
  | 'text_too_large'
  | 'zip_bomb_suspected'
  | 'timeout';

/**
 * Every message on this error is written by us, never derived from a raw
 * parser exception — safe to surface as-is in processingError/logs, unlike
 * an arbitrary caught Error's own .message.
 */
export class DocumentExtractionError extends Error {
  readonly code: DocumentExtractionErrorCode;
  constructor(code: DocumentExtractionErrorCode, message: string) {
    super(message);
    this.name = 'DocumentExtractionError';
    this.code = code;
  }
}

export type PdfExtractionLimits = {
  maxPages: number;
  maxExtractedChars: number;
  timeoutMs: number;
};

export const DEFAULT_PDF_EXTRACTION_LIMITS: PdfExtractionLimits = {
  maxPages: 300,
  maxExtractedChars: 5_000_000,
  timeoutMs: 15_000,
};

export type ZipStructureLimits = {
  maxEntries: number;
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
};

export const DEFAULT_ZIP_STRUCTURE_LIMITS: ZipStructureLimits = {
  maxEntries: 2000,
  maxEntryUncompressedBytes: 100 * 1024 * 1024,
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 300,
};

export type DocxExtractionLimits = {
  maxExtractedChars: number;
  timeoutMs: number;
  zip: ZipStructureLimits;
};

export const DEFAULT_DOCX_EXTRACTION_LIMITS: DocxExtractionLimits = {
  maxExtractedChars: 5_000_000,
  timeoutMs: 15_000,
  zip: DEFAULT_ZIP_STRUCTURE_LIMITS,
};

// ---------------------------------------------------------------------
// Magic-byte checks — necessary but explicitly NOT sufficient on their
// own. A file passing this still goes through the real parser, and a
// parser failure still safely fails the source (never crashes the
// request, never partially indexes).
// ---------------------------------------------------------------------

const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export function looksLikePdf(buffer: Buffer): boolean {
  // Some generators prepend a few bytes of garbage before the header;
  // staying within the first 1024 bytes keeps this strict rather than
  // scanning the whole file for the signature.
  return buffer.subarray(0, 1024).includes(PDF_SIGNATURE);
}

export function looksLikeDocx(buffer: Buffer): boolean {
  // Require the signature at offset 0 (the normal case for a real .docx).
  // An empty-archive EOCD-only signature (PK\x05\x06) is deliberately not
  // accepted here — that is never a valid Word document.
  return buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP_LOCAL_FILE_HEADER_SIGNATURE);
}

// ---------------------------------------------------------------------
// Shared timeout helper
// ---------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DocumentExtractionError('timeout', timeoutMessage)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ---------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------

function isPdfPasswordError(err: unknown): boolean {
  return err instanceof Error && err.name === 'PasswordException';
}

export async function extractPdfChunks(
  buffer: Buffer,
  limits: PdfExtractionLimits = DEFAULT_PDF_EXTRACTION_LIMITS,
): Promise<{ chunks: ExtractedChunk[]; pageCount: number }> {
  if (!looksLikePdf(buffer)) {
    throw new DocumentExtractionError('malformed', 'This file does not look like a valid PDF.');
  }

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await withTimeout(
      getDocumentProxy(new Uint8Array(buffer)),
      limits.timeoutMs,
      'PDF parsing took too long and was stopped.',
    );
  } catch (err) {
    if (isPdfPasswordError(err)) {
      throw new DocumentExtractionError(
        'password_protected',
        'This PDF is password-protected and cannot be processed.',
      );
    }
    if (err instanceof DocumentExtractionError) throw err;
    throw new DocumentExtractionError('malformed', 'This file could not be read as a valid PDF.');
  }

  if (pdf.numPages > limits.maxPages) {
    throw new DocumentExtractionError(
      'too_many_pages',
      `This PDF has ${pdf.numPages} pages; the maximum allowed is ${limits.maxPages}.`,
    );
  }

  let pages: string[];
  try {
    const { text } = await withTimeout(
      extractText(pdf, { mergePages: false }),
      limits.timeoutMs,
      'PDF text extraction took too long and was stopped.',
    );
    pages = Array.isArray(text) ? text : [text];
  } catch (err) {
    if (isPdfPasswordError(err)) {
      throw new DocumentExtractionError(
        'password_protected',
        'This PDF is password-protected and cannot be processed.',
      );
    }
    if (err instanceof DocumentExtractionError) throw err;
    throw new DocumentExtractionError('malformed', 'This file could not be read as a valid PDF.');
  }

  const chunks: ExtractedChunk[] = [];
  let totalChars = 0;
  for (let i = 0; i < pages.length; i++) {
    totalChars += pages[i].length;
    if (totalChars > limits.maxExtractedChars) {
      throw new DocumentExtractionError(
        'text_too_large',
        `Extracted text exceeds the ${limits.maxExtractedChars}-character limit.`,
      );
    }
    // PDFs have no Markdown headings, so isMarkdown is always false here —
    // section stays null, honestly, rather than guessing at structure
    // chunkText has no basis to detect. Chunking per page (not on the
    // merged document) means a chunk can never span a page boundary, so
    // page provenance is always exact, never an association guess.
    for (const c of chunkText(pages[i], false)) {
      chunks.push({ ...c, page: i + 1 });
    }
  }

  return { chunks, pageCount: pdf.numPages };
}

// ---------------------------------------------------------------------
// DOCX — ZIP structural pre-check
// ---------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const EOCD_FIXED_SIZE = 22;
const MAX_EOCD_COMMENT_LENGTH = 65535;
const CENTRAL_DIR_HEADER_FIXED_SIZE = 46;
const ZIP64_SENTINEL = 0xffffffff;

function findEndOfCentralDirectory(buffer: Buffer): number {
  const searchStart = Math.max(0, buffer.length - EOCD_FIXED_SIZE - MAX_EOCD_COMMENT_LENGTH);
  for (let i = buffer.length - EOCD_FIXED_SIZE; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/**
 * Hand-rolled, read-only ZIP central-directory inspection. Deliberately
 * NOT using a zip library — even one already resolved transitively via
 * mammoth's own dependency tree — to stay strictly within the "no new
 * parser dependencies beyond unpdf/mammoth" approval boundary.
 *
 * Reads only the sizes/counts the ZIP format's central directory already
 * declares; never decompresses a single entry's actual bytes. This is
 * what lets a zip-bomb-shaped DOCX be rejected BEFORE mammoth (and its own
 * internal unzip step) ever touches it. A malformed/truncated central
 * directory is treated as "reject" (code: 'malformed'), never as "assume
 * it's fine."
 */
export function inspectDocxZipStructure(
  buffer: Buffer,
  limits: ZipStructureLimits = DEFAULT_ZIP_STRUCTURE_LIMITS,
): void {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset === -1) {
    throw new DocumentExtractionError('malformed', 'This file is not a valid DOCX (ZIP) container.');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries > limits.maxEntries) {
    throw new DocumentExtractionError(
      'zip_bomb_suspected',
      `This DOCX has ${totalEntries} internal parts; the maximum allowed is ${limits.maxEntries}.`,
    );
  }
  if (centralDirOffset < 0 || centralDirOffset + centralDirSize > buffer.length) {
    throw new DocumentExtractionError('malformed', 'This file is not a valid DOCX (ZIP) container.');
  }

  let pos = centralDirOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (pos + CENTRAL_DIR_HEADER_FIXED_SIZE > buffer.length) {
      throw new DocumentExtractionError('malformed', 'This file is not a valid DOCX (ZIP) container.');
    }
    if (buffer.readUInt32LE(pos) !== CENTRAL_DIR_SIGNATURE) {
      throw new DocumentExtractionError('malformed', 'This file is not a valid DOCX (ZIP) container.');
    }

    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const filenameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);

    // ZIP64 sentinel — the real size lives in an extra field this check
    // does not parse. Reject rather than trust a possibly-tiny declared
    // 32-bit value while the real size is unknown.
    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL) {
      throw new DocumentExtractionError(
        'zip_bomb_suspected',
        'This DOCX uses a ZIP64 extension this check cannot safely verify.',
      );
    }
    // A non-empty declared uncompressed size with zero compressed bytes is
    // not a plausible real entry.
    if (compressedSize === 0 && uncompressedSize > 0) {
      throw new DocumentExtractionError(
        'zip_bomb_suspected',
        'This DOCX contains a part with an implausible size declaration.',
      );
    }
    if (uncompressedSize > limits.maxEntryUncompressedBytes) {
      throw new DocumentExtractionError(
        'zip_bomb_suspected',
        `A part of this DOCX would expand to more than ${limits.maxEntryUncompressedBytes} bytes.`,
      );
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) {
      throw new DocumentExtractionError(
        'zip_bomb_suspected',
        `This DOCX would expand to more than ${limits.maxTotalUncompressedBytes} bytes in total.`,
      );
    }
    if (compressedSize > 0) {
      const ratio = uncompressedSize / compressedSize;
      if (ratio > limits.maxCompressionRatio) {
        throw new DocumentExtractionError(
          'zip_bomb_suspected',
          'This DOCX contains a part with a suspicious compression ratio.',
        );
      }
    }

    pos += CENTRAL_DIR_HEADER_FIXED_SIZE + filenameLength + extraLength + commentLength;
  }
}

// ---------------------------------------------------------------------
// DOCX — HTML -> pseudo-Markdown (no new HTML-parsing dependency)
// ---------------------------------------------------------------------

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const codePoint =
        body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_HTML_ENTITIES[body] ?? match;
  });
}

/**
 * Converts mammoth's HTML output into the pseudo-Markdown shape
 * chunkText() already knows how to read (literal "# "/"## " heading
 * prefixes), so heading/section tracking is reused rather than
 * reimplemented. Intentionally simple: a tag-strip plus heading/paragraph
 * boundary conversion, not a general HTML-to-Markdown converter — table
 * cell boundaries and list bullets are not specially preserved (a known,
 * minor fidelity gap, not a correctness issue for section tracking).
 *
 * Exported for reuse by the approved-web-page extraction path (Phase 4B),
 * which needs the exact same tag-strip/heading-conversion behavior after
 * its own chrome-stripping pass — this function itself is unchanged.
 */
export function htmlToPseudoMarkdown(html: string): string {
  let text = html;
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, inner: string) => {
    const hashes = '#'.repeat(Number(level));
    return `\n\n${hashes} ${inner.replace(/<[^>]+>/g, '').trim()}\n\n`;
  });
  text = text.replace(/<\/(p|li|tr|div)>/gi, '\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  return decodeHtmlEntities(text);
}

export async function extractDocxChunks(
  buffer: Buffer,
  limits: DocxExtractionLimits = DEFAULT_DOCX_EXTRACTION_LIMITS,
): Promise<{ chunks: ExtractedChunk[] }> {
  if (!looksLikeDocx(buffer)) {
    throw new DocumentExtractionError('malformed', 'This file does not look like a valid DOCX document.');
  }

  // Structural pre-check before mammoth (and its own internal unzip) ever
  // touches this buffer's compressed content. This — not the post-hoc
  // character count below — is the real bound on a DOCX zip bomb: mammoth
  // cannot produce more extracted text than there are underlying
  // uncompressed XML bytes, which this check already caps.
  inspectDocxZipStructure(buffer, limits.zip);

  let html: string;
  try {
    const result = await withTimeout(
      mammoth.convertToHtml({ buffer }),
      limits.timeoutMs,
      'DOCX parsing took too long and was stopped.',
    );
    html = result.value;
  } catch (err) {
    if (err instanceof DocumentExtractionError) throw err;
    throw new DocumentExtractionError('malformed', 'This file could not be read as a valid DOCX document.');
  }

  const pseudoMarkdown = htmlToPseudoMarkdown(html);
  if (pseudoMarkdown.length > limits.maxExtractedChars) {
    throw new DocumentExtractionError(
      'text_too_large',
      `Extracted text exceeds the ${limits.maxExtractedChars}-character limit.`,
    );
  }

  // DOCX has no real page concept — page stays null for every chunk,
  // honestly, rather than inventing one from, e.g., a guessed character
  // count per page.
  const chunks = chunkText(pseudoMarkdown, true).map((c) => ({ ...c, page: null }));
  return { chunks };
}
