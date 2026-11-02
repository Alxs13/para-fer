/* FER & ALXS v7 - Extensiones respetando la base v6. No usa service_role. */
(()=>{
'use strict';
const core=window.FerCoreV7;
if(!core)return;
const {sb}=core;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const trim=(v,n=500)=>String(v??'').trim().slice(0,n);
const strDate=v=>{if(!v)return '';const d=new Date(String(v).slice(0,10)+'T12:00:00');return Number.isNaN(+d)?String(v):new Intl.DateTimeFormat('es-CL',{dateStyle:'long'}).format(d)};
const dateInput=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const msg=(id,value,ok=false)=>{const el=$(id);if(el){el.textContent=value;el.style.color=ok?'#d1edc9':''}};
const user=()=>core.user();
const requireUser=()=>{if(!user())throw Error('Inicia sesión para usar esta sección.');return user()};
const readable=e=>String(e?.message||e||'Error de conexión');
const tableFields={
  dreams:'id,user_id,title,details,category,target_date,saving_goal_id,completed_at,created_at,backup_source_id',
  diary:'id,user_id,entry_date,title,content,mood,visibility,created_at,backup_source_id',
  places:'id,user_id,name,description,latitude,longitude,visited_at,photo_id,created_at,backup_source_id',
  gifts:'id,user_id,recipient_id,title,message,unlock_at,created_at,backup_source_id'
};
const names={dreams:'couple_dreams',diary:'couple_diary',places:'couple_places',gifts:'couple_gifts'};
const data={dreams:[],diary:[],places:[],gifts:[]};
let active='home',subscriptions=[],refreshing=false;
function row(name,row,body){const node=document.createElement('article');node.className='v7-card';node.innerHTML=`<span class="v7-card-label">${esc(name)}</span>${body}`;return node;}
function empty(el,txt){el.innerHTML=`<div class="v7-empty"><span>✦</span><p>${esc(txt)}</p></div>`;}
function statusSubmit(form,promise,statusId,button){let btn=form.querySelector('button[type=submit]');btn.disabled=true;return promise.then(()=>{form.reset();msg(statusId,'Guardado para los dos.',true)}).catch(e=>msg(statusId,readable(e))).finally(()=>btn.disabled=false);}
async function load(name){requireUser();let q=sb.from(names[name]).select(tableFields[name]).order('created_at',{ascending:false}).limit(300);
  const {data:rows,error}=await q;if(error)throw error;data[name]=rows||[];
  ({dreams:drawDreams,diary:drawDiary,places:drawPlaces,gifts:drawGifts})[name]();
}
function openPage(name){active=name;
  if(names[name])load(name).catch(e=>msg('v7'+name[0].toUpperCase()+name.slice(1)+'Status',readable(e)));
  if(name==='today')loadToday().catch(()=>empty($('v7TodayList'),'No se pudieron cargar los recuerdos.'));
  if(name==='dreams')loadGoalOptions().catch(console.warn);
  if(name==='gifts')fillGiftTargets();
  if(name==='places')fillPlacePhotos().catch(console.warn);
}
window.addEventListener('fer-page',e=>openPage(e.detail));

// 1. Un día como hoy: busca también fotos antiguas que la v6 aún no haya paginado.
async function loadToday(){
  let photos=await core.allPhotos();const today=new Date(),m=today.getMonth()+1,d=today.getDate();
  const shared=photos.filter(p=>{const day=(p.event_date||p.created_at||'').slice(0,10);let [y,mo,da]=day.split('-').map(Number);return mo===m&&da===d&&y<today.getFullYear()});
  const box=$('v7TodayList');box.replaceChildren();
  // También videos y notas del mismo día en años anteriores, con permisos de Supabase.
  const extra=[];
  for(const [table,columns,type] of [
    ['couple_videos','id,title,note,event_date,created_at,location','VIDEO'],
    ['couple_notes','id,content,due_date,created_at,type','MENSAJE']]){
    const {data:rows,error}=await sb.from(table).select(columns).limit(1000);
    if(error)continue;
    for(const r of rows||[]){
      const day=(r.event_date||r.due_date||r.created_at||'').slice(0,10);
      const [year,month,date]=day.split('-').map(Number);
      if(month===m&&date===d&&year<today.getFullYear())extra.push({type,title:r.title||r.content?.slice(0,65),text:r.note||r.content||'',date:day});
    }
  }
  if(!shared.length&&!extra.length){empty(box,'Todavía no hay recuerdos de esta fecha en años anteriores.');return}
  for(const r of extra){box.append(row(r.type,`<h3>${esc(r.title)}</h3><p>${esc(strDate(r.date))}</p><p>${esc(r.text)}</p>`))}
  for(const p of shared.slice(0,30)){
    let article=row('UN DÍA COMO HOY',`<h3>${esc(p.title||'Nuestro recuerdo')}</h3><p>${esc(strDate(p.event_date||p.created_at))} · ${esc(p.location||'')}</p><p>${esc(p.back_note||p.bubble_text||'')}</p>`);
    let btn=document.createElement('button');btn.className='btn-secondary';btn.textContent='Ver la foto';btn.onclick=async()=>{
      const {data:s,error}=await sb.storage.from(window.COUPLE_CONFIG?.BUCKET||'fer-alxs').createSignedUrl(p.storage_path,300);
      if(error) return alert(readable(error));let a=document.createElement('a');a.href=s.signedUrl;a.target='_blank';a.rel='noopener noreferrer';a.click();
    };article.append(btn);box.append(article);
  }
}
// 2. Mapa manual: no captura GPS ni geocodifica. OpenStreetMap solo si usuario toca el punto.
async function fillPlacePhotos(){
 const sel=$('v7PlacePhoto');if(!sel)return;
 let current=sel.value;sel.replaceChildren(new Option('Sin foto',''));
 const photos=(await core.allPhotos()).slice(0,100);
 photos.forEach(p=>sel.add(new Option(p.title||'Recuerdo sin título',p.id)));
 sel.value=current;
}
function drawPlaces(){const box=$('v7PlaceList');box.replaceChildren();if(!data.places.length)return empty(box,'Agrega el primer lugar especial.');
  data.places.forEach(p=>{const a=row('PUNTO EN NUESTRO MAPA',`<h4>${esc(p.name)}</h4><p>${esc(p.description||'')}</p><small>${esc(strDate(p.visited_at))}</small>`);
    const b=document.createElement('button');b.className='v7-tiny';b.textContent='Ver en el mapa';b.addEventListener('click',()=>{
      const lat=Number(p.latitude),lng=Number(p.longitude),delta=.018;
      $('v7MapFrame').src=`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent([lng-delta,lat-delta,lng+delta,lat+delta].join(','))}&layer=mapnik&marker=${lat}%2C${lng}`;
      $('v7MapFrame').classList.remove('hidden');$('v7MapPlaceholder').classList.add('hidden');
      $('v7MapFrame').scrollIntoView({behavior:'smooth',block:'nearest'});
    });a.append(b);if(p.photo_id){const photoBtn=document.createElement('button');photoBtn.className='v7-tiny';photoBtn.textContent='Foto relacionada';photoBtn.onclick=async()=>{
     const {data:photo,error}=await sb.from('couple_photos').select('storage_path').eq('id',p.photo_id).maybeSingle();if(error||!photo)return alert('La fotografía ya no está disponible.');
     const {data:s, error:sign}=await sb.storage.from(window.COUPLE_CONFIG?.BUCKET||'fer-alxs').createSignedUrl(photo.storage_path,300);
     if(sign)return alert(readable(sign));const link=document.createElement('a');link.href=s.signedUrl;link.rel='noopener noreferrer';link.target='_blank';link.click();
   };a.append(photoBtn)}if(p.user_id===user()?.id){const del=document.createElement('button');del.className='v7-tiny';del.textContent='Eliminar';del.onclick=()=>removeOwn('places',p.id);a.append(del)}box.append(a)});
}
$('v7PlaceForm').addEventListener('submit',e=>{e.preventDefault();let lat=Number($('v7Lat').value.replace(',','.')),lng=Number($('v7Lng').value.replace(',','.'));
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return msg('v7PlaceStatus','Coordenadas inválidas. Usa decimales (por ejemplo -23.65).');
 statusSubmit(e.target, (async()=>{const {error}=await sb.from(names.places).insert({user_id:requireUser().id,name:trim($('v7PlaceName').value,100),description:trim($('v7PlaceText').value,500),latitude:lat,longitude:lng,visited_at:$('v7PlaceDate').value||null,photo_id:$('v7PlacePhoto').value||null});if(error)throw error;await load('places')})(),'v7PlaceStatus');
});
async function removeOwn(key,id){if(!confirm('¿Eliminar este registro?'))return;const {error}=await sb.from(names[key]).delete().eq('id',id).eq('user_id',requireUser().id);if(error)return alert(readable(error));await load(key)}

// 3. Regalos. Servidor impide SELECT al destinatario antes de unlock_at.
function fillGiftTargets(){let sel=$('v7GiftTo'),prev=sel.value;sel.replaceChildren();core.members().filter(m=>m.user_id!==user()?.id).forEach(m=>{let op=document.createElement('option');op.value=m.user_id;op.textContent=m.display_name;sel.append(op)});if([...sel.options].some(x=>x.value===prev))sel.value=prev;}
function drawGifts(){let box=$('v7GiftList');box.replaceChildren();if(!data.gifts.length)return empty(box,'Todavía no hay sobres visibles. Los regalos futuros no aparecen al destinatario hasta la fecha de apertura.');
  data.gifts.forEach(g=>{let authored=g.user_id===user()?.id,unlock=new Date(g.unlock_at).toLocaleString('es-CL',{dateStyle:'medium',timeStyle:'short'});
    let a=row(authored?'TU SOBRE SELLADO':'PARA TI',`<h4>${esc(g.title)}</h4><p>${authored?'Se abrirá:':'Se abrió:'} ${esc(unlock)}</p><div class="v7-gift-letter">${esc(g.message)}</div>`);box.append(a)});
}
$('v7GiftForm').addEventListener('submit',e=>{e.preventDefault();let date=$('v7GiftWhen').value,recipient=$('v7GiftTo').value;
 if(!date||!recipient)return msg('v7GiftStatus','Elige destinatario y fecha.');
 statusSubmit(e.target,(async()=>{const {error}=await sb.from(names.gifts).insert({user_id:requireUser().id,recipient_id:recipient,title:trim($('v7GiftTitle').value,100),message:trim($('v7GiftText').value,4000),unlock_at:new Date(date).toISOString()});if(error)throw error;await load('gifts')})(),'v7GiftStatus')});

// 4. Sueños, con progreso de las metas de ahorro existentes.
async function loadGoalOptions(){const sel=$('v7DreamSaving');let keep=sel.value;const {data:goals,error}=await sb.from('couple_saving_goals').select('id,name').limit(200);if(error)throw error;sel.replaceChildren(new Option('Sin vincular',''));(goals||[]).forEach(g=>sel.add(new Option(g.name,g.id)));sel.value=keep||'';}
function drawDreams(){const box=$('v7DreamList');box.replaceChildren();if(!data.dreams.length)return empty(box,'Aún no han agregado sueños a su lista.');data.dreams.forEach(d=>{
  const done=!!d.completed_at;const item=row(done?'SUEÑO CUMPLIDO':'PRÓXIMA AVENTURA',`<h4>${esc(d.title)}</h4><p>${esc(d.details||'')}</p><small>${esc(d.category)}${d.target_date?' · '+esc(strDate(d.target_date)):''}${d.saving_goal_id?' · Con meta de ahorro':''}</small>`);
  const b=document.createElement('button');b.className='v7-tiny';b.textContent=done?'Marcar pendiente':'Marcar cumplido';b.onclick=async()=>{const {error}=await sb.from(names.dreams).update({completed_at:done?null:new Date().toISOString()}).eq('id',d.id);if(error)alert(readable(error));else await load('dreams')};item.append(b);box.append(item)});
}
$('v7DreamForm').addEventListener('submit',e=>{e.preventDefault();statusSubmit(e.target,(async()=>{const {error}=await sb.from(names.dreams).insert({user_id:requireUser().id,title:trim($('v7DreamTitle').value,100),details:trim($('v7DreamText').value,700),category:$('v7DreamCat').value,target_date:$('v7DreamDate').value||null,saving_goal_id:$('v7DreamSaving').value||null});if(error)throw error;await load('dreams')})(),'v7DreamStatus')});

// 5. Diario privado/compartido con permisos RLS también en el servidor.
$('v7DiaryDate').value=dateInput();
function drawDiary(){let box=$('v7DiaryList');box.replaceChildren();if(!data.diary.length)return empty(box,'Tu primera página puede empezar hoy.');data.diary.forEach(d=>{
 let a=row(d.visibility==='private'?'SOLO PARA MÍ':'DIARIO DE LOS DOS',`<h4>${esc(d.title)}</h4><p>${esc(strDate(d.entry_date))} · ${esc(d.mood)}</p><p class="v7-prose">${esc(d.content)}</p>`);
 if(d.user_id===user()?.id){let b=document.createElement('button');b.className='v7-tiny';b.textContent='Eliminar mi página';b.onclick=()=>removeOwn('diary',d.id);a.append(b)}box.append(a)
});}
$('v7DiaryForm').addEventListener('submit',e=>{e.preventDefault();statusSubmit(e.target,(async()=>{const {error}=await sb.from(names.diary).insert({user_id:requireUser().id,entry_date:$('v7DiaryDate').value,title:trim($('v7DiaryTitle').value,100),content:trim($('v7DiaryContent').value,4000),mood:$('v7DiaryMood').value,visibility:$('v7DiaryVisibility').value});if(error)throw error;await load('diary')})(),'v7DiaryStatus')});

// 6. Cámara/estudio: exporta JPEG del canvas sin metadatos EXIF al formulario de carta v6.
const canvas=$('v7PhotoCanvas'),ctx=canvas.getContext('2d');let cameraImg=null;
function drawCamera(){const w=640,h=800;ctx.fillStyle='#180612';ctx.fillRect(0,0,w,h);
 const style=$('v7CameraStyle').value;const color={wine:'#873049',gold:'#b88d5c',rose:'#c9768d'}[style]||'#873049';
 if(cameraImg){const ratio=Math.max(570/cameraImg.width,590/cameraImg.height),iw=cameraImg.width*ratio,ih=cameraImg.height*ratio;ctx.save();ctx.beginPath();ctx.roundRect(35,35,570,595,12);ctx.clip();ctx.drawImage(cameraImg,(w-iw)/2,35+(595-ih)/2,iw,ih);ctx.restore()}else{ctx.fillStyle='#47203a';ctx.fillRect(35,35,570,595);ctx.fillStyle='#e5a8ae';ctx.textAlign='center';ctx.font='28px Georgia';ctx.fillText('Elige una foto para comenzar',320,330)}
 ctx.strokeStyle=color;ctx.lineWidth=22;ctx.strokeRect(17,17,606,766);ctx.strokeStyle='#eac5a1';ctx.lineWidth=3;ctx.strokeRect(31,31,578,735);ctx.fillStyle='#341122';ctx.fillRect(35,638,570,120);
 ctx.fillStyle='#f7e4da';ctx.textAlign='center';ctx.font='bold 30px Georgia';let caption=trim($('v7CameraCaption').value,80)||'Un recuerdo para siempre';
 const words=caption.split(/\s+/),lines=[''];for(const word of words){if(ctx.measureText(lines[lines.length-1]+' '+word).width>530&&lines.length<2)lines.push(word);else lines[lines.length-1]+=(lines[lines.length-1]?' ':'')+word}
 lines.forEach((l,i)=>ctx.fillText(l,320,682+i*34));ctx.font='14px sans-serif';ctx.fillStyle='#d2a6a7';ctx.fillText('FER & ALXS · NUESTRA COLECCIÓN',320,756);
}
$('v7CameraFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return; if(!file.type.startsWith('image/')||file.size>20*1024*1024)return msg('v7CameraStatus','Elige una imagen de menos de 20 MB.');let url=URL.createObjectURL(file);try{const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url});cameraImg=img;drawCamera();msg('v7CameraStatus','Foto lista para decorar.',true)}catch{msg('v7CameraStatus','No se pudo abrir esa imagen.')}finally{URL.revokeObjectURL(url)}});
$('v7CameraStyle').addEventListener('change',drawCamera);$('v7CameraCaption').addEventListener('input',drawCamera);drawCamera();
$('v7CameraMake').addEventListener('click',()=>{if(!cameraImg)return msg('v7CameraStatus','Selecciona una foto primero.');canvas.toBlob(blob=>{if(!blob)return msg('v7CameraStatus','No se pudo crear la imagen.');const file=new File([blob],`recuerdo-${Date.now()}.jpg`,{type:'image/jpeg'}),dt=new DataTransfer();dt.items.add(file);$('photoInput').files=dt.files;$('photoInput').dispatchEvent(new Event('change',{bubbles:true}));$('memoryTitle').value=trim($('v7CameraCaption').value,80);core.openUpload()},'image/jpeg',.9)});

// 7. Película: Canvas + MediaRecorder WEBM. Solo fotos existentes, sin audio ajeno.
$('v7MovieCreate').addEventListener('click',async()=>{const btn=$('v7MovieCreate');btn.disabled=true;try{
 const all=(await core.allPhotos()).slice(0,12);if(!all.length)throw Error('Primero agrega fotos al álbum.');
 const test=document.createElement('canvas');if(!test.captureStream||!window.MediaRecorder)throw Error('Este navegador no permite exportar video WEBM. Usa Chrome Android actualizado.');
 const recCanvas=document.createElement('canvas');recCanvas.width=720;recCanvas.height=960;const pen=recCanvas.getContext('2d');const stream=recCanvas.captureStream(12);
 let mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(v=>MediaRecorder.isTypeSupported(v));if(!mime)throw Error('Tu navegador no admite grabación WEBM.');
 const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1500000}),parts=[];
 recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
 let finished=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=reject});recorder.start(300);
 for(let i=0;i<all.length;i++){
   let photo=all[i];msg('v7MovieStatus',`Creando escena ${i+1} de ${all.length}…`);
   const {data:blob,error}=await sb.storage.from(window.COUPLE_CONFIG.BUCKET||'fer-alxs').download(photo.storage_path);if(error)throw error;
   const url=URL.createObjectURL(blob),img=new Image();try{await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url});
     for(let frame=0;frame<24;frame++){
       const t=frame/24;pen.fillStyle='#260818';pen.fillRect(0,0,720,960);
       const scale=Math.max(660/img.width,680/img.height)*(1+.04*t),w=img.width*scale,h=img.height*scale;
       pen.save();pen.beginPath();pen.roundRect(30,60,660,680,22);pen.clip();pen.drawImage(img,(720-w)/2,60+(680-h)/2,w,h);pen.restore();
       pen.fillStyle='#2b0b19';pen.fillRect(0,765,720,195);pen.textAlign='center';pen.fillStyle='#f5e7df';pen.font='bold 32px Georgia';pen.fillText(trim(photo.title,32)||'Nuestro recuerdo',360,835);
       pen.font='22px sans-serif';pen.fillStyle='#dec4bd';pen.fillText(strDate(photo.event_date||photo.created_at),360,890);
       await new Promise(r=>setTimeout(r,84));
     }
   }finally{URL.revokeObjectURL(url)}
 }
 recorder.stop();await finished;stream.getTracks().forEach(t=>t.stop());const movie=new Blob(parts,{type:'video/webm'});if(movie.size<1500)throw Error('No se generó la película.');core.downloadBlob(movie,`Fer-Alxs-pelicula-${dateInput()}.webm`);msg('v7MovieStatus',`Película creada con ${all.length} fotos. Revisa Descargas.`,true);
 }catch(e){msg('v7MovieStatus',readable(e))}finally{btn.disabled=false}});

