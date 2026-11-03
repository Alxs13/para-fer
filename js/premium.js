/* Life OS 9.2 · Saludo según la hora. No toca datos ni sesión. */
(()=>{'use strict';
const el=document.getElementById('homeGreeting');if(!el)return;
const paint=()=>{const h=new Date().getHours();
  el.textContent=h<6?'Buenas noches':h<13?'Buenos días':h<20?'Buenas tardes':'Buenas noches';};
paint();setInterval(paint,10*60*1000);
})();
