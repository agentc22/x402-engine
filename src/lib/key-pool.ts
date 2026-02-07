/**
 * Round-robin API key pool.
 *
 * Distributes requests across multiple API keys per provider to avoid
 * hitting per-key rate limits. Supports any number of keys — works
 * seamlessly with 1 key (no rotation) or many.
 *
 * Usage:
 *   keyPool.register("coingecko", ["key1", "key2", "key3"]);
 *   const key = keyPool.acquire("coingecko"); // round-robin
 */

interface ProviderPool {
  keys: string[];
  index: number;
  totalAcquires: number;
}

class KeyPool {
  private pools = new Map<string, ProviderPool>();

  /**
   * Register keys for a provider. Silently skips if keys array is empty.
   */
  register(provider: string, keys: string[]): void {
    const filtered = keys.filter(Boolean);
    if (filtered.length === 0) return;
    this.pools.set(provider, { keys: filtered, index: 0, totalAcquires: 0 });
  }

  /**
   * Get the next key for a provider (round-robin).
   * Returns null if the provider has no registered keys.
   */
  acquire(provider: string): string | null {
    const pool = this.pools.get(provider);
    if (!pool || pool.keys.length === 0) return null;

    const key = pool.keys[pool.index];
    pool.index = (pool.index + 1) % pool.keys.length;
    pool.totalAcquires++;
    return key;
  }

  /**
   * Number of keys registered for a provider.
   */
  count(provider: string): number {
    return this.pools.get(provider)?.keys.length ?? 0;
  }

  /**
   * Whether a provider has any keys registered.
   */
  has(provider: string): boolean {
    return (this.pools.get(provider)?.keys.length ?? 0) > 0;
  }

  /**
   * Stats for all registered providers.
   */
  stats(): Record<string, { keys: number; acquires: number }> {
    const result: Record<string, { keys: number; acquires: number }> = {};
    for (const [provider, pool] of this.pools) {
      result[provider] = { keys: pool.keys.length, acquires: pool.totalAcquires };
    }
    return result;
  }
}

export const keyPool = new KeyPool();
