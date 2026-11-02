/* FER & ALXS · V_C — mejoras aditivas. Nunca toca datos, sesión ni Supabase. */
(function(){
'use strict';
const BASE='Fer & Alxs · Nuestro universo';
const TITLES={home:'Inicio',cards:'Cartas',binder:'Archivador',chat:'Chat',notes:'Notas',calendar:'Calendario',music:'Música',videos:'Videos',more:'Más',savings:'Ahorros',backup:'Cápsula',today:'Un día como hoy',places:'Mapa',gifts:'Regalos',dreams:'Sueños',diary:'Diario',studio:'Estudio'};

// 1) Título de la pestaña y foco accesible al cambiar de sección.
window.addEventListener('fer-page',e=>{
  try{
    const name=e.detail,label=TITLES[name];
    document.title=label&&name!=='home'?label+' · Fer & Alxs':BASE;
    const main=document.getElementById('main');
    if(main&&name!=='chat')main.focus({preventScroll:true});
  }catch{}
});

// 2) Imágenes: decodificación asíncrona, carga diferida y fundido al aparecer.
function prep(img){
  if(img.dataset.vc)return;img.dataset.vc='1';
  if(!img.hasAttribute('decoding'))img.decoding='async';
  if(img.complete)return;
  img.classList.add('vc-pending');
  const done=()=>img.classList.remove('vc-pending');
  img.addEventListener('load',done,{once:true});
  img.addEventListener('error',done,{once:true});
  setTimeout(done,6000); // seguro: nunca dejar una imagen invisible
}
function scan(root){
  if(root.nodeType!==1)return;
  if(root.tagName==='IMG')prep(root);
  root.querySelectorAll&&root.querySelectorAll('img').forEach(prep);
}
try{
  scan(document.body);
  new MutationObserver(list=>{for(const m of list)m.addedNodes.forEach(scan)}).observe(document.body,{childList:true,subtree:true});
}catch{}

// 3) Enlaces externos seguros (target=_blank siempre con rel).
document.addEventListener('click',e=>{
  const a=e.target.closest&&e.target.closest('a[target="_blank"]');
  if(a&&!/noopener/.test(a.rel))a.rel=(a.rel+' noopener noreferrer').trim();
},true);

// 4) Atajo "/" para buscar recuerdos (sin interferir al escribir).
document.addEventListener('keydown',e=>{
  if(e.key!=='/'||e.ctrlKey||e.metaKey||e.altKey)return;
  const t=e.target;if(t&&(/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)||t.isContentEditable))return;
  const btn=document.getElementById('v71SearchOpen');
  if(btn&&btn.offsetParent!==null){e.preventDefault();btn.click()}
});
})();
