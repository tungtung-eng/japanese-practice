// 背景服務程式：
//   1. 把 App 存在手機上，沒網路也能打開、看句子、聽發音
//   2. 收到每日三句推播就顯示；點通知就打開 App 並跳到那一句
const CACHE = 'nihongo-v4';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'phrases.js', 'phrases-en.js', 'kana.js', 'traps.js', 'vocab.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first for our own files (so updates show up), cache when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // no-cache: always check the server for a newer version, skipping the browser's 10-minute cache.
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: '英日雙語學習機', body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(self.registration.showNotification(d.title || '英日雙語學習機', {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.tag || 'daily',
    renotify: true,
    data: { slot: d.slot || '', lang: d.lang || '' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const slot = (e.notification.data && e.notification.data.slot) || '';
  const lang = (e.notification.data && e.notification.data.lang) || '';
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) {
        await c.focus();
        if (slot) c.postMessage({ today: slot, lang });
        return;
      }
    }
    await self.clients.openWindow(self.registration.scope + (slot ? '?today=' + slot + (lang ? '&lang=' + lang : '') : ''));
  })());
});
