// Offline cache for the shelf. Pages are network-first (so new articles show up);
// audio and other assets are cache-first. iOS plays audio with Range requests,
// so cached files are sliced into 206 responses.
const CACHE = 'shelf-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const isPage = url => url.pathname.endsWith('/') || /\.(html|json|webmanifest)$/.test(url.pathname);

async function ranged(req, res) {
  const range = req.headers.get('range');
  if (!range || res.status !== 200) return res;
  const buf = await res.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : buf.byteLength - 1;
  if (!m[1] && m[2]) { start = buf.byteLength - +m[2]; end = buf.byteLength - 1; }
  end = Math.min(end, buf.byteLength - 1);
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const key = url.origin + url.pathname;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isPage(url)) {
      try {
        const net = await fetch(key, { cache: 'no-cache' });
        if (net.ok) cache.put(key, net.clone());
        return net;
      } catch {
        return (await cache.match(key)) || new Response('离线且未缓存', { status: 503 });
      }
    }
    let res = await cache.match(key);
    if (!res) {
      try {
        res = await fetch(key);
        if (res.ok) await cache.put(key, res.clone());
      } catch {
        return new Response('', { status: 503 });
      }
    }
    return ranged(req, res);
  })());
});
