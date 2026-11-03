/* FER & ALXS CONNECT v9: módulo complementario, sin claves privadas ni acceso a datos de otros usuarios. */
(()=>{
 'use strict';
 const core=window.FerCoreV7;if(!core)return;
 const sb=core.sb,$=id=>document.getElementById(id),user=()=>core.user();
 const state={destinations:[],trips:[],vehicles:[],events:[],docs:[]};
 let loadedFor='',refreshInFlight=false;
 const n=(s,m=500)=>String(s||'').trim().slice(0,m);
 const fmtMoney=v=>new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(Number(v)||0);
 const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
 const niceDate=v=>{if(!v)return 'Sin fecha';const d=new Date(v.slice(0,10)+'T12:00:00');return isNaN(+d)?v:new Intl.DateTimeFormat('es-CL',{day:'numeric',month:'short',year:'numeric'}).format(d);};
 const txt=(v)=>String(v??'');
 const make=(tag,cls='',text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x;};
 function btn(label,handler,cls='connect-action'){const b=make('button',cls,label);b.type='button';b.addEventListener('click',handler);return b;}
 function message(id,s,success=false){const e=$(id);if(e){e.textContent=s;e.dataset.ok=success?'1':'0';}}
 const errorText=e=>String(e?.message||e||'Error inesperado.');
 function requireUser(){if(!user())throw Error('Inicia sesión para usar el módulo de movilidad.');return user();}
 function wazeURL(address,lat,lng){
   const url=new URL('https://www.waze.com/ul');
   if(lat!==null&&lng!==null&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))){url.searchParams.set('ll',`${lat},${lng}`);}
   else url.searchParams.set('q',address);
   url.searchParams.set('navigate','yes');url.searchParams.set('utm_source','fer_alxs');
   return url.toString();
 }
 function openWaze(address,lat=null,lng=null){const url=wazeURL(address,lat,lng);window.open(url,'_blank','noopener,noreferrer');}
 function formatError(e){const msg=errorText(e);if(msg.includes('Could not find the table'))return 'Falta ejecutar SQL 11_movilidad_garage.sql en Supabase.';if(/row.level.security|permission denied/i.test(msg))return 'No hay permiso para este registro. Revisa si está marcado como compartido.';return msg;}
 async function loadAll(){const u=requireUser();if(refreshInFlight)return;refreshInFlight=true;
  try{
   const q=[['destinations','couple_destinations'],['trips','couple_trips'],['vehicles','couple_vehicles'],['events','couple_vehicle_events'],['docs','couple_vehicle_documents']];
   const results=await Promise.all(q.map(async([k,t])=>{let {data,error}=await sb.from(t).select('*').order('created_at',{ascending:false}).limit(500);if(error)throw error;return[k,data||[]]}));
   if(!user()||user().id!==u.id)return;
   results.forEach(([k,v])=>state[k]=v);
   drawRoutes();drawVehicles();loadedFor=u.id;
   message('routeStatus','');message('vehicleStatus','');
  }catch(e){message('routeStatus',formatError(e));message('vehicleStatus',formatError(e));}
  finally{refreshInFlight=false;}
 }
 function clearList(id,emptyText){const l=$(id);if(!l)return null;l.replaceChildren();if(emptyText){l.append(make('p','connect-empty',emptyText));}return l;}
 function tile(title,subtitle,tag){const row=make('article','connect-entry');const head=make('div','connect-entry-head');head.append(make('strong','',title),make('span','connect-chip',tag));row.append(head,make('p','',subtitle||''));return row;}
 function controls(row,buttons){const wrap=make('div','connect-entry-actions');buttons.forEach(x=>wrap.append(x));row.append(wrap);}
 function confirmDelete(label){return window.confirm(`¿Eliminar ${label}? No se puede deshacer.`);}
 async function deleteRow(table,id,key,label){if(!confirmDelete(label))return;
  const {error}=await sb.from(table).delete().eq('id',id).eq('user_id',user().id);if(error)throw error;
  await loadAll();
 }
 function drawRoutes(){
  const list=clearList('destinationList');if(!list)return;
  $('routeKpis').querySelectorAll('b')[0].textContent=String(state.destinations.length);
  $('routeKpis').querySelectorAll('b')[1].textContent=String(state.trips.length);
  if(!state.destinations.length)list.append(make('p','connect-empty','Guarda un lugar para abrirlo en Waze.'));
  state.destinations.forEach(d=>{const r=tile(d.name,d.address+(d.notes?' · '+d.notes:''),d.visibility==='shared'?'Compartido':'Privado');
    const actions=[btn('Abrir en Waze',()=>openWaze(d.address,d.latitude,d.longitude),'connect-action primary')];
    if(d.user_id===user()?.id)actions.push(btn('Eliminar',()=>deleteRow('couple_destinations',d.id,'destinations','este destino').catch(e=>message('routeStatus',formatError(e)))));
    controls(r,actions);list.append(r);
  });
  const t=clearList('tripList');if(!state.trips.length)t.append(make('p','connect-empty','Aún no tienen viajes registrados.'));
  state.trips.forEach(d=>{const sub=`${niceDate(d.trip_date)} · ${d.destination_address}`+(d.cost_clp!==null&&d.cost_clp!==undefined?` · ${fmtMoney(d.cost_clp)}`:'')+(d.notes?' · '+d.notes:'');const r=tile(d.title,sub,d.visibility==='shared'?'Compartido':'Privado');
    const actions=[btn('Navegar',()=>openWaze(d.destination_address),'connect-action primary')];
    if(d.user_id===user()?.id)actions.push(btn('Eliminar',()=>deleteRow('couple_trips',d.id,'trips','este viaje').catch(e=>message('routeStatus',formatError(e)))));
    controls(r,actions);t.append(r);
  });
 }
 function vehicleName(id){const v=state.vehicles.find(x=>x.id===id);return v?v.name:'Vehículo';}
 function drawVehicles(){
  const stats=$('vehicleKpis');if(!stats)return;
  stats.querySelectorAll('b')[0].textContent=state.vehicles.length;
  stats.querySelectorAll('b')[1].textContent=fmtMoney(state.events.reduce((a,r)=>a+Number(r.amount_clp||0),0));
  const vl=clearList('vehicleList');if(!state.vehicles.length)vl.append(make('p','connect-empty','Agrega tu primer vehículo para empezar.'));
  state.vehicles.forEach(v=>{const r=tile(v.name,[v.make,v.model,v.year,v.plate].filter(Boolean).join(' · ')+(v.odometer_km!==null?` · ${Number(v.odometer_km).toLocaleString('es-CL')} km`:''),v.visibility==='shared'?'Compartido':'Privado');
   const actions=[];
   if(v.user_id===user()?.id)actions.push(btn('Eliminar vehículo',async()=>{if(state.events.some(e=>e.vehicle_id===v.id)||state.docs.some(e=>e.vehicle_id===v.id))return message('vehicleStatus','Para proteger el historial, elimina primero los movimientos y documentos del vehículo.');await deleteRow('couple_vehicles',v.id,'vehicles','este vehículo');}));
   if(actions.length)controls(r,actions);vl.append(r);
  });
  for(const id of ['eventVehicle','docVehicle']){const s=$(id),old=s.value;s.replaceChildren(new Option('Elige un vehículo',''));state.vehicles.forEach(v=>s.add(new Option(v.name+(v.plate?' · '+v.plate:''),v.id)));if(state.vehicles.some(v=>v.id===old))s.value=old;}
  const ev=clearList('vehicleEventList');if(!state.events.length)ev.append(make('p','connect-empty','Sin recargas ni mantenciones registradas.'));
  const kinds={fuel:'Combustible',maintenance:'Mantención',expense:'Gasto',inspection:'Revisión'};
  state.events.sort((a,b)=>b.event_date.localeCompare(a.event_date)).forEach(e=>{const sub=[vehicleName(e.vehicle_id),niceDate(e.event_date),e.amount_clp!==null?fmtMoney(e.amount_clp):'',e.liters?`${e.liters} L`:'',e.odometer_km?`${e.odometer_km} km`:'',e.notes].filter(Boolean).join(' · ');const r=tile(kinds[e.event_type]||'Movimiento',sub,'Bitácora');if(e.user_id===user()?.id)controls(r,[btn('Eliminar',()=>deleteRow('couple_vehicle_events',e.id,'events','este movimiento').catch(e=>message('vehicleStatus',formatError(e))))]);ev.append(r);});
  const docs=clearList('vehicleDocumentList');if(!state.docs.length)docs.append(make('p','connect-empty','No hay documentos guardados.'));
  const labels={soap:'SOAP',permit:'Permiso circulación',inspection:'Revisión técnica',registration:'Padrón',other:'Documento'};
  state.docs.forEach(d=>{const r=tile(labels[d.doc_type]||'Documento',`${vehicleName(d.vehicle_id)} · ${d.file_name}`+(d.expires_on?' · Vence '+niceDate(d.expires_on):''),'Privado');
    const actions=[btn('Ver documento',async()=>{const {data,error}=await sb.storage.from('fer-alxs-garage').createSignedUrl(d.storage_path,300);if(error)throw error;window.open(data.signedUrl,'_blank','noopener,noreferrer');},'connect-action primary')];
    if(d.user_id===user()?.id)actions.push(btn('Eliminar',async()=>{if(!confirmDelete('este documento'))return;const {error}=await sb.from('couple_vehicle_documents').delete().eq('id',d.id).eq('user_id',user().id);if(error)throw error;await sb.storage.from('fer-alxs-garage').remove([d.storage_path]);await loadAll();}));
    actions.forEach(b=>{const orig=b.onclick;/* los listeners se asocian mediante addEventListener */});
    controls(r,actions);docs.append(r);
  });
 }
 async function send(table,payload,form,statusId){let submit=form.querySelector('[type=submit]');submit.disabled=true;message(statusId,'Guardando…');try{const {error}=await sb.from(table).insert(payload);if(error)throw error;form.reset();for(const f of [form.closest('details')])if(f)f.open=false;await loadAll();message(statusId,'Guardado correctamente.',true);}catch(e){message(statusId,formatError(e));}finally{submit.disabled=false;}}
 const val=id=>$(id).value;
 const optionalNumber=id=>val(id).trim()?Number(val(id)):null;
 const add=(id,table,getPayload,status)=>$(id).addEventListener('submit',e=>{e.preventDefault();try{const u=requireUser();send(table,{user_id:u.id,...getPayload()},e.currentTarget,status);}catch(e){message(status,formatError(e));}});
 add('destinationForm','couple_destinations',()=>({name:n(val('destinationName'),100),address:n(val('destinationAddress'),240),latitude:optionalNumber('destinationLat'),longitude:optionalNumber('destinationLng'),notes:n(val('destinationNote')),visibility:val('destinationVisibility')}),'routeStatus');
 add('tripForm','couple_trips',()=>({title:n(val('tripName'),120),destination_address:n(val('tripAddress'),240),trip_date:val('tripDate'),cost_clp:optionalNumber('tripCost'),notes:n(val('tripNotes'),600),visibility:val('tripVisibility')}),'routeStatus');
 add('vehicleForm','couple_vehicles',()=>({name:n(val('vehicleName'),90),make:n(val('vehicleMake'),60),model:n(val('vehicleModel'),60),plate:n(val('vehiclePlate'),12).toUpperCase(),year:optionalNumber('vehicleYear'),odometer_km:optionalNumber('vehicleKm'),visibility:val('vehicleVisibility')}),'vehicleStatus');
 add('vehicleEventForm','couple_vehicle_events',()=>({vehicle_id:val('eventVehicle'),event_type:val('vehicleEventType'),event_date:val('vehicleEventDate'),amount_clp:optionalNumber('vehicleEventCost'),liters:optionalNumber('vehicleEventLiters'),odometer_km:optionalNumber('vehicleEventKm'),notes:n(val('vehicleEventNote'))}),'vehicleStatus');
 $('vehicleDocumentForm').addEventListener('submit',async e=>{
  e.preventDefault();const u=requireUser(),form=e.currentTarget,button=form.querySelector('[type=submit]');const file=$('vehicleDocumentFile').files[0];if(!file)return;
  const formats={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'};if(!formats[file.type])return message('vehicleStatus','Solo admite PDF, JPG, PNG o WEBP.');if(file.size>12*1024*1024)return message('vehicleStatus','Archivo demasiado grande. Máximo 12 MB.');
  button.disabled=true;message('vehicleStatus','Subiendo documento…');const path=`${u.id}/${Date.now()}-${crypto.randomUUID()}.${formats[file.type]}`;
  try{
    const {error:uploadErr}=await sb.storage.from('fer-alxs-garage').upload(path,file,{contentType:file.type,upsert:false});if(uploadErr)throw uploadErr;
    const {error}=await sb.from('couple_vehicle_documents').insert({user_id:u.id,vehicle_id:val('docVehicle'),doc_type:val('vehicleDocumentType'),file_name:n(file.name,220),storage_path:path,mime_type:file.type,expires_on:val('vehicleDocumentExpires')||null});
    if(error){await sb.storage.from('fer-alxs-garage').remove([path]);throw error;}
    form.reset();form.closest('details').open=false;await loadAll();message('vehicleStatus','Documento privado guardado.',true);
  }catch(err){message('vehicleStatus',formatError(err));}finally{button.disabled=false;}
 });
 ['tripDate','vehicleEventDate'].forEach(id=>$(id).value=today());
 window.addEventListener('fer-page',e=>{if(['routes','mobility'].includes(e.detail)){if(!user())return;loadAll();}});
 window.addEventListener('fer-auth-updated',()=>{loadedFor='';});
 // Chat: búsqueda en mensajes actualmente cargados (sin recopilar información fuera de Supabase).
 const chatBar=document.querySelector('#page-chat .chat-bar');
 if(chatBar){
   const toggle=btn('Buscar',()=>{}, 'connect-chat-search-toggle');toggle.setAttribute('aria-label','Buscar en mensajes cargados');
   const panel=make('div','connect-chat-search hidden');const input=make('input');input.type='search';input.placeholder='Buscar en mensajes cargados';input.setAttribute('aria-label','Buscar en mensajes');const counter=make('small','', 'Buscar en los mensajes visibles');
   panel.append(input,counter);chatBar.append(toggle);chatBar.insertAdjacentElement('afterend',panel);
   toggle.onclick=()=>{panel.classList.toggle('hidden');if(!panel.classList.contains('hidden'))input.focus();else{input.value='';filterChat('');}};
   input.addEventListener('input',()=>filterChat(input.value));
   function filterChat(q){const nodes=[...document.querySelectorAll('#chatTimeline .chat-message, #chatTimeline .chat-entry, #chatTimeline [data-message-id]')];const norm=q.toLocaleLowerCase('es').trim();let found=0;nodes.forEach(node=>{const match=!norm||node.textContent.toLocaleLowerCase('es').includes(norm);node.classList.toggle('connect-search-dim',!match);if(norm&&match)found++;});counter.textContent=norm?`${found} coincidencias en mensajes cargados`:'Buscar en los mensajes visibles';}
 }
 // Grupo adicional en el menú existente. Mantiene todos los botones originales sin duplicarlos.
 // Conserva una copia legible en la Cápsula ZIP (restauración guiada separada).
 window.FerConnectBackup=Object.freeze({
  append:async({manifest,human,fetchAll})=>{
   for(const [key,table] of [['destinations_v9','couple_destinations'],['trips_v9','couple_trips'],['vehicles_v9','couple_vehicles'],['vehicle_events_v9','couple_vehicle_events'],['vehicle_documents_v9','couple_vehicle_documents']]){
    const rows=await fetchAll(table,'*');manifest[key]=rows;human.push(`\n${key}: ${rows.length} registros accesibles`);
   }
  }
 });
})();