// 8. PWA: solo cachea archivos públicos. No guarda conversaciones/fotos privadas en el caché.
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{});
let installPrompt=null;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e});
$('v7Install').onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null}else msg('v7SecurityInfo','Desde Chrome Android: menú ⋮ → Agregar a pantalla principal → Instalar. En iPhone: Compartir → Añadir a inicio.')};
$('v7BackupCheck').onclick=()=>{let last;try{last=localStorage.getItem('fer-alxs-last-backup-start-v2')}catch{};
 msg('v7SecurityInfo',last?`Último respaldo iniciado desde este dispositivo: ${new Date(last).toLocaleString('es-CL')}. Confirma que el ZIP esté guardado en Descargas y otra ubicación privada.`:'Este navegador no registra un respaldo descargado. Abre Cápsula y crea un ZIP completo.');};
// 9. Avisos mientras la web está abierta. Background push NO está configurado.
$('v7NotifyEnable').onclick=async()=>{if(!('Notification' in window))return msg('v7SecurityInfo','Este navegador no admite notificaciones del sistema. Verás avisos dentro de la web.');
 const permission=await Notification.requestPermission();msg('v7SecurityInfo',permission==='granted'?'Avisos activados cuando la página esté abierta. Para notificaciones con la web cerrada falta servidor push.':`Permiso: ${permission}. Puedes usar los avisos dentro de la web.`)};
