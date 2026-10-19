import { crc32 } from 'zlib';
import {
  DEFAULT_ZIP_STRUCTURE_LIMITS,
  DocumentExtractionError,
  DocxExtractionLimits,
  extractDocxChunks,
  extractPdfChunks,
  inspectDocxZipStructure,
  looksLikeDocx,
  looksLikePdf,
  PdfExtractionLimits,
} from './knowledge-document-extraction.util';

// ---------------------------------------------------------------------
// Fixture builders — generated locally at test time, no external
// downloads, no binary files committed to the repo. Each builder was
// manually verified against the real unpdf/mammoth libraries before
// being used here (see the session's investigation notes).
// ---------------------------------------------------------------------

function buildMinimalPdf(pageTexts: string[]): Buffer {
  const parts: Buffer[] = [];
  const offsets: Record<number, number> = {};
  let length = 0;

  function push(str: string) {
    const buf = Buffer.from(str, 'latin1');
    parts.push(buf);
    length += buf.length;
  }
  function pushObj(num: number, body: string) {
    offsets[num] = length;
    push(`${num} 0 obj\n${body}\nendobj\n`);
  }

  push('%PDF-1.4\n');

  const n = pageTexts.length;
  const catalogNum = 1;
  const pagesNum = 2;
  let nextNum = 3;
  const sharedFontNum = nextNum++;
  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];
  for (let i = 0; i < n; i++) {
    pageObjNums.push(nextNum++);
    contentObjNums.push(nextNum++);
  }

  pushObj(catalogNum, `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`);
  pushObj(
    pagesNum,
    `<< /Type /Pages /Kids [${pageObjNums.map((p) => `${p} 0 R`).join(' ')}] /Count ${n} >>`,
  );
  pushObj(sharedFontNum, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

  for (let i = 0; i < n; i++) {
    const content = `BT /F1 24 Tf 72 712 Td (${pageTexts[i]}) Tj ET`;
    pushObj(
      pageObjNums[i],
      `<< /Type /Page /Parent ${pagesNum} 0 R /Resources << /Font << /F1 ${sharedFontNum} 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentObjNums[i]} 0 R >>`,
    );
    pushObj(contentObjNums[i], `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }

  const totalObjs = nextNum - 1;
  const xrefOffset = length;
  let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjs; i++) {
    xref += String(offsets[i] ?? 0).padStart(10, '0') + ' 00000 n \n';
  }
  push(xref);
  push(`trailer\n<< /Size ${totalObjs + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.concat(parts);
}

type StoredZipFile = {
  name: string;
  content: Buffer;
  /** Overrides for the CENTRAL DIRECTORY's declared sizes only — lets tests
   * simulate a "lying" central directory (the exact shape a zip-bomb-style
   * attack would need) without needing real compression. */
  declaredCompressedSize?: number;
  declaredUncompressedSize?: number;
};

function buildStoredZip(files: StoredZipFile[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf-8');
    const crc = crc32(f.content) >>> 0;
    const size = f.content.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localEntry = Buffer.concat([localHeader, nameBuf, f.content]);
    const localOffset = offset;
    localParts.push(localEntry);
    offset += localEntry.length;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(f.declaredCompressedSize ?? size, 20);
    centralHeader.writeUInt32LE(f.declaredUncompressedSize ?? size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);

    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
  }

  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);
  const centralDirOffset = localSection.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localSection, centralSection, eocd]);
}

function buildMinimalDocx(): Buffer {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Sample Heading</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>This is a sample paragraph for extraction testing.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

  return buildStoredZip([
    { name: '[Content_Types].xml', content: Buffer.from(contentTypes, 'utf-8') },
    { name: '_rels/.rels', content: Buffer.from(rootRels, 'utf-8') },
    { name: 'word/document.xml', content: Buffer.from(documentXml, 'utf-8') },
  ]);
}

const FAST_PDF_LIMITS: PdfExtractionLimits = { maxPages: 300, maxExtractedChars: 5_000_000, timeoutMs: 5_000 };
const FAST_DOCX_LIMITS: DocxExtractionLimits = {
  maxExtractedChars: 5_000_000,
  timeoutMs: 5_000,
  zip: DEFAULT_ZIP_STRUCTURE_LIMITS,
};

