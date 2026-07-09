import { describe, it, expect, beforeEach } from 'vitest';
import {
  DURABLE_KEYS,
  setDurable,
  durableStorage,
  hydrateDurableState,
} from '@/lib/persistentStore';

// In the test (and plain-browser) environment there's no Tauri IPC, so the disk
// mirror is a caught no-op and localStorage is the source of truth. These tests
// pin that fallback behavior — the guarantee that nothing breaks without Tauri.

describe('persistentStore (cache-only / no-Tauri fallback)', () => {
  beforeEach(() => localStorage.clear());

  it('exposes the set of durable keys', () => {
    expect(DURABLE_KEYS.length).toBeGreaterThan(0);
    expect(DURABLE_KEYS).toContain('aiden.commitment.overrides');
    expect(DURABLE_KEYS).toContain('aiden.crm.overrides');
  });

  it('setDurable writes through to the localStorage cache', () => {
    setDurable('aiden.test.key', JSON.stringify({ a: 1 }));
    expect(localStorage.getItem('aiden.test.key')).toBe('{"a":1}');
  });

  it('durableStorage round-trips values (zustand adapter shape)', () => {
    durableStorage.setItem('k', 'v');
    expect(durableStorage.getItem('k')).toBe('v');
    durableStorage.removeItem('k');
    expect(durableStorage.getItem('k')).toBeNull();
  });

  it('durableStorage.getItem returns null for a missing key', () => {
    expect(durableStorage.getItem('nope')).toBeNull();
  });

  it('hydrateDurableState resolves and never clobbers existing cache when disk is unavailable', async () => {
    localStorage.setItem('aiden.commitment.overrides', '{"c1":{"status":"done"}}');
    await expect(hydrateDurableState(['aiden.commitment.overrides'])).resolves.toBeUndefined();
    // Disk read fails (no IPC) → cache must be preserved, not wiped.
    expect(localStorage.getItem('aiden.commitment.overrides')).toBe('{"c1":{"status":"done"}}');
  });
});
