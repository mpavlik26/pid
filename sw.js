// Minimal service worker: caches the static app shell so the app opens even
// offline (you just won't get live departures without network). It never
// caches api.golemio.cz requests — those must always hit the network.
const CACHE_NAME = 'pid-departures-shell-v11'; // bump při každé změně souborů v SHELL_FILES
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './connections.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  // {cache: 'reload'} obchází běžnou HTTP cache prohlížeče/CDN — bez toho
  // se mohlo stát, že cache.addAll() při novém CACHE_NAME přesto dotáhne
  // starou (ještě neexpirovanou) verzi jednoho souboru ze SHELL_FILES a
  // spolu s čerstvými ostatními vytvoří nekonzistentní app shell.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(SHELL_FILES.map((url) =>
        fetch(url, { cache: 'reload' }).then((response) => cache.put(url, response))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache/interfere with the live API — always go to network.
  if (url.hostname.endsWith('golemio.cz')) {
    return;
  }

  // App shell: cache-first, falling back to network.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
