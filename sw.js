// Fer & Alxs v7: cachea únicamente interfaz pública.
// Nunca intercepta, almacena ni cachea peticiones de Supabase, fotos o chat.
const CACHE='fer-alxs-shell-v7';
const SHELL=['./','./index.html','./galeria.css','./galeria.js','./universo-v7.js','./config.js','./pdf-native.js','./jszip.min.js','./icon.svg','./icon-192.png','./icon-512.png','./manifest.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(async c=>{for(const url of SHELL)try{await c.add(url)}catch{}}).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(!/\.(html|css|js|png|svg|webmanifest)$/.test(url.pathname)&&!url.pathname.endsWith('/'))return;
  // Nunca guardar capturas privadas del usuario; solo rutas declaradas.
  if(!SHELL.some(path=>new URL(path,self.registration.scope).pathname===url.pathname))return;
  e.respondWith(fetch(e.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{})}return response}).catch(()=>caches.match(e.request)));
});