let unread=0;let notificationHistory=[];
const notiPanel=document.createElement('section');notiPanel.className='v7-notification-panel hidden';notiPanel.id='v7NotiPanel';notiPanel.setAttribute('aria-label','Actividad reciente');document.body.append(notiPanel);
function drawNotificationPanel(){notiPanel.replaceChildren();const title=document.createElement('h3');title.textContent='Actividad reciente';notiPanel.append(title);
  if(!notificationHistory.length){const e=document.createElement('p');e.textContent='Todavía no hay avisos en esta sesión.';notiPanel.append(e)}
  for(const item of notificationHistory.slice().reverse()){const div=document.createElement('div');div.className='v7-notification-row';div.textContent=`${item.text} · ${item.time}`;notiPanel.append(div)}
  const close=document.createElement('button');close.textContent='Cerrar';close.onclick=()=>notiPanel.classList.add('hidden');notiPanel.append(close);
}

function alertNew(kind){notificationHistory.push({text:'Novedad en '+kind,time:new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'})});unread++;$('v7BellCount').textContent=unread;$('v7BellCount').classList.remove('hidden');
 if(document.visibilityState==='visible'&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
  try{new Notification('Fer & Alxs',{body:`Una novedad en ${kind}. Abre la aplicación para verla.`,icon:'./icon-192.png'})}catch{}}
}
$('v7Bell').onclick=()=>{unread=0;$('v7BellCount').classList.add('hidden');drawNotificationPanel();notiPanel.classList.toggle('hidden')};
// Suscripción Realtime, filtrada por RLS, sin contenido sensible en las notificaciones.
function connectRealtime(){if(subscriptions.length||!user())return;
 const ch=sb.channel('fer-v7-live')
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'couple_chat'},p=>{if(user()&&p.new?.user_id!==user().id)alertNew('el chat')});
 ['dreams','diary','places','gifts'].forEach(k=>ch.on('postgres_changes',{event:'*',schema:'public',table:names[k]},p=>{
  if(user()&&active===k)load(k).catch(console.warn);
  if(p.eventType==='INSERT'&&user()&&p.new?.user_id!==user().id)alertNew(k==='gifts'?'regalos':k==='diary'?'el diario':k==='dreams'?'los sueños':'el mapa');
 }));ch.subscribe();subscriptions.push(ch);
}
setInterval(()=>{if(user()&&!subscriptions.length)connectRealtime();if(!user()&&subscriptions.length){subscriptions.forEach(ch=>sb.removeChannel(ch));subscriptions=[];unread=0;$('v7BellCount').classList.add('hidden');}},4000);

