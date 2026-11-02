/* Fer & Alxs · PDF de recuerdos v4.3
   Portable PDF writer: no CDN, no external service, no uploads.
   A4 with JPEG photo XObjects and WinAnsi text (Spanish accents supported).
   The ZIP remains the restorable backup; this PDF is archival/printable. */
(function () {
  'use strict';
  const W = 595.28, H = 841.89;
  const palette = {
    wine:[0.235,0.047,0.115],wine2:[0.355,0.095,0.185],pink:[0.72,0.30,0.42],
    paper:[0.981,0.962,0.946],white:[1,1,1],pale:[0.957,0.911,0.901],
    gold:[0.78,0.60,0.42],ink:[0.29,0.12,0.17],muted:[0.47,0.33,0.35],line:[0.87,0.79,0.78]
  };
  const win1252 = {
    0x20ac:0x80,0x201a:0x82,0x0192:0x83,0x201e:0x84,0x2026:0x85,0x2020:0x86,
    0x2021:0x87,0x02c6:0x88,0x2030:0x89,0x0160:0x8a,0x2039:0x8b,0x0152:0x8c,
    0x017d:0x8e,0x2018:0x91,0x2019:0x92,0x201c:0x93,0x201d:0x94,0x2022:0x95,
    0x2013:0x96,0x2014:0x97,0x02dc:0x98,0x2122:0x99,0x0161:0x9a,0x203a:0x9b,
    0x0153:0x9c,0x017e:0x9e,0x0178:0x9f,0x2605:42,0x2665:42
  };
  const strBytes = str => {
    const a=[];
    for(const ch of String(str)) {
      const c=ch.codePointAt(0);
      if (c<=255) a.push(c);
      else if (win1252[c] !== undefined) a.push(win1252[c]);
      else {const normalized=ch.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const code=normalized.charCodeAt(0);a.push(code>31 && code<256 ? code : 63);
      }
    }
    return new Uint8Array(a);
  };
  const merge = chunks => {
    let total=0;for(const a of chunks)total+=a.length;
    const out=new Uint8Array(total);let off=0;
    for(const a of chunks){out.set(a,off);off+=a.length;}
    return out;
  };
  function printableText(str){
    let out='';
    const normalized = String(str ?? '').replace(/[♡♥❤💖💕💘💗💞❤️]/gu, '<3');
    for(const ch of normalized) {
      if(ch==='\\'||ch==='('||ch===')') out+='\\';
      if(ch==='\n'||ch==='\r'||ch==='\t') out+=' ';
      else out+=ch;
    }
    return out;
  }
  function c(color){return color.map(n=>Number(n).toFixed(3)).join(' ');}
  function fmt(n){return Number(n).toFixed(2);}
  function dateHuman(v){
    if(!v)return 'Sin fecha registrada';
    const d=new Date(/^\d{4}-\d\d-\d\d$/.test(v)?v+'T12:00:00':v);
    return Number.isNaN(+d)?String(v):new Intl.DateTimeFormat('es-CL',{day:'numeric',month:'long',year:'numeric'}).format(d);
  }
  const measureCanvas = document.createElement('canvas').getContext('2d');
  function widthOf(s,size,font='regular'){
    measureCanvas.font=`${font==='bold'?'700':'400'} 100px ${font==='serif'?'Georgia':'Arial'}`;
    return measureCanvas.measureText(s).width*size/100;
  }
  function linesOf(text,maxWidth,size,font){
    const paragraphs=String(text || '—').replace(/\r/g,'').split('\n');
    const out=[];
    for(const paragraph of paragraphs){
      const words=paragraph.split(/\s+/).filter(Boolean);
      if(!words.length){out.push('');continue;}
      let line='';
      for(let w of words){
        if(widthOf(w,size,font)>maxWidth){
          if(line){out.push(line);line='';}
          let partial='';
          for(const letter of w){
            if(partial && widthOf(partial+letter,size,font)>maxWidth){out.push(partial);partial=letter;}
            else partial+=letter;
          }
          line=partial;
          continue;
        }
        const attempt=line?`${line} ${w}`:w;
        if(line && widthOf(attempt,size,font)>maxWidth){out.push(line);line=w;}
        else line=attempt;
      }
      if(line)out.push(line);
    }
    return out;
  }
  class PagePaint {
    constructor(){this.ops=[];this.images=[];}
    cmd(s){this.ops.push(s);}
    rect(x,y,w,h,color){this.cmd(`${c(color)} rg ${fmt(x)} ${fmt(H-y-h)} ${fmt(w)} ${fmt(h)} re f`);}
    outline(x,y,w,h,color,width=1){this.cmd(`${c(color)} RG ${fmt(width)} w ${fmt(x)} ${fmt(H-y-h)} ${fmt(w)} ${fmt(h)} re S`);}
    line(x,y,x2,y2,color,width=1){this.cmd(`${c(color)} RG ${fmt(width)} w ${fmt(x)} ${fmt(H-y)} m ${fmt(x2)} ${fmt(H-y2)} l S`);}
    text(x,y,value,size=12,font='regular',color=palette.ink){
      const id=font==='bold'?'F2':font==='serif'?'F3':'F1';
      this.cmd(`${c(color)} rg BT /${id} ${fmt(size)} Tf 1 0 0 1 ${fmt(x)} ${fmt(H-y-size)} Tm (${printableText(value)}) Tj ET`);
    }
    wrap(x,y,content,width,size=11,font='regular',color=palette.ink,leading=1.37,maxLines=999){
      const lines=linesOf(content,width,size,font);
      for(let i=0;i<Math.min(lines.length,maxLines);i++){
        let t=lines[i];
        if(i===maxLines-1 && lines.length>maxLines){
          while(t.length && widthOf(t+'…',size,font)>width)t=t.slice(0,-1);
          t+='…';
        }
        this.text(x,y+i*size*leading,t,size,font,color);
      }
      return y+Math.min(maxLines,lines.length)*size*leading;
    }
    image(obj,w,h,x,y,boxW,boxH){
      const ratio=Math.min(boxW/w,boxH/h);
      const outW=w*ratio,outH=h*ratio;
      const posX=x+(boxW-outW)/2,posY=y+(boxH-outH)/2;
      const name=`Im${this.images.length+1}`;
      this.images.push({name,obj});
      this.cmd(`q ${fmt(outW)} 0 0 ${fmt(outH)} ${fmt(posX)} ${fmt(H-posY-outH)} cm /${name} Do Q`);
    }
    bytes(){return strBytes(this.ops.join('\n')+'\n');}
  }
  async function jpegFromBlob(blob){
    const objectUrl=URL.createObjectURL(blob);
    let im;
    try{
      im=new Image();
      await new Promise((resolve,reject)=>{
        im.onload=resolve; im.onerror=()=>reject(new Error('La imagen del álbum no se puede abrir.'));
        im.src=objectUrl;
      });
      const maxSide=1700,scale=Math.min(1,maxSide/Math.max(im.naturalWidth,im.naturalHeight));
      const w=Math.max(1,Math.round(im.naturalWidth*scale));
      const h=Math.max(1,Math.round(im.naturalHeight*scale));
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d',{alpha:false});
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);ctx.drawImage(im,0,0,w,h);
      const jpg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.84));
      canvas.width=1;canvas.height=1;
      if(!jpg||!jpg.size)throw new Error('No se pudo preparar la imagen para el PDF.');
      return {w,h,bytes:new Uint8Array(await jpg.arrayBuffer())};
    }finally{URL.revokeObjectURL(objectUrl);}
  }
  function frame(p,index,total){
    p.rect(0,0,W,H,palette.paper);
    p.rect(0,0,W,77,palette.wine);
    p.rect(0,76,W,3,palette.gold);
    p.text(42,24,'FER  &  ALXS',20,'serif',palette.white);
    p.text(42,51,'NUESTRO UNIVERSO DE DOS',8,'bold',palette.pale);
    p.text(440,36,'ARCHIVO PRIVADO',8,'regular',palette.pale);
    p.line(42,797,553,797,palette.line,.8);
    p.text(42,806,'Una historia que merece quedarse.',9,'serif',palette.muted);
    p.text(504,806,`${index} / ${total}`,9,'regular',palette.muted);
  }
  function photoPaint(row, jpg, number, pageNum,total){
    const p=new PagePaint();frame(p,pageNum,total);
    p.text(42,92,`RECUERDO  ${String(number).padStart(3,'0')}`,9,'bold',palette.pink);
    p.wrap(42,111,row.title||'Un momento nuestro',508,24,'serif',palette.wine,1.17,2);
    p.rect(42,169,345,430,palette.pale);
    p.outline(42,169,345,430,palette.line,1);
    p.image(jpg.obj,jpg.w,jpg.h,52,179,325,410);
    p.rect(401,169,151,430,palette.white);
    p.outline(401,169,151,430,palette.line,.7);
    p.text(415,183,'CUÁNDO',9,'bold',palette.pink);
    p.wrap(415,203,dateHuman(row.event_date),120,11,'regular',palette.ink,1.3,3);
    p.line(415,255,537,255,palette.line,.7);
    p.text(415,265,'DÓNDE',9,'bold',palette.pink);
    p.wrap(415,286,row.location||'Sin lugar indicado',120,10.5,'regular',palette.ink,1.25,7);
    p.line(415,365,537,365,palette.line,.7);
    p.text(415,375,'LA HISTORIA',9,'bold',palette.pink);
    p.wrap(415,394,row.back_note||'Todavía no escribimos la historia de este día.',120,9.4,'regular',palette.ink,1.25,17);
    p.rect(42,612,345,154,palette.pale);
    p.text(58,627,'MENSAJE PARA MI AMOR',9,'bold',palette.pink);
    p.wrap(58,652,row.bubble_text||'Un instante que guardamos en nuestro corazón.',311,12.3,'serif',palette.ink,1.34,7);
    p.rect(401,612,151,154,palette.wine2);
    p.text(416,627,'PARA NO OLVIDAR',8.5,'bold',palette.pale);
    p.wrap(416,651,row.reminder||'Guardar este instante.',120,9.6,'regular',palette.white,1.25,9);
    return p;
  }
  function needExtraPage(row){
    return [
      [row.title||'Un momento nuestro',508,24,'serif',2],
      [row.location||'Sin lugar indicado',120,10.5,'regular',7],
      [row.back_note||'Todavía no escribimos la historia de este día.',120,9.4,'regular',17],
      [row.reminder||'Guardar este instante.',120,9.6,'regular',9],
      [row.bubble_text||'Un instante nuestro.',311,12.3,'serif',7]
    ].some(([value,width,size,font,max])=>linesOf(value,width,size,font).length>max);
  }
  function detailsPaint(row,pageNum,total){
    const p=new PagePaint();frame(p,pageNum,total);
    p.text(42,100,'CONTINUACIÓN DEL RECUERDO',10,'bold',palette.pink);
    p.wrap(42,131,row.title||'Un momento nuestro',508,24,'serif',palette.wine,1.15,3);
    let y=235;
    for(const [heading,value] of [
      ['FECHA Y LUGAR',`${dateHuman(row.event_date)} · ${row.location||'Sin lugar indicado'}`],
      ['MENSAJE',row.bubble_text||'Sin mensaje'],
      ['NUESTRA HISTORIA',row.back_note||'Sin nota'],
      ['PARA NO OLVIDAR',row.reminder||'Sin recordatorio']
    ]){
      p.text(42,y,heading,10,'bold',palette.pink);
      y=p.wrap(42,y+21,value,502,12,'regular',palette.ink,1.36,22)+27;
      p.line(42,y-16,553,y-16,palette.line,.7);
    }
    return p;
  }
  function messagePaint(row,n,pageNum,total){
    const p=new PagePaint();frame(p,pageNum,total);
    const reminder=row.type==='reminder';
    p.text(42,107,reminder?'RECORDATORIO':'MENSAJE',11,'bold',palette.pink);
    p.text(42,138,reminder?'Para volver a encontrarnos.':'Palabras que también son recuerdos.',24,'serif',palette.wine);
    p.rect(42,216,510,414,palette.white);
    p.outline(42,216,510,414,palette.line,1);
    p.rect(42,216,9,414,palette.wine2);
    p.text(70,245,'CARTA ENTRE DOS',10,'bold',palette.pink);
    p.wrap(70,290,row.content||'Sin contenido',447,14,'serif',palette.ink,1.42,14);
    p.text(70,579,`Escrito por ${row.original_author_name||row.author||'Mi amor'}`,11,'regular',palette.muted);
    p.rect(42,651,510,89,palette.pale);
    p.text(60,666,reminder?'FECHA DEL RECORDATORIO':'FECHA DE LA NOTA',9,'bold',palette.pink);
    p.text(60,693,dateHuman(reminder ? row.due_date : row.created_at),13,'serif',palette.wine);
    return p;
  }
  function coverPaint(countPhotos,countNotes,exported,total){
    const p=new PagePaint();p.rect(0,0,W,H,palette.wine);
    p.rect(25,25,W-50,H-50,palette.wine2);p.outline(37,37,W-74,H-74,palette.gold,.7);
    p.line(65,157,530,157,palette.gold,.6);
    p.text(68,105,'FER  &  ALXS',26,'serif',palette.white);
    p.text(68,192,'ARCHIVO DE NUESTRA HISTORIA',10,'bold',palette.pale);
    p.text(66,260,'Donde cada recuerdo',36,'serif',palette.white);
    p.text(66,309,'vuelve a vivir.',36,'serif',palette.white);
    p.rect(66,410,463,186,palette.paper);
    p.text(86,440,'NUESTRO LIBRO DE RECUERDOS',11,'bold',palette.pink);
    p.text(86,483,`${countPhotos} ${countPhotos===1 ? 'fotografía':'fotografías'}`,24,'serif',palette.wine);
    p.text(86,518,`${countNotes} ${countNotes===1 ? 'mensaje o recordatorio':'mensajes y recordatorios'}`,15,'regular',palette.ink);
    p.line(66,667,529,667,palette.gold,.6);
    p.text(66,696,`Creado el ${dateHuman(exported)}`,12,'regular',palette.pale);
    p.wrap(66,729,'Copia privada para leer o imprimir. Para restaurar el álbum en la web, conserva también su respaldo ZIP.',452,10,'regular',palette.pale,1.45,4);
    p.text(500,793,`1 / ${total}`,9,'regular',palette.pale);
    return p;
  }
  function pdfObjStream(dict,stream){return {dict,stream};}
  async function create({photos=[],notes=[],loadPhoto,progress=()=>{}}={}){
    if(typeof loadPhoto!=='function')throw new Error('No se proporcionó la lectura privada de fotografías.');
    const objects=[];
    const add=obj=>{objects.push(obj);return objects.length;};
    const reserve=()=>add('');
    const pageTree=reserve(), catalog=reserve();
    const f1=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const f3=add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');
    const pages=[];const allPages=1+photos.length+photos.filter(needExtraPage).length+notes.length;
    function addPaint(p){
      const content=p.bytes();
      const contentObj=add(pdfObjStream(`/Length ${content.length}`,content));
      const imgs=p.images.map(img=>`/${img.name} ${img.obj} 0 R`).join(' ');
      const page=add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${fmt(W)} ${fmt(H)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> /XObject << ${imgs} >> >> /Contents ${contentObj} 0 R >>`);
      pages.push(page);
    }
    addPaint(coverPaint(photos.length,notes.length,new Date(),allPages));
    for(let i=0;i<photos.length;i++){
      progress(`Preparando imagen ${i+1} de ${photos.length} para PDF…`,(i+1)/(photos.length+notes.length+1));
      const blob=await loadPhoto(photos[i]);
      if(!blob)throw new Error(`No se pudo obtener la foto ${i+1}. El PDF no se ha generado.`);
      const jpg=await jpegFromBlob(blob);
      const imgObj=add(pdfObjStream(`/Type /XObject /Subtype /Image /Width ${jpg.w} /Height ${jpg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.bytes.length}`,jpg.bytes));
      addPaint(photoPaint(photos[i],{obj:imgObj,w:jpg.w,h:jpg.h},i+1,pages.length+1,allPages));
      if(needExtraPage(photos[i]))addPaint(detailsPaint(photos[i],pages.length+1,allPages));
    }
    for(let i=0;i<notes.length;i++){
      progress(`Agregando nota ${i+1} de ${notes.length}…`,(photos.length+i+1)/(photos.length+notes.length+1));
      addPaint(messagePaint(notes[i],i+1,pages.length+1,allPages));
    }
    objects[pageTree-1]=`<< /Type /Pages /Kids [${pages.map(p=>p+' 0 R').join(' ')}] /Count ${pages.length} >>`;
    objects[catalog-1]=`<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
    const parts=[], offsets=[0];let bytesCount=0;
    const push=chunk=>{const a=typeof chunk==='string'?strBytes(chunk):chunk;parts.push(a);bytesCount+=a.length;};
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    for(let i=0;i<objects.length;i++){
      offsets.push(bytesCount);push(`${i+1} 0 obj\n`);
      const body=objects[i];
      if(typeof body==='string')push(body);
      else {push(`<< ${body.dict} >>\nstream\n`);push(body.stream);push('\nendstream');}
      push('\nendobj\n');
    }
    const xrefOffset=bytesCount;
    push(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`);
    for(let i=1;i<offsets.length;i++)push(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
    push(`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
    progress('PDF preparado para guardar.',1);
    return new Blob(parts,{type:'application/pdf'});
  }
  window.FerPDF={create};
})();
