/* Fer & Alxs 10.7: una sola barra, asociada al scroll real de cada sección. */
(() => {
  'use strict';
  const app=document.getElementById('appView');
  if(!app || document.getElementById('ferEdgeScroll'))return;
  const bar=document.createElement('aside');
  bar.id='ferEdgeScroll';bar.className='edge-scroll-rail';bar.hidden=true;
  bar.setAttribute('aria-label','Desplazamiento asistido');
  bar.innerHTML=`<button type="button" class="edge-up" aria-label="Subir">⌃</button>
    <div class="edge-scroll-track" role="scrollbar" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0" aria-label="Arrastra para desplazarte">
    <div class="edge-scroll-thumb"></div></div>
    <button type="button" class="edge-down" aria-label="Bajar">⌄</button>`;
  document.body.appendChild(bar);
  const track=bar.querySelector('.edge-scroll-track'), thumb=bar.querySelector('.edge-scroll-thumb');
  const root=()=>document.scrollingElement||document.documentElement;
  const range=el=>Math.max(0,el.scrollHeight-el.clientHeight);
  const page=()=>app.dataset.currentPage||app.querySelector('.page.active')?.dataset.page||'';
  const modalOpen=()=>document.body.classList.contains('life10-modal-open')||
     !!document.querySelector('#uploadOverlay:not(.hidden),#v71SearchDialog:not(.hidden),#fer77MessageMenu:not(.hidden),#stickerMessageMenu:not(.hidden)');
  let activeTarget=null,frame=0,dragId=null,thumbHeight=38,lastVisible=false;
  const current=()=>{
    if(page()==='cards' || app.classList.contains('hidden') || modalOpen())return null;
    if(page()==='chat'){
      const wall=document.querySelector('#page-chat .chat-wall');
      return wall&&range(wall)>8?wall:null;
    }
    return range(root())>8?root():null;
  };
  const position=el=>el===root()?window.scrollY:el.scrollTop;
  function render(){
    const next=current();activeTarget=next;
    const visible=!!next;
    if(lastVisible!==visible){bar.hidden=!visible;lastVisible=visible;}
    if(!visible)return;
    const trackLength=track.clientHeight;
    if(trackLength<38)return;
    const max=range(next);
    thumbHeight=Math.max(38,Math.min(trackLength,Math.round(trackLength*next.clientHeight/next.scrollHeight)));
    thumb.style.height=thumbHeight+'px';
    const percent=Math.min(1,Math.max(0,position(next)/max));
    thumb.style.transform='translateY('+Math.round((trackLength-thumbHeight)*percent)+'px)';
    track.setAttribute('aria-valuenow',String(Math.round(percent*100)));
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;render()})}
  function go(y,smooth=false){const el=activeTarget||current();if(!el)return;
    const top=Math.max(0,Math.min(range(el),y));
    if(el===root())window.scrollTo({top,behavior:smooth?'smooth':'auto'});
    else el.scrollTo({top,behavior:smooth?'smooth':'auto'});
    schedule();
  }
  function step(dir){const el=activeTarget||current();if(el)go(position(el)+dir*Math.max(130,Math.round(el.clientHeight*.7)),true)}
  function move(clientY){const el=activeTarget||current();if(!el)return;
    const rect=track.getBoundingClientRect();const span=Math.max(1,rect.height-thumbHeight);
    const y=Math.max(0,Math.min(span,clientY-rect.top-thumbHeight/2));go(y/span*range(el));
  }
  bar.querySelector('.edge-up').addEventListener('click',()=>step(-1));
  bar.querySelector('.edge-down').addEventListener('click',()=>step(1));
  track.addEventListener('pointerdown',e=>{if(e.button!==0)return;dragId=e.pointerId;
    track.setPointerCapture(dragId);move(e.clientY);e.preventDefault();});
  track.addEventListener('pointermove',e=>{if(dragId===e.pointerId){move(e.clientY);e.preventDefault()}});
  function end(){dragId=null;schedule()}
  ['pointerup','pointercancel','lostpointercapture'].forEach(t=>track.addEventListener(t,end));
  track.addEventListener('keydown',e=>{const el=activeTarget||current();if(!el)return;
    const map={ArrowUp:-65,ArrowDown:65,PageUp:-el.clientHeight*.8,PageDown:el.clientHeight*.8,Home:-Infinity,End:Infinity};
    if(!(e.key in map))return;e.preventDefault();const val=map[e.key];go(val===-Infinity?0:val===Infinity?range(el):position(el)+val);
  });
  document.addEventListener('scroll',schedule,{capture:true,passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  window.visualViewport?.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('fer-page',()=>{dragId=null;activeTarget=null;schedule()});
  new MutationObserver(schedule).observe(app,{attributes:true,attributeFilter:['class','data-current-page'],childList:true});
  const timeline=document.getElementById('chatTimeline');
  if(timeline)new MutationObserver(schedule).observe(timeline,{childList:true,subtree:false});
  if('ResizeObserver' in window){const ro=new ResizeObserver(schedule);ro.observe(app);ro.observe(document.documentElement);
    const wall=document.querySelector('#page-chat .chat-wall');if(wall)ro.observe(wall);}
  schedule();
})();
