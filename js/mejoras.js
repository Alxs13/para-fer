/* Fer & Alxs v7.1 · Guía, búsqueda privada y actualizaciones PWA.
   No crea tablas ni transmite búsquedas a terceros. Respeta Supabase RLS. */
(()=>{
'use strict';
const core=window.FerCoreV7;
if(!core)return;
const sb=core.sb,$=id=>document.getElementById(id);
const app=$('appView'),search=$('v71SearchDialog'),welcome=$('v71WelcomeDialog');
const input=$('v71SearchInput'),results=$('v71SearchResults'),status=$('v71SearchStatus');
let indexedUser=null,items=[],request=null,previousFocus=null,opened=false,shownWelcomeFor=null;
const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-CL');
const fmtDate=s=>{try{return s?new Intl.DateTimeFormat('es-CL',{dateStyle:'medium'}).format(new Date(String(s).slice(0,10)+'T12:00:00')):''}catch{return''}};
function authenticated(){return core.user()&&!app.classList.contains('hidden')}
function show(dialog){previousFocus=document.activeElement;dialog.classList.remove('hidden');dialog.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';}
function hide(dialog){dialog.classList.add('hidden');dialog.setAttribute('aria-hidden','true');document.body.style.overflow='';previousFocus?.focus?.();}
function closeAll(){if(!search.classList.contains('hidden'))hide(search);if(!welcome.classList.contains('hidden'))hide(welcome)}
function showGuide(){if(!authenticated())return;show(welcome);$('v71WelcomeCards').focus({preventScroll:true})}
function closeGuide(){const u=core.user();if(u){try{localStorage.setItem('fer-alxs-welcome-v71-'+u.id,'seen')}catch{}}hide(welcome)}
$('v71WelcomeOpen').addEventListener('click',showGuide);
$('v71HomeGuide').addEventListener('click',showGuide);
$('v71WelcomeClose').addEventListener('click',closeGuide);
$('v71WelcomeCards').addEventListener('click',()=>{closeGuide();core.goPage('cards')});
$('v71WelcomeChat').addEventListener('click',()=>{closeGuide();core.goPage('chat')});
function maybeWelcome(){if(!authenticated())return;const u=core.user(),name=core.members().find(m=>m.user_id===u.id)?.display_name||'';
 if(!/fer(nanda)?/i.test(name)||shownWelcomeFor===u.id)return;
 shownWelcomeFor=u.id;
 let seen=false;try{seen=localStorage.getItem('fer-alxs-welcome-v71-'+u.id)==='seen'}catch{}
 if(!seen)showGuide();}
// La guía aparece solo en la primera visita de Fer en cada dispositivo.
new MutationObserver(()=>{if(!authenticated()){shownWelcomeFor=null;indexedUser=null;items=[];closeAll()}else maybeWelcome()}).observe(app,{attributes:true,attributeFilter:['class']});
window.addEventListener('fer-page',e=>{if(e.detail==='home')maybeWelcome();if(e.detail==='backup')backupHint()});

function setSearchMessage(message){status.textContent=message}
async function loadIndex(){
 if(!authenticated())throw Error('Inicia sesión para buscar recuerdos.');
 const uid=core.user().id;
 if(indexedUser===uid&&items.length)return items;
 setSearchMessage('Buscando nuestros recuerdos…');
 // Todo ocurre con la sesión autenticada. No se guardan búsquedas privadas en localStorage.
 const photoPromise=core.allPhotos();
 const other=[
  ['videos','couple_videos','id,title,note,location,event_date,created_at','Videos','videos'],
  ['songs','couple_songs','id,title,artist,dedication,created_at','Canciones','music'],
  ['dreams','couple_dreams','id,title,details,target_date,created_at','Sueños','dreams'],
  ['places','couple_places','id,name,description,visited_at,created_at','Lugares','places'],
  ['diary','couple_diary','id,title,content,entry_date,created_at,visibility','Diario','diary']
 ];
 const loaded=await Promise.allSettled([photoPromise,...other.map(async([kind,table,fields,label,page])=>{
  const {data,error}=await sb.from(table).select(fields).order('created_at',{ascending:false}).limit(500);if(error)throw error;
  return (data||[]).map(row=>({kind,id:row.id,title:row.title||row.name||'Recuerdo',detail:row.location||row.artist||row.description||row.dedication||row.details||row.content||row.note||'',date:row.event_date||row.visited_at||row.entry_date||row.target_date||row.created_at||'',label,page,searchText:Object.values(row).join(' ')}));
 })]);
 const list=[];
 if(loaded[0].status==='fulfilled'){
  for(const p of loaded[0].value||[])list.push({kind:'photos',id:p.id,title:p.title||'Fotografía sin título',detail:[p.location,p.bubble_text,p.back_note].filter(Boolean).join(' · '),date:p.event_date||p.created_at||'',label:'Cartas',page:'cards',storagePath:p.storage_path,searchText:[p.title,p.location,p.bubble_text,p.back_note,p.reminder,p.event_date,p.created_at].filter(Boolean).join(' ')});
 }
 for(let i=1;i<loaded.length;i++)if(loaded[i].status==='fulfilled')list.push(...loaded[i].value);
 if(core.user()?.id!==uid)throw Error('Se cerró la sesión.');
 indexedUser=uid;items=list;
 const fails=loaded.filter(r=>r.status==='rejected').length;
 setSearchMessage(fails?`Algunos módulos no pudieron consultarse (${fails}). Puedes buscar entre ${list.length} recuerdos disponibles.`:`${list.length} recuerdos disponibles para buscar.`);
 return list;
}
function renderSearch(){const q=normalize(input.value.trim());results.replaceChildren();
 if(!q){setSearchMessage('Escribe un lugar, una fecha o una palabra de sus recuerdos.');return}
 const matches=items.filter(item=>normalize(item.searchText).includes(q)).slice(0,60);
 setSearchMessage(matches.length?`${matches.length}${matches.length===60?'+':''} resultados visibles`:'No encontré coincidencias. Prueba otra palabra.');
 for(const item of matches){const btn=document.createElement('button');btn.type='button';btn.className='v71-result';
  const type=document.createElement('span');type.className='v71-result-type';type.textContent=item.label+' · '+fmtDate(item.date);
  const title=document.createElement('span');title.className='v71-result-title';title.textContent=item.title;
  const detail=document.createElement('span');detail.className='v71-result-detail';detail.textContent=String(item.detail).slice(0,150)||'Abrir sección';
  btn.append(type,title,detail);btn.addEventListener('click',()=>openResult(item));results.append(btn);
 }
}
async function openResult(item){hide(search);
 if(item.kind!=='photos'){core.goPage(item.page);return}
 try{
  const bucket=window.COUPLE_CONFIG?.BUCKET||'fer-alxs';
  const {data,error}=await sb.storage.from(bucket).createSignedUrl(item.storagePath,300);
  if(error||!data?.signedUrl)throw error||Error('La imagen no está disponible.');
  const lightbox=$('lightbox');$('lightboxImg').src=data.signedUrl;
  $('lightboxTitle').textContent=item.title;
  $('lightboxDesc').textContent=[fmtDate(item.date),item.detail].filter(Boolean).join(' · ');
  lightbox.classList.remove('hidden');lightbox.setAttribute('aria-hidden','false');
 }catch(e){$('statusMsg').textContent='No se pudo abrir la foto. '+(e?.message||'Intenta desde Cartas.')}
}
async function openSearch(){if(!authenticated())return;show(search);input.value='';results.replaceChildren();input.focus({preventScroll:true});
 try{await loadIndex();if(!search.classList.contains('hidden'))renderSearch()}catch(e){setSearchMessage(e.message||'No se pudo cargar la búsqueda.')}
}
$('v71SearchOpen').addEventListener('click',openSearch);
$('v71HomeSearch').addEventListener('click',openSearch);
$('v71SearchClose').addEventListener('click',()=>hide(search));
input.addEventListener('input',renderSearch);
// Compartir solo el enlace público de la web. Nunca adjunta conversaciones ni fotos privadas.
$('v71Share').addEventListener('click',async()=>{
 const url='https://alxs13.github.io/para-fer/';
 const title='Fer & Alxs — Nuestro universo';
 try{if(navigator.share)await navigator.share({title,text:'Nuestro rincón de recuerdos.',url});
 else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);$('statusMsg').textContent='Enlace copiado. Compártelo únicamente con quien quieras.';}
 else{window.prompt('Copia el enlace de la aplicación:',url)}}catch(e){if(e.name!=='AbortError')$('statusMsg').textContent='No se pudo compartir el enlace desde este navegador.'}
});
// Sin garantías de conectividad: navigator.onLine solo informa estado de red básico.
function networkStatus(){const alert=$('v71NetworkAlert');alert.classList.toggle('hidden',navigator.onLine!==false)}
window.addEventListener('offline',networkStatus);window.addEventListener('online',networkStatus);networkStatus();
// Recordatorio de respaldo en el dispositivo, no se interpreta como copia verificada.
function backupHint(){const el=$('v71BackupReminder');let time=null;
 try{time=localStorage.getItem('fer-alxs-last-backup-start-v2')}catch{}
 if(!time){el.textContent='Todavía no hay una descarga ZIP registrada en este dispositivo. Genera una copia y guárdala fuera del teléfono.';el.hidden=false;return}
 const days=(Date.now()-new Date(time).getTime())/86400000;
 if(!Number.isFinite(days)||days>30){el.textContent='Conviene crear un respaldo nuevo: la última descarga registrada fue hace más de 30 días. Confirma que el ZIP se guardó correctamente.';el.hidden=false}
 else el.hidden=true;
}
// Aviso de actualización que NO fuerza la recarga mientras escriben un mensaje.
if('serviceWorker' in navigator){
 let hadController=Boolean(navigator.serviceWorker.controller);
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(!hadController){hadController=true;return}
  $('v71UpdateAlert').classList.remove('hidden');
 });
}
$('v71UpdateNow').addEventListener('click',()=>{
 const editing=[...document.querySelectorAll('input,textarea')].some(x=>!x.disabled&&document.activeElement===x&&x.value?.trim());
 if(editing&&!confirm('Hay un campo en edición. ¿Recargar de todos modos?'))return;
 location.reload();
});
$('v71UpdateLater').addEventListener('click',()=>$('v71UpdateAlert').classList.add('hidden'));
document.querySelectorAll('[data-v71-close="search"]').forEach(x=>x.addEventListener('click',()=>hide(search)));
document.querySelectorAll('[data-v71-close="welcome"]').forEach(x=>x.addEventListener('click',closeGuide));
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){
  if(!welcome.classList.contains('hidden')){closeGuide();e.preventDefault()}
  else if(!search.classList.contains('hidden')){hide(search);e.preventDefault()}
 }
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&authenticated()){
  e.preventDefault();openSearch();
 }
});
})();
