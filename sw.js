// Fer & Alxs V_C: cachea únicamente la interfaz pública (shell).
// Nunca intercepta, almacena ni cachea peticiones de Supabase, fotos, videos o chat.
const CACHE='fer-alxs-shell-fusion-7-8';
const SHELL=['./','./index.html','./config.js','./manifest.webmanifest',
  './css/experiencia77.css','./css/experiencia78.css','./css/galeria.css','./css/mejoras.css','./css/vc.css',
  './js/giphy-public.js','./js/galeria.js','./js/universo.js','./js/mejoras.js','./js/vc.js','./js/pdf-native.js',
  './vendor/jszip.min.js',
  './assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png','./assets/icon-maskable-512.png'];
const SHELL_PATHS=new Set(SHELL.map(p=>new URL(p,self.registration.scope).pathname));
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(async c=>{for(const url of SHELL){try{await c.add(url)}catch{}}}).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin)return;
  if(!SHELL_PATHS.has(url.pathname))return; // solo rutas declaradas
  e.respondWith(
    fetch(req).then(res=>{
      if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{})}
      return res;
    }).catch(async()=>{
      const hit=await caches.match(req,{ignoreSearch:true});
      if(hit)return hit;
      if(req.mode==='navigate'){const home=await caches.match('./index.html',{ignoreSearch:true});if(home)return home}
      return Response.error();
    })
  );
});