// 10. Respaldo v5: añade las cuatro tablas nuevas sin romper ZIP v2-v4.
window.FerV7Backup={
 append:async({manifest,human,fetchAll})=>{
  manifest.v7={};
  for(const kind of Object.keys(names)){
   const rows=await fetchAll(names[kind],tableFields[kind]);
   manifest.v7[kind]=rows;
   human.push(`\n${kind.toUpperCase()} · ${rows.length} registros`);
   rows.forEach(r=>human.push([r.title||r.name||'Entrada',r.content||r.details||r.description||r.message||'',r.entry_date||r.target_date||r.visited_at||r.unlock_at||''].join(' · ')));
  }
 },
 restore:async({data:manifest,sb,activeUser})=>{
  const obj=manifest.v7;if(!obj||typeof obj!=='object')throw Error('El respaldo v5 no tiene sección de datos nuevos.');
  const members=core.members(),old=manifest.members||[],byOld=new Map(old.map(r=>[r.user_id,r.display_name?.toLowerCase()]));
  for(const key of Object.keys(names)){
   const rows=obj[key]||[];if(!Array.isArray(rows)||rows.length>5000)throw Error('Sección de respaldo inválida: '+key);
   for(const r of rows){
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.id))throw Error('Identificador de respaldo inválido.');
    const {data:existing,error:findError}=await sb.from(names[key]).select('id').eq('backup_source_id',r.backup_source_id||r.id).limit(1);
    if(findError)throw findError;if(existing?.length)continue;
    const meta={user_id:activeUser.id,backup_source_id:r.backup_source_id||r.id};
    let payload;
    if(key==='dreams')payload={...meta,title:trim(r.title,100),details:trim(r.details,700),category:['plan','viaje','experiencia','hogar','otro'].includes(r.category)?r.category:'otro',target_date:r.target_date||null,completed_at:r.completed_at||null,saving_goal_id:null};
    if(key==='diary')payload={...meta,title:trim(r.title,100),content:trim(r.content,4000),entry_date:r.entry_date||dateInput(),mood:['feliz','tranquilo','nostalgico','emocionado','otro'].includes(r.mood)?r.mood:'otro',visibility:r.visibility==='private'?'private':'shared'};
    if(key==='places')payload={...meta,name:trim(r.name,100),description:trim(r.description,500),latitude:Number(r.latitude),longitude:Number(r.longitude),visited_at:r.visited_at||null,photo_id:null};
    if(key==='gifts'){
      const recipientName=byOld.get(r.recipient_id);const recipient=members.find(m=>m.display_name.toLowerCase()===recipientName&&m.user_id!==activeUser.id);
      // No restaura sobres cuyo destinatario no pueda identificarse correctamente.
      if(!recipient)continue;
      payload={...meta,recipient_id:recipient.user_id,title:trim(r.title,100),message:trim(r.message,4000),unlock_at:r.unlock_at};
    }
    const {error}=await sb.from(names[key]).insert(payload);if(error)throw error;
   }
  }
  for(const key of Object.keys(names))if(active===key)await load(key);
 }
};
// Respaldo cifrado opcional: AES-GCM + PBKDF2 SHA-256. Todo en navegador, HTTPS requerido.
const vaultMagic=new TextEncoder().encode('FALX7');
async function deriveVaultKey(password,salt){
 const input=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},input,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function vaultInput(){
 const file=$('v7VaultFile').files?.[0],password=$('v7VaultPassword').value;
 if(!file)throw Error('Selecciona primero un archivo de respaldo.');
 if(file.size>200*1024*1024)throw Error('Límite de cifrado móvil: 200 MB. Usa un computador para copias más grandes.');
 if(password.length<12)throw Error('La contraseña debe tener al menos 12 caracteres.');
 if(!crypto.subtle)throw Error('El navegador no permite criptografía segura. Abre la web mediante HTTPS.');
 return {file,password};
}
$('v7Encrypt').onclick=async()=>{
 const b=$('v7Encrypt');b.disabled=true;
 try{
  const {file,password}=vaultInput();if(!file.name.toLowerCase().endsWith('.zip'))throw Error('Elige primero un respaldo .zip.');
  msg('v7VaultStatus','Cifrando de forma local…');
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveVaultKey(password,salt);
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,await file.arrayBuffer());
  const blob=new Blob([vaultMagic,salt,iv,encrypted],{type:'application/octet-stream'});
  core.downloadBlob(blob,file.name.replace(/\.zip$/i,'')+'.ferenc');
  msg('v7VaultStatus','Copia cifrada descargada. Verifica el archivo y guarda la contraseña fuera de la web.',true);
 }catch(e){msg('v7VaultStatus',readable(e))}finally{b.disabled=false;$('v7VaultPassword').value=''}
};
$('v7Decrypt').onclick=async()=>{
 const b=$('v7Decrypt');b.disabled=true;
 try{
  const {file,password}=vaultInput();if(!file.name.toLowerCase().endsWith('.ferenc'))throw Error('Selecciona una copia .ferenc.');
  const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length<70||!vaultMagic.every((v,i)=>v===bytes[i]))throw Error('Archivo cifrado incompatible.');
  const salt=bytes.slice(5,21),iv=bytes.slice(21,33),key=await deriveVaultKey(password,salt);
  let plain;try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,bytes.slice(33)))}catch{throw Error('Contraseña incorrecta o archivo cifrado dañado.')}
  if(!(plain[0]===80&&plain[1]===75))throw Error('El archivo descifrado no parece un ZIP.');
  core.downloadBlob(new Blob([plain],{type:'application/zip'}),file.name.replace(/\.ferenc$/i,'')+'.zip');
  msg('v7VaultStatus','ZIP descifrado y descargado. Puedes restaurarlo desde Cápsula.',true);
 }catch(e){msg('v7VaultStatus',readable(e))}finally{b.disabled=false;$('v7VaultPassword').value=''}
};
})();
