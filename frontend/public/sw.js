// Service worker minimal de Calmap.
// Stratégie « réseau d'abord, cache en secours » sur les fichiers de l'app :
// l'app reste à jour en ligne et continue de s'ouvrir hors ligne.
// Les appels /api/* et les tuiles de carte (autre origine) ne sont PAS mis en
// cache : les données sensorielles doivent rester fraîches.
const CACHE = "calmap-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return; // laisse passer sans intercepter
  }
  event.respondWith(
    fetch(event.request)
      .then((reponse) => {
        const copie = reponse.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copie));
        return reponse;
      })
      .catch(async () => {
        const enCache = await caches.match(event.request);
        return enCache || caches.match("/index.html");
      })
  );
});
