(() => {
  const cfg = window.COUPLE_CONFIG || {};
  const ready = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('PEGA_AQUI') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('PEGA_AQUI');
  const BUCKET = cfg.BUCKET || 'fer-alxs';

  const $ = id => document.getElementById(id);
  const show = el => el.classList.remove('hidden');
  const hide = el => el.classList.add('hidden');
  const fmtDate = value => {
    if (!value) return 'Sin fecha';
    const d = new Date(value + 'T12:00:00');
    return Number.isNaN(+d) ? value : new Intl.DateTimeFormat('es-CL', { day:'numeric', month:'long', year:'numeric' }).format(d);
  };
  const fmtCreated = value => new Intl.DateTimeFormat('es-CL', { day:'numeric', month:'short', year:'numeric' }).format(new Date(value));
  const text = (el, value, ok = false) => {
    el.textContent = value || '';
    el.style.color = ok ? '#d7f5dd' : '';
    if (el.id === 'statusMsg') {
      const target = document.getElementById('uploadStatus');
      if (target) {target.textContent = value || '';target.style.color = ok ? '#d7f5dd' : ''; }
    }
  };
  const safe = value => (value || '').trim();
  const cut = (value, max) => safe(value).slice(0, max);
  const escapeHtml = s => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const loginView = $('loginView');
  const appView = $('appView');
  const cloudWarning = $('cloudWarning');
  const loginMsg = $('loginMsg');
  const statusMsg = $('statusMsg');
  const preview = $('preview');
  const photoInput = $('photoInput');
  const dropzone = $('dropzone');

  if (!ready || !window.supabase) {
    cloudWarning.textContent = !ready
      ? 'Esta copia aún no tiene la URL y la clave pública en config.js.'
      : 'No se pudo cargar la librería de Supabase. Revisa la conexión, desactiva bloqueadores y vuelve a abrir la página.';
    show(cloudWarning);
    show(loginView);
    return;
  }

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  let activeUser = null;
  let members = [];
  let photos = [];
  let currentFilter = 'all';
  let offset = 0;
  const PAGE = 30;
  let hasMore = false;
  let busy = false;
  let sub = null;
  let notes = [];
  let notesSub = null;

  const friendly = err => {
    const msg = String(err?.message || err || 'Error inesperado.');
    if (/Invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
    if (/Email not confirmed/i.test(msg)) return 'El correo todavía no está confirmado.';
    if (/row-level security/i.test(msg) || /permission denied/i.test(msg)) return 'Esta cuenta no está autorizada para el álbum.';
    return msg;
  };

  const memberName = userId => members.find(m => m.user_id === userId)?.display_name || 'Mi amor';
  const isMine = item => item.user_id === activeUser?.id;
  const authorName = item => item.original_author_name || memberName(item.user_id);

  async function loadMembers() {
    const { data, error } = await sb.from('couple_members').select('user_id,display_name').order('display_name');
    if (error) throw error;
    members = data || [];
    $('memberNames').textContent = members.map(m => m.display_name).join(' · ') || 'Álbum de pareja';
  }

  async function verifyAccess(user) {
    activeUser = user;
    try {
      await loadMembers();
      const allowed = members.some(m => m.user_id === user.id);
      if (!allowed) throw new Error('Esta cuenta no está autorizada para el álbum.');
      $('welcomeTitle').textContent = `Hola, ${memberName(user.id)} ♡`;
      hide(loginView);
      show(appView);
      await Promise.all([loadPhotos(true), loadNotes()]);
      goPage('home');
      subscribeRealtime();
    } catch (err) {
      await sb.auth.signOut().catch(() => {});
      activeUser = null;
      hide(appView);
      show(loginView);
      text(loginMsg, friendly(err));
    }
  }

  sb.auth.getSession().then(async ({ data }) => {
    if (data?.session?.user && activeUser?.id !== data.session.user.id) await verifyAccess(data.session.user);
    else show(loginView);
  });

  sb.auth.onAuthStateChange(async (_evt, session) => {
    const user = session?.user || null;
    if (!user) {
      activeUser = null;
      photos = [];
      hide(appView);
      show(loginView);
      if (sub) { sb.removeChannel(sub); sub = null; }
      if (notesSub) { sb.removeChannel(notesSub); notesSub = null; }
      hide($('uploadOverlay'));
      return;
    }
    if (activeUser?.id !== user.id || appView.classList.contains('hidden')) await verifyAccess(user);
  });

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('loginBtn').disabled = true;
    text(loginMsg, 'Entrando…');
    try {
      const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
      if (error) throw error;
      $('password').value = '';
    } catch (err) {
      text(loginMsg, friendly(err));
    } finally {
      $('loginBtn').disabled = false;
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut().catch(console.warn);
    text(loginMsg, 'Sesión cerrada.', true);
  });

  function subscribeRealtime() {
    if (sub) return;
    sub = sb.channel('couple-photos-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_photos' }, () => {
        if (activeUser && !busy) loadPhotos(true).catch(console.warn);
      }).subscribe();
    notesSub = sb.channel('couple-notes-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_notes' }, () => {
        if (activeUser && !busy) loadNotes().catch(console.warn);
      }).subscribe();
  }

  function lightbox(item) {
    $('lightboxImg').src = item.signedUrl || '';
    $('lightboxTitle').textContent = item.title || 'Recuerdo';
    const parts = [item.bubble_text, item.location ? `Lugar: ${item.location}` : '', item.event_date ? `Fecha: ${fmtDate(item.event_date)}` : '', `Subido por ${authorName(item)}`].filter(Boolean);
    $('lightboxDesc').textContent = parts.join(' · ');
    show($('lightbox'));
    $('lightbox').setAttribute('aria-hidden', 'false');
  }
  $('lightboxClose').addEventListener('click', () => { hide($('lightbox')); $('lightbox').setAttribute('aria-hidden', 'true'); });
  $('lightbox').addEventListener('click', e => { if (e.target === $('lightbox')) $('lightboxClose').click(); });

  let activeCard = 0;
  let isLoadingPage = false;
  let filteredPhotos = [];
  let page = 'home';
  const sectionNames = ['home','cards','binder','notes','backup'];

  function goPage(name) {
    if (!sectionNames.includes(name)) name = 'home';
    page = name;
    appView.dataset.currentPage=name;
    document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.dataset.page === name));
    document.querySelectorAll('.bottom-nav button[data-go]').forEach(el => {
      const on = el.dataset.go === name;
      el.classList.toggle('active',on);
      if(on) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (name === 'cards') scrollToCard(activeCard, false);
  }
  document.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => goPage(btn.dataset.go)));
  $('homeOpenCards').addEventListener('click', () => goPage('cards'));
  const uploadOverlay = $('uploadOverlay');
  function openUpload() {
    show(uploadOverlay);
    uploadOverlay.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
    $('memoryTitle').focus({preventScroll:true});
  }
  function closeUpload() {
    if(busy) return;
    hide(uploadOverlay);
    uploadOverlay.setAttribute('aria-hidden','true');
    document.body.style.overflow='';
  }
  ['fabAdd','homeAddPhoto','binderAdd'].forEach(id => $(id).addEventListener('click',openUpload));
  $('closeUpload').addEventListener('click',closeUpload);
  document.querySelector('[data-close="upload"]').addEventListener('click',closeUpload);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {closeUpload();$('lightboxClose').click();}
    else if(page==='cards' && !e.target.matches('input,textarea,select')) {
      if(e.key==='ArrowLeft') scrollToCard(activeCard-1);
      if(e.key==='ArrowRight') scrollToCard(activeCard+1);
    }
  });

  const surpriseOverlay = $('surpriseOverlay');
  $('openSurprise').addEventListener('click', () => {
    if (!photos.length) {openUpload(); return;}
    show(surpriseOverlay);
    surpriseOverlay.querySelector('.surprise-panel').classList.remove('revealing');
    $('revealSurprise').disabled=false;
  });
  $('closeSurprise').addEventListener('click',()=>hide(surpriseOverlay));
  $('revealSurprise').addEventListener('click',()=>{
    if (!photos.length) return;
    $('revealSurprise').disabled=true;
    surpriseOverlay.querySelector('.surprise-panel').classList.add('revealing');
    const selected = photos[Math.floor(Math.random()*photos.length)];
    setTimeout(()=>{
      hide(surpriseOverlay);
      currentFilter='all';
      $('filters').querySelectorAll('button').forEach(b=>{const on=b.dataset.filter==='all';b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
      renderPhotos();
      activeCard=Math.max(0,filteredPhotos.findIndex(p=>p.id===selected.id));
      goPage('cards');
      scrollToCard(activeCard);
    },650);
  });

  function memoryCard(item) {
    const title = item.title || 'Recuerdo sin título';
    const bubble = item.bubble_text || 'Un momento que guardamos para siempre. ♡';
    const note = item.back_note || 'Aún sin una historia escrita.';
    const reminder = item.reminder || 'Un recuerdo para atesorar.';
    const where = item.location || 'Nuestro lugar secreto';
    const when = item.event_date ? fmtDate(item.event_date) : 'Sin fecha indicada';
    const card = document.createElement('article');
    card.className = 'memory-card';
    card.tabIndex = 0;
    card.setAttribute('aria-label',`Carta ${title}. Toca para girar.`);
    card.innerHTML = `
      <div class="memory-card-inner">
        <div class="memory-side memory-front">
          <div class="photo-frame">
            ${item.signedUrl ? `<img src="${escapeHtml(item.signedUrl)}" alt="${escapeHtml(title)}" loading="lazy"/>` : '<span class="empty-heart">♡</span>'}
            <div class="memory-topbar"><span class="author-pill">✦ ${escapeHtml(authorName(item))}</span><span class="date-pill">Nº ${String(filteredPhotos.indexOf(item) + 1).padStart(3,'0')}</span></div>
            <div class="bubble-wrap"><span class="bubble">${escapeHtml(bubble)}</span></div>
          </div>
          <div class="memory-content"><h4 class="memory-title">${escapeHtml(title)}</h4><p class="memory-snippet">${escapeHtml(when)} · ${escapeHtml(where)}</p>
            <div class="card-actions"><button type="button" class="small-btn" data-action="flip">↻ Girar carta</button><button type="button" class="small-btn" data-action="zoom">Ampliar foto</button>${isMine(item) ? '<button type="button" class="small-btn danger" data-action="delete">Eliminar</button>' : ''}</div>
          </div>
        </div>
        <div class="memory-side memory-back"><div class="back-body"><h4>${escapeHtml(title)}</h4><div class="meta-list">
          <div class="meta-item"><b>Cuándo fue</b><span>${escapeHtml(when)}</span></div>
          <div class="meta-item"><b>Dónde estuvimos</b><span>${escapeHtml(where)}</span></div>
          <div class="meta-item"><b>Nuestra historia</b><span>${escapeHtml(note)}</span></div>
          <div class="meta-item"><b>Para no olvidar</b><span>${escapeHtml(reminder)}</span></div>
          </div><div class="back-footer"><button type="button" class="small-btn" data-action="flip">↻ Volver</button><button type="button" class="small-btn" data-action="zoom">Foto</button>${isMine(item) ? '<button type="button" class="small-btn danger" data-action="delete">Eliminar</button>' : ''}</div></div></div>
      </div>`;
    let pointerX=0;
    card.addEventListener('pointerdown',e=>{pointerX=e.clientX;},{passive:true});
    card.addEventListener('click',e=>{
      if(e.target.closest('button')) return;
      if(Math.abs(e.clientX-pointerX)>10) return;
      card.classList.toggle('is-flipped');
    });
    card.addEventListener('keydown',e=>{
      if(e.target===card && (e.key==='Enter'||e.key===' ')) {e.preventDefault();card.classList.toggle('is-flipped');}
    });
    card.querySelectorAll('[data-action="flip"]').forEach(btn=>btn.addEventListener('click',()=>card.classList.toggle('is-flipped')));
    card.querySelectorAll('[data-action="zoom"]').forEach(btn=>btn.addEventListener('click',()=>lightbox(item)));
    card.querySelectorAll('[data-action="delete"]').forEach(btn=>btn.addEventListener('click',()=>removePhoto(item)));
    return card;
  }

  function scrollToCard(index, animate = true) {
    if (!filteredPhotos.length) return;
    activeCard = Math.max(0, Math.min(index, filteredPhotos.length-1));
    const cards = $('cardGrid').querySelectorAll('.memory-card');
    const card = cards[activeCard];
    if(card) {
      const track=$('cardGrid');
      const left=card.offsetLeft-track.offsetLeft-(track.clientWidth-card.offsetWidth)/2;
      track.scrollTo({left:Math.max(0,left),behavior:animate?'smooth':'instant'});
    }
    updatePager();
  }
  function updatePager() {
    const n = filteredPhotos.length;
    $('activeCardNum').textContent = n ? String(activeCard+1) : '0';
    $('photoCount').textContent = String(n);
    $('prevCard').disabled = !n || activeCard === 0;
    $('nextCard').disabled = !n || (activeCard===n-1 && !hasMore);
    const dots=$('cardDots');dots.replaceChildren();
    if(n>1) for(let i=0;i<Math.min(n,9);i++) {
      const dot=document.createElement('i');dot.className=(Math.round(activeCard/Math.max(n-1,1)*Math.min(n-1,8))===i?'active':'');dots.appendChild(dot);
    }
    if(n && activeCard >= n-3 && hasMore && !isLoadingPage) loadPhotos(false).catch(console.warn);
  }
  $('prevCard').addEventListener('click',()=>scrollToCard(activeCard-1));
  $('nextCard').addEventListener('click',()=>{
    if(activeCard===filteredPhotos.length-1 && hasMore) loadPhotos(false).then(()=>scrollToCard(activeCard+1));
    else scrollToCard(activeCard+1);
  });
  let scrollFrame=0;
  $('cardGrid').addEventListener('scroll',()=>{
    cancelAnimationFrame(scrollFrame);
    scrollFrame=requestAnimationFrame(()=>{
      const cards=[...$('cardGrid').querySelectorAll('.memory-card')];
      if(!cards.length)return;
      const center=$('cardGrid').getBoundingClientRect().left+$('cardGrid').clientWidth/2;
      let best=0, dist=Infinity;
      cards.forEach((el,i)=>{const r=el.getBoundingClientRect();const d=Math.abs(r.left+r.width/2-center);if(d<dist){dist=d;best=i;}});
      if(best!==activeCard){activeCard=best;updatePager();}
    });
  },{passive:true});

  function renderPhotos() {
    const track=$('cardGrid'),binder=$('collectionGrid');
    const beforeId=filteredPhotos[activeCard]?.id;
    filteredPhotos=photos.filter(item=>currentFilter==='all'||(currentFilter==='mine'&&isMine(item))||(currentFilter==='theirs'&&!isMine(item)));
    track.replaceChildren();binder.replaceChildren();
    if(!filteredPhotos.length){
      const empty=document.createElement('div');empty.className='empty-deck';
      empty.innerHTML='<span class="empty-heart">♡</span><h3>Tu historia empieza aquí</h3><p>La primera foto se convertirá en una carta para compartir entre los dos.</p><button type="button">＋ Crear primera carta</button>';
      empty.querySelector('button').addEventListener('click',openUpload);track.appendChild(empty);
      const be=document.createElement('div');be.className='binder-empty';be.textContent='Todavía no hay cartas. Crea la primera desde el botón +.';binder.appendChild(be);
    } else filteredPhotos.forEach((item,i)=>{
      track.appendChild(memoryCard(item));
      const cell=document.createElement('button');cell.className='binder-item';cell.type='button';
      cell.innerHTML=`<span class="binder-art">${item.signedUrl?`<img src="${escapeHtml(item.signedUrl)}" alt="" loading="lazy">`:'♡'}</span><b>${escapeHtml(item.title||'Nuestro recuerdo')}</b><small>${escapeHtml(item.location||'Nuestra historia')} · ${String(i+1).padStart(3,'0')}</small>`;
      cell.addEventListener('click',()=>{activeCard=i;goPage('cards');scrollToCard(i);});
      binder.appendChild(cell);
    });
    $('countText').textContent=filteredPhotos.length===1?'1 carta de nuestra historia':`${filteredPhotos.length}${hasMore?'+':''} cartas en nuestra colección`;
    $('binderCount').textContent=`${photos.length}${hasMore?'+':''} recuerdos guardados`;
    hasMore?show($('loadMoreBtn')):hide($('loadMoreBtn'));
    hasMore?show($('binderLoadMore')):hide($('binderLoadMore'));
    activeCard=Math.max(0,filteredPhotos.findIndex(p=>p.id===beforeId));
    updatePager();
    if(beforeId) requestAnimationFrame(()=>scrollToCard(activeCard,false));
    const first=photos[0];
    $('featuredTitle').textContent=first?.title||'Aquí comienza nuestra historia';
    $('featuredSubtitle').textContent=first ? `${first.location||'Nuestro lugar'} · ${first.event_date?fmtDate(first.event_date):'Siempre nosotros'}` : 'Agrega la primera fotografía para llenar este espacio de recuerdos.';
    const featured=$('featuredImage');featured.querySelectorAll('img').forEach(img=>img.remove());
    if(first?.signedUrl){const image=document.createElement('img');image.src=first.signedUrl;image.alt='Último recuerdo';featured.appendChild(image);}
  }

  async function loadPhotos(reset = false) {
    if (!activeUser || isLoadingPage) return;
    isLoadingPage = true;
    if (reset) {
      offset = 0;
      photos = [];
      $('cardGrid').innerHTML = '<div class="empty-state panel"><p>Cargando recuerdos…</p></div>';
    }
    const { data, error } = await sb.from('couple_photos')
      .select('id,user_id,storage_path,title,bubble_text,back_note,location,event_date,reminder,created_at,original_author_name,backup_source_id')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) {
      isLoadingPage = false;
      text(statusMsg, `No se pudieron cargar las cartas: ${friendly(error)}`);
      return;
    }
    const rows = data || [];
    let signed = [];
    if (rows.length) {
      const { data: links, error: signErr } = await sb.storage.from(BUCKET).createSignedUrls(rows.map(r => r.storage_path), 60 * 60);
      if (signErr) text(statusMsg, `No se pudo firmar alguna imagen: ${friendly(signErr)}`);
      signed = links || [];
    }
    const page = rows.map((row, i) => ({ ...row, signedUrl: signed[i]?.signedUrl || null }));
    photos = reset ? page : photos.concat(page);
    offset += rows.length;
    hasMore = rows.length === PAGE;
    isLoadingPage = false;
    renderPhotos();
  }

  $('binderLoadMore').addEventListener('click', () => loadPhotos(false).catch(console.warn));
  $('loadMoreBtn').addEventListener('click', () => loadPhotos(false).catch(console.warn));
  $('filters').addEventListener('click', e => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    [...$('filters').querySelectorAll('button')].forEach(b => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    renderPhotos();
  });

  function clearPreview() {
    preview.innerHTML = '';
    hide(preview);
  }
  function renderPreview() {
    const files = [...photoInput.files];
    if (!files.length) { $('uploadBtn').disabled = true; return clearPreview(); }
    show(preview);
    preview.innerHTML = '';
    files.slice(0, 8).forEach(file => {
      const url = URL.createObjectURL(file);
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Vista previa';
      img.onload = () => URL.revokeObjectURL(url);
      preview.appendChild(img);
    });
    const count = document.createElement('div');
    count.className = 'preview-count';
    count.textContent = `${files.length} ${files.length === 1 ? 'foto seleccionada' : 'fotos seleccionadas'}`;
    preview.appendChild(count);
    $('uploadBtn').disabled = false;
  }
  photoInput.addEventListener('change', renderPreview);
  ['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', e => {
    if (e.dataTransfer?.files?.length) {
      photoInput.files = e.dataTransfer.files;
      renderPreview();
    }
  });

  async function optimizedImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('Selecciona imágenes válidas.');
    if (file.size > 25 * 1024 * 1024) throw new Error('La foto original supera los 25 MB.');
    if (file.type === 'image/gif' && file.size <= 8 * 1024 * 1024) return { body: file, ext: 'gif', mime: 'image/gif' };

    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('No se pudo abrir la imagen.'));
        img.src = url;
      });
      const max = 2000;
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d', { alpha: false }).drawImage(img, 0, 0, canvas.width, canvas.height);
      let mime = 'image/webp';
      let blob = await new Promise(resolve => canvas.toBlob(resolve, mime, .84));
      if (!blob) {
        mime = 'image/jpeg';
        blob = await new Promise(resolve => canvas.toBlob(resolve, mime, .86));
      }
      if (!blob || blob.size > 8 * 1024 * 1024) throw new Error('La imagen optimizada todavía es demasiado grande.');
      return { body: blob, ext: mime === 'image/webp' ? 'webp' : 'jpg', mime };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function setProgress(index, total) {
    show($('progressBox'));
    $('progressText').textContent = `Guardando foto ${index} de ${total}…`;
    $('progressBar').style.width = `${Math.round(((index - 1) / total) * 100)}%`;
  }

  $('uploadForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!activeUser || busy) return;
    const files = [...photoInput.files];
    if (!files.length) return text(statusMsg, 'Selecciona al menos una foto.');
    if (files.length > 8) return text(statusMsg, 'Puedes subir hasta 8 fotos por vez.');

    const title = cut($('memoryTitle').value, 80);
    const bubbleText = cut($('bubbleText').value, 180);
    const backNote = cut($('backNote').value, 240);
    const eventDate = $('eventDate').value || null;
    const location = cut($('location').value, 90);
    const reminder = cut($('reminder').value, 140);

    busy = true;
    $('uploadBtn').disabled = true;
    $('logoutBtn').disabled = true;
    text(statusMsg, 'Preparando sus recuerdos…');

    try {
      let done = 0;
      for (const file of files) {
        done += 1;
        setProgress(done, files.length);
        const optimized = await optimizedImage(file);
        const path = `${activeUser.id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${optimized.ext}`;
        const { error: uploadErr } = await sb.storage.from(BUCKET).upload(path, optimized.body, {
          upsert: false,
          contentType: optimized.mime,
          cacheControl: '3600'
        });
        if (uploadErr) throw uploadErr;

        const { error: dbErr } = await sb.from('couple_photos').insert({
          user_id: activeUser.id,
          storage_path: path,
          title,
          bubble_text: bubbleText,
          back_note: backNote,
          event_date: eventDate,
          location,
          reminder
        });
        if (dbErr) {
          await sb.storage.from(BUCKET).remove([path]).catch(() => {});
          throw dbErr;
        }
      }
      $('uploadForm').reset();
      clearPreview();
      hide($('progressBox'));
      $('progressBar').style.width = '100%';
      text(statusMsg, files.length === 1 ? 'Foto guardada en su álbum. ♡' : 'Fotos guardadas en su álbum. ♡', true);
      await loadPhotos(true);
      hide(uploadOverlay);
      uploadOverlay.setAttribute('aria-hidden','true');
      document.body.style.overflow='';
      goPage('cards');
    } catch (err) {
      hide($('progressBox'));
      text(statusMsg, friendly(err));
    } finally {
      busy = false;
      $('uploadBtn').disabled = !photoInput.files.length;
      $('logoutBtn').disabled = false;
    }
  });

  async function removePhoto(item) {
    if (!isMine(item)) return;
    if (!window.confirm('¿Eliminar esta tarjeta de tu álbum?')) return;
    try {
      const { error: dbErr } = await sb.from('couple_photos').delete().eq('id', item.id).eq('user_id', activeUser.id);
      if (dbErr) throw dbErr;
      await sb.storage.from(BUCKET).remove([item.storage_path]).catch(() => {});
      text(statusMsg, 'Tu foto fue eliminada.', true);
      await loadPhotos(true);
    } catch (err) {
      text(statusMsg, friendly(err));
    }
  }


  // ─── TABLERO DE MENSAJITOS ─────────────────────────────────────────────
  function createNote(item) {
    const card = document.createElement('article');
    card.className = 'note-card ' + (item.type === 'reminder' ? 'reminder' : 'message');
    const kind = document.createElement('span');
    kind.className = 'note-kind';
    kind.textContent = item.type === 'reminder' ? 'Recordatorio ♡' : 'Un mensajito para ti';
    const body = document.createElement('p');
    body.className = 'note-body';
    body.textContent = item.content;
    card.append(kind, body);
    if (item.due_date) {
      const date = document.createElement('span');
      date.className = 'note-date';
      date.textContent = `Para el ${fmtDate(item.due_date)}`;
      card.appendChild(date);
    }
    const foot = document.createElement('div');
    foot.className = 'note-meta';
    const who = document.createElement('span');
    who.textContent = `${authorName(item)} · ${fmtCreated(item.created_at)}`;
    foot.appendChild(who);
    card.appendChild(foot);
    if (item.user_id === activeUser?.id) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'note-delete';
      del.textContent = 'Eliminar mi nota';
      del.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta nota?')) return;
        const { error } = await sb.from('couple_notes').delete().eq('id', item.id).eq('user_id', activeUser.id);
        if (error) text($('noteStatus'), friendly(error));
        else { text($('noteStatus'), 'Nota eliminada.', true); await loadNotes(); }
      });
      card.appendChild(del);
    }
    return card;
  }

  async function loadNotes() {
    if (!activeUser) return;
    const { data, error } = await sb.from('couple_notes')
      .select('id,user_id,type,content,due_date,created_at,original_author_name,backup_source_id')
      .order('created_at', { ascending:false }).limit(50);
    if (error) {
      text($('noteStatus'), `No se pudieron cargar los mensajitos: ${friendly(error)}`);
      return;
    }
    notes = data || [];
    const preview = $('homeNotePreview');
    if (notes.length) {
      preview.querySelector('p').textContent = notes[0].content;
      preview.querySelector('span').textContent = notes[0].type === 'reminder' ? '⌑' : '✉';
    } else {
      preview.querySelector('p').textContent = 'Deja un mensaje y aparecerá aquí.';
    }
    const grid = $('notesGrid');
    grid.replaceChildren();
    if (!notes.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-notes';
      empty.textContent = 'Aún no hay mensajitos. Deja el primero para tu amor.';
      grid.appendChild(empty);
    } else notes.forEach(row => grid.appendChild(createNote(row)));
  }

  $('noteType').addEventListener('change', () => {
    $('noteType').value === 'reminder' ? show($('noteDateLabel')) : hide($('noteDateLabel'));
    $('noteSaveBtn').textContent = $('noteType').value === 'reminder' ? 'Guardar recordatorio' : 'Guardar mensajito';
  });
  $('noteForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!activeUser || busy) return;
    const content = cut($('noteContent').value, 500);
    if (!content) return;
    const type = $('noteType').value === 'reminder' ? 'reminder' : 'message';
    $('noteSaveBtn').disabled = true;
    try {
      const { error } = await sb.from('couple_notes').insert({
        user_id: activeUser.id, type, content,
        due_date: type === 'reminder' ? ($('noteDueDate').value || null) : null
      });
      if (error) throw error;
      $('noteForm').reset();
      hide($('noteDateLabel'));
      $('noteSaveBtn').textContent = 'Guardar mensajito';
      text($('noteStatus'), 'Guardado para los dos. ♡', true);
      await loadNotes();
    } catch (err) {
      text($('noteStatus'), friendly(err));
    } finally { $('noteSaveBtn').disabled = false; }
  });

  // ─── CÁPSULA DEL TIEMPO: RESPALDO TOTAL Y RESTAURACIÓN ───────────────
  // La exportación siempre consulta TODAS las filas de la nube: no solo las
  // tarjetas cargadas en la pantalla. Si falla alguna foto, no descarga un ZIP
  // aparentemente completo.
  const BACKUP_KEY = 'fer-alxs-last-backup-start-v2';
  const asDate = () => new Date().toISOString().slice(0, 10);
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8a-f][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  function backupStatus() {
    let last = null;
    try { last = localStorage.getItem(BACKUP_KEY); } catch (_) {}
    const node = $('backupStatus');
    if (!last) {
      node.textContent = 'Todavía no se ha iniciado un respaldo en este navegador.';
    } else {
      const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
      node.textContent = days >= 30
        ? `Última descarga iniciada hace ${days} días. Conviene crear un respaldo nuevo y guardarlo fuera del celular.`
        : `Última descarga iniciada: ${new Intl.DateTimeFormat('es-CL', {dateStyle:'medium'}).format(new Date(last))}. Verifica que el ZIP esté guardado.`;
    }
  }
  backupStatus();

  function backupProgress(label, fraction = null) {
    show($('backupProgress'));
    $('backupProgressText').textContent = label;
    $('backupProgressBar').style.width = fraction == null ? '5%' : `${Math.round(100 * fraction)}%`;
  }

  async function fetchAll(table, fields, batch = 250) {
    const rows = [];
    for (let start = 0; ; start += batch) {
      const { data, error } = await sb.from(table).select(fields)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(start, start + batch - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < batch) break;
      if (rows.length > 20000) throw new Error('El álbum tiene demasiados registros para respaldarlos desde este navegador.');
    }
    return rows;
  }

  function fileExtension(path) {
    const ext = (String(path).split('.').pop() || 'jpg').toLowerCase();
    return ['jpg','jpeg','webp','png','gif'].includes(ext) ? ext : 'jpg';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Dejar un margen para que el navegador comience a guardar el archivo.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const pictureFields = 'id,user_id,storage_path,title,bubble_text,back_note,location,event_date,reminder,created_at,original_author_name,backup_source_id';
  const noteFields = 'id,user_id,type,content,due_date,created_at,original_author_name,backup_source_id';

  $('backupExportBtn').addEventListener('click', async () => {
    if (!activeUser || busy) return;
    if (!window.JSZip) return text($('backupMessage'), 'No se pudo cargar la herramienta ZIP. Verifica internet y recarga la página.');
    busy = true;
    $('backupExportBtn').disabled = true;
    $('backupImportBtn').disabled = true;
    try {
      text($('backupMessage'), 'Preparando una copia de todos los recuerdos…');
      backupProgress('Leyendo el álbum completo…', .02);
      const [allPhotos, allNotes] = await Promise.all([
        fetchAll('couple_photos', pictureFields),
        fetchAll('couple_notes', noteFields)
      ]);
      const zip = new JSZip();
      const people = Object.fromEntries(members.map(m => [m.user_id, m.display_name]));
      const manifest = {
        format: 'fer-alxs-backup', version: 2,
        exported_at: new Date().toISOString(),
        members: members.map(m => ({ user_id: m.user_id, display_name:m.display_name })),
        photos: [], notes: []
      };
      const human = ['FER & ALXS · CÁPSULA DEL TIEMPO', `Exportado el ${new Date().toLocaleString('es-CL')}`, ''];
      for (const [index, row] of allPhotos.entries()) {
        backupProgress(`Descargando foto ${index+1} de ${allPhotos.length}…`, .05 + .75*((index+1)/Math.max(allPhotos.length,1)));
        const { data: photoBlob, error } = await sb.storage.from(BUCKET).download(row.storage_path);
        if (error || !photoBlob) throw new Error(`No se pudo respaldar la foto ${index+1} (${row.title || row.id}). No se generó un respaldo incompleto. ${friendly(error || '')}`);
        const file = `fotos/${row.id}.${fileExtension(row.storage_path)}`;
        zip.file(file, photoBlob);
        const { storage_path, ...entry } = row;
        const author = row.original_author_name || people[row.user_id] || 'Mi amor';
        manifest.photos.push({ ...entry, author, file });
        human.push(`FOTO: ${row.title || '(Sin título)'}`, `Autor: ${author}`, `Fecha: ${row.event_date || 'sin fecha'}`, `Lugar: ${row.location || 'sin lugar'}`, `Mensaje: ${row.bubble_text || ''}`, `Nota: ${row.back_note || ''}`, `Recordatorio: ${row.reminder || ''}`, `Archivo: ${file}`, '');
      }
      for (const row of allNotes) {
        const author = row.original_author_name || people[row.user_id] || 'Mi amor';
        manifest.notes.push({ ...row, author });
        human.push(`${row.type === 'reminder' ? 'RECORDATORIO' : 'MENSAJE'}: ${row.content}`, `Autor: ${author}`, `Fecha: ${row.due_date || 'sin fecha'}`, '');
      }
      zip.file('respaldo.json', JSON.stringify(manifest, null, 2));
      zip.file('NUESTROS_RECUERDOS.txt', human.join('\n'));
      zip.file('LEEME.txt', 'FER & ALXS — RESPALDO PRIVADO\n\nEste ZIP contiene fotografías y datos personales. No lo compartas públicamente.\n\nPara restaurarlo: entra a la web con una de las dos cuentas, abre Cápsula del tiempo, elige este ZIP y pulsa Restaurar recuerdos.\n\nEl archivo respaldo.json tiene el contenido estructurado. Puedes leer NUESTROS_RECUERDOS.txt aunque ya no tengas la web.\n\nLos archivos originales de la nube fueron optimizados al subirlos; esta copia conserva esas imágenes, no el original sin comprimir de la cámara.\n');
      backupProgress('Empaquetando tus recuerdos…', .87);
      const blob = await zip.generateAsync({ type:'blob', compression:'STORE' }, metadata => {
        backupProgress(`Creando ZIP… ${Math.round(metadata.percent)} %`, .87 + .12 * metadata.percent / 100);
      });
      if (blob.size < 100) throw new Error('El archivo ZIP generado no es válido.');
      downloadBlob(blob, `Fer-y-Alxs_respaldo_${asDate()}.zip`);
      try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch (_) {}
      backupStatus();
      backupProgress('Descarga iniciada. Verifica el archivo en Descargas.', 1);
      text($('backupMessage'), `Se inició la descarga del ZIP: ${allPhotos.length} fotos y ${allNotes.length} mensajitos/recordatorios. Guarda otra copia en un lugar privado.`, true);
    } catch(err) {
      text($('backupMessage'), `No se pudo completar el respaldo: ${friendly(err)}`);
      hide($('backupProgress'));
    } finally {
      busy = false;
      $('backupExportBtn').disabled = false;
      $('backupImportBtn').disabled = !$('backupImportInput').files.length;
    }
  });

  $('backupImportInput').addEventListener('change', () => {
    $('backupImportBtn').disabled = !$('backupImportInput').files.length || busy;
  });

  function validSourceId(id) { return typeof id === 'string' && uuidPattern.test(id); }
  function validPhotoPath(path, id) {
    return typeof path === 'string' && new RegExp(`^fotos/${id}\\.(webp|jpg|jpeg|png|gif)$`, 'i').test(path);
  }

  $('backupImportBtn').addEventListener('click', async () => {
    if (!activeUser || busy) return;
    if (!window.JSZip) return text($('backupMessage'), 'No está disponible la herramienta ZIP. Recarga la página.');
    const file = $('backupImportInput').files?.[0];
    if (!file) return;
    if (file.size > 600 * 1024 * 1024) return text($('backupMessage'), 'Este ZIP supera 600 MB. Para restauraciones grandes, usa un computador o divide el respaldo.');
    busy = true;
    $('backupImportBtn').disabled = true;
    $('backupExportBtn').disabled = true;
    let restoredPhotos = 0, restoredNotes = 0, skipped = 0;
    try {
      backupProgress('Leyendo y validando el ZIP…', .03);
      const zip = await JSZip.loadAsync(file, { checkCRC32:true });
      const manifestFile = zip.file('respaldo.json');
      if (!manifestFile) throw new Error('No se encontró respaldo.json. Selecciona un ZIP creado por esta web.');
      const rawJson = await manifestFile.async('string');
      if (rawJson.length > 8 * 1024 * 1024) throw new Error('El registro del respaldo es demasiado grande.');
      const data = JSON.parse(rawJson);
      if (data.format !== 'fer-alxs-backup' || data.version !== 2 || !Array.isArray(data.photos) || !Array.isArray(data.notes)) throw new Error('Formato de respaldo incompatible.');
      if (data.photos.length > 5000 || data.notes.length > 10000) throw new Error('El ZIP supera los límites de restauración desde esta web.');
      for (const row of data.photos) {
        if (!validSourceId(row.id) || !validPhotoPath(row.file, row.id) || !zip.file(row.file)) throw new Error('Hay una foto faltante o una referencia no válida en el ZIP.');
        const entry = zip.file(row.file);
        if (entry?._data?.uncompressedSize > 9 * 1024 * 1024) throw new Error('El ZIP contiene una fotografía demasiado grande.');
      }
      for (const row of data.notes) if (!validSourceId(row.id) || !['message','reminder'].includes(row.type) || typeof row.content !== 'string' || row.content.length > 500) throw new Error('El ZIP contiene una nota incompatible.');
      if (!window.confirm(`Este ZIP contiene ${data.photos.length} fotos y ${data.notes.length} mensajes/recordatorios.\n\nSe recuperarán los que aún no existan, usando tu cuenta como responsable de la restauración. Los nombres originales se conservarán como autores.\n\n¿Quieres continuar?`)) {
        text($('backupMessage'), 'Restauración cancelada.');
        return;
      }
      // Duplicados: tanto la foto/nota original como copias ya restauradas.
      const [existingPhotos, existingNotes] = await Promise.all([
        fetchAll('couple_photos','id,backup_source_id'),
        fetchAll('couple_notes','id,backup_source_id')
      ]);
      const photoIds = new Set(existingPhotos.flatMap(r => [r.id, r.backup_source_id].filter(Boolean)));
      const noteIds = new Set(existingNotes.flatMap(r => [r.id, r.backup_source_id].filter(Boolean)));
      const people = Object.fromEntries((Array.isArray(data.members)?data.members:[])
        .filter(m => typeof m.user_id === 'string' && typeof m.display_name === 'string')
        .map(m => [m.user_id, m.display_name]));
      const total = data.photos.length + data.notes.length;
      let index = 0;
      for (const row of data.photos) {
        index++;
        backupProgress(`Restaurando foto ${index} de ${total}…`, .1 + .85 * index / Math.max(total,1));
        const sourceId = validSourceId(row.backup_source_id) ? row.backup_source_id : row.id;
        if (photoIds.has(row.id) || photoIds.has(sourceId)) { skipped++; continue; }
        const entry = zip.file(row.file);
        const body = await entry.async('blob');
        if (body.size > 8 * 1024 * 1024) throw new Error('Una de las imágenes supera los 8 MB admitidos.');
        const ext = fileExtension(row.file);
        const mime = ({jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',png:'image/png',gif:'image/gif'})[ext];
        const newPath = `${activeUser.id}/restored-${sourceId}-${Math.random().toString(36).slice(2,8)}.${ext}`;
        const { error: uploadError } = await sb.storage.from(BUCKET).upload(newPath, body, { contentType:mime, upsert:false });
        if (uploadError) throw uploadError;
        const payload = {
          user_id:activeUser.id, storage_path:newPath,
          title:cut(row.title,80), bubble_text:cut(row.bubble_text,180),
          back_note:cut(row.back_note,240), location:cut(row.location,90),
          event_date:typeof row.event_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.event_date) ? row.event_date : null,
          reminder:cut(row.reminder,140), backup_source_id:sourceId,
          original_author_name:cut(row.original_author_name || row.author || people[row.user_id] || 'Mi amor',35)
        };
        if (typeof row.created_at === 'string' && !Number.isNaN(Date.parse(row.created_at))) payload.created_at = row.created_at;
        const { error: saveError } = await sb.from('couple_photos').insert(payload);
        if (saveError) {
          await sb.storage.from(BUCKET).remove([newPath]).catch(()=>{});
          throw saveError;
        }
        restoredPhotos++;
        photoIds.add(sourceId);
      }
      for (const row of data.notes) {
        index++;
        backupProgress(`Restaurando nota ${index} de ${total}…`, .1 + .85 * index / Math.max(total,1));
        const sourceId = validSourceId(row.backup_source_id) ? row.backup_source_id : row.id;
        if (noteIds.has(row.id) || noteIds.has(sourceId)) { skipped++; continue; }
        const payload = {
          user_id:activeUser.id, type:row.type, content:cut(row.content,500),
          due_date:typeof row.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.due_date) ? row.due_date : null,
          backup_source_id:sourceId,
          original_author_name:cut(row.original_author_name || row.author || people[row.user_id] || 'Mi amor',35)
        };
        if (typeof row.created_at === 'string' && !Number.isNaN(Date.parse(row.created_at))) payload.created_at = row.created_at;
        const { error } = await sb.from('couple_notes').insert(payload);
        if (error) throw error;
        noteIds.add(sourceId);
        restoredNotes++;
      }
      await Promise.all([loadPhotos(true),loadNotes()]);
      text($('backupMessage'), `Restauración terminada: ${restoredPhotos} fotos y ${restoredNotes} notas recuperadas; ${skipped} registros ya existían.`, true);
      backupProgress('Restauración completada.', 1);
    } catch(err) {
      hide($('backupProgress'));
      text($('backupMessage'), `Restauración interrumpida (${restoredPhotos} fotos y ${restoredNotes} notas recuperadas hasta ahora). ${friendly(err)} Puedes volver a intentar: se omiten los duplicados.`);
      await Promise.all([loadPhotos(true),loadNotes()]).catch(()=>{});
    } finally {
      busy = false;
      $('backupImportBtn').disabled = !$('backupImportInput').files.length;
      $('backupExportBtn').disabled = false;
    }
  });
})();
