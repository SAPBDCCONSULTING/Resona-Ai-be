/**
 * Returns 0 for mismatched/empty vectors rather than throwing — callers
 * treat 0 as "no similarity," the same outcome as a chunk with no
 * embedding at all, so a dimension mismatch (e.g. after an embedding
 * model change) degrades silently to "this candidate scores no semantic
 * relevance" instead of breaking retrieval.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
