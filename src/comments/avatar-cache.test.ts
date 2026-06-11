import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cachedRoundAvatar,
  clearAvatarCache,
  ensureRoundAvatar,
  githubAvatarUri,
} from './avatar-cache';

const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4]);

function fakeResponse(ok: boolean, status: number): Response {
  return {
    ok,
    status,
    arrayBuffer: async () => PNG_BYTES.buffer.slice(0),
  } as unknown as Response;
}

describe('avatar-cache', () => {
  beforeEach(() => {
    clearAvatarCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('githubAvatarUri', () => {
    it('builds the GitHub avatar URL with an encoded login', () => {
      expect(githubAvatarUri('Nacho Vazquez').toString()).toBe(
        'https://github.com/Nacho%20Vazquez.png?size=48',
      );
    });
  });

  describe('ensureRoundAvatar', () => {
    it('fetches the PNG and returns an inline circular SVG data URI', async () => {
      const fetchMock = vi.fn(async () => fakeResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      const uri = await ensureRoundAvatar('alice');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://github.com/alice.png?size=48',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      const value = uri?.toString() ?? '';
      expect(value.startsWith('data:image/svg+xml;base64,')).toBe(true);
      const svg = Buffer.from(value.replace('data:image/svg+xml;base64,', ''), 'base64').toString();
      expect(svg).toContain('clip-path="url(#r)"');
      expect(svg).toContain('<image href="data:image/png;base64,');
    });

    it('caches the result and does not refetch for the same login', async () => {
      const fetchMock = vi.fn(async () => fakeResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      const first = await ensureRoundAvatar('alice');
      expect(cachedRoundAvatar('alice')).toBe(first);

      const second = await ensureRoundAvatar('alice');
      expect(second).toBe(first);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('shares a single in-flight fetch across concurrent callers', async () => {
      const fetchMock = vi.fn(async () => fakeResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      const [a, b] = await Promise.all([
        ensureRoundAvatar('alice'),
        ensureRoundAvatar('alice'),
      ]);

      expect(a).toBe(b);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws and does not cache when GitHub responds non-ok', async () => {
      const fetchMock = vi.fn(async () => fakeResponse(false, 404));
      vi.stubGlobal('fetch', fetchMock);

      await expect(ensureRoundAvatar('ghost')).rejects.toBeInstanceOf(Error);
      await expect(ensureRoundAvatar('ghost')).rejects.toThrow(
        'GitHub avatar fetch for @ghost failed with status 404',
      );
      expect(cachedRoundAvatar('ghost')).toBeUndefined();
    });

    it('retries after failure: failed fetch removes the inflight entry so next call starts fresh', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(fakeResponse(false, 404))
        .mockResolvedValueOnce(fakeResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      await expect(ensureRoundAvatar('ghost')).rejects.toThrow('status 404');
      expect(cachedRoundAvatar('ghost')).toBeUndefined();

      const uri = await ensureRoundAvatar('ghost');
      expect(uri.toString().startsWith('data:image/svg+xml;base64,')).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(cachedRoundAvatar('ghost')).toBe(uri);
    });

    it('propagates rejection to all concurrent callers sharing an in-flight fetch', async () => {
      const fetchMock = vi.fn(async () => fakeResponse(false, 404));
      vi.stubGlobal('fetch', fetchMock);

      const results = await Promise.allSettled([
        ensureRoundAvatar('ghost'),
        ensureRoundAvatar('ghost'),
      ]);

      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('rejected');
      for (const result of results) {
        expect(result.status).toBe('rejected');
        const reason = (result as PromiseRejectedResult).reason;
        expect(reason).toBeInstanceOf(Error);
        expect(reason.message).toContain('failed with status 404');
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(cachedRoundAvatar('ghost')).toBeUndefined();
    });
  });
});
