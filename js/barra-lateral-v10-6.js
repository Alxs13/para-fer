/* Fer & Alxs 10.6: barra para TODAS las anchuras sin interceptar el scroll nativo. */
(() => {
  'use strict';
  const app = document.getElementById('appView');
  if (!app || document.getElementById('ferEdgeScroll')) return;
  const bar=document.createElement('aside');
  bar.id='ferEdgeScroll'; bar.className='edge-scroll-rail'; bar.hidden=true;
  bar.setAttribute('aria-label','Control de desplazamiento');
  bar.innerHTML=`<button type="button" id="ferEdgeUp" aria-label="Subir" title="Subir">⌃</button>
  <div class="edge-scroll-track" id="ferEdgeTrack" role="scrollbar" aria-label="Arrastra para desplazar" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><div class="edge-scroll-thumb" id="ferEdgeThumb"></div></div>
  <button type="button" id="ferEdgeDown" aria-label="Bajar" title="Bajar">⌄</button>`;
  document.body.appendChild(bar);
  const track=bar.querySelector('#ferEdgeTrack'), thumb=bar.querySelector('#ferEdgeThumb');
  const root=()=>document.scrollingElement||document.documentElement;
  const range=el=>Math.max(0,el.scrollHeight-el.clientHeight);
  const isRoot=el=>el===root();
  const pos=el=>isRoot(el)?(window.scrollY||el.scrollTop):el.scrollTop;
  const currentPage=()=>app.dataset.currentPage || app.querySelector('.page.active')?.dataset.page || '';
  let target=null,thumbHeight=40,dragging=false,frame=0;
  function scrollable(el){return el && range(el)>10 && (isRoot(el)||/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY));}
  function pick(){
    if(currentPage()==='cards')return null; // las cartas se deslizan horizontalmente
    const active=app.querySelector('.page.active');
    if(currentPage()==='chat'){
      const wall=active?.querySelector('.chat-wall');
      if(scrollable(wall))return wall;
    }
    // Pantallas con desplazamiento propio, luego la página normal.
    for(const el of [active,app,document.getElementById('main'),root()]){
      if(scrollable(el))return el;
    }
    return null;
  }
  const modalOpen=()=>document.body.classList.contains('life10-modal-open')||
    !!document.querySelector('#uploadOverlay:not(.hidden),#v71SearchDialog:not(.hidden),#v71WelcomeDialog:not(.hidden),#fer77MessageMenu:not(.hidden),#stickerMessageMenu:not(.hidden)');
  function readTarget(){
    const el=pick();
    if(el!==target){
      if(target&&!isRoot(target))target.removeEventListener('scroll',schedule);
      target=el;
      if(target&&!isRoot(target))target.addEventListener('scroll',schedule,{passive:true});
    }
    return target;
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;update()})}
  function update(){
    const el=readTarget(), max=el?range(el):0;
    const visible=!app.classList.contains('hidden') && currentPage()!=='cards' && !!el && max>12 && !modalOpen();
    bar.hidden=!visible;
    if(!visible)return;
    const h=track.clientHeight;
    if(!h)return;
    thumbHeight=Math.max(40,Math.min(h,Math.round(h*el.clientHeight/el.scrollHeight)));
    const fraction=Math.max(0,Math.min(1,pos(el)/max));
    thumb.style.height=thumbHeight+'px';
    thumb.style.transform=`translateY(${Math.round((h-thumbHeight)*fraction)}px)`;
    track.setAttribute('aria-valuenow',String(Math.round(fraction*100)));
    track.setAttribute('aria-valuetext',`${Math.round(fraction*100)} por ciento del recorrido`);
    track.setAttribute('aria-controls',isRoot(el)?'appView':el.id||'appView');
  }
  function go(y,smooth=false){
    const el=readTarget();if(!el)return;
    const dest=Math.max(0,Math.min(range(el),y));
    if(isRoot(el))window.scrollTo({top:dest,behavior:smooth?'smooth':'instant'});
    else el.scrollTo({top:dest,behavior:smooth?'smooth':'instant'});
    schedule();
  }
  function step(direction){const el=readTarget();if(el)go(pos(el)+direction*Math.max(120,Math.round(el.clientHeight*.75)),true)}
  function moveAt(clientY){
    const el=readTarget();if(!el)return;
    const rect=track.getBoundingClientRect(), handleRange=Math.max(0,rect.height-thumbHeight);
    const y=Math.max(0,Math.min(handleRange,clientY-rect.top-thumbHeight/2));
    go((handleRange?y/handleRange:0)*range(el));
  }
  bar.querySelector('#ferEdgeUp').addEventListener('click',()=>step(-1));
  bar.querySelector('#ferEdgeDown').addEventListener('click',()=>step(1));
  track.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    dragging=true;
    track.setPointerCapture(event.pointerId);
    moveAt(event.clientY);event.preventDefault();
  });
  track.addEventListener('pointermove',event=>{if(dragging){moveAt(event.clientY);event.preventDefault()}});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])track.addEventListener(name,()=>{dragging=false;schedule()});
  track.addEventListener('keydown',event=>{
    const el=readTarget();if(!el)return;
    let y=pos(el);
    if(event.key==='ArrowDown')y+=60;
    else if(event.key==='ArrowUp')y-=60;
    else if(event.key==='PageDown')y+=el.clientHeight*.8;
    else if(event.key==='PageUp')y-=el.clientHeight*.8;
    else if(event.key==='Home')y=0;
    else if(event.key==='End')y=range(el);
    else return;
    event.preventDefault();go(y);
  });
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  window.visualViewport?.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('fer-page',()=>{dragging=false;target=null;requestAnimationFrame(schedule)});
  new MutationObserver(schedule).observe(app,{attributes:true,attributeFilter:['class','data-current-page'],childList:true,subtree:true});
  new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class']});
  if('ResizeObserver' in window){const observer=new ResizeObserver(schedule);observer.observe(app);observer.observe(document.documentElement)}
  schedule();
})();
