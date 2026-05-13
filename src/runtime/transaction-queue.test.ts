import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetTransactionQueueForTests, runExclusive } from './transaction-queue';

const defer = <T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe('runExclusive', () => {
  beforeEach(() => {
    __resetTransactionQueueForTests();
  });

  afterEach(() => {
    __resetTransactionQueueForTests();
  });

  it('serializes concurrent calls for the same filePath in submission order', async () => {
    const events: string[] = [];
    const first = defer<void>();
    const second = defer<void>();

    const a = runExclusive('/x.md', async () => {
      events.push('a-start');
      await first.promise;
      events.push('a-end');
      return 'a';
    });
    const b = runExclusive('/x.md', async () => {
      events.push('b-start');
      await second.promise;
      events.push('b-end');
      return 'b';
    });

    await flushMicrotasks();
    expect(events).toEqual(['a-start']);
    first.resolve();
    await a;
    await flushMicrotasks();
    expect(events).toEqual(['a-start', 'a-end', 'b-start']);
    second.resolve();
    await b;
    expect(events).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('second submission observes a shared mutation from the first', async () => {
    const state = { value: 0 };

    const a = runExclusive('/x.md', async () => {
      await Promise.resolve();
      state.value = 1;
    });
    const b = runExclusive('/x.md', async () => {
      return state.value;
    });

    await a;
    await expect(b).resolves.toBe(1);
  });

  it('rejection in first does not block second', async () => {
    const error = new Error('boom');
    const a = runExclusive('/x.md', async () => {
      throw error;
    });
    const b = runExclusive('/x.md', async () => 'ok');

    await expect(a).rejects.toBe(error);
    await expect(b).resolves.toBe('ok');
  });

  it('runs different filePath values in parallel', async () => {
    const aStarted = defer<void>();
    const bStarted = defer<void>();
    const release = defer<void>();

    const a = runExclusive('/a.md', async () => {
      aStarted.resolve();
      await release.promise;
      return 'a';
    });
    const b = runExclusive('/b.md', async () => {
      bStarted.resolve();
      await release.promise;
      return 'b';
    });

    await aStarted.promise;
    await bStarted.promise;
    release.resolve();
    await expect(a).resolves.toBe('a');
    await expect(b).resolves.toBe('b');
  });

  it('surfaces the original rejection value through the returned promise', async () => {
    const cause = { kind: 'custom-error' as const };
    const p = runExclusive('/x.md', async () => {
      throw cause;
    });
    await expect(p).rejects.toBe(cause);
  });
});
