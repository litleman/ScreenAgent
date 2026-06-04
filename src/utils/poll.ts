export interface PollResult<T> {
  found: boolean
  value: T | null
  elapsed: number
}

export async function pollUntil<T>(
  fn: () => Promise<T | null>,
  timeout: number,
  interval: number,
): Promise<PollResult<T>> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const value = await fn()
    if (value !== null && value !== undefined) {
      return { found: true, value, elapsed: Date.now() - start }
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  return { found: false, value: null, elapsed: Date.now() - start }
}