describe('looksLikePdf / looksLikeDocx (magic-byte checks)', () => {
  it('accepts a real PDF signature', () => {
    expect(looksLikePdf(buildMinimalPdf(['x']))).toBe(true);
  });

  it('rejects arbitrary bytes with no PDF signature', () => {
    expect(looksLikePdf(Buffer.from('just some random text content'))).toBe(false);
  });

  it('accepts a real DOCX (ZIP local file header) signature', () => {
    expect(looksLikeDocx(buildMinimalDocx())).toBe(true);
  });

  it('rejects arbitrary bytes with no ZIP signature', () => {
    expect(looksLikeDocx(Buffer.from('just some random text content'))).toBe(false);
  });

  it('rejects a mismatched magic byte: a .txt-looking buffer claiming to be a PDF/DOCX never passes either check', () => {
    const plainText = Buffer.from('Hello, this is just plain text.');
    expect(looksLikePdf(plainText)).toBe(false);
    expect(looksLikeDocx(plainText)).toBe(false);
  });
});

describe('extractPdfChunks', () => {
  it('extracts correct text and real page numbers from a valid multi-page PDF', async () => {
    const pdf = buildMinimalPdf(['Hello PDF extraction test page one', 'Second page content here']);
    const { chunks, pageCount } = await extractPdfChunks(pdf, FAST_PDF_LIMITS);

    expect(pageCount).toBe(2);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ page: 1, section: null });
    expect(chunks[0].text).toContain('Hello PDF extraction test page one');
    expect(chunks[1]).toMatchObject({ page: 2, section: null });
    expect(chunks[1].text).toContain('Second page content here');
  });

  it('never lets a chunk span two pages — chunking happens per page', async () => {
    const pdf = buildMinimalPdf(['Page one text', 'Page two text']);
    const { chunks } = await extractPdfChunks(pdf, FAST_PDF_LIMITS);
    const pages = new Set(chunks.map((c) => c.page));
    expect(pages.size).toBe(chunks.length); // one distinct page per chunk here
  });

  it('rejects a file with no valid PDF signature before ever invoking the parser', async () => {
    await expect(extractPdfChunks(Buffer.from('not a pdf'), FAST_PDF_LIMITS)).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('rejects a truncated/malformed PDF with a safe, specific error rather than crashing', async () => {
    const valid = buildMinimalPdf(['Some content']);
    const truncated = valid.subarray(0, valid.length - 100); // cut off the xref/trailer
    await expect(extractPdfChunks(truncated, FAST_PDF_LIMITS)).rejects.toBeInstanceOf(DocumentExtractionError);
  });

  it('rejects a PDF with more pages than the configured maximum', async () => {
    const manyPages = Array.from({ length: 5 }, (_, i) => `Page ${i + 1}`);
    const pdf = buildMinimalPdf(manyPages);
    await expect(
      extractPdfChunks(pdf, { ...FAST_PDF_LIMITS, maxPages: 3 }),
    ).rejects.toMatchObject({ code: 'too_many_pages' });
  });

  it('rejects extracted text over the configured character limit', async () => {
    const longText = 'word '.repeat(5000); // ~25,000 chars on one page
    const pdf = buildMinimalPdf([longText.slice(0, 200)]); // keep the PDF content stream itself short/valid
    // Artificially tiny limit to exercise the ceiling without needing a huge fixture.
    await expect(
      extractPdfChunks(pdf, { ...FAST_PDF_LIMITS, maxExtractedChars: 5 }),
    ).rejects.toMatchObject({ code: 'text_too_large' });
  });

  // See knowledge-document-extraction.pdf-errors.spec.ts for the
  // PasswordException / raw-error-leak tests — those need a module-level
  // jest.mock('unpdf', ...) (unpdf's CJS export isn't jest.spyOn-able
  // directly: its properties are non-configurable), which would otherwise
  // force every other test in this file onto a mocked unpdf too.
});

