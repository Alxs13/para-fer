/* FER & ALXS LIFE OS 9.1 · Notas 24h con archivo y juegos locales */
(()=>{
'use strict';
const core=window.FerCoreV7;if(!core)return;
const sb=core.sb,user=()=>core.user(),$=id=>document.getElementById(id);
const state={notes:[],currentUserId:null,loading:false};
const el=(tag,cls,content)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(content!==undefined)n.textContent=content;return n};
const status=(s)=>{$('flashStatus').textContent=s||''};
const nameOf=id=>core.members().find(x=>x.user_id===id)?.display_name||'Nosotros';
const dateFmt=s=>new Intl.DateTimeFormat('es-CL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(s));
const isLive=r=>new Date(r.expires_at).getTime()>Date.now();
function noteCard(r,archived=false){const n=el('article','life-note');n.dataset.tone=['wine','rose','gold','night'].includes(r.tone)?r.tone:'wine';
 n.append(el('p','',r.body));const foot=el('footer');const who=el('span','',nameOf(r.user_id)+(archived?' · Archivada':` · hasta ${dateFmt(r.expires_at)}`));foot.append(who);
 if(r.user_id===user()?.id){const b=el('button','', 'Eliminar');b.type='button';b.addEventListener('click',async()=>{
 if(!confirm('¿Eliminar esta nota también del archivo? No se puede deshacer.'))return;
 const {error}=await sb.from('couple_flash_notes').delete().eq('id',r.id).eq('user_id',user().id);if(error)return status(error.message);await loadNotes();
 });foot.append(b);}
 n.append(foot);return n;}
function paint(){const live=$('flashLive'),old=$('flashArchive');live.replaceChildren();old.replaceChildren();
 const active=state.notes.filter(isLive),archive=state.notes.filter(x=>!isLive(x));
 if(!active.length)live.append(el('p','life-muted','No hay notas activas. Escribe una para hoy.'));
 for(const r of active)live.append(noteCard(r));
 if(!archive.length)old.append(el('p','life-muted','Todavía no hay notas vencidas.'));
 for(const r of archive)old.append(noteCard(r,true));$('flashArchiveCount').textContent=String(archive.length);
}
async function loadNotes(){if(!user()||state.loading)return;state.loading=true;try{
 const id=user().id;const {data,error}=await sb.from('couple_flash_notes').select('id,user_id,body,tone,visibility,created_at,expires_at').order('created_at',{ascending:false}).limit(500);
 if(error)throw error;if(user()?.id!==id)return;state.notes=data||[];state.currentUserId=id;paint();status('');
 }catch(e){status('No se cargaron las notas. Ejecuta SQL 12_lifeos.sql. '+(e.message||e));}
 finally{state.loading=false;}}
$('flashCreateToggle').addEventListener('click',()=>{const f=$('flashForm');f.classList.toggle('hidden');if(!f.classList.contains('hidden'))$('flashBody').focus({preventScroll:true})});
$('flashForm').addEventListener('submit',async e=>{e.preventDefault();if(!user())return;
 const body=$('flashBody').value.trim();if(!body||body.length>300)return status('Escribe entre 1 y 300 caracteres.');
 const b=e.currentTarget.querySelector('[type=submit]');b.disabled=true;try{const {error}=await sb.from('couple_flash_notes').insert({user_id:user().id,body,tone:$('flashColor').value,visibility:$('flashVisibility').value});if(error)throw error;
 e.currentTarget.reset();e.currentTarget.classList.add('hidden');await loadNotes();status('Nota publicada. Se archivará automáticamente tras 24 horas.');
 }catch(err){status('Error al guardar la nota: '+err.message)}finally{b.disabled=false;}});
$('flashExport').addEventListener('click',()=>{if(!user())return;const json=JSON.stringify({format:'fer-alxs-notes-v1',exported_at:new Date().toISOString(),items:state.notes},null,2);const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='fer-alxs-notas-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);status('Copia JSON generada. Guárdala en un lugar privado.');});
window.addEventListener('fer-page',e=>{if(e.detail==='flash')loadNotes()});
sb.auth.onAuthStateChange((_event,session)=>{if(!session?.user){state.notes=[];state.currentUserId=null;paint();}else if(state.currentUserId!==session.user.id){state.notes=[];state.currentUserId=null;}});
const realtime=sb.channel('fer-alxs-flash-v91').on('postgres_changes',{event:'*',schema:'public',table:'couple_flash_notes'},()=>{if(user()&&document.querySelector('#page-flash.active'))loadNotes()}).subscribe();
setInterval(()=>{if(document.querySelector('#page-flash.active'))paint()},60000);
// Tic tac toe local, 2 turnos en mismo equipo, sin fingir multijugador de red.
let board=Array(9).fill(''),turn='X',ended=false;const winning=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function drawGame(){const root=$('tttBoard');root.replaceChildren();let matched=winning.find(c=>c.every(i=>board[i]&&board[i]===board[c[0]]));const winner=matched?board[matched[0]]:null;ended=!!winner||board.every(Boolean);
 $('tttTurn').textContent=ended?(winner?`Ganó ${winner==='X'?'Fer':'Alxs'}`:'Empate'):`Turno: ${turn==='X'?'Fer (X)':'Alxs (O)'}`;
 $('tttStatus').textContent=ended?(winner?'¡Una buena partida!':'Empate. Otra ronda.'):'Toquen una casilla para jugar por turnos.';
 for(let i=0;i<9;i++){const b=el('button','',board[i]||'');b.type='button';b.dataset.mark=board[i];b.setAttribute('aria-label',`Casilla ${i+1}, ${board[i]||'vacía'}`);if(matched?.includes(i))b.classList.add('win');b.disabled=ended||!!board[i];b.addEventListener('click',()=>{if(ended||board[i])return;board[i]=turn;turn=turn==='X'?'O':'X';drawGame()});root.append(b)}
}
$('tttRestart').addEventListener('click',()=>{board=Array(9).fill('');turn='X';ended=false;drawGame()});drawGame();
// Roulette visual: sin cripto pagos ni apuestas.
let spinDeg=0,spinBusy=false;
$('rouletteSpin').addEventListener('click',()=>{if(spinBusy)return;const options=$('rouletteOptions').value.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,20);if(options.length<2)return $('rouletteStatus').textContent='Ingresa al menos dos opciones.';
 spinBusy=true;const win=options[Math.floor(Math.random()*options.length)];spinDeg+=1080+360*Math.random();const wheel=$('rouletteWheel'),ans=$('rouletteAnswer');wheel.style.transform=`rotate(${spinDeg}deg)`;ans.style.transform=`rotate(${-spinDeg}deg)`;ans.textContent='Girando…';$('rouletteStatus').textContent='Eligiendo entre '+options.length+' opciones';
 setTimeout(()=>{ans.textContent=win;$('rouletteStatus').textContent='Hoy elegimos: '+win;spinBusy=false},3100);
});
// Add content to Capsule complete backup (same RLS scope as the currently authenticated member).
window.FerLifeOSBackup={append:async({manifest,human,fetchAll})=>{const rows=await fetchAll('couple_flash_notes','id,user_id,body,tone,visibility,created_at,expires_at');manifest.flash_notes_v91=rows;human.push(`\nNOTAS 24H · ${rows.length} notas visibles, incluidas archivadas`);},
 restore:async({data,activeUser})=>{const items=data.flash_notes_v91;if(!items)return;if(!Array.isArray(items)||items.length>1500)throw Error('Respaldo de notas 24h no válido.');
 const ownIds=new Set([activeUser.id]);const original=(data.members||[]).find(x=>String(x.display_name).toLowerCase()===String(core.members().find(m=>m.user_id===activeUser.id)?.display_name).toLowerCase());if(original?.user_id)ownIds.add(original.user_id);
 for(const r of items){if(!ownIds.has(r.user_id)||typeof r.body!=='string'||r.body.length>300||!r.body.trim())continue;
 const whenCreated=new Date(r.created_at),whenExpires=new Date(r.expires_at);if(!Number.isFinite(+whenCreated)||!Number.isFinite(+whenExpires)||whenExpires<=whenCreated||whenExpires-whenCreated>86400000)continue;
 const payload={user_id:activeUser.id,body:r.body,created_at:whenCreated.toISOString(),expires_at:whenExpires.toISOString(),tone:['wine','rose','gold','night'].includes(r.tone)?r.tone:'wine',visibility:r.visibility==='shared'?'shared':'private',backup_source_id:r.id};
 const {error}=await sb.from('couple_flash_notes').upsert(payload,{onConflict:'backup_source_id',ignoreDuplicates:true});if(error)throw error;
 }await loadNotes();}};
})();
