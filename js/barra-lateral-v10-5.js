/* Barra lateral Fer & Alxs 10.5: controla el contenido sin interceptar los gestos nativos. */
(() => {
  'use strict';
  const app = document.getElementById('appView');
  if (!app || document.getElementById('ferEdgeScroll')) return;
  const bar = document.createElement('aside');
  bar.id = 'ferEdgeScroll';
  bar.className = 'edge-scroll-rail';
  bar.hidden = true;
  bar.setAttribute('aria-label','Desplazamiento de la pantalla');
  bar.innerHTML = `<button type="button" id="ferEdgeUp" aria-label="Subir una pantalla" title="Subir">⌃</button>
  <div class="edge-scroll-track" id="ferEdgeTrack" role="scrollbar" aria-label="Barra lateral, arrastra para subir o bajar" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
    <div class="edge-scroll-thumb" id="ferEdgeThumb"></div>
  </div>
  <button type="button" id="ferEdgeDown" aria-label="Bajar una pantalla" title="Bajar">⌄</button>`;
  document.body.appendChild(bar);
  const track=bar.querySelector('#ferEdgeTrack'), thumb=bar.querySelector('#ferEdgeThumb');
  const up=bar.querySelector('#ferEdgeUp'), down=bar.querySelector('#ferEdgeDown');
  const root=()=>document.scrollingElement||document.documentElement;
  const isRoot=(e)=>e===root();
  const range=(e)=>Math.max(0,e.scrollHeight-e.clientHeight);
  const top=(e)=>isRoot(e)?window.scrollY||e.scrollTop:e.scrollTop;
  const currentPage=()=>app.dataset.currentPage || document.querySelector('#appView .page.active')?.dataset.page || '';
  let target=null, dragging=false, raf=0, thumbHeight=42;
  const schedule=()=>{if(!raf){raf=requestAnimationFrame(()=>{raf=0;update()})}};
  function pick(){
    const page=currentPage();
    if(page==='cards')return null; // Las cartas usan el gesto horizontal original.
    if(page==='chat'){
      // El historial se mueve; si todavía no desborda, usar scroll de página.
      const wall=document.querySelector('#page-chat .chat-wall');
      if(wall && range(wall)>8)return wall;
    }
    const active=document.querySelector('#appView .page.active');
    // Algunas pantallas usan contenedor propio: detectarlo antes del documento.
    if(active && range(active)>8 && ['auto','scroll'].includes(getComputedStyle(active).overflowY))return active;
    const main=document.getElementById('main');
    if(main && range(main)>8 && ['auto','scroll'].includes(getComputedStyle(main).overflowY))return main;
    if(range(app)>8 && ['auto','scroll'].includes(getComputedStyle(app).overflowY))return app;
    return root();
  }
  function readTarget(){
    const newTarget=pick();
    if(newTarget!==target){
      if(target){target.removeEventListener('scroll',schedule)}
      target=newTarget;
      if(target && !isRoot(target))target.addEventListener('scroll',schedule,{passive:true});
    }
    return target;
  }
  function modalOpen(){
    return document.body.classList.contains('life10-modal-open') ||
      !!document.querySelector('#uploadOverlay:not(.hidden), #v71SearchDialog:not(.hidden), #v71WelcomeDialog:not(.hidden), #fer77MessageMenu:not(.hidden), #stickerMessageMenu:not(.hidden)');
  }
  function update(){
    const el=readTarget(), max=el?range(el):0;
    const visible=window.innerWidth<720 && !app.classList.contains('hidden') && !!el && max>12 && !modalOpen();
    bar.hidden=!visible;
    if(!visible)return;
    const h=track.clientHeight;
    if(!h){return}
    thumbHeight=Math.max(42,Math.min(h,Math.round(h*el.clientHeight/el.scrollHeight)));
    thumb.style.height=thumbHeight+'px';
    const fraction=Math.max(0,Math.min(1,top(el)/max));
    thumb.style.transform=`translateY(${Math.round((h-thumbHeight)*fraction)}px)`;
    track.setAttribute('aria-valuenow',String(Math.round(fraction*100)));
    track.setAttribute('aria-valuetext',Math.round(fraction*100)+' por ciento del recorrido');
    track.setAttribute('aria-controls',isRoot(el)?'appView':el.id||'appView');
  }
  function scrollToY(el,y,smooth=false){
    if(!el)return;
    const dest=Math.max(0,Math.min(range(el),y));
    if(isRoot(el))window.scrollTo({top:dest,behavior:smooth?'smooth':'instant'});
    else el.scrollTo({top:dest,behavior:smooth?'smooth':'instant'});
    schedule();
  }
  function step(sign){
    const el=readTarget();if(!el)return;
    scrollToY(el,top(el)+sign*Math.max(140,Math.round(el.clientHeight*.7)),true);
  }
  function moveAt(clientY){
    const el=readTarget();if(!el)return;
    const rect=track.getBoundingClientRect();
    const maxHandle=Math.max(0,rect.height-thumbHeight);
    const y=Math.max(0,Math.min(maxHandle,clientY-rect.top-thumbHeight/2));
    scrollToY(el,(maxHandle?y/maxHandle:0)*range(el));
  }
  up.addEventListener('click',()=>step(-1));
  down.addEventListener('click',()=>step(1));
  track.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    dragging=true;track.setPointerCapture(e.pointerId);
    moveAt(e.clientY);e.preventDefault();
  });
  track.addEventListener('pointermove',e=>{if(dragging){moveAt(e.clientY);e.preventDefault()}});
  const end=()=>{dragging=false;schedule()};
  track.addEventListener('pointerup',end);
  track.addEventListener('pointercancel',end);
  track.addEventListener('lostpointercapture',end);
  track.addEventListener('keydown',e=>{
    const el=readTarget();if(!el)return;
    let y=top(el);
    if(e.key==='ArrowDown')y+=60;
    else if(e.key==='ArrowUp')y-=60;
    else if(e.key==='PageDown')y+=el.clientHeight*.8;
    else if(e.key==='PageUp')y-=el.clientHeight*.8;
    else if(e.key==='Home')y=0;
    else if(e.key==='End')y=range(el);
    else return;
    e.preventDefault();scrollToY(el,y);
  });
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('fer-page',()=>{dragging=false;if(target&&!isRoot(target))target.removeEventListener('scroll',schedule);target=null;requestAnimationFrame(schedule)});
  // Mensajes y notas pueden cargar después de cambiar de pestaña.
  const observer=new MutationObserver(schedule);
  observer.observe(app,{attributes:true,attributeFilter:['class','data-current-page'],childList:true,subtree:true,characterData:false});
  observer.observe(document.body,{attributes:true,attributeFilter:['class']});
  if('ResizeObserver' in window){const ro=new ResizeObserver(schedule);ro.observe(app);ro.observe(document.documentElement);}
  schedule();
})();
