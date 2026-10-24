import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageValue, savedUsername, rememberUsername, saveBrowserPassword, withDeadline } from '../src/startup';
test('startup handles blocked storage and saves only the username', async () => {
  const values = new Map<string, string>();
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  rememberUsername('ZHD', true); assert.equal(savedUsername(), 'ZHD');
  assert.equal(values.size, 1); rememberUsername('', false); assert.equal(savedUsername(), '');
  Object.assign(globalThis, { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } } });
  assert.equal(storageValue('rxm-bridge-auto-v2'), ''); assert.equal(savedUsername(), '');
  assert.doesNotThrow(() => rememberUsername('ZHD', true));
});
test('stalled startup work times out and completed work keeps its result', async () => {
  assert.equal(await withDeadline(Promise.resolve(42), 'Timed out', 50), 42);
  await assert.rejects(withDeadline(new Promise<never>(() => {}), 'Connection took too long', 5), /Connection took too long/);
});
test('unsupported password managers do not prevent login', async () => {
  Object.assign(globalThis, { window: {} });
  await assert.doesNotReject(saveBrowserPassword('ZHD', 'not-persisted'));
});
