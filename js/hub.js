/* Fer & Alxs · HUB 8.0 - extensión independiente de ALX HUB. No lee datos privados sin consentimiento. */
(()=>{
 'use strict';
 const core=window.FerCoreV7;if(!core)return;
 // Reordenar el menú sin duplicar botones ni perder los listeners originales.
 function organizeMenu(){
   const root=document.querySelector('#page-more .more-grid');if(!root||root.dataset.hubOrganized)return;
   const buttons=[...root.children].filter(x=>x.tagName==='BUTTON');
   const groups=[
    ['Personal',['hub','calendar','today','diary','flash']] ,
    ['Movilidad',['routes','mobility','places']] ,
    ['Ocio',['play','music','videos','studio','dreams']] ,
    ['Nuestros recuerdos',['cards','binder','chat','notes','gifts']] ,
    ['Trabajo, estudio y finanzas',['savings']],['Seguridad y ajustes',['backup']] 
   ];
   const used=new Set(),fragment=document.createDocumentFragment();
   for(const [heading,keys] of groups){
     const details=document.createElement('details');details.className='hub-menu-group';details.open=heading==='Nuestros recuerdos';
     const summary=document.createElement('summary');summary.textContent=heading;details.append(summary);
     const grid=document.createElement('div');grid.className='hub-menu-grid';
     for(const btn of buttons){if(keys.includes(btn.dataset.go)&&!used.has(btn)){used.add(btn);grid.append(btn)}}
     details.append(grid);fragment.append(details);
   }
   const other=document.createElement('details');other.className='hub-menu-group';const summary=document.createElement('summary');summary.textContent='Más opciones';other.append(summary);
   const rest=document.createElement('div');rest.className='hub-menu-grid';buttons.filter(b=>!used.has(b)).forEach(b=>rest.append(b));other.append(rest);fragment.append(other);
   root.replaceChildren(fragment);root.dataset.hubOrganized='1';
 }
 organizeMenu();
 const sb=core.sb;
 const $=id=>document.getElementById(id);
 const today=()=>{const n=new Date();return [n.getFullYear(),String(n.getMonth()+1).padStart(2,'0'),String(n.getDate()).padStart(2,'0')].join('-')};
 const plusDays=(s,n)=>{const d=new Date(`${s}T12:00:00`);d.setDate(d.getDate()+n);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
 const money=n=>new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(n||0);
 const formatDay=s=>{if(!s)return '';const d=new Date(s+'T12:00:00');return Number.isNaN(+d)?s:new Intl.DateTimeFormat('es-CL',{day:'numeric',month:'short',year:'numeric'}).format(d)};
 const cut=(s,n)=>String(s||'').trim().slice(0,n);
 let rows=[],tab='all',scope='all',area='all',loaded=false,loading=false,lastUser='',channel=null;
 const kindNames={task:'Pendiente',event:'Agenda',study:'Estudio',finance:'Finanzas',note:'Nota'};
 const user=()=>core.user();
 const pageIsHub=()=>document.getElementById('page-hub')?.classList.contains('active');
 const status=(s)=>{$('hubStatus').textContent=s||''};
 const taskKind=x=>['task','event','study','finance','note'].includes(x);
 const own=r=>r.user_id===user()?.id;
 const dateSort=(a,b)=>(a.event_date||'').localeCompare(b.event_date||'')||(a.event_time||'').localeCompare(b.event_time||'')||a.created_at.localeCompare(b.created_at);
 const el=(tag,cls,content)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(content!==undefined)e.textContent=content;return e};
 function currentRows(){const now=today();return rows.filter(r=>(scope==='all'||r.visibility===scope)&&(area==='all'||(r.life_area||'personal')===area)&&(tab==='all'||r.kind===tab)&&(tab!=='all'||r.kind!=='finance'||r.event_date>=plusDays(now,-45))).sort(dateSort)}
 function refreshHome(){const box=$('hubHomeCards');if(!box)return;box.replaceChildren();if(!user()){box.append(el('span','', 'Inicia sesión para organizar tu día.'));return}
  const now=today();let upcoming=rows.filter(r=>r.kind!=='finance'&&r.status!=='done'&&r.event_date>=now).sort(dateSort).slice(0,3);
  const due=rows.filter(r=>r.kind==='task'&&r.status!=='done').length;
  $('hubHomeSummary').textContent=`${due} pendiente${due===1?'':'s'} · ${upcoming.length} próximo${upcoming.length===1?'':'s'} a la vista`;
  if(!upcoming.length){const btn=el('button','', 'Crear mi primera actividad +');btn.type='button';btn.addEventListener('click',()=>{core.goPage('hub');openForm()});box.append(btn);return}
  for(const r of upcoming){const b=el('button');b.type='button';b.append(el('span','',r.title),el('small','',formatDay(r.event_date)));b.addEventListener('click',()=>{core.goPage('hub');tab=r.kind;render()});box.append(b)}
 }
 async function fetchHub(){if(!user()||loading)return;loading=true;try{
   const {data,error}=await sb.from('couple_hub_items').select('id,user_id,kind,life_area,visibility,title,details,event_date,event_time,priority,status,amount_clp,direction,created_at,imported_from').order('event_date',{ascending:true}).limit(1000);
   if(error)throw error;rows=data||[];loaded=true;lastUser=user().id;
   render();if(rows.length>=1000)status('Mostrando los primeros 1000 registros. Para gestionar más, necesitarás paginación.');else status('');
  }catch(e){status('No se pudo cargar el HUB. Comprueba que ejecutaste 10_hub_integracion.sql en Supabase. '+(e?.message||e))}
  finally{loading=false}
 }
 function drawStats(){const now=today(),week=plusDays(now,7),month=now.slice(0,7), pending=rows.filter(r=>r.kind==='task'&&r.status!=='done'),upcoming=rows.filter(r=>r.kind!=='finance'&&r.status!=='done'&&r.event_date>=now&&r.event_date<=week),expense=rows.filter(r=>r.kind==='finance'&&r.direction==='out'&&r.event_date.startsWith(month)).reduce((s,r)=>s+Number(r.amount_clp||0),0);
  const kpis=$('hubKpis');kpis.replaceChildren();for(const [val,label] of [[String(pending.length),'Pendientes'],[String(upcoming.length),'Próximos 7 días'],[money(expense),'Gastos del mes']]){const cell=el('div');cell.append(el('strong','',val),el('span','',label));kpis.append(cell)}
  const focus=$('hubNow');focus.replaceChildren(el('span','eyebrow','QUÉ HAGO AHORA'));
  const best=[...rows].filter(r=>r.kind!=='finance'&&r.kind!=='note'&&r.status!=='done').sort((a,b)=>{
   const urg=x=>x.event_date<now?0:x.event_date===now?1:x.event_date<=week?2:3;
   return urg(a)-urg(b)||(a.priority==='high'?-1:0)-(b.priority==='high'?-1:0)||dateSort(a,b);
  })[0];
  if(best){focus.append(el('h2','',best.title),el('p','',`${kindNames[best.kind]} · ${formatDay(best.event_date)}${best.event_time?' · '+best.event_time.slice(0,5):''} · ${best.visibility==='shared'?'Compartido':'Privado'}`));}
  else{focus.append(el('h2','', 'Todo al día'),el('p','','No hay actividades pendientes. Puedes crear una nueva desde Añadir.'))}
 }
 function render(){if(!loaded)return;refreshHome();drawStats();
   $('hubTabs').querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b.dataset.hubTab===tab);b.setAttribute('aria-pressed',String(b.dataset.hubTab===tab))});
   const list=$('hubList');list.replaceChildren();const selected=currentRows();$('hubListHeading').textContent=tab==='all'?'Agenda y próximos pasos':kindNames[tab];
   if(!selected.length){list.append(el('p','hub-muted','Todavía no hay registros en esta vista. Añade uno con el botón +.'));return}
   for(const r of selected){const root=el('article','hub-entry');root.dataset.kind=r.kind;root.append(el('span','hub-entry-bar'));
     const content=el('div'),heading=el('div','hub-entry-header');heading.append(el('h3','',r.title),el('small','',kindNames[r.kind]));content.append(heading);
     const meta=el('div','hub-entry-meta');for(const x of [formatDay(r.event_date)+(r.event_time?' · '+r.event_time.slice(0,5):''),r.visibility==='shared'?'De los dos':'Solo yo',r.kind==='finance'?(r.direction==='in'?'Ingreso ':'Gasto ')+money(r.amount_clp):r.status==='done'?'Completado':r.priority==='high'?'Alta prioridad':'Pendiente']){meta.append(el('span','',x))}content.append(meta);
     if(r.details)content.append(el('p','',r.details));const areaNames={personal:'Personal',work:'Trabajo',study:'Estudio',finance:'Finanzas',leisure:'Ocio',family:'Familia'};content.append(el('small','',areaNames[r.life_area]||'Personal')); 
     if(own(r)){const actions=el('div','hub-entry-actions');if(r.kind!=='finance'&&r.kind!=='note'){
       const done=el('button','',r.status==='done'?'↶ Reabrir':'✓ Completar');done.type='button';done.addEventListener('click',()=>setDone(r));actions.append(done)}
       const vis=el('button','',r.visibility==='private'?'Compartir con Fer':'Hacer privado');vis.type='button';vis.addEventListener('click',()=>setVisibility(r));actions.append(vis);
       const del=el('button','','Eliminar');del.type='button';del.addEventListener('click',()=>removeItem(r));actions.append(del);content.append(actions);
     }else content.append(el('small','','Agregado por tu pareja · Solo lectura'));
     root.append(content);list.append(root);
   }
 }
 async function updateItem(r,patch){const {error}=await sb.from('couple_hub_items').update(patch).eq('id',r.id).eq('user_id',user().id);if(error){status(error.message);return}await fetchHub()}
 async function setDone(r){await updateItem(r,{status:r.status==='done'?'todo':'done'})}
 async function setVisibility(r){const value=r.visibility==='private'?'shared':'private';if(value==='shared'&&!confirm('Este registro será visible para Fer o Alxs. ¿Compartirlo?'))return;await updateItem(r,{visibility:value})}
 async function removeItem(r){if(!confirm(`¿Eliminar «${r.title}» del HUB? No se puede deshacer.`))return;const {error}=await sb.from('couple_hub_items').delete().eq('id',r.id).eq('user_id',user().id);if(error)status(error.message);else await fetchHub()}
 function openForm(){const overlay=$('hubFormOverlay');overlay.classList.remove('hidden');overlay.setAttribute('aria-hidden','false');$('hubDate').value=today();$('hubTitle').focus({preventScroll:true})}
 function closeForm(){$('hubFormOverlay').classList.add('hidden');$('hubFormOverlay').setAttribute('aria-hidden','true')}
 $('hubOpenForm').addEventListener('click',openForm);$('hubCloseForm').addEventListener('click',closeForm);
 $('hubFormOverlay').addEventListener('click',e=>{if(e.target.dataset.hubClose)closeForm()});
 $('hubType').addEventListener('change',()=>{const finance=$('hubType').value==='finance';$('hubFinanceFields').classList.toggle('hidden',!finance);$('hubAmount').required=finance;$('hubDirection').required=finance;});
 $('hubTabs').addEventListener('click',e=>{const b=e.target.closest('button[data-hub-tab]');if(!b)return;tab=b.dataset.hubTab;render()});
 $('hubLifeAreas').addEventListener('click',e=>{const b=e.target.closest('[data-life-area]');if(!b)return;area=b.dataset.lifeArea;$('hubLifeAreas').querySelectorAll('button').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b))});render()});
 $('hubScope').addEventListener('change',e=>{scope=e.target.value;render()});
 $('hubRefresh').addEventListener('click',fetchHub);
 $('hubForm').addEventListener('submit',async e=>{e.preventDefault();if(!user())return;const kind=$('hubType').value;
   const title=cut($('hubTitle').value,140),date=$('hubDate').value,amount=Number($('hubAmount').value),finance=kind==='finance';
   if(!taskKind(kind)||!title||!/^\d{4}-\d\d-\d\d$/.test(date)||(finance&&(!Number.isInteger(amount)||amount<1||amount>1e9))){status('Revisa los datos obligatorios.');return}
   const payload={user_id:user().id,kind,life_area:$('hubLifeArea').value,title,event_date:date,event_time:$('hubTime').value||null,visibility:$('hubVisibility').value,priority:$('hubPriority').value,details:cut($('hubDetails').value,1600),status:'todo',amount_clp:finance?amount:null,direction:finance?$('hubDirection').value:null};
   const btn=$('hubSave');btn.disabled=true;
   try{const {error}=await sb.from('couple_hub_items').insert(payload);if(error)throw error;$('hubForm').reset();closeForm();tab=kind;status('Guardado correctamente.');await fetchHub()}
   catch(err){status('No se pudo guardar: '+(err?.message||err));alert('Error al guardar: '+(err?.message||err))}
   finally{btn.disabled=false}
 });
 // Importación selectiva ALX HUB V14. Solo se importan campos conocidos y válidos.
 $('hubImportBtn').addEventListener('click',async()=>{const file=$('hubImportFile').files[0],box=$('hubImportStatus');if(!file)return box.textContent='Selecciona un JSON';if(file.size>8*1024*1024)return box.textContent='Archivo demasiado grande (máximo 8 MB).';if(!user())return;
   let data;try{data=JSON.parse(await file.text())}catch{return box.textContent='No es un JSON válido'}
   if(!data||!Array.isArray(data.tareas)||typeof data.version!=='number'||data.version<11||data.version>16)return box.textContent='Se esperaba un respaldo ALX HUB compatible (v11–v16) con tareas.';
   const selected=[];const valid=s=>/^\d{4}-\d\d-\d\d$/.test(String(s||''));
   for(const r of data.tareas.slice(0,300)){if(!r||!r.name)continue;selected.push({kind:'task',title:cut(r.name,140),details:cut(r.notes,1600),event_date:valid(r.due)?r.due:today(),status:r.done?'done':'todo',priority:['high','low','normal'].includes(r.priority)?r.priority:'normal',source:`ALX:task:${String(r.id||r.name).slice(0,90)}`})}
   if(Array.isArray(data.evaluaciones))for(const r of data.evaluaciones.slice(0,150)){if(!r||!r.nombre||!valid(r.fecha))continue;selected.push({kind:'study',title:cut(r.nombre,140),details:cut(r.tipo||'Evaluación',1600),event_date:r.fecha,priority:'high',status:'todo',source:`ALX:eval:${String(r.id||r.nombre).slice(0,90)}`})}
   for(const [collection,direction] of [['egresos','out'],['ingresos','in']]){const obj=data[collection];if(!obj||typeof obj!=='object'||Array.isArray(obj))continue;for(const [day,expenses] of Object.entries(obj)){
     if(!valid(day)||!Array.isArray(expenses))continue;for(const r of expenses.slice(0,30)){const amt=Math.round(Number(r.monto));if(!Number.isInteger(amt)||amt<1||amt>1e9)continue;selected.push({kind:'finance',title:cut(r.descripcion||r.categoria||collection,140),details:cut(r.categoria||'',1600),event_date:day,status:'todo',priority:'normal',direction,amount_clp:amt,source:`ALX:${collection}:${String(r.id||`${day}:${r.monto}:${r.descripcion||''}`).slice(0,95)}`})}
   }}
   if(selected.length>650)return box.textContent='El respaldo excede la importación segura de 650 registros. Divide la importación.';
   const answer=confirm(`Se importarán hasta ${selected.length} registros del ALX HUB. Todos serán PRIVADOS, solo visibles para ti. Se omiten registros ya importados. ¿Continuar?`);if(!answer)return;
   let created=0,skipped=0,errors=0;box.textContent='Importando…';$('hubImportBtn').disabled=true;
   try{for(const r of selected){const payload={user_id:user().id,kind:r.kind,life_area:r.kind==='study'?'study':r.kind==='finance'?'finance':'personal',title:r.title,details:r.details,event_date:r.event_date,visibility:'private',status:r.status,priority:r.priority,amount_clp:r.amount_clp||null,direction:r.direction||null,imported_from:`${user().id}:${r.source}`};
      const {error}=await sb.from('couple_hub_items').upsert(payload,{onConflict:'imported_from',ignoreDuplicates:true});if(error)errors++;else created++;
     }box.textContent=`Procesados: ${created}. Errores: ${errors}. Los repetidos se omitieron. Los registros son privados.`;await fetchHub()}
   finally{$('hubImportBtn').disabled=false}
 });
 function maybeStart(){if(!user())return;if(user().id!==lastUser){loaded=false;rows=[];lastUser=user().id;fetchHub()}}
 window.addEventListener('fer-page',e=>{if(e.detail==='hub')maybeStart();if(e.detail==='home'){maybeStart();refreshHome()}});
 sb.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>{if(!session?.user){rows=[];loaded=false;lastUser='';refreshHome();return}maybeStart()},80)});
 if(user())maybeStart();
 // Realtime notifications are scoped by RLS: owner/private records never appear to the other user.
 channel=sb.channel('couple-hub-v8').on('postgres_changes',{event:'*',schema:'public',table:'couple_hub_items'},()=>{if(user())fetchHub()}).subscribe();

 // Cápsula del tiempo: HUB completo en ZIP v5 sin alterar el formato v7.
 // Lo privado solo aparece cuando el propietario exporta. RLS garantiza el filtrado.
 window.FerHubBackup={
  append:async({manifest,human,fetchAll})=>{
    const data=await fetchAll('couple_hub_items','id,user_id,kind,life_area,visibility,title,details,event_date,event_time,priority,status,amount_clp,direction,created_at,imported_from');
    manifest.hub_v8=data;
    human.push('\nALX HUB · '+data.length+' registros autorizados');
    for(const r of data)human.push(`${r.event_date} · ${r.kind} · ${r.title} · ${r.visibility} · ${r.details||''}`);
  },
  restore:async({data,activeUser})=>{
    const items=data.hub_v8;
    if(!items)return;
    if(!Array.isArray(items)||items.length>10000)throw new Error('Datos de HUB no válidos en el respaldo.');
    // Solo restaurar registros del propietario actual: no se reasignan entradas privadas ajenas.
    const originalMembers=Array.isArray(data.members)?data.members:[];
    const currentName=core.members().find(x=>x.user_id===activeUser.id)?.display_name?.toLowerCase();
    const myOriginalIds=new Set(originalMembers.filter(x=>x.display_name?.toLowerCase()===currentName).map(x=>x.user_id));
    myOriginalIds.add(activeUser.id);
    let imported=0,skipped=0;
    for(const r of items){
      if(!myOriginalIds.has(r.user_id)){skipped++;continue;}
      if(!taskKind(r.kind)||!/^\d{4}-\d{2}-\d{2}$/.test(r.event_date)||!r.title){skipped++;continue}
      const source=`${activeUser.id}:restore:${r.id}`;
      const row={user_id:activeUser.id,kind:r.kind,life_area:['personal','work','study','finance','leisure','family'].includes(r.life_area)?r.life_area:'personal',visibility:r.visibility==='shared'?'shared':'private',title:cut(r.title,140),details:cut(r.details,1600),event_date:r.event_date,event_time:r.event_time||null,priority:['low','normal','high'].includes(r.priority)?r.priority:'normal',status:r.status==='done'?'done':'todo',amount_clp:r.kind==='finance'?Number(r.amount_clp):null,direction:r.kind==='finance'?(r.direction==='in'?'in':'out'):null,imported_from:source};
      const {error}=await sb.from('couple_hub_items').upsert(row,{onConflict:'imported_from',ignoreDuplicates:true});
      if(error)throw new Error('Error restaurando registros HUB: '+error.message);imported++;
    }
    await fetchHub();status(`Respaldo HUB procesado: ${imported} propios; ${skipped} ajenos u omitidos.`);
  }
 };
 window.FerHubV8=Object.freeze({refresh:fetchHub});
})();
