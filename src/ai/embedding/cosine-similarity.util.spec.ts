import { cosineSimilarity } from './cosine-similarity.util';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('returns 0 for mismatched lengths instead of throwing', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 0 for empty vectors instead of throwing', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for a zero vector instead of dividing by zero', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
