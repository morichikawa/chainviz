/**
 * ブラウザの localStorage を安全に取得する。localStorage が使えない環境
 * （プライベートモード、テストの jsdom、SSR など）ではインメモリの代替を返す。
 * getItem / setItem だけを使う最小インターフェースに揃える。
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function createMemoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

/** 実際に読み書きできる localStorage かどうかを試す。 */
function isUsable(storage: KeyValueStorage | undefined | null): boolean {
  if (!storage) return false;
  try {
    const probe = "__chainviz_probe__";
    storage.setItem(probe, "1");
    storage.getItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function getBrowserStorage(): KeyValueStorage {
  const candidate =
    typeof globalThis !== "undefined"
      ? (globalThis as { localStorage?: KeyValueStorage }).localStorage
      : undefined;
  return isUsable(candidate) ? (candidate as KeyValueStorage) : createMemoryStorage();
}
