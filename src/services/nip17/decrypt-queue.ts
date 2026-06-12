/**
 * Run `worker` over `items` with at most `concurrency` in flight at once,
 * preserving input order in the result array. A worker that throws yields
 * `null` for that slot (so junk/undecryptable wraps don't abort the batch).
 * Feed items newest-first to decrypt newest-first.
 */
export async function runBounded<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null)
  let next = 0
  const limit = Math.max(1, concurrency)

  async function pump(): Promise<void> {
    while (next < items.length) {
      const i = next++
      try {
        results[i] = await worker(items[i], i)
      } catch {
        results[i] = null
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => pump()))
  return results
}
