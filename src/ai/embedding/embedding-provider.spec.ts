import { ConfigService } from '@nestjs/config';
import { OpenAiEmbeddingProvider } from './embedding-provider';

function makeProvider(apiKey: string | undefined): OpenAiEmbeddingProvider {
  const config = { get: jest.fn(() => apiKey) } as unknown as ConfigService;
  return new OpenAiEmbeddingProvider(config);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('OpenAiEmbeddingProvider.isConfigured', () => {
  it('is false when OPENAI_API_KEY is unset — the safe default for this repo', () => {
    expect(makeProvider(undefined).isConfigured).toBe(false);
    expect(makeProvider('').isConfigured).toBe(false);
  });

  it('is true when OPENAI_API_KEY is set', () => {
    expect(makeProvider('sk-fake').isConfigured).toBe(true);
  });
});

describe('OpenAiEmbeddingProvider.embed', () => {
  it('returns null for every text without making a network call when unconfigured', async () => {
    const provider = makeProvider(undefined);
    const fetchSpy = jest.spyOn(global, 'fetch');

    const result = await provider.embed(['hello', 'world']);

    expect(result).toEqual([null, null]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns an empty array for an empty input without making a network call', async () => {
    const provider = makeProvider('sk-fake');
    const fetchSpy = jest.spyOn(global, 'fetch');

    expect(await provider.embed([])).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps each returned embedding back to its input by index', async () => {
    const provider = makeProvider('sk-fake');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { index: 1, embedding: [0.2, 0.3] },
          { index: 0, embedding: [0.1, 0.1] },
        ],
      }),
    } as Response);

    const result = await provider.embed(['first', 'second']);

    expect(result).toEqual([
      [0.1, 0.1],
      [0.2, 0.3],
    ]);
  });

  it('never fabricates a vector for a text the response omitted', async () => {
    const provider = makeProvider('sk-fake');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [0.1] }] }),
    } as Response);

    const result = await provider.embed(['first', 'second']);

    expect(result).toEqual([[0.1], null]);
  });

  it('returns null for every text (never throws) when the request fails', async () => {
    const provider = makeProvider('sk-fake');
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(provider.embed(['a', 'b'])).resolves.toEqual([null, null]);
  });

  it('returns null for every text (never throws) when fetch itself throws', async () => {
    const provider = makeProvider('sk-fake');
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(provider.embed(['a', 'b'])).resolves.toEqual([null, null]);
  });

  it('sends the configured model and bounded dimensions in the request body', async () => {
    const provider = makeProvider('sk-fake');
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [0.1] }] }),
    } as Response);

    await provider.embed(['hello']);

    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.model).toBe(OpenAiEmbeddingProvider.MODEL);
    expect(body.dimensions).toBe(OpenAiEmbeddingProvider.DIMENSIONS);
    expect(body.input).toEqual(['hello']);
  });
});
