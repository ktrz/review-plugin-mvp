const chains = new Map<string, Promise<unknown>>();

export function runExclusive<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(filePath) ?? Promise.resolve();
  const next = previous.then(
    () => fn(),
    () => fn(),
  );
  chains.set(
    filePath,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export function __resetTransactionQueueForTests(): void {
  chains.clear();
}
