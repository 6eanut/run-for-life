import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function harness() {
  const handlers: Record<string, (event: any) => void> = {};
  const cache = { match: vi.fn<(request: unknown, options?: unknown) => Promise<Response | undefined>>().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined), addAll: vi.fn().mockResolvedValue(undefined) };
  const caches = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue([]), delete: vi.fn().mockResolvedValue(true) };
  const response = new Response('valid worker', { status: 200 });
  const fetch = vi.fn().mockResolvedValue(response);
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const claim = vi.fn().mockResolvedValue(undefined);
  const source = readFileSync('scripts/sw-template.js', 'utf8').replace('__VERSION__', '"run-for-life-current"').replace('__SHELL__', '["./index.html"]');
  vm.runInNewContext(source, { self: { location: { origin: 'https://example.test' }, addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; }, skipWaiting, clients: { claim } }, caches, fetch, URL, Response, console });
  const lifetimes: Promise<unknown>[] = [];
  const request = { method: 'GET', url: 'https://example.test/running/ocr/worker.min.js', mode: 'cors' };
  const run = (overrides: Partial<typeof request> = {}) => {
    let result: Promise<Response> | undefined;
    handlers.fetch({ request: { ...request, ...overrides }, respondWith: (value: Promise<Response>) => { result = value; }, waitUntil: (value: Promise<unknown>) => lifetimes.push(value) });
    return result;
  };
  return { cache, caches, fetch, response, skipWaiting, claim, handlers, lifetimes, run };
}

describe('service worker storage restrictions', () => {
  it('returns a successful asset even when cache.put exceeds quota', async () => {
    const h = harness(); h.cache.put.mockRejectedValue(new Error('QuotaExceededError'));
    await expect(h.run()).resolves.toBe(h.response);
    await Promise.all(h.lifetimes);
  });
  it('does not wait for a blocked cache write before returning a network asset', async () => {
    const h = harness(); h.cache.put.mockReturnValue(new Promise(() => {}));
    const winner = await Promise.race([h.run()!.then(() => 'network'), new Promise(resolve => setTimeout(() => resolve('blocked'), 20))]);
    expect(winner).toBe('network');
  });
  it('does not discard a network asset if cache.put throws synchronously', async () => {
    const h = harness(); h.cache.put.mockImplementation(() => { throw new Error('SecurityError'); });
    await expect(h.run()).resolves.toBe(h.response);
    await Promise.all(h.lifetimes);
  });
  it.each(['open', 'match'])('returns a network asset when cache.%s is denied', async operation => {
    const h = harness();
    if (operation === 'open') h.caches.open.mockRejectedValue(new Error('SecurityError'));
    else h.cache.match.mockRejectedValue(new Error('SecurityError'));
    await expect(h.run()).resolves.toBe(h.response);
  });
  it('uses a cached asset without fetching and ignores static Origin vary headers', async () => {
    const h = harness(); h.cache.match.mockResolvedValue(h.response);
    await expect(h.run()).resolves.toBe(h.response);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.cache.match).toHaveBeenCalledWith(expect.anything(), { ignoreVary: true });
  });
  it('returns cached index on offline navigation', async () => {
    const h = harness(); const shell = new Response('<html>offline</html>');
    h.cache.match.mockResolvedValue(shell);
    h.fetch.mockRejectedValue(new Error('offline'));
    await expect(h.run({ mode: 'navigate' })).resolves.toBe(shell);
  });
  it('returns a valid network error response when offline storage is unavailable', async () => {
    const h = harness(); h.caches.open.mockRejectedValue(new Error('SecurityError'));
    h.fetch.mockRejectedValue(new Error('offline'));
    expect((await h.run({ mode: 'navigate' }))?.type).toBe('error');
  });
  it('ignores non-GET and cross-origin requests', () => {
    const h = harness();
    expect(h.run({ method: 'POST' })).toBeUndefined();
    expect(h.run({ url: 'https://other.test/worker.js' })).toBeUndefined();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('only activates a waiting update after an explicit message', () => {
    const h = harness();
    expect(h.skipWaiting).not.toHaveBeenCalled();
    h.handlers.message({ data: 'OTHER' });
    expect(h.skipWaiting).not.toHaveBeenCalled();
    h.handlers.message({ data: 'SKIP_WAITING' });
    expect(h.skipWaiting).toHaveBeenCalledOnce();
  });
  it('can install and claim clients even when browser storage is restricted', async () => {
    const h = harness(); h.caches.open.mockRejectedValue(new Error('SecurityError')); h.caches.keys.mockRejectedValue(new Error('SecurityError'));
    const lifetime: Promise<unknown>[] = [];
    h.handlers.install({ waitUntil: (value: Promise<unknown>) => lifetime.push(value) });
    h.handlers.activate({ waitUntil: (value: Promise<unknown>) => lifetime.push(value) });
    await expect(Promise.all(lifetime)).resolves.toBeDefined();
    expect(h.claim).toHaveBeenCalledOnce();
  });
});

it('fetches fresh HTML on navigation even when an older shell is cached', async () => {
  const h = harness();
  h.cache.match.mockResolvedValue(new Response('old application'));
  await expect(h.run({ mode: 'navigate' })).resolves.toBe(h.response);
  expect(h.fetch).toHaveBeenCalledOnce();
});

it('rejects an update whose offline shell could not be downloaded', async () => {
  const h = harness();
  h.cache.addAll.mockRejectedValue(new TypeError('Network failed during precache'));
  const lifetime: Promise<unknown>[] = [];
  h.handlers.install({ waitUntil: (value: Promise<unknown>) => lifetime.push(value) });
  await expect(Promise.all(lifetime)).rejects.toThrow('Network failed');
});

it('keeps the previous offline cache until the new shell exists', async () => {
  const h = harness();
  h.caches.keys.mockResolvedValue(['run-for-life-old']);
  h.cache.match.mockResolvedValue(undefined);
  const lifetime: Promise<unknown>[] = [];
  h.handlers.activate({ waitUntil: (value: Promise<unknown>) => lifetime.push(value) });
  await Promise.all(lifetime);
  expect(h.caches.delete).not.toHaveBeenCalled();
  expect(h.claim).toHaveBeenCalledOnce();
});

it('cleans only previous app caches after the current shell is ready', async () => {
  const h = harness();
  h.caches.keys.mockResolvedValue(['run-for-life-old', 'run-for-life-current', 'other-app']);
  h.cache.match.mockResolvedValue(new Response('ready shell'));
  const lifetime: Promise<unknown>[] = [];
  h.handlers.activate({ waitUntil: (value: Promise<unknown>) => lifetime.push(value) });
  await Promise.all(lifetime);
  expect(h.caches.delete).toHaveBeenCalledExactlyOnceWith('run-for-life-old');
});
