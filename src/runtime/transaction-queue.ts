const chains = new Map<string, Promise<unknown>>();

export function runExclusive<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(filePath) ?? Promise.resolve();
  const next = previous.then(
    () => fn(),
    () => fn(),
  );
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  chains.set(filePath, settled);
  settled.then(() => {
    if (chains.get(filePath) === settled) {
      chains.delete(filePath);
    }
  });
  return next;
}

export function __resetTransactionQueueForTests(): void {
  chains.clear();
}
