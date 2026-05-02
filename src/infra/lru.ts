type Entry<V> = { value: V; expiresAt: number };

export type Lru<K, V> = {
  get: (key: K) => V | undefined;
  set: (key: K, value: V) => void;
  clear: () => void;
};

export function createLru<K, V>(opts: {
  max: number;
  ttlMs: number;
  now?: () => number;
}): Lru<K, V> {
  const now = opts.now ?? (() => Date.now());
  const map = new Map<K, Entry<V>>();
  return {
    get(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (e.expiresAt <= now()) {
        map.delete(key);
        return undefined;
      }
      // move to MRU
      map.delete(key);
      map.set(key, e);
      return e.value;
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, { value, expiresAt: now() + opts.ttlMs });
      if (map.size > opts.max) {
        const oldest = map.keys().next().value as K | undefined;
        if (oldest !== undefined) map.delete(oldest);
      }
    },
    clear() {
      map.clear();
    },
  };
}
