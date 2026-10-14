// HydroLog service worker (v8.1)
// - App shell (the page, manifest, icons): network-first, so updates show up right away;
//   falls back to the cached copy when offline.
// - Libraries from CDNs (Tailwind, Firebase SDK, Font Awesome, Google Fonts):
//   stale-while-revalidate, so the app opens instantly and offline.
// - Firebase data/auth traffic is never touched; Firestore handles its own offline cache.

const VERSION = 'hydrolog-v8.1';
const SHELL_CACHE = `${VERSION}-shell`;
const CDN_CACHE = `${VERSION}-cdn`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Add individually so one missing file doesn't fail the whole install
    await Promise.all(SHELL_FILES.map(url => cache.add(url).catch(() => {})));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The page asks the waiting worker to take over when the user taps "Reload"
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isCdnRequest(url) {
  if (url.hostname === 'www.gstatic.com') return url.pathname.startsWith('/firebasejs/');
  return CDN_HOSTS.includes(url.hostname);
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return (await cache.match(request, { ignoreSearch: true }))
        || (request.mode === 'navigate' && ((await cache.match('./index.html')) || (await cache.match('./'))))
        || Response.error();
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(event.request);
  const network = fetch(event.request)
    .then(response => {
      if (response && (response.ok || response.type === 'opaque')) cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => cached);
  if (cached) {
    event.waitUntil(network); // refresh in the background
    return cached;
  }
  return network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    event.respondWith(networkFirst(request));
    return;
  }

  if (isCdnRequest(url)) {
    event.respondWith(staleWhileRevalidate(event));
  }
  // Everything else (Firestore, Firebase Auth, analytics) goes straight to the network.
});
