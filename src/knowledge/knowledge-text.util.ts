/**
 * Pure text-processing helpers for the Knowledge Base ingestion pipeline —
 * no Mongo/GridFS/Nest dependencies, so these can be unit tested directly
 * without mocking any infrastructure.
 */

export const MAX_CHUNK_CHARS = 1000;

export type ExtractedChunk = {
  text: string;
  section: string | null;
  /**
   * Optional and never set by chunkText() itself — TXT/Markdown have no
   * real pagination. Populated by the PDF extraction path (one real page
   * number per chunk, since PDF chunking happens per page) and explicitly
   * left null by the DOCX path (no real page concept to invent one for).
   */
  page?: number | null;
};

/**
 * Server-side content-type validation for the MVP's plain-text/Markdown
 * scope. True MIME sniffing for text formats is inherently fuzzy (no magic
 * bytes), so this checks the one thing that's actually reliable: genuine
 * text essentially never contains a NUL byte in its first few hundred bytes,
 * while virtually every binary format (PDF, images, archives, executables)
 * does. Combined with the declared-MIME allowlist check at the call site,
 * this catches "renamed .exe to .txt"-style spoofing without needing a real
 * format-detection library.
 */
export function looksLikeBinary(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, 512);
  for (let i = 0; i < sampleLength; i++) {
    if (buffer[i] === 0x00) return true;
  }
  return false;
}

/**
 * Splits normalized text into bounded chunks, tracking the nearest preceding
 * Markdown heading as each chunk's "section" when one genuinely exists.
 * Never invents a section for plain text or content with no heading above it
 * — `section` stays null in that case, per "do not fabricate locations."
 *
 * Paragraphs (blank-line-separated) are the unit of grouping; consecutive
 * paragraphs are packed into a chunk up to MAX_CHUNK_CHARS. A single
 * paragraph longer than the max is hard-split at the boundary rather than
 * producing an oversized chunk or crashing.
 */
export function chunkText(raw: string, isMarkdown: boolean): ExtractedChunk[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const chunks: ExtractedChunk[] = [];
  let currentSection: string | null = null;
  let buffer: string[] = [];
  let bufferLen = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    chunks.push({ text: buffer.join('\n\n'), section: currentSection });
    buffer = [];
    bufferLen = 0;
  };

  for (const paragraph of paragraphs) {
    const headingMatch = isMarkdown ? paragraph.match(/^#{1,6}\s+(.+)$/m) : null;
    if (headingMatch && paragraph.trim().startsWith('#')) {
      // A heading paragraph starts a new section; flush what came before it.
      flush();
      currentSection = headingMatch[1].trim();
      continue;
    }

    if (paragraph.length > MAX_CHUNK_CHARS) {
      flush();
      for (let i = 0; i < paragraph.length; i += MAX_CHUNK_CHARS) {
        chunks.push({ text: paragraph.slice(i, i + MAX_CHUNK_CHARS), section: currentSection });
      }
      continue;
    }

    if (bufferLen + paragraph.length + 2 > MAX_CHUNK_CHARS && buffer.length > 0) {
      flush();
    }
    buffer.push(paragraph);
    bufferLen += paragraph.length + 2;
  }
  flush();

  return chunks;
}