describe('inspectDocxZipStructure (zip-bomb / resource-exhaustion defenses)', () => {
  it('accepts a normal, small, valid DOCX', () => {
    expect(() => inspectDocxZipStructure(buildMinimalDocx())).not.toThrow();
  });

  it('rejects a file with no valid ZIP end-of-central-directory record', () => {
    expect(() => inspectDocxZipStructure(Buffer.from('not a zip at all'))).toThrow(DocumentExtractionError);
  });

  it('rejects a zip with more entries than the configured maximum', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      name: `file${i}.xml`,
      content: Buffer.from('x'),
    }));
    const zip = buildStoredZip(files);
    expect(() => inspectDocxZipStructure(zip, { ...DEFAULT_ZIP_STRUCTURE_LIMITS, maxEntries: 5 })).toThrow(
      expect.objectContaining({ code: 'zip_bomb_suspected' }),
    );
  });

  it('rejects an entry whose declared uncompressed size exceeds the per-entry maximum (a lying central directory, not real decompression)', () => {
    const zip = buildStoredZip([
      {
        name: 'word/document.xml',
        content: Buffer.from('tiny actual bytes'),
        declaredUncompressedSize: 500 * 1024 * 1024, // claims 500MB while actually tiny
      },
    ]);
    expect(() =>
      inspectDocxZipStructure(zip, { ...DEFAULT_ZIP_STRUCTURE_LIMITS, maxEntryUncompressedBytes: 1024 }),
    ).toThrow(expect.objectContaining({ code: 'zip_bomb_suspected' }));
  });

  it('rejects when the sum of declared uncompressed sizes exceeds the total maximum', () => {
    const zip = buildStoredZip([
      { name: 'a.xml', content: Buffer.from('a'), declaredUncompressedSize: 600 },
      { name: 'b.xml', content: Buffer.from('b'), declaredUncompressedSize: 600 },
    ]);
    expect(() =>
      inspectDocxZipStructure(zip, { ...DEFAULT_ZIP_STRUCTURE_LIMITS, maxTotalUncompressedBytes: 1000 }),
    ).toThrow(expect.objectContaining({ code: 'zip_bomb_suspected' }));
  });

  it('rejects an entry with a suspicious declared compression ratio', () => {
    const zip = buildStoredZip([
      {
        name: 'word/document.xml',
        content: Buffer.from('tiny'),
        declaredCompressedSize: 10,
        declaredUncompressedSize: 100_000, // 10,000:1 ratio
      },
    ]);
    expect(() =>
      inspectDocxZipStructure(zip, { ...DEFAULT_ZIP_STRUCTURE_LIMITS, maxCompressionRatio: 300 }),
    ).toThrow(expect.objectContaining({ code: 'zip_bomb_suspected' }));
  });

  it('rejects an implausible entry claiming zero compressed bytes but nonzero uncompressed size', () => {
    const zip = buildStoredZip([
      {
        name: 'word/document.xml',
        content: Buffer.from('tiny'),
        declaredCompressedSize: 0,
        declaredUncompressedSize: 5000,
      },
    ]);
    expect(() => inspectDocxZipStructure(zip)).toThrow(expect.objectContaining({ code: 'zip_bomb_suspected' }));
  });

  it('rejects a ZIP64 entry it cannot safely verify, rather than trusting a possibly-truncated 32-bit size', () => {
    const zip = buildStoredZip([
      {
        name: 'word/document.xml',
        content: Buffer.from('tiny'),
        declaredUncompressedSize: 0xffffffff,
      },
    ]);
    expect(() => inspectDocxZipStructure(zip)).toThrow(expect.objectContaining({ code: 'zip_bomb_suspected' }));
  });

  it('rejects a central directory that runs past the end of the buffer (truncated file)', () => {
    const zip = buildMinimalDocx();
    const truncated = zip.subarray(0, zip.length - 10);
    expect(() => inspectDocxZipStructure(truncated)).toThrow(expect.objectContaining({ code: 'malformed' }));
  });
});

describe('extractDocxChunks', () => {
  it('extracts text and preserves heading/section information; never invents a page number', async () => {
    const { chunks } = await extractDocxChunks(buildMinimalDocx(), FAST_DOCX_LIMITS);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].section).toBe('Sample Heading');
    expect(chunks[0].text).toContain('This is a sample paragraph for extraction testing.');
    for (const c of chunks) {
      expect(c.page).toBeNull();
    }
  });

  it('rejects a file with no valid ZIP signature before ever invoking mammoth', async () => {
    await expect(extractDocxChunks(Buffer.from('not a docx'), FAST_DOCX_LIMITS)).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('runs the ZIP structural pre-check before mammoth, rejecting a zip-bomb-shaped DOCX', async () => {
    const zip = buildStoredZip([
      {
        name: 'word/document.xml',
        content: Buffer.from('tiny'),
        declaredUncompressedSize: 500 * 1024 * 1024,
      },
    ]);
    await expect(
      extractDocxChunks(zip, {
        ...FAST_DOCX_LIMITS,
        zip: { ...DEFAULT_ZIP_STRUCTURE_LIMITS, maxEntryUncompressedBytes: 1024 },
      }),
    ).rejects.toMatchObject({ code: 'zip_bomb_suspected' });
  });

  it('rejects a truncated/malformed DOCX with a safe error rather than crashing', async () => {
    const valid = buildMinimalDocx();
    const truncated = valid.subarray(0, valid.length - 30);
    await expect(extractDocxChunks(truncated, FAST_DOCX_LIMITS)).rejects.toBeInstanceOf(DocumentExtractionError);
  });

  it('rejects extracted text over the configured character limit', async () => {
    await expect(
      extractDocxChunks(buildMinimalDocx(), { ...FAST_DOCX_LIMITS, maxExtractedChars: 1 }),
    ).rejects.toMatchObject({ code: 'text_too_large' });
  });
});
