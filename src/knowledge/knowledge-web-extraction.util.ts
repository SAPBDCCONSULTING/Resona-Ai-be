/**
 * Text extraction for an already-fetched, already-approved web page.
 * Parses HTML as plain text (regex-based tag stripping, same technique
 * already used for DOCX in Phase 4A) — never executes any script, never
 * renders, never loads a DOM. Reuses htmlToPseudoMarkdown/chunkText rather
 * than reimplementing heading/section detection.
 */

import { chunkText, type ExtractedChunk } from './knowledge-text.util';
import { DocumentExtractionError, htmlToPseudoMarkdown } from './knowledge-document-extraction.util';

export const MAX_WEB_EXTRACTED_CHARS_DEFAULT = 2_000_000;

/**
 * Entirely removed, tag AND content — this is page chrome/non-content,
 * never meant to be read as the page's text, and script/style content in
 * particular must never reach extracted text or an AI prompt.
 */
const CHROME_TAGS = ['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'template', 'svg', 'form', 'iframe'];

function stripChromeAndComments(html: string): string {
  let result = html;
  for (const tag of CHROME_TAGS) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    result = result.replace(pattern, '');
  }
  // HTML comments can contain anything (including stale script snippets) — never read as content.
  result = result.replace(/<!--[\s\S]*?-->/g, '');
  return result;
}

export function extractWebPageChunks(
  html: string,
  maxExtractedChars: number = MAX_WEB_EXTRACTED_CHARS_DEFAULT,
): ExtractedChunk[] {
  const withoutChrome = stripChromeAndComments(html);
  const pseudoMarkdown = htmlToPseudoMarkdown(withoutChrome);

  if (pseudoMarkdown.length > maxExtractedChars) {
    throw new DocumentExtractionError(
      'text_too_large',
      `Extracted text exceeds the ${maxExtractedChars}-character limit.`,
    );
  }

  // Web pages have no real page concept — page stays null, honestly,
  // exactly like the DOCX path.
  return chunkText(pseudoMarkdown, true).map((c) => ({ ...c, page: null }));
}
