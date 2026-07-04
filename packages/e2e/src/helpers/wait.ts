/** 指定ミリ秒待つ。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * predicate が truthy な値を返すまで interval 間隔でポーリングする。timeout を
 * 超えたら Error を投げる。predicate は同期でも非同期でもよく、例外は「まだ
 * 条件未達」として扱い（最後の例外は timeout メッセージに含める）継続する。
 */
export async function waitFor<T>(
  predicate: () => T | Promise<T>,
  {
    timeoutMs = 60_000,
    intervalMs = 1_000,
    description = "condition",
  }: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await predicate();
      if (value) return value as NonNullable<T>;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() >= deadline) {
      const suffix = lastError ? ` (last error: ${String(lastError)})` : "";
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for ${description}${suffix}`,
      );
    }
    await sleep(intervalMs);
  }
}
