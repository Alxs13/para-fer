/* FER & ALXS · Life OS 10.0 — capa UX progresiva.
   Sin llamadas adicionales a Supabase, sin datos personales en localStorage.
   Solo guarda las preferencias visuales de ESTE navegador. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const core=window.FerCoreV7;
const app=$('appView'),more=$('page-more'),deck=$('page-cards'),hub=$('page-hub');
if(!core||!app||!more||!deck||!hub)return;
const KEY='fer-alxs:v10:ui';
const defaultState={pins:['cards','chat','hub','flash'],compact:false,privacy:false,photo:false};
let saved={};try {saved=JSON.parse(localStorage.getItem(KEY)||'{}')||{}} catch{}
const state={...defaultState,...saved};
state.pins=Array.isArray(state.pins)?[...new Set(state.pins.filter(x=>typeof x==='string'))].slice(0,8):[...defaultState.pins];
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}};
const defs=[
 ['cards','Cartas','Fotos · recuerdos','Nuestros recuerdos'],
 ['chat','Chat','Mensajes · stickers · GIF','Nuestros recuerdos'],
 ['binder','Archivador','Todas las fotos','Nuestros recuerdos'],
 ['calendar','Calendario','Fechas importantes','Nuestros recuerdos'],
 ['today','Un día como hoy','Recuerdos del pasado','Nuestros recuerdos'],
 ['notes','Mensajitos','Notas de pareja','Nuestros recuerdos'],
 ['music','Nuestra música','Playlist de los dos','Nuestros recuerdos'],
 ['videos','Videos','Momentos grabados','Nuestros recuerdos'],
 ['diary','Diario','Diario personal y compartido','Nuestros recuerdos'],
 ['gifts','Regalos sorpresa','Sobres programados','Nuestros recuerdos'],
 ['studio','Estudio creativo','Crear tarjetas y película','Nuestros recuerdos'],
 ['hub','Vida · ALX HUB','Agenda · pendientes · finanzas','Organización'],
 ['flash','Notas de 24 horas','Notas que se archivan','Organización'],
 ['savings','Metas de ahorro','Aportes y metas en CLP','Organización'],
 ['dreams','Nuestros sueños','Planes por cumplir','Organización'],
 ['routes','Rutas y Waze','Viajes y destinos','Movilidad'],
 ['mobility','SNK Garage','Autos · mantenciones · documentos','Movilidad'],
 ['places','Mapa de recuerdos','Lugares que visitamos','Movilidad'],
 ['play','Juegos y ruleta','Ocio para los dos','Ocio'],
 ['backup','Cápsula y respaldo','Exportar y restaurar','Seguridad'],
 ['home','Inicio','Resumen personal','Seguridad']
];
const info=new Map(defs.map(x=>[x[0],{id:x[0],title:x[1],subtitle:x[2],group:x[3]}]));
const groups=['Nuestros recuerdos','Organización','Movilidad','Ocio','Seguridad'];
const toPage=id=>{if(!info.has(id))return;closePalette();core.goPage(id);};
const el=(tag,cls,txt)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(txt!==undefined)node.textContent=txt;return node;};
function navButton(id,cls='life10-command'){
  const data=info.get(id);if(!data)return el('span','',id);
  const b=el('button',cls);b.type='button';b.dataset.target=id;
  b.append(el('strong','',data.title),el('small','',data.subtitle));b.addEventListener('click',()=>toPage(id));return b;
}
function togglePin(id){const on=state.pins.includes(id);state.pins=on?state.pins.filter(x=>x!==id):[...state.pins,id].slice(-8);save();drawPins();updatePinButtons();}
const header=el('section','life10-more-header');
header.innerHTML='<span class="life10-eyebrow">TU ESPACIO · ORGANIZADO</span><h2>Todo en su lugar.</h2><p>Lo que compartimos y lo que es solo tuyo, sin menús interminables.</p>';
const search=el('label','life10-tool-search');search.innerHTML='<span aria-hidden="true">⌕</span><input type="search" autocomplete="off" placeholder="Buscar una herramienta…" aria-label="Buscar herramientas"/><kbd>⌘ K</kbd>';
header.append(search);
const pinned=el('section','life10-pinned');pinned.innerHTML='<div class="life10-section-title"><h3>Mis accesos</h3><span>Puedes fijar hasta 8</span></div>';
const pinGrid=el('div','life10-pins');pinned.append(pinGrid);
const results=el('div','life10-tool-categories');const empty=el('p','life10-empty hidden','No encontramos una herramienta con ese nombre.');
const oldRoot=more.querySelector('.more-grid');
// Reutiliza los botones originales y sus listeners; no recrea funciones.
const originalButtons=[...oldRoot.querySelectorAll('button.more-tile')];
const assigned=new Set();
const wrappers=[];
for(const group of groups){
 const section=el('section','life10-group');section.dataset.category=group;
 const h=el('div','life10-section-title');h.append(el('h3','',group),el('span','',group==='Nuestros recuerdos'?'Momentos para volver':'Herramientas útiles'));section.append(h);
 const grid=el('div','life10-tool-grid');section.append(grid);
 for(const item of defs.filter(x=>x[3]===group)){
  const old=originalButtons.find(b=>b.dataset.go===item[0]&&!assigned.has(b));
  const tile=old||navButton(item[0],'more-tile');assigned.add(old||tile);
  const wrap=el('div','life10-tool');wrap.dataset.module=item[0];wrap.dataset.search=(item.join(' ')+' '+(tile.textContent||'')).toLocaleLowerCase('es');
  if(old)old.classList.add('life10-primary-tile');
  const pin=el('button','life10-pin');pin.type='button';pin.dataset.pin=item[0];pin.setAttribute('aria-label','Fijar '+item[1]);pin.addEventListener('click',()=>togglePin(item[0]));
  wrap.append(tile,pin);grid.append(wrap);wrappers.push(wrap);
 }
 results.append(section);
}
// Conserva botones adicionales de la versión anterior (bienvenida, compartir, etc.).
const extras=originalButtons.filter(x=>!assigned.has(x));
if(extras.length){const sec=el('section','life10-group');const head=el('div','life10-section-title');head.append(el('h3','','Más opciones'));sec.append(head);const grid=el('div','life10-tool-grid');sec.append(grid);
 for(const b of extras){const w=el('div','life10-tool');w.dataset.search=b.textContent.toLocaleLowerCase('es');w.append(b);grid.append(w);wrappers.push(w);}results.append(sec);}
oldRoot.replaceChildren(header,pinned,results,empty);oldRoot.classList.add('life10-more-root');
function drawPins(){pinGrid.replaceChildren();for(const id of state.pins)pinGrid.append(navButton(id,'life10-pinned-btn'));pinned.hidden=!state.pins.length;}
function updatePinButtons(){for(const b of results.querySelectorAll('[data-pin]')){const yes=state.pins.includes(b.dataset.pin);b.textContent=yes?'★':'☆';b.setAttribute('aria-pressed',String(yes));b.setAttribute('title',yes?'Quitar de accesos':'Agregar a accesos');}}
function filterTools(term){const q=term.trim().toLocaleLowerCase('es');let hits=0;for(const w of wrappers){const match=!q||w.dataset.search.includes(q);w.hidden=!match;hits+=Number(match)}
 for(const group of results.querySelectorAll('.life10-group'))group.hidden=![...group.querySelectorAll('.life10-tool')].some(x=>!x.hidden);
 empty.classList.toggle('hidden',hits>0);pinned.hidden=!!q||!state.pins.length;
}
search.querySelector('input').addEventListener('input',e=>filterTools(e.target.value));
search.querySelector('input').addEventListener('keydown',e=>{if(e.key==='Escape'){e.currentTarget.value='';filterTools('');}});
drawPins();updatePinButtons();
// Acceso universal desde cualquier pantalla.
const palette=el('div','life10-palette hidden');palette.id='life10Palette';palette.setAttribute('role','dialog');palette.setAttribute('aria-modal','true');palette.setAttribute('aria-label','Ir a herramienta');palette.innerHTML='<button class="life10-palette-scrim" type="button" aria-label="Cerrar"></button><div class="life10-palette-sheet"><div class="life10-palette-head"><span>IR A CUALQUIER PARTE</span><button type="button" data-close="1" aria-label="Cerrar">×</button></div><input id="life10CommandInput" type="search" placeholder="¿Qué necesitas hacer?" autocomplete="off" aria-label="Buscar módulos"><div class="life10-command-results"></div><p class="life10-command-foot">Tus favoritos están arriba. No se muestran datos personales en esta búsqueda.</p></div>';
document.body.append(palette);
const cmdInput=$('life10CommandInput'),cmdResults=palette.querySelector('.life10-command-results');
let returnFocus=null;
const quickActions=[
 {title:'Crear una carta',hint:'Nueva fotografía y dedicatoria',keywords:'foto recuerdo crear nueva carta',run:()=>core.openUpload()},
 {title:'Añadir un pendiente',hint:'Tarea personal o compartida',keywords:'tarea evento pendiente agregar agenda',run:()=>{core.goPage('hub');$('hubOpenForm')?.click()}},
 {title:'Dejar una nota 24h',hint:'Mensaje temporal con archivo',keywords:'nota 24 horas temporal',run:()=>{core.goPage('flash');$('flashCreateToggle')?.click()}},
 {title:'Enviar un mensaje',hint:'Abrir el chat y escribir',keywords:'chat mensaje hablar',run:()=>{core.goPage('chat');setTimeout(()=>$('chatInput')?.focus({preventScroll:true}),80)}}
];
function drawCommands(q=''){
 cmdResults.replaceChildren();const term=q.trim().toLocaleLowerCase('es');
 const actions=quickActions.filter(a=>!term||[a.title,a.hint,a.keywords].join(' ').toLocaleLowerCase('es').includes(term));
 if(actions.length){const label=el('p','life10-command-label','ACCIONES RÁPIDAS');cmdResults.append(label);
  for(const action of actions){const b=el('button','life10-command life10-quick-action');b.type='button';b.append(el('strong','',action.title),el('small','',action.hint));b.addEventListener('click',()=>{closePalette();action.run()});cmdResults.append(b)}
 }
 const ids=[...new Set([...state.pins,...defs.map(d=>d[0])])].filter(id=>{const d=info.get(id);return !term||[d.title,d.subtitle,d.group].join(' ').toLocaleLowerCase('es').includes(term)}).slice(0,22);
 if(ids.length)cmdResults.append(el('p','life10-command-label','SECCIONES'));
 for(const id of ids)cmdResults.append(navButton(id));
 if(!ids.length&&!actions.length)cmdResults.append(el('p','life10-empty','No hay coincidencias. Prueba otra palabra.'));
}
function openPalette(){returnFocus=document.activeElement;drawCommands();cmdInput.value='';palette.classList.remove('hidden');document.body.classList.add('life10-modal-open');cmdInput.focus({preventScroll:true});}
function closePalette(){palette.classList.add('hidden');document.body.classList.remove('life10-modal-open');try{returnFocus?.focus({preventScroll:true});}catch{}}
palette.querySelector('.life10-palette-scrim').addEventListener('click',closePalette);
palette.querySelector('[data-close]').addEventListener('click',closePalette);
cmdInput.addEventListener('input',()=>drawCommands(cmdInput.value));
cmdInput.addEventListener('keydown',e=>{if(e.key==='Enter'){const button=cmdResults.querySelector('button');if(button)button.click();}});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();palette.classList.contains('hidden')?openPalette():closePalette();}else if(e.key==='Escape'&&!palette.classList.contains('hidden'))closePalette();});
// Lanzador discreto, visible en todas las pantallas autenticadas.
const launch=el('button','life10-launcher');launch.id='life10Launcher';launch.type='button';launch.setAttribute('aria-label','Abrir buscador de funciones');launch.title='Buscar funciones';launch.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 5 5"/></svg>';
launch.addEventListener('click',openPalette);
const appTop=app.querySelector('.app-topline');appTop?.append(launch);
// Inyectar acciones claramente visibles en Cartas sin cubrir el mazo.
const cardsActions=el('div','life10-cards-actions');
const findBtn=el('button','','⌕ Buscar momentos'),focusBtn=el('button','','▣ Vista limpia');
findBtn.type=focusBtn.type='button';findBtn.addEventListener('click',()=>{const old=$('v71SearchOpen');if(old)old.click();else openPalette();});
focusBtn.addEventListener('click',()=>{state.photo=!state.photo;save();applySettings();});
cardsActions.append(findBtn,focusBtn);
const deckBar=deck.querySelector('.deck-bar');deckBar?.insertAdjacentElement('afterend',cardsActions);
// Filtro de texto local, exclusivo para el HUB autorizado ya cargado.
const hubFind=el('label','life10-hub-find');hubFind.innerHTML='<span>⌕</span><input type="search" placeholder="Filtrar mis pendientes y notas…" aria-label="Buscar en registros visibles del HUB"/>';
const hubList=$('hubList');const agenda=hubList?.parentElement;agenda?.insertBefore(hubFind,hubList);
const hubInput=hubFind.querySelector('input');
function filterHubRows(){const term=hubInput.value.trim().toLocaleLowerCase('es');
 let count=0;for(const item of hubList.querySelectorAll('.hub-entry')){const ok=!term||item.textContent.toLocaleLowerCase('es').includes(term);item.hidden=!ok;if(ok)count++;}
 let no=hubList.querySelector('.life10-hub-no-results');if(term&&!count&&!no)hubList.append(el('p','life10-hub-no-results','No hay resultados en los registros cargados.'));else if((!term||count)&&no)no.remove();
}
hubInput.addEventListener('input',filterHubRows);
if(hubList){const mo=new MutationObserver(()=>{if(hubInput.value)requestAnimationFrame(filterHubRows)});mo.observe(hubList,{childList:true});}
// Ajustes visuales por navegador; no oculta contenido en Supabase ni reemplaza permisos.
const settings=el('section','life10-settings');settings.innerHTML='<div class="life10-section-title"><h3>Mi experiencia</h3><span>Solo en este dispositivo</span></div><p>Personaliza la vista. El modo discreto solo oculta contenido en pantalla; no cifra ni cambia permisos.</p>';
const compactBtn=el('button','life10-option'),privacyBtn=el('button','life10-option');compactBtn.type=privacyBtn.type='button';
compactBtn.addEventListener('click',()=>{state.compact=!state.compact;save();applySettings();});
privacyBtn.addEventListener('click',()=>{state.privacy=!state.privacy;save();applySettings();});
const options=el('div','life10-options');options.append(compactBtn,privacyBtn);settings.append(options);oldRoot.append(settings);
function applySettings(){document.body.classList.toggle('life10-compact',!!state.compact);document.body.classList.toggle('life10-privacy',!!state.privacy);document.body.classList.toggle('life10-photo',!!state.photo);
 compactBtn.textContent=(state.compact?'✓ ':'')+'Diseño compacto';compactBtn.setAttribute('aria-pressed',String(state.compact));
 privacyBtn.textContent=(state.privacy?'✓ ':'')+'Modo discreto';privacyBtn.setAttribute('aria-pressed',String(state.privacy));
 focusBtn.textContent=(state.photo?'✓ Vista normal':'▣ Vista limpia');focusBtn.setAttribute('aria-pressed',String(state.photo));
}
applySettings();
// Escuchar cambio de pestaña sin interferir con la navegación principal.
window.addEventListener('fer-page',e=>{if(e.detail==='more'&&search.querySelector('input').value){search.querySelector('input').value='';filterTools('')}if(e.detail!=='cards'&&state.photo){state.photo=false;save();applySettings();}});
// Exponer solo API de presentación para pruebas, sin exportar tokens ni datos.
window.FerLife10=Object.freeze({openPalette,closePalette,go:toPage});
})();
