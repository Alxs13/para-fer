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
  let extraSub = null;

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
      if (extraSub) { sb.removeChannel(extraSub); extraSub = null; }
      if (chatSub) { sb.removeChannel(chatSub); chatSub = null; }
      if (miscSub) { sb.removeChannel(miscSub); miscSub = null; }
      chatMessages = []; chatOffset = 0; customStickers = []; savingsGoals = []; savingsEntries = [];
      songs=[]; videos=[]; calendarPhotos=[];
      $('musicPlayer').replaceChildren(); $('musicPlayer').classList.add('hidden');
      $('videoGrid').replaceChildren();
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
    extraSub=sb.channel('couple-extras-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'couple_songs'},()=>{if(activeUser)loadSongs().catch(console.warn);})
      .on('postgres_changes',{event:'*',schema:'public',table:'couple_videos'},()=>{if(activeUser)loadVideos().catch(console.warn);})
      .subscribe();
    chatSub = sb.channel('couple-chat-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'couple_chat'},()=>{if(activeUser && page==='chat')loadChat(true,true).catch(console.warn);})
      .subscribe();
    miscSub = sb.channel('couple-chat-extras-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'couple_stickers'},()=>{if(activeUser)loadStickers().catch(console.warn);})
      .on('postgres_changes',{event:'*',schema:'public',table:'couple_sticker_favorites'},()=>{if(activeUser)loadFavoriteStickers().catch(console.warn);})
      .on('postgres_changes',{event:'*',schema:'public',table:'couple_saving_goals'},()=>{if(activeUser && page==='savings')loadSavings().catch(console.warn);})
      .on('postgres_changes',{event:'*',schema:'public',table:'couple_saving_entries'},()=>{if(activeUser && page==='savings')loadSavings().catch(console.warn);})
      .subscribe();
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
  const sectionNames = ['home','cards','chat','savings','binder','notes','backup','calendar','music','videos','more','today','places','gifts','dreams','diary','studio'];

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
    window.dispatchEvent(new CustomEvent('fer-page', {detail:name}));
    if (name === 'cards') scrollToCard(activeCard, false);
    if(name === 'savings') loadSavings().catch(e=>text($('savingsStatus'),friendly(e)));
    if(name === 'chat') { loadStickers().catch(console.warn); loadFavoriteStickers().catch(console.warn); loadChat(true).catch(e=>text($('chatStatus'),friendly(e))); }
    if(name === 'calendar') loadCalendar().catch(e=>text($('calendarDetails'),friendly(e)));
    if(name === 'music') { populateSongPhotos(); loadSongs().catch(e=>text($('musicStatus'),friendly(e))); }
    if(name === 'videos') loadVideos().catch(e=>text($('videoStatus'),friendly(e)));
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

  function animateFlip(card) {
    // Mantener los dos planos montados durante toda la rotación: el reverso
    // no desaparece de golpe ni se despega la burbuja en Chrome Android.
    if (card.classList.contains('is-flipping')) return;
    card.classList.add('is-flipping');
    card.classList.toggle('is-flipped');
    const inner=card.querySelector('.memory-card-inner');
    const finish=e=>{if(e && (e.target!==inner || e.propertyName!=='transform'))return;
      inner.removeEventListener('transitionend',finish);
      card.classList.remove('is-flipping');
    };
    inner.addEventListener('transitionend',finish);
    setTimeout(()=>finish(),850);
  }

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
      animateFlip(card);
    });
    card.addEventListener('keydown',e=>{
      if(e.target===card && (e.key==='Enter'||e.key===' ')) {e.preventDefault();animateFlip(card);}
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
    populateSongPhotos();
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
      calendarPhotos=[];
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

  // ─── CALENDARIO DE RECUERDOS ─────────────────────────────────────────────
  let calendarPhotos = [];
  let calDate = new Date();
  let selectedCalDate = '';
  function photoDay(row) {
    return row.event_date || new Intl.DateTimeFormat('en-CA', {timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.created_at));
  }
  async function loadCalendar() {
    if(!activeUser)return;
    calendarPhotos=await fetchAll('couple_photos','id,title,event_date,created_at,location,bubble_text');
    renderCalendar();
  }
  function renderCalendar() {
    const y=calDate.getFullYear(),m=calDate.getMonth();
    $('calMonth').textContent = new Intl.DateTimeFormat('es-CL',{month:'long',year:'numeric'}).format(new Date(y,m,1));
    const grid=$('calendarGrid');grid.replaceChildren();
    for(const day of ['L','M','M','J','V','S','D']){const head=document.createElement('span');head.className='day-head';head.textContent=day;grid.append(head);}
    const start=(new Date(y,m,1).getDay()+6)%7, days=new Date(y,m+1,0).getDate();
    const photoDays = new Set(calendarPhotos.map(photoDay));
    const noteDays = new Set(notes.filter(n=>n.type==='reminder'&&n.due_date).map(n=>n.due_date));
    for(let i=0;i<start;i++){const blank=document.createElement('span');blank.className='calendar-blank';grid.append(blank);}
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    for(let i=1;i<=days;i++){
      const date = `${y}-${String(m+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
      const btn=document.createElement('button');btn.type='button';btn.className='day-cell';btn.dataset.date=date;
      if(date===today)btn.classList.add('today');
      if(date===selectedCalDate)btn.classList.add('selected');
      const number=document.createElement('span');number.textContent=String(i);btn.append(number);
      const marks=document.createElement('span');marks.className='day-marks';
      if(photoDays.has(date)){const dot=document.createElement('i');dot.className='memory-dot';marks.append(dot);}
      if(noteDays.has(date)){const dot=document.createElement('i');dot.className='reminder-dot';marks.append(dot);}
      btn.append(marks);btn.addEventListener('click',()=>{selectedCalDate=date;renderCalendar();});grid.append(btn);
    }
    const detail=$('calendarDetails');detail.replaceChildren();
    if(!selectedCalDate){const p=document.createElement('p');p.textContent='Toca un día para descubrir recuerdos y recordatorios.';detail.append(p);return;}
    const matches=calendarPhotos.filter(p=>photoDay(p)===selectedCalDate);
    const reminders=notes.filter(n=>n.type==='reminder'&&n.due_date===selectedCalDate);
    const title=document.createElement('h3');title.textContent=fmtDate(selectedCalDate);detail.append(title);
    if(!matches.length&&!reminders.length){const p=document.createElement('p');p.textContent='Un día esperando su primer recuerdo.';detail.append(p);}
    for(const p of matches){const div=document.createElement('div');div.className='day-memory';const b=document.createElement('b');b.textContent=p.title||'Nuestro recuerdo';const small=document.createElement('small');small.textContent=[p.location,p.bubble_text].filter(Boolean).join(' · ');div.append(b,small);detail.append(div);}
    for(const n of reminders){const div=document.createElement('div');div.className='day-memory note-memory';div.textContent='Recordatorio: '+n.content;detail.append(div);}
  }
  $('calPrev').addEventListener('click',()=>{calDate=new Date(calDate.getFullYear(),calDate.getMonth()-1,1);selectedCalDate='';renderCalendar();});
  $('calNext').addEventListener('click',()=>{calDate=new Date(calDate.getFullYear(),calDate.getMonth()+1,1);selectedCalDate='';renderCalendar();});

  // ─── PLAYLIST MUTUA CON YOUTUBE ─────────────────────────────────────────
  let songs=[];
  function youtubeId(raw) {
    try {
      const url=new URL(raw);
      if(url.protocol!=='https:')return null;
      const host=url.hostname.toLowerCase().replace(/^www\./,'');
      let id='';
      if(host==='youtu.be')id=url.pathname.slice(1).split('/')[0];
      else if(['youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com'].includes(host)){
        if(url.pathname==='/watch')id=url.searchParams.get('v')||'';
        else if(/^\/(shorts|embed|live)\//.test(url.pathname))id=url.pathname.split('/')[2]||'';
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id)?id:null;
    }catch{return null;}
  }
  function populateSongPhotos(){
    const select=$('songPhoto');if(!select)return;
    const selected=select.value;
    select.replaceChildren(new Option('Sin foto asociada',''));
    for(const p of photos){select.add(new Option(p.title||'Recuerdo sin título',p.id));}
    select.value=photos.some(p=>p.id===selected)?selected:'';
  }
  $('youtubeFind').addEventListener('click',()=>{
    const query=$('youtubeSearch').value.trim();
    if(!query)return text($('musicStatus'),'Escribe el artista o la canción que buscas.');
    window.open('https://www.youtube.com/results?search_query='+encodeURIComponent(query),'_blank','noopener,noreferrer');
    text($('musicStatus'),'Copia el enlace de la canción desde YouTube y pégalo abajo.',true);
  });
  async function loadSongs(){
    if(!activeUser)return;
    const {data,error}=await sb.from('couple_songs').select('id,user_id,title,artist,dedication,youtube_id,photo_id,created_at').order('created_at',{ascending:false}).limit(500);
    if(error)throw new Error('La playlist aún no está lista. Ejecuta 03_ampliar_universo.sql en Supabase. '+friendly(error));
    songs=data||[];renderSongs();
  }
  function renderSongs(){
    $('songCount').textContent=`${songs.length} ${songs.length===1?'canción':'canciones'}`;
    const box=$('songList');box.replaceChildren();
    if(!songs.length){const p=document.createElement('p');p.className='empty-library';p.textContent='Todavía no hay canciones. Agrega la primera para construir su banda sonora.';box.append(p);return;}
    for(const [i,song] of songs.entries()){
      const item=document.createElement('article');item.className='song-item';
      item.innerHTML=`<span class="song-number">${String(i+1).padStart(2,'0')}</span><div class="song-lines"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(song.artist||'Nuestro tema')}</small>${song.dedication?`<p>“${escapeHtml(song.dedication)}”</p>`:''}</div>`;
      const actions=document.createElement('div');actions.className='song-actions';
      const play=document.createElement('button');play.type='button';play.className='small-btn';play.textContent='Escuchar';play.addEventListener('click',()=>playSong(song));actions.append(play);
      if(isMine(song)){const del=document.createElement('button');del.type='button';del.className='small-btn danger';del.textContent='Quitar';del.addEventListener('click',async()=>{if(!confirm('¿Quitar esta canción de nuestra playlist?'))return;const {error}=await sb.from('couple_songs').delete().eq('id',song.id).eq('user_id',activeUser.id);if(error)text($('musicStatus'),friendly(error));else await loadSongs();});actions.append(del);}
      item.append(actions);box.append(item);
    }
  }
  function playSong(song){
    const box=$('musicPlayer');show(box);box.replaceChildren();
    const title=document.createElement('h3');title.textContent=song.title+' · '+(song.artist||'Nuestra canción');box.append(title);
    const frame=document.createElement('iframe');frame.title='Reproductor de YouTube: '+song.title;
    frame.src=`https://www.youtube-nocookie.com/embed/${song.youtube_id}?rel=0`;
    frame.referrerPolicy='strict-origin-when-cross-origin';frame.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';frame.allowFullscreen=true;frame.loading='lazy';box.append(frame);
    if(song.dedication){const note=document.createElement('p');note.textContent='“'+song.dedication+'”';box.append(note);}
    const open=document.createElement('a');open.href=`https://www.youtube.com/watch?v=${song.youtube_id}`;open.target='_blank';open.rel='noopener noreferrer';open.textContent='Abrir en YouTube';box.append(open);
    const related=photos.find(p=>p.id===song.photo_id);
    if(related){const btn=document.createElement('button');btn.type='button';btn.className='small-btn';btn.textContent='Ver el recuerdo relacionado';btn.addEventListener('click',()=>{currentFilter='all';renderPhotos();const idx=filteredPhotos.findIndex(p=>p.id===related.id);activeCard=Math.max(0,idx);goPage('cards');scrollToCard(activeCard);});box.append(btn);}
    box.scrollIntoView({behavior:'smooth',block:'start'});
  }
  $('musicForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!activeUser)return;
    const id=youtubeId($('songUrl').value.trim());if(!id)return text($('musicStatus'),'Pega un enlace válido de YouTube (video, Shorts o youtu.be).');
    $('songSave').disabled=true;
    try{
      const {error}=await sb.from('couple_songs').insert({user_id:activeUser.id,title:cut($('songTitle').value,100),artist:cut($('songArtist').value,90),dedication:cut($('songDedication').value,300),youtube_id:id,photo_id:$('songPhoto').value||null});
      if(error)throw error;$('musicForm').reset();text($('musicStatus'),'Canción agregada a nuestra playlist.',true);await loadSongs();
    }catch(err){text($('musicStatus'),friendly(err)+' — Si faltan tablas, ejecuta 03_ampliar_universo.sql.');}
    finally{$('songSave').disabled=false;}
  });

  // ─── VIDEOTECA PRIVADA ─────────────────────────────────────────────────
  const VIDEO_BUCKET='fer-alxs-videos';
  let videos=[];
  async function loadVideos(){
    if(!activeUser)return;
    const {data,error}=await sb.from('couple_videos').select('id,user_id,storage_path,title,note,event_date,location,created_at').order('created_at',{ascending:false}).limit(100);
    if(error)throw new Error('La videoteca aún no está lista. Ejecuta 03_ampliar_universo.sql. '+friendly(error));
    videos=data||[];renderVideos();
  }
  function renderVideos(){
    $('videoCount').textContent=`${videos.length} ${videos.length===1?'video':'videos'}`;
    const grid=$('videoGrid');grid.replaceChildren();
    if(!videos.length){const p=document.createElement('p');p.className='empty-library';p.textContent='Los videos que suban aparecerán aquí. Puedes guardar clips MP4 y WEBM.';grid.append(p);return;}
    for(const row of videos){
      const card=document.createElement('article');card.className='video-card';
      const art=document.createElement('div');art.className='video-art';art.innerHTML='<svg class="ui-icon"><use href="#i-video"/></svg>';card.append(art);
      const info=document.createElement('div');info.className='video-details';
      const title=document.createElement('h3');title.textContent=row.title;
      const meta=document.createElement('p');meta.textContent=[row.event_date?fmtDate(row.event_date):'',row.location,memberName(row.user_id)].filter(Boolean).join(' · ');
      info.append(title,meta);
      if(row.note){const note=document.createElement('p');note.className='video-note';note.textContent=row.note;info.append(note);}
      const play=document.createElement('button');play.className='small-btn';play.textContent='Reproducir video';
      play.addEventListener('click',async()=>{
        play.disabled=true;play.textContent='Abriendo video…';
        const {data,error}=await sb.storage.from(VIDEO_BUCKET).createSignedUrl(row.storage_path,3600);
        if(error||!data?.signedUrl){text($('videoStatus'),friendly(error||'No se pudo abrir'));play.disabled=false;play.textContent='Reproducir video';return;}
        const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.src=data.signedUrl;video.className='video-player';art.replaceChildren(video);video.play().catch(()=>{});
        play.textContent='Actualizar video';play.disabled=false;
      });info.append(play);
      if(isMine(row)){const del=document.createElement('button');del.className='small-btn danger';del.textContent='Eliminar mi video';del.addEventListener('click',async()=>{
        if(!confirm('¿Eliminar este video de nuestra videoteca?'))return;
        const {error}=await sb.from('couple_videos').delete().eq('id',row.id).eq('user_id',activeUser.id);
        if(error){text($('videoStatus'),friendly(error));return;}
        await sb.storage.from(VIDEO_BUCKET).remove([row.storage_path]).catch(()=>{});await loadVideos();
      });info.append(del);}
      card.append(info);grid.append(card);
    }
  }
  $('videoForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!activeUser)return;
    const file=$('videoFile').files?.[0];if(!file)return text($('videoStatus'),'Selecciona un video.');
    const mime=file.type==='video/mp4'?'video/mp4':file.type==='video/webm'?'video/webm':null;
    if(!mime)return text($('videoStatus'),'Usa un archivo MP4 o WEBM.');
    if(file.size>45*1024*1024)return text($('videoStatus'),'Máximo 45 MB por video; recorta el archivo desde la galería de tu celular.');
    $('videoSave').disabled=true;
    try{
      text($('videoStatus'),'Subiendo video a la nube privada. Mantén la página abierta…');
      const ext=mime==='video/mp4'?'mp4':'webm';
      const path=`${activeUser.id}/${Date.now()}-${Math.random().toString(36).slice(2,9)}.${ext}`;
      const {error:upErr}=await sb.storage.from(VIDEO_BUCKET).upload(path,file,{contentType:mime,upsert:false});if(upErr)throw upErr;
      const {error:dbErr}=await sb.from('couple_videos').insert({user_id:activeUser.id,storage_path:path,title:cut($('videoTitle').value,100),note:cut($('videoNote').value,300),event_date:$('videoDate').value||null,location:cut($('videoLocation').value,90)});
      if(dbErr){await sb.storage.from(VIDEO_BUCKET).remove([path]).catch(()=>{});throw dbErr;}
      $('videoForm').reset();text($('videoStatus'),'Video guardado para ambos.',true);await loadVideos();
    }catch(err){text($('videoStatus'),friendly(err)+' Comprueba que ejecutaste 03_ampliar_universo.sql y que el video no supera el límite global de Storage.');}
    finally{$('videoSave').disabled=false;}
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
    return ['jpg','jpeg','webp','png','gif','mp4','webm','pdf','txt','csv','zip','docx','xlsx','ogg','m4a'].includes(ext) ? ext : 'jpg';
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

  // PDF de lectura/impresión: usa las mismas reglas privadas del álbum, pero
  // NO reemplaza el ZIP, que contiene los datos necesarios para restaurar.
  $('pdfExportBtn').addEventListener('click', async () => {
    if (!activeUser || busy) return;
    if (!window.FerPDF) return text($('pdfExportMessage'), 'No se cargó el generador PDF local. Actualiza la página.');
    busy = true;
    $('pdfExportBtn').disabled = true;
    $('backupExportBtn').disabled = true;
    $('backupImportBtn').disabled = true;
    try {
      text($('pdfExportMessage'), 'Consultando todas las fotografías y mensajes privados…');
      backupProgress('Preparando el libro de recuerdos…', .02);
      const [allPhotos, allNotes] = await Promise.all([
        fetchAll('couple_photos', pictureFields),
        fetchAll('couple_notes', noteFields)
      ]);
      if (allPhotos.length + allNotes.length === 0) throw new Error('Todavía no hay recuerdos o mensajes para exportar.');
      const byId = Object.fromEntries(members.map(m => [m.user_id, m.display_name]));
      const rows = allPhotos.map(r => ({
        ...r, original_author_name:r.original_author_name || byId[r.user_id] || 'Mi amor'
      }));
      const notes = allNotes.map(r => ({
        ...r, author:r.original_author_name || byId[r.user_id] || 'Mi amor'
      }));
      if (rows.length > 80 && !confirm(`El álbum contiene ${rows.length} fotografías. Un PDF tan grande puede consumir mucha memoria en el celular. ¿Continuar?`)) {
        text($('pdfExportMessage'), 'Exportación cancelada. Puedes usar el ZIP como respaldo completo.');
        return;
      }
      const pdf = await window.FerPDF.create({
        photos:rows,notes,
        progress:(label,fraction)=>{
          backupProgress(label,.03+fraction*.95);
          text($('pdfExportMessage'),label);
        },
        loadPhoto: async row => {
          const {data,error} = await sb.storage.from(BUCKET).download(row.storage_path);
          if(error || !data) throw new Error(`No se pudo obtener «${row.title||'Recuerdo'}» desde la nube: ${friendly(error || '')}`);
          return data;
        }
      });
      if(pdf.size < 300)throw new Error('La generación produjo un archivo vacío.');
      downloadBlob(pdf, `Fer-y-Alxs_libro-de-recuerdos_${asDate()}.pdf`);
      backupProgress('Se inició la descarga del libro PDF.',1);
      text($('pdfExportMessage'),`Se inició la descarga del PDF: ${allPhotos.length} fotos y ${allNotes.length} notas. Comprueba que esté en Descargas. Conserva además tu ZIP para restaurar el álbum.`,true);
    } catch (err) {
      hide($('backupProgress'));
      text($('pdfExportMessage'),`No se pudo generar el PDF: ${friendly(err)}`);
    } finally {
      busy = false;
      $('pdfExportBtn').disabled = false;
      $('backupExportBtn').disabled = false;
      $('backupImportBtn').disabled = !$('backupImportInput').files.length;
    }
  });


  // CHAT PRIVADO — misma cuenta Supabase y reglas RLS del álbum.
  let miscSub = null;
  let customStickers = [];
  let favoriteStickers = new Set(); // La colección de favoritos es de AMBOS, no local al navegador.
  let stickerPickerMode = 'emoji';
  let favoriteEnabled = true;
  const customKey = id => `custom:${id}`;
  const builtinKey = id => `builtin:${id}`;
  function hasFavorite(key) { return favoriteStickers.has(key); }
  async function loadFavoriteStickers() {
    if(!activeUser)return;
    const {data,error}=await sb.from('couple_sticker_favorites').select('sticker_key').limit(300);
    if(error){
      favoriteEnabled=false;
      text($('stickerStatus'),'Favoritos requiere activar el SQL 08_favoritos_compartidos.sql. Los stickers normales siguen disponibles.');
      return;
    }
    favoriteEnabled=true;
    favoriteStickers=new Set((data||[]).map(r=>r.sticker_key));
    $('favCount').textContent=String(favoriteStickers.size);
    renderStickers();
  }
  async function toggleFavorite(key,button){
    if(!activeUser||!favoriteEnabled)return text($('stickerStatus'),'Primero ejecuta 08_favoritos_compartidos.sql en Supabase.');
    if(!/^(builtin:[a-z0-9_-]{1,60}|custom:[a-f0-9-]{36})$/.test(key))return;
    const adding=!hasFavorite(key);
    button.disabled=true;
    try {
      const query=adding
        ? sb.from('couple_sticker_favorites').upsert({sticker_key:key,added_by:activeUser.id},{onConflict:'sticker_key',ignoreDuplicates:true})
        : sb.from('couple_sticker_favorites').delete().eq('sticker_key',key);
      const {error}=await query;
      if(error)throw error;
      await loadFavoriteStickers();
      text($('stickerStatus'),adding?'Agregado a favoritos de ambos.':'Retirado de favoritos de ambos.',true);
    }catch(e){text($('stickerStatus'),'No se pudo cambiar el favorito: '+friendly(e));}
    finally{button.disabled=false;}
  }
  function makeFavoriteButton(key,label){
    const b=document.createElement('button'); b.type='button';
    b.className='sticker-favorite-btn'+(hasFavorite(key)?' is-favorite':'');
    b.textContent=hasFavorite(key)?'★':'☆';
    b.title=hasFavorite(key)?'Quitar de favoritos compartidos':'Guardar en favoritos compartidos';
    b.setAttribute('aria-label',b.title);
    b.setAttribute('aria-pressed',String(hasFavorite(key)));
    b.addEventListener('click',e=>{e.stopPropagation();toggleFavorite(key,b);});
    return b;
  }
  function renderFavoriteGrid(){
    const grid=$('chatFavoritesGrid'); grid.replaceChildren();
    for(const s of stickerCatalog){
      if(!hasFavorite(builtinKey(s.id)))continue;
      const tile=document.createElement('div');tile.className='sticker-custom-tile';
      const send=document.createElement('button');send.type='button';send.className='sticker-pick';send.innerHTML=stickerHTML(s.id);
      send.title='Enviar '+s.title;
      send.addEventListener('click',()=>sendBuiltinSticker(s.id));
      tile.append(send,makeFavoriteButton(builtinKey(s.id),s.title));grid.append(tile);
    }
    for(const s of customStickers){
      if(s.archived_at||!hasFavorite(customKey(s.id)))continue;
      const tile=document.createElement('div');tile.className='sticker-custom-tile';
      const send=document.createElement('button');send.type='button';send.className='sticker-custom-pick';
      send.title='Enviar '+s.name;
      const im=document.createElement('img');im.src=s.signedUrl||'';im.alt=s.name;im.loading='lazy';
      const caption=document.createElement('small');caption.textContent=s.name;
      send.append(im,caption);send.addEventListener('click',()=>sendCustomSticker(s.id));
      tile.append(send,makeFavoriteButton(customKey(s.id),s.name));grid.append(tile);
    }
    if(!grid.children.length){
      const empty=document.createElement('div');empty.className='sticker-favorites-empty';
      empty.textContent='Todavía no tienen stickers favoritos. Abre «Todos» y toca ☆ en los que quieran compartir.';
      grid.append(empty);
    }
  }
  let savingsGoals = [];
  let savingsEntries = [];
  const CHAT_FILES_BUCKET = 'fer-alxs-chat';
  const STICKER_BUCKET = 'fer-alxs-stickers';
  let chatSub = null;
  let chatMessages = [];
  let chatOffset = 0;
  let chatMore = false;
  let chatBusy = false;
  let chatRequest = 0;
  let replyDraft = null;
  const CHAT_BATCH = 50;
  const stickerCatalog = [
    {id:'te-amo',title:'TE AMO',subtitle:'hasta el infinito',symbol:'♥',color:'rose'},
    {id:'besito',title:'MUAH',subtitle:'un besito para ti',symbol:'♡',color:'peach'},
    {id:'abrazo',title:'ABRAZO',subtitle:'apretadito',symbol:'✿',color:'plum'},
    {id:'te-extrano',title:'TE EXTRAÑO',subtitle:'ven a mí',symbol:'☾',color:'violet'},
    {id:'buenos-dias',title:'BUEN DÍA',subtitle:'mi personita',symbol:'☼',color:'amber'},
    {id:'dulces-suenos',title:'DULCES SUEÑOS',subtitle:'descansa amor',symbol:'✧',color:'indigo'},
    {id:'contigo',title:'CONTIGO',subtitle:'todo es mejor',symbol:'❀',color:'jade'},
    {id:'por-siempre',title:'SIEMPRE',subtitle:'fer & alxs',symbol:'∞',color:'ruby'}
  ];
  const stickerById = id => stickerCatalog.find(s=>s.id===id);
  function stickerHTML(id) {
    const s=stickerById(id);
    if(!s)return '';
    return `<div class="love-sticker ${s.color}" role="img" aria-label="Sticker ${escapeHtml(s.title)}">
      <div class="sticker-stars" aria-hidden="true">✧ · ✦ · ✧</div><span class="sticker-symbol" aria-hidden="true">${s.symbol}</span>
      <strong>${escapeHtml(s.title)}</strong><small>${escapeHtml(s.subtitle)}</small></div>`;
  }
  const dateTimeChat = iso => new Intl.DateTimeFormat('es-CL',{hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
  const dateChat = iso => new Intl.DateTimeFormat('es-CL',{day:'numeric',month:'long',year:'numeric'}).format(new Date(iso));
  const chatWall = document.querySelector('#page-chat .chat-wall');
  const chatTimeline=$('chatTimeline');
  const chatInput=$('chatInput');
  function setReply(item) {
    replyDraft={id:item.id,author:authorName(item),body:item.kind==='sticker'?'Sticker':(item.kind==='audio'?'Nota de voz':(item.kind==='file'?item.file_name:item.body))};
    $('chatReplyName').textContent=replyDraft.author;
    $('chatReplyText').textContent=replyDraft.body.slice(0,100);
    show($('chatReplyBar'));
    chatInput.focus();
  }
  function clearReply() {replyDraft=null;hide($('chatReplyBar'));}
  $('chatReplyCancel').addEventListener('click',clearReply);
  function renderChat(scrollBottom=false,offsetScroll=0) {
    const frag=document.createDocumentFragment();let lastDay='';
    for(const item of chatMessages) {
      const day = dateChat(item.created_at);
      if(day!==lastDay){const el=document.createElement('div');el.className='chat-date';el.textContent=day;frag.appendChild(el);lastDay=day;}
      const mine=isMine(item);
      const wrapper=document.createElement('article');wrapper.className='chat-message '+(mine?'from-me':'from-them');
      const header=document.createElement('div');header.className='chat-author';header.textContent=authorName(item);
      const bubble=document.createElement('div');bubble.className='chat-bubble '+(item.kind==='sticker'?'chat-bubble-sticker':'');
      if(item.reply_preview){const q=document.createElement('div');q.className='chat-quoted';
        const name=document.createElement('b');name.textContent=item.reply_author||'Mensaje';
        const body=document.createElement('span');body.textContent=item.reply_preview;
        q.append(name,body);bubble.append(q);}
      if(item.kind==='sticker' && item.sticker_id){
        const s=customStickers.find(s=>s.id===item.sticker_id);
        if(s){const visual=document.createElement('img');visual.className='chat-custom-sticker';visual.src=s.signedUrl||'';visual.alt=s.name;visual.loading='lazy';bubble.append(visual);}
        else {const b=document.createElement('span');b.textContent='Sticker guardado (pulsa actualizar)';bubble.append(b);}
      }else if(item.kind==='sticker' && stickerById(item.sticker_code)){
        const visual=document.createElement('div');visual.innerHTML=stickerHTML(item.sticker_code);bubble.append(visual.firstChild);
      }else if(['file','audio'].includes(item.kind) && item.attachment_path){
        const fileBox=document.createElement('div');fileBox.className='chat-attachment';
        const fileName=document.createElement('span');fileName.textContent=item.file_name||'Archivo adjunto';
        const play=document.createElement('button');play.type='button';play.className='small-btn';play.textContent=item.kind==='audio'?'▶ Escuchar audio':'↓ Abrir archivo';
        play.addEventListener('click', async()=>{
          play.disabled=true;
          try{
            const {data,error}=await sb.storage.from(CHAT_FILES_BUCKET).createSignedUrl(item.attachment_path,120);
            if(error)throw error;
            if(item.kind==='audio'){
              const audio=document.createElement('audio');audio.src=data.signedUrl;audio.controls=true;audio.autoplay=true;audio.preload='metadata';play.replaceWith(audio);
            } else {
              window.open(data.signedUrl,'_blank','noopener,noreferrer');
            }
          }catch(err){text($('chatStatus'),friendly(err));}finally{play.disabled=false;}
        });
        if(item.file_mime?.startsWith('image/')){
          const thumb=document.createElement('img');thumb.className='chat-file-photo';thumb.alt=item.file_name||'Fotografía compartida';thumb.loading='lazy';
          sb.storage.from(CHAT_FILES_BUCKET).createSignedUrl(item.attachment_path,1800).then(({data,error})=>{if(!error && thumb.isConnected)thumb.src=data.signedUrl;}).catch(console.warn);
          fileBox.append(thumb);
        }
        fileBox.append(fileName,play);bubble.append(fileBox);
      }else {const t=document.createElement('p');t.textContent=item.body; bubble.append(t);}
      const meta=document.createElement('div');meta.className='chat-meta';
      const time=document.createElement('time');time.dateTime=item.created_at;time.textContent=dateTimeChat(item.created_at);meta.append(time);
      const replyBtn=document.createElement('button');replyBtn.type='button';replyBtn.textContent='Responder';replyBtn.className='chat-reply-btn';replyBtn.addEventListener('click',()=>setReply(item));meta.append(replyBtn);
      if(mine){const del=document.createElement('button');del.type='button';del.textContent='Eliminar';del.className='chat-delete-btn';del.addEventListener('click',async()=>{
        if(!confirm('¿Borrar este mensaje para los dos?'))return;
        const {error}=await sb.from('couple_chat').delete().eq('id',item.id).eq('user_id',activeUser.id);
        if(error)text($('chatStatus'),friendly(error));
        else {
          if(item.attachment_path){
            const {error:removeError}=await sb.storage.from(CHAT_FILES_BUCKET).remove([item.attachment_path]);
            if(removeError)text($('chatStatus'),'Mensaje borrado, pero no se pudo borrar el archivo de la nube: '+friendly(removeError));
          }
          await loadChat(true,true);
        }
      });meta.append(del);}
      wrapper.append(header,bubble,meta);frag.appendChild(wrapper);
    }
    chatTimeline.replaceChildren(frag);
    $('chatEmpty').classList.toggle('hidden',chatMessages.length>0);
    $('chatOlderBtn').classList.toggle('hidden',!chatMore);
    if(offsetScroll>0)chatWall.scrollTop=chatWall.scrollHeight-offsetScroll;
    else if(scrollBottom)chatWall.scrollTop=chatWall.scrollHeight;
  }
  async function loadChat(reset=false,preserve=false){
    if(!activeUser)return;
    const req=++chatRequest;
    const oldHeight=chatWall.scrollHeight;
    const nearBottom=chatWall.scrollHeight-chatWall.scrollTop-chatWall.clientHeight<140;
    const before=preserve && !nearBottom ? chatWall.scrollHeight-chatWall.scrollTop : 0;
    const start=reset?0:chatOffset;
    const {data,error}=await sb.from('couple_chat')
      .select('id,user_id,kind,body,sticker_code,sticker_id,attachment_path,file_name,file_mime,reply_preview,reply_author,created_at,original_author_name,backup_source_id')
      .order('created_at',{ascending:false}).range(start,start+CHAT_BATCH-1);
    if(req!==chatRequest || !activeUser)return;
    if(error){text($('chatStatus'),'No se pudo abrir el chat: '+friendly(error)+' Ejecuta 04_activar_chat.sql en Supabase.');return;}
    const part=(data||[]).reverse();
    chatMessages=reset?part:part.concat(chatMessages);
    chatOffset=start+(data||[]).length;
    chatMore=(data||[]).length===CHAT_BATCH;
    renderChat(reset?(nearBottom||!preserve):false,reset?before:(oldHeight-chatWall.scrollTop));
    text($('chatStatus'),'');
  }
  $('chatRefresh').addEventListener('click',()=>loadChat(true,true).catch(e=>text($('chatStatus'),friendly(e))));
  $('chatOlderBtn').addEventListener('click',()=>loadChat(false).catch(e=>text($('chatStatus'),friendly(e))));
  $('chatForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!activeUser || chatBusy)return;
    const body=chatInput.value.trim().slice(0,1500);
    if(!body)return;
    chatBusy=true;$('chatSend').disabled=true;
    try{
      const row={user_id:activeUser.id,kind:'text',body,reply_preview:replyDraft?.body.slice(0,140)||'',reply_author:replyDraft?.author.slice(0,35)||''};
      const {error}=await sb.from('couple_chat').insert(row);
      if(error)throw error;
      chatInput.value='';chatInput.style.height='auto';clearReply();hide($('chatPicker'));
      await loadChat(true);
      chatWall.scrollTop=chatWall.scrollHeight;
    }catch(err){text($('chatStatus'),friendly(err));}
    finally{chatBusy=false;$('chatSend').disabled=false;}
  });
  chatInput.addEventListener('input',()=>{chatInput.style.height='auto';chatInput.style.height=Math.min(chatInput.scrollHeight,118)+'px';});
  chatInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing && window.matchMedia('(min-width:700px)').matches){e.preventDefault();$('chatForm').requestSubmit();}});
  $('chatPickerToggle').addEventListener('click',()=>{$('chatPicker').classList.toggle('hidden');});
  function setPickerTab(name){
    stickerPickerMode=name;
    const emojis=name==='emoji', stickers=name==='sticker', favorites=name==='favorites';
    $('chatEmojiTab').classList.toggle('active',emojis);
    $('chatStickerTab').classList.toggle('active',stickers);
    $('chatFavoritesTab').classList.toggle('active',favorites);
    $('chatEmojiGrid').classList.toggle('hidden',!emojis);
    $('chatStickerGrid').classList.toggle('hidden',!stickers);
    $('chatFavoritesGrid').classList.toggle('hidden',!favorites);
    $('chatStickerImport').classList.toggle('hidden',!stickers);
    if(favorites)renderFavoriteGrid();
  }
  $('chatEmojiTab').addEventListener('click',()=>setPickerTab('emoji'));
  $('chatStickerTab').addEventListener('click',()=>setPickerTab('sticker'));
  $('chatFavoritesTab').addEventListener('click',()=>setPickerTab('favorites'));
  $('stickerImportHelp').addEventListener('click',()=>$('stickerImportGuide').classList.toggle('hidden'));
  $('stickerImportGuideClose').addEventListener('click',()=>hide($('stickerImportGuide')));
  for(const em of ['❤️','🥹','😘','💕','🫶','🌹','✨','🥰','💌','🫂','💋','🌙','😍','💖','☀️','🎶']){
    const b=document.createElement('button');b.type='button';b.className='chat-emoji';b.textContent=em;b.setAttribute('aria-label','Agregar '+em);
    b.addEventListener('click',()=>{chatInput.value+=em;chatInput.dispatchEvent(new Event('input'));chatInput.focus();});$('chatEmojiGrid').append(b);
  }
  async function sendBuiltinSticker(id) {
    if(!activeUser || chatBusy)return;
    chatBusy=true;
    try{
      const {error}=await sb.from('couple_chat').insert({user_id:activeUser.id,kind:'sticker',sticker_code:id,body:'',reply_preview:replyDraft?.body.slice(0,140)||'',reply_author:replyDraft?.author.slice(0,35)||''});
      if(error)throw error;
      hide($('chatPicker'));clearReply();await loadChat(true);chatWall.scrollTop=chatWall.scrollHeight;
    }catch(err){text($('chatStatus'),friendly(err));}finally{chatBusy=false;}
  }
  function renderBuiltins(){
    const grid=$('chatStickerGrid');
    grid.querySelectorAll('.sticker-builtin-tile').forEach(el=>el.remove());
    for(const sticker of stickerCatalog){
      const tile=document.createElement('div');tile.className='sticker-custom-tile sticker-builtin-tile';
      const b=document.createElement('button');b.type='button';b.className='sticker-pick';b.innerHTML=stickerHTML(sticker.id);
      b.title='Enviar sticker '+sticker.title;
      b.addEventListener('click',()=>sendBuiltinSticker(sticker.id));
      tile.append(b,makeFavoriteButton(builtinKey(sticker.id),sticker.title));
      grid.append(tile);
    }
  }
  renderBuiltins();

  // GESTIÓN DE STICKERS: los enviados se retiran de la colección, pero siguen en el historial.
  // Los stickers nunca enviados se pueden eliminar también del almacenamiento privado.
  let stickerManageMode = false;
  const stickerManageBtn = $('stickerManageBtn');
  function setStickerManageMode(enabled) {
    stickerManageMode = enabled;
    stickerManageBtn.setAttribute('aria-pressed',String(enabled));
    stickerManageBtn.textContent = enabled ? 'Terminar de eliminar' : 'Eliminar stickers agregados';
    $('chatStickerGrid').classList.toggle('is-managing',enabled);
    renderStickers();
    if(enabled)text($('stickerStatus'),'Pulsa la papelera en cualquier sticker importado por ti o por Fer. Se quitará para ambos; los ya enviados permanecerán en el chat.');
  }
  stickerManageBtn.addEventListener('click',()=>setStickerManageMode(!stickerManageMode));

  async function removeSavedSticker(s,button){
    // Ambos administran la colección compartida. Solo el propietario puede borrar
    // físicamente un sticker SIN mensajes; cualquiera puede archivarlo para ambos.
    if (!activeUser || !stickerManageMode || s.archived_at) return;
    if (!confirm(`¿Quitar «${s.name}» de los stickers de ambos? Los mensajes antiguos lo conservarán.`)) return;
    button.disabled=true;
    try {
      const own = s.user_id===activeUser.id;
      let archived = !own;
      if(own){
        // Un sticker referenciado nunca se borra físicamente.
        const {count,error:countError}=await sb.from('couple_chat')
          .select('id',{count:'exact',head:true}).eq('sticker_id',s.id);
        if(countError)throw countError;
        archived=(count||0)>0;
        if(!archived){
          const {data:deleted,error:deleteError}=await sb.from('couple_stickers')
            .delete().eq('id',s.id).eq('user_id',activeUser.id).select('id');
          if(deleteError){
            if(deleteError.code==='23503')archived=true;
            else throw deleteError;
          }else if(!deleted?.length){
            throw new Error('No se pudo eliminar el sticker; comprueba los permisos.');
          }else{
            const {error:fileError}=await sb.storage.from(STICKER_BUCKET).remove([s.storage_path]);
            if(fileError)console.warn('El archivo antiguo debe limpiarse manualmente:',fileError);
          }
        }
      }
      if(archived){
        const {data:updated,error:updateError}=await sb.from('couple_stickers')
          .update({archived_at:new Date().toISOString()})
          .eq('id',s.id).is('archived_at',null).select('id');
        if(updateError)throw updateError;
        if(!updated?.length)throw new Error('Ya se retiró el sticker o faltan permisos de edición.');
      }
      await loadStickers();
      text($('stickerStatus'),archived
        ? 'Sticker retirado de la colección compartida. Los mensajes anteriores lo conservan.'
        : 'Sticker añadido eliminado de la colección y del almacenamiento.',true);
    }catch(err){text($('stickerStatus'),'No se pudo quitar el sticker: '+friendly(err));}
    finally{button.disabled=false;}
  }

  // IMPORTAR, GUARDAR Y ENVIAR STICKERS PRIVADOS (PNG / WEBP / GIF).
  async function loadStickers(){
    if(!activeUser)return;
    const {data,error}=await sb.from('couple_stickers').select('id,user_id,name,pack_name,storage_path,created_at,backup_source_id,archived_at').order('created_at',{ascending:false}).limit(200);
    if(error){text($('stickerStatus'),'Ejecuta 04_chat_ahorros.sql: '+friendly(error));return;}
    const arr=data||[];
    const {data:links,error:signErr}=arr.length?await sb.storage.from(STICKER_BUCKET).createSignedUrls(arr.map(s=>s.storage_path),3600):{data:[],error:null};
    if(signErr)console.warn(signErr);
    customStickers=arr.map((s,i)=>({...s,signedUrl:links?.[i]?.signedUrl||''}));
    renderStickers();
    if(page==='chat')renderChat(false,chatWall.scrollHeight-chatWall.scrollTop);
  }
  function renderStickers(){
    const grid=$('chatStickerGrid');
    grid.querySelectorAll('.sticker-custom-tile').forEach(el=>el.remove());
    renderBuiltins();
    const available=customStickers.filter(s=>!s.archived_at);
    for(const sticker of available){
      const tile=document.createElement('div');tile.className='sticker-custom-tile';
      const send=document.createElement('button');send.type='button';send.className='sticker-custom-pick';
      send.title='Enviar '+sticker.name;
      send.disabled=stickerManageMode;
      const img=document.createElement('img');img.src=sticker.signedUrl||'';img.alt=sticker.name;img.loading='lazy';
      const title=document.createElement('small');title.textContent=(sticker.pack_name?sticker.pack_name+' · ':'')+sticker.name;
      send.append(img,title);send.addEventListener('click',()=>sendCustomSticker(sticker.id));
      tile.append(send,makeFavoriteButton(customKey(sticker.id),sticker.name));
      {
        const del=document.createElement('button');del.type='button';del.className='sticker-remove-btn';
        del.title='Quitar sticker agregado '+sticker.name+' de la colección de los dos';del.setAttribute('aria-label','Quitar sticker agregado '+sticker.name);
        del.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg>';
        del.addEventListener('click',()=>removeSavedSticker(sticker,del));tile.append(del);
      }
      grid.append(tile);
    }
    renderFavoriteGrid();
    if(!stickerManageMode){
      if(!available.length)text($('stickerStatus'),'Importa tu primer sticker y aparecerá aquí.');
      else text($('stickerStatus'),`${available.length} stickers disponibles entre los dos. Toca ☆ para favoritos compartidos.`,true);
    }
  }
  async function sendCustomSticker(id){
    if(!activeUser||chatBusy||stickerManageMode||!customStickers.some(s=>s.id===id&&!s.archived_at))return;
    chatBusy=true;
    try{
      const {error}=await sb.from('couple_chat').insert({user_id:activeUser.id,kind:'sticker',sticker_id:id,body:'',reply_preview:replyDraft?.body.slice(0,140)||'',reply_author:replyDraft?.author.slice(0,35)||''});
      if(error)throw error;
      hide($('chatPicker'));clearReply();await loadChat(true);chatWall.scrollTop=chatWall.scrollHeight;
    }catch(err){text($('chatStatus'),friendly(err));}finally{chatBusy=false;}
  }
  $('chatStickerFile').addEventListener('change',async e=>{
    const files=[...(e.target.files||[])];if(!files.length||!activeUser)return;
    const pack=$('chatStickerPack').value.trim().slice(0,40)||'Nuestra colección';
    if(files.length>15){text($('stickerStatus'),'Elige máximo 15 stickers de una vez.');return;}
    if(customStickers.filter(s=>!s.archived_at).length+files.length>100){text($('stickerStatus'),'Máximo 100 stickers entre ambos.');return;}
    let done=0;
    try{
      for(const file of files){
        if(!['image/png','image/webp','image/gif'].includes(file.type)||file.size>2*1024*1024){throw new Error(`El archivo ${file.name} no es PNG, WEBP o GIF de hasta 2 MB.`);}
        const name=(file.name.replace(/\.[^.]+$/,'').slice(0,45)||'Sticker');
        const ext=file.type==='image/gif'?'gif':file.type==='image/webp'?'webp':'png';
        const path=`${activeUser.id}/${crypto.randomUUID()}.${ext}`;
        text($('stickerStatus'),`Guardando sticker ${done+1} de ${files.length}…`);
        const {error:upError}=await sb.storage.from(STICKER_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
        if(upError)throw upError;
        const {error}=await sb.from('couple_stickers').insert({user_id:activeUser.id,name,pack_name:pack,storage_path:path});
        if(error){await sb.storage.from(STICKER_BUCKET).remove([path]);throw error;}
        done++;
      }
      text($('stickerStatus'),`${done} stickers guardados en «${pack}».`,true);
    }catch(err){text($('stickerStatus'),`Se guardaron ${done}: ${friendly(err)}`);}
    finally{e.target.value='';await loadStickers();}
  });

  // DOCUMENTOS Y FOTOS COMPARTIDOS. Archivos privados con enlace temporal al abrirlos.
  const chatTypes={
    'application/pdf':'pdf','text/plain':'txt','text/csv':'csv',
    'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif',
    'application/zip':'zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
    'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a'
  };
  async function sendAttachment(blob,filename,mime,kind){
    if(!activeUser||chatBusy)return;
    if(!chatTypes[mime])throw new Error('Formato no permitido. Prueba PDF, documento, imagen o audio.');
    if(blob.size>12*1024*1024)throw new Error('Límite de 12 MB por archivo.');
    chatBusy=true;
    text($('chatStatus'),'Subiendo archivo cifrado en tránsito al almacenamiento privado…');
    const path=`${activeUser.id}/${crypto.randomUUID()}.${chatTypes[mime]}`;
    try{
      const {error:upError}=await sb.storage.from(CHAT_FILES_BUCKET).upload(path,blob,{contentType:mime,upsert:false});
      if(upError)throw upError;
      const {error}=await sb.from('couple_chat').insert({user_id:activeUser.id,kind,body:'',attachment_path:path,file_name:filename.slice(0,120),file_mime:mime,
        reply_preview:replyDraft?.body.slice(0,140)||'',reply_author:replyDraft?.author.slice(0,35)||''});
      if(error){await sb.storage.from(CHAT_FILES_BUCKET).remove([path]);throw error;}
      clearReply();await loadChat(true);chatWall.scrollTop=chatWall.scrollHeight;
      text($('chatStatus'),'Archivo enviado.',true);
    }finally{chatBusy=false;}
  }
  $('chatAttachBtn').addEventListener('click',()=>$('chatAttachInput').click());
  $('chatAttachInput').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{await sendAttachment(file,file.name,file.type,'file');}catch(err){text($('chatStatus'),friendly(err));}finally{e.target.value='';}
  });

  // Notas de voz. Usa la API del dispositivo; no garantiza formato MP3 ni envío si micrófono no está permitido.
  let mediaRecorder=null,mediaStream=null,voiceChunks=[],voiceTimer=null;
  async function stopVoice(send=true){
    if(!mediaRecorder||mediaRecorder.state==='inactive')return;
    mediaRecorder.datasetSend=send;
    mediaRecorder.stop();
    $('chatRecord').classList.remove('recording');hide($('chatRecording'));
    clearTimeout(voiceTimer);
  }
  $('chatRecord').addEventListener('click',async()=>{
    if(mediaRecorder?.state==='recording'){stopVoice(true);return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){text($('chatStatus'),'Este navegador no admite grabar audio. Puedes adjuntar archivos de audio compatibles más adelante.');return;}
    try{
      mediaStream=await navigator.mediaDevices.getUserMedia({audio:true});
      const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(x=>MediaRecorder.isTypeSupported(x));
      mediaRecorder=mime?new MediaRecorder(mediaStream,{mimeType:mime}):new MediaRecorder(mediaStream);
      voiceChunks=[];
      mediaRecorder.addEventListener('dataavailable',e=>{if(e.data?.size)voiceChunks.push(e.data);});
      mediaRecorder.addEventListener('stop',async()=>{
        const recorded=mediaRecorder,stream=mediaStream;
        stream?.getTracks().forEach(t=>t.stop());mediaStream=null;
        if(!recorded?.datasetSend)return;
        let rawType=(recorded.mimeType||'audio/webm').split(';')[0];
        if(!chatTypes[rawType])rawType='audio/webm';
        const blob=new Blob(voiceChunks,{type:rawType});
        if(blob.size<100){text($('chatStatus'),'No se grabó audio. Intenta de nuevo.');return;}
        try{await sendAttachment(blob,`Audio de ${memberName(activeUser.id)}`,rawType,'audio');}
        catch(err){text($('chatStatus'),friendly(err));}
      },{once:true});
      mediaRecorder.start();
      show($('chatRecording'));$('chatRecord').classList.add('recording');
      text($('chatStatus'),'Grabando… pulsa nuevamente el micrófono para enviar.');
      voiceTimer=setTimeout(()=>stopVoice(true),120000);
    }catch(err){mediaStream?.getTracks().forEach(t=>t.stop());text($('chatStatus'),'Permite el micrófono en Chrome para grabar: '+friendly(err));}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&mediaRecorder?.state==='recording')stopVoice(false);});

  // AHORROS — solo contabilidad manual, no hay acceso a cuentas bancarias.
  const money = n => new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(n||0);
  async function loadSavings(){
    if(!activeUser)return;
    const [g,e]=await Promise.all([
      sb.from('couple_saving_goals').select('id,user_id,name,target_clp,target_date,created_at,backup_source_id').order('created_at',{ascending:false}),
      sb.from('couple_saving_entries').select('id,goal_id,user_id,amount_clp,note,created_at,backup_source_id').order('created_at',{ascending:false})
    ]);
    if(g.error||e.error){text($('savingsStatus'),'Activa 04_chat_ahorros.sql en Supabase. '+friendly(g.error||e.error));return;}
    savingsGoals=g.data||[];savingsEntries=e.data||[];renderSavings();
  }
  function renderSavings(){
    const grid=$('savingGoalList');grid.replaceChildren();
    const sum=(g)=>savingsEntries.filter(e=>e.goal_id===g.id).reduce((a,e)=>a+e.amount_clp,0);
    const overall=savingsGoals.reduce((s,g)=>s+sum(g),0);
    $('savingsTotal').textContent=money(overall);
    $('savingsCount').textContent=`${savingsGoals.length} metas`;
    if(!savingsGoals.length){const p=document.createElement('div');p.className='content-panel empty-savings';p.textContent='Su primera meta puede ser un viaje, un aniversario o un proyecto juntos. Créala arriba.';grid.append(p);return;}
    for(const goal of savingsGoals){
      const total=sum(goal),pct=Math.max(0,Math.min(100,total/goal.target_clp*100));
      const card=document.createElement('article');card.className='saving-goal';
      const heading=document.createElement('div');heading.className='saving-goal-head';
      const h3=document.createElement('h3');h3.textContent=goal.name;
      const pctText=document.createElement('strong');pctText.textContent=Math.round(pct)+'%';heading.append(h3,pctText);
      const vals=document.createElement('div');vals.className='saving-values';vals.textContent=`${money(total)} de ${money(goal.target_clp)} · ${goal.target_date?'Meta '+fmtDate(goal.target_date):'Sin fecha límite'}`;
      const track=document.createElement('div');track.className='saving-track';const fill=document.createElement('span');fill.style.width=pct+'%';track.append(fill);
      const form=document.createElement('form');form.className='saving-add';
      const amount=document.createElement('input');amount.type='number';amount.min='1';amount.max='1000000000';amount.placeholder='Monto CLP';amount.required=true;amount.setAttribute('aria-label','Monto del aporte en CLP');
      const memo=document.createElement('input');memo.maxLength=100;memo.placeholder='Nota opcional';memo.setAttribute('aria-label','Nota del aporte');
      const type=document.createElement('select');type.setAttribute('aria-label','Tipo de movimiento');
      [['1','Agregar'],['-1','Retirar']].forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;type.append(o);});
      const btn=document.createElement('button');btn.className='btn-primary';btn.type='submit';btn.textContent='Registrar';
      form.append(amount,memo,type,btn);
      form.addEventListener('submit',async ev=>{
        ev.preventDefault();let n=Number(amount.value);if(!Number.isInteger(n)||n<1||n>1000000000)return;
        n*=Number(type.value);
        if(n<0 && Math.abs(n)>total){text($('savingsStatus'),'No puedes retirar más de lo registrado en esta meta.');return;}
        btn.disabled=true;
        const {error}=await sb.from('couple_saving_entries').insert({goal_id:goal.id,user_id:activeUser.id,amount_clp:n,note:memo.value.trim()});
        btn.disabled=false;if(error)text($('savingsStatus'),friendly(error));else{amount.value='';memo.value='';await loadSavings();text($('savingsStatus'),'Movimiento registrado.',true);}
      });
      const history=document.createElement('div');history.className='saving-history';
      for(const entry of savingsEntries.filter(e=>e.goal_id===goal.id).slice(0,20)){
        const row=document.createElement('div');row.className='saving-history-row';
        const title=document.createElement('span');title.textContent=`${memberName(entry.user_id)} · ${entry.note||'Movimiento'} · ${fmtCreated(entry.created_at)}`;
        const value=document.createElement('strong');value.textContent=(entry.amount_clp>0?'+':'')+money(entry.amount_clp);
        row.append(title,value);history.append(row);
      }
      card.append(heading,vals,track,form,history);grid.append(card);
    }
  }
  $('savingGoalForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const name=$('savingGoalName').value.trim(),target=Number($('savingGoalAmount').value);
    if(!name||!Number.isInteger(target)||target<1000||target>1e9)return;
    $('savingGoalForm').querySelector('button[type="submit"]').disabled=true;
    const {error}=await sb.from('couple_saving_goals').insert({user_id:activeUser.id,name,target_clp:target,target_date:$('savingGoalDate').value||null});
    $('savingGoalForm').querySelector('button[type="submit"]').disabled=false;
    if(error)text($('savingsStatus'),friendly(error));else{$('savingGoalForm').reset();await loadSavings();text($('savingsStatus'),'Meta creada.',true);}
  });

  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&activeUser&&page==='chat')loadChat(true,true).catch(console.warn);});
  setInterval(()=>{if(activeUser && page==='chat' && !document.hidden)loadChat(true,true).catch(console.warn);},30000);

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
      const [allVideos,allSongs]=await Promise.all([
        fetchAll('couple_videos','id,user_id,storage_path,title,note,location,event_date,created_at,backup_source_id,original_author_name'),
        fetchAll('couple_songs','id,user_id,title,artist,dedication,youtube_id,photo_id,created_at,backup_source_id,original_author_name')
      ]);
      const [allChat, allStickers, allGoals, allEntries]=await Promise.all([
        fetchAll('couple_chat','id,user_id,kind,body,sticker_code,sticker_id,attachment_path,file_name,file_mime,reply_preview,reply_author,created_at,original_author_name,backup_source_id'),
        fetchAll('couple_stickers','id,user_id,name,pack_name,storage_path,created_at,backup_source_id,archived_at'),
        fetchAll('couple_saving_goals','id,user_id,name,target_clp,target_date,created_at,backup_source_id'),
        fetchAll('couple_saving_entries','id,goal_id,user_id,amount_clp,note,created_at,backup_source_id')
      ]);
      const allFavorites=await fetchAll('couple_sticker_favorites','sticker_key,added_by,created_at');
      const zip = new JSZip();
      const people = Object.fromEntries(members.map(m => [m.user_id, m.display_name]));
      const manifest = {
        format: 'fer-alxs-backup', version: 5,
        exported_at: new Date().toISOString(),
        members: members.map(m => ({ user_id: m.user_id, display_name:m.display_name })),
        photos: [], notes: [], songs:[], videos:[], chat:[], stickers:[], favorites:allFavorites.map(f=>f.sticker_key), goals:allGoals, entries:allEntries
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
      let extraBytes=0;
      for(const s of allStickers){
        const {data:blob,error}=await sb.storage.from(STICKER_BUCKET).download(s.storage_path);
        if(error || !blob)throw new Error('No pude recuperar un sticker: '+friendly(error));
        extraBytes+=blob.size;
        if(extraBytes>120*1024*1024)throw new Error('Los adjuntos y stickers superan 120 MB; respalda desde un computador. No se creó un ZIP parcial.');
        const ext=fileExtension(s.storage_path),file=`stickers/${s.id}.${ext}`;
        zip.file(file,blob);const {storage_path,...meta}=s;manifest.stickers.push({...meta,file});
      }
      for(const msg of allChat){
        const author=msg.original_author_name||people[msg.user_id]||'Mi amor';
        const {attachment_path,...meta}=msg;
        if(attachment_path){
          const {data:blob,error}=await sb.storage.from(CHAT_FILES_BUCKET).download(attachment_path);
          if(error || !blob)throw new Error('No pude recuperar un adjunto del chat: '+friendly(error));
          extraBytes+=blob.size;
          if(extraBytes>120*1024*1024)throw new Error('Los adjuntos del chat superan 120 MB; usa un computador para respaldar archivos grandes.');
          const ext=fileExtension(attachment_path),file=`chat/${msg.id}.${ext}`;
          zip.file(file,blob);meta.file=file;
        }
        manifest.chat.push({...meta,author});
        human.push(`CHAT · ${author} · ${msg.created_at}`, msg.kind==='sticker'?'[Sticker compartido]':msg.kind==='audio'?'[Audio adjunto]':msg.kind==='file'?`[Archivo ${msg.file_name}]`:msg.body, '');
      }
      for(const goal of allGoals)human.push(`META: ${goal.name}`,`Objetivo: ${goal.target_clp} CLP`,'');
      for(const entry of allEntries)human.push(`APORTE: ${entry.amount_clp} CLP`,`Nota: ${entry.note||''}`,'');
      for(const song of allSongs){
        manifest.songs.push(song);
        human.push(`CANCIÓN: ${song.title} — ${song.artist||''}`,`YouTube: https://www.youtube.com/watch?v=${song.youtube_id}`,`Dedicatoria: ${song.dedication||''}`,'');
      }
      // Los videos pueden ser grandes. Evita agotar la memoria del celular generando archivos gigantes.
      let videoBytes=0;
      for(const [index,row] of allVideos.entries()){
        backupProgress(`Descargando video ${index+1} de ${allVideos.length}…`,.78+.08*(index+1)/Math.max(1,allVideos.length));
        const {data:videoBlob,error}=await sb.storage.from(VIDEO_BUCKET).download(row.storage_path);
        if(error||!videoBlob)throw new Error(`No se pudo respaldar el video «${row.title}». ${friendly(error||'')}`);
        videoBytes+=videoBlob.size;
        if(videoBytes > 250*1024*1024)throw new Error('Los videos juntos superan 250 MB. Para no colgar el teléfono, exporta los videos por separado antes de intentar un ZIP completo en un computador. No se generó un respaldo incompleto.');
        const ext=fileExtension(row.storage_path);
        const file=`videos/${row.id}.${ext}`;
        zip.file(file,videoBlob);
        const {storage_path,...meta}=row;
        manifest.videos.push({...meta,file,author:row.original_author_name||people[row.user_id]||'Mi amor'});
        human.push(`VIDEO: ${row.title}`,`Fecha: ${row.event_date||'sin fecha'}`,`Lugar: ${row.location||''}`,`Nota: ${row.note||''}`,`Archivo: ${file}`,'');
      }
      if(window.FerV7Backup?.append)await window.FerV7Backup.append({manifest,zip,human,sb,members,activeUser,fetchAll});
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
      text($('backupMessage'), `Se inició la descarga del ZIP: ${allPhotos.length} fotos, ${allVideos.length} videos, ${allSongs.length} canciones, ${allNotes.length} notas y ${allChat.length} mensajes de chat, ${allStickers.length} stickers y ${allGoals.length} metas. Guarda otra copia privada.`, true);
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
      if (data.format !== 'fer-alxs-backup' || ![2,3,4,5].includes(data.version) || !Array.isArray(data.photos) || !Array.isArray(data.notes)) throw new Error('Formato de respaldo incompatible.');
      if (data.photos.length > 5000 || data.notes.length > 10000) throw new Error('El ZIP supera los límites de restauración desde esta web.');
      if(data.version>=3 && (!Array.isArray(data.songs)||!Array.isArray(data.videos)))throw new Error('El respaldo nuevo no tiene sección de canciones o videos.');
      if(data.version>=4 && (!Array.isArray(data.chat)||!Array.isArray(data.stickers)||!Array.isArray(data.goals)||!Array.isArray(data.entries)))throw new Error('Faltan datos de la versión 4 del respaldo.');
      if(data.chat!=null && (!Array.isArray(data.chat)||data.chat.length>20000))throw new Error('Chat inválido o demasiado grande para restaurar.');
      if(data.favorites != null && (!Array.isArray(data.favorites)||data.favorites.length>300||data.favorites.some(k=>typeof k!=='string'||!/^(builtin:[a-z0-9_-]{1,60}|custom:[a-f0-9-]{36})$/.test(k))))throw new Error('Favoritos inválidos en el respaldo.');
      if((data.stickers||[]).length>200||(data.goals||[]).length>1000||(data.entries||[]).length>20000)throw new Error('Los stickers o ahorros superan el límite permitido.');
      for(const s of (data.stickers||[])){
        if(!validSourceId(s.id)||!new RegExp(`^stickers/${s.id}\\.(png|webp|gif)$`,'i').test(s.file)||!zip.file(s.file)||zip.file(s.file)?._data?.uncompressedSize>2*1024*1024)throw new Error('Sticker incompatible en respaldo.');
      }
      for(const msg of (data.chat||[])){
        if(!validSourceId(msg.id)||!['text','sticker','file','audio'].includes(msg.kind)||typeof msg.body!=='string'||msg.body.length>1500)throw new Error('El respaldo contiene un mensaje incompatible.');
        if(msg.kind==='sticker' && !stickerById(msg.sticker_code) && !validSourceId(msg.sticker_id))throw new Error('Sticker del chat inválido.');
        if(['file','audio'].includes(msg.kind)){
          if(!new RegExp(`^chat/${msg.id}\\.(pdf|txt|csv|jpg|png|webp|gif|zip|docx|xlsx|webm|ogg|m4a)$`,'i').test(msg.file)||!zip.file(msg.file)||zip.file(msg.file)?._data?.uncompressedSize>12*1024*1024)throw new Error('Adjunto no válido en el respaldo.');
        }
      }
      for(const goal of (data.goals||[]))if(!validSourceId(goal.id)||typeof goal.name!=='string'||goal.name.length>70||!Number.isInteger(goal.target_clp)||goal.target_clp<1000||goal.target_clp>1e9)throw new Error('Una meta tiene datos inválidos.');
      for(const entry of (data.entries||[]))if(!validSourceId(entry.id)||!validSourceId(entry.goal_id)||!Number.isInteger(entry.amount_clp)||Math.abs(entry.amount_clp)>1e9||entry.amount_clp===0)throw new Error('Movimiento de ahorro inválido.');
      if((data.videos||[]).length>1000||(data.songs||[]).length>10000)throw new Error('Demasiados videos o canciones para restaurar desde un celular.');
      for(const row of (data.videos||[])){
        if(!validSourceId(row.id)||!new RegExp(`^videos/${row.id}\\.(mp4|webm)$`,'i').test(row.file)||!zip.file(row.file))throw new Error('Archivo de video faltante o inválido en respaldo.');
        if(zip.file(row.file)?._data?.uncompressedSize>45*1024*1024)throw new Error('Video mayor de 45 MB en respaldo.');
      }
      for(const row of (data.songs||[])){if(!validSourceId(row.id)||!/^[A-Za-z0-9_-]{11}$/.test(row.youtube_id))throw new Error('Enlace YouTube inválido en respaldo.');}
      for (const row of data.photos) {
        if (!validSourceId(row.id) || !validPhotoPath(row.file, row.id) || !zip.file(row.file)) throw new Error('Hay una foto faltante o una referencia no válida en el ZIP.');
        const entry = zip.file(row.file);
        if (entry?._data?.uncompressedSize > 9 * 1024 * 1024) throw new Error('El ZIP contiene una fotografía demasiado grande.');
      }
      for (const row of data.notes) if (!validSourceId(row.id) || !['message','reminder'].includes(row.type) || typeof row.content !== 'string' || row.content.length > 500) throw new Error('El ZIP contiene una nota incompatible.');
      if (!window.confirm(`Este ZIP contiene ${data.photos.length} fotos, ${(data.videos||[]).length} videos, ${(data.songs||[]).length} canciones y ${data.notes.length} notas, ${(data.chat||[]).length} mensajes de chat.\n\nSe recuperarán los que aún no existan, usando tu cuenta como responsable de la restauración. Los nombres originales se conservarán como autores.\n\n¿Quieres continuar?`)) {
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
      const [existingSongs,existingVideos]=await Promise.all([
        fetchAll('couple_songs','id,backup_source_id'),fetchAll('couple_videos','id,backup_source_id')
      ]);
      const existingChat=await fetchAll('couple_chat','id,backup_source_id');
      const chatIds=new Set(existingChat.flatMap(r=>[r.id,r.backup_source_id].filter(Boolean)));
      const [existingStickers,existingGoals,existingEntries]=await Promise.all([
        fetchAll('couple_stickers','id,backup_source_id'),
        fetchAll('couple_saving_goals','id,backup_source_id'),
        fetchAll('couple_saving_entries','id,backup_source_id')
      ]);
      const stickerIds=new Set(existingStickers.flatMap(r=>[r.id,r.backup_source_id].filter(Boolean)));
      const stickerIdMap=new Map(existingStickers.flatMap(r=>[[r.id,r.id],...(r.backup_source_id?[[r.backup_source_id,r.id]]:[])]));
      const goalIds=new Set(existingGoals.flatMap(r=>[r.id,r.backup_source_id].filter(Boolean)));
      const goalIdMap=new Map(existingGoals.flatMap(r=>[[r.id,r.id],...(r.backup_source_id?[[r.backup_source_id,r.id]]:[])]));
      const entryIds=new Set(existingEntries.flatMap(r=>[r.id,r.backup_source_id].filter(Boolean)));
      const songIds=new Set(existingSongs.flatMap(r=>[r.id,r.backup_source_id].filter(Boolean)));
      const videoIds=new Set(existingVideos.flatMap(r=>[r.id,r.backup_source_id].filter(Boolean)));
      const photoIdMap = new Map(existingPhotos.flatMap(r=>[[r.id,r.id], ...(r.backup_source_id?[[r.backup_source_id,r.id]]:[])]));
      const total = data.photos.length + data.notes.length + (data.videos||[]).length + (data.songs||[]).length + (data.chat||[]).length+(data.stickers||[]).length+(data.goals||[]).length+(data.entries||[]).length;
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
        // La base genera ID nuevo: buscar la foto restaurada para vincular las canciones.
        const {data:newPhoto}=await sb.from('couple_photos').select('id').eq('backup_source_id',sourceId).maybeSingle();
        if(newPhoto?.id)photoIdMap.set(row.id,newPhoto.id);
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
      let restoredVideos=0,restoredSongs=0;
      for(const row of (data.videos||[])){
        index++;
        backupProgress(`Restaurando video ${index} de ${total}…`,.1+.85*index/Math.max(total,1));
        const sourceId=validSourceId(row.backup_source_id)?row.backup_source_id:row.id;
        if(videoIds.has(row.id)||videoIds.has(sourceId)){skipped++;continue;}
        const body=await zip.file(row.file).async('blob');
        const ext=fileExtension(row.file),mime=ext==='mp4'?'video/mp4':'video/webm';
        if(body.size>45*1024*1024)throw new Error('Un video excede 45 MB.');
        const path=`${activeUser.id}/restored-${sourceId}-${Math.random().toString(36).slice(2,8)}.${ext}`;
        const {error:upErr}=await sb.storage.from(VIDEO_BUCKET).upload(path,body,{contentType:mime,upsert:false});if(upErr)throw upErr;
        const payload={user_id:activeUser.id,storage_path:path,title:cut(row.title,100)||'Video recuperado',note:cut(row.note,300),location:cut(row.location,90),event_date:typeof row.event_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.event_date)?row.event_date:null,backup_source_id:sourceId,original_author_name:cut(row.original_author_name||row.author||people[row.user_id]||'Mi amor',35)};
        if(typeof row.created_at==='string'&&!Number.isNaN(Date.parse(row.created_at)))payload.created_at=row.created_at;
        const {error:saveErr}=await sb.from('couple_videos').insert(payload);
        if(saveErr){await sb.storage.from(VIDEO_BUCKET).remove([path]).catch(()=>{});throw saveErr;}
        restoredVideos++;videoIds.add(sourceId);
      }
      for(const row of (data.songs||[])){
        index++;
        backupProgress(`Restaurando canción ${index} de ${total}…`,.1+.85*index/Math.max(total,1));
        const sourceId=validSourceId(row.backup_source_id)?row.backup_source_id:row.id;
        if(songIds.has(row.id)||songIds.has(sourceId)){skipped++;continue;}
        const payload={user_id:activeUser.id,title:cut(row.title,100)||'Canción recuperada',artist:cut(row.artist,90),dedication:cut(row.dedication,300),youtube_id:row.youtube_id,photo_id:photoIdMap.get(row.photo_id)||null,backup_source_id:sourceId,original_author_name:cut(row.original_author_name||people[row.user_id]||'Mi amor',35)};
        if(typeof row.created_at==='string'&&!Number.isNaN(Date.parse(row.created_at)))payload.created_at=row.created_at;
        const {error}=await sb.from('couple_songs').insert(payload);if(error)throw error;
        restoredSongs++;songIds.add(sourceId);
      }
      let restoredStickers=0,restoredGoals=0,restoredEntries=0;
      for(const row of (data.stickers||[])){
        index++;
        backupProgress(`Restaurando sticker ${index} de ${total}…`,.1+.85*index/Math.max(total,1));
        const sid=validSourceId(row.backup_source_id)?row.backup_source_id:row.id;
        if(stickerIds.has(row.id)||stickerIds.has(sid)){skipped++;continue;}
        const blob=await zip.file(row.file).async('blob'),ext=fileExtension(row.file);
        const mime={png:'image/png',webp:'image/webp',gif:'image/gif'}[ext];
        const path=`${activeUser.id}/restored-${sid}-${crypto.randomUUID()}.${ext}`;
        const {error:up}=await sb.storage.from(STICKER_BUCKET).upload(path,blob,{contentType:mime,upsert:false});if(up)throw up;
        const {data:ins,error}=await sb.from('couple_stickers').insert({user_id:activeUser.id,name:cut(row.name,50)||'Sticker',pack_name:cut(row.pack_name,40)||'Recuperados',storage_path:path,backup_source_id:sid,archived_at:typeof row.archived_at==='string'&&!Number.isNaN(Date.parse(row.archived_at))?row.archived_at:null}).select('id').single();
        if(error){await sb.storage.from(STICKER_BUCKET).remove([path]);throw error;}
        stickerIdMap.set(row.id,ins.id);stickerIdMap.set(sid,ins.id);stickerIds.add(sid);restoredStickers++;
      }
      // Restaura la selección compartida; no duplica favoritos existentes.
      for(const key of (data.favorites||[])){
        let mapped=key;
        if(key.startsWith('custom:')){
          const id=stickerIdMap.get(key.slice(7));
          if(!id)continue; // sticker no disponible (nunca recrear una referencia rota)
          mapped=customKey(id);
        }
        const {error:favError}=await sb.from('couple_sticker_favorites')
          .upsert({sticker_key:mapped,added_by:activeUser.id},{onConflict:'sticker_key',ignoreDuplicates:true});
        if(favError)throw favError;
      }
      for(const row of (data.goals||[])){
        index++;
        const sid=validSourceId(row.backup_source_id)?row.backup_source_id:row.id;
        if(goalIds.has(row.id)||goalIds.has(sid)){skipped++;continue;}
        const {data:ins,error}=await sb.from('couple_saving_goals').insert({user_id:activeUser.id,name:cut(row.name,70),target_clp:row.target_clp,target_date:typeof row.target_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.target_date)?row.target_date:null,backup_source_id:sid}).select('id').single();
        if(error)throw error;goalIdMap.set(row.id,ins.id);goalIdMap.set(sid,ins.id);goalIds.add(sid);restoredGoals++;
      }
      for(const row of (data.entries||[])){
        index++;
        const sid=validSourceId(row.backup_source_id)?row.backup_source_id:row.id;
        if(entryIds.has(row.id)||entryIds.has(sid)){skipped++;continue;}
        const goalId=goalIdMap.get(row.goal_id);if(!goalId){skipped++;continue;}
        const payload={user_id:activeUser.id,goal_id:goalId,amount_clp:row.amount_clp,note:cut(row.note,100),backup_source_id:sid};
        if(typeof row.created_at==='string'&&!Number.isNaN(Date.parse(row.created_at)))payload.created_at=row.created_at;
        const {error}=await sb.from('couple_saving_entries').insert(payload);if(error)throw error;
        entryIds.add(sid);restoredEntries++;
      }
      let restoredChat=0;
      for(const row of (data.chat||[])){
        index++;
        backupProgress(`Restaurando chat ${index} de ${total}…`,.1+.85*index/Math.max(total,1));
        const sourceId=validSourceId(row.backup_source_id)?row.backup_source_id:row.id;
        if(chatIds.has(row.id)||chatIds.has(sourceId)){skipped++;continue;}
        let path=null;
        if(['file','audio'].includes(row.kind)){
          const ext=fileExtension(row.file),mime=chatTypes[row.file_mime]===ext?row.file_mime:Object.keys(chatTypes).find(t=>chatTypes[t]===ext);
          if(!mime)throw new Error('El respaldo contiene un adjunto de formato no permitido.');
          const body=await zip.file(row.file).async('blob');
          path=`${activeUser.id}/restored-${sourceId}-${crypto.randomUUID()}.${ext}`;
          const {error:up}=await sb.storage.from(CHAT_FILES_BUCKET).upload(path,body,{contentType:mime,upsert:false});if(up)throw up;
        }
        const payload={user_id:activeUser.id,kind:row.kind,body:cut(row.body,1500),sticker_code:row.kind==='sticker'&&!row.sticker_id?row.sticker_code:null,
          sticker_id:row.sticker_id?stickerIdMap.get(row.sticker_id)||null:null,
          attachment_path:path,file_name:path?cut(row.file_name,120)||'Adjunto restaurado':null,file_mime:path?(chatTypes[row.file_mime]?row.file_mime:Object.keys(chatTypes).find(t=>chatTypes[t]===fileExtension(row.file))):null,
          reply_preview:cut(row.reply_preview,140),reply_author:cut(row.reply_author,35),backup_source_id:sourceId,original_author_name:cut(row.original_author_name||row.author||people[row.user_id]||'Mi amor',35)};
        if(typeof row.created_at==='string'&&!Number.isNaN(Date.parse(row.created_at)))payload.created_at=row.created_at;
        const {error}=await sb.from('couple_chat').insert(payload);
        if(error){if(path)await sb.storage.from(CHAT_FILES_BUCKET).remove([path]).catch(()=>{});throw error;}
        chatIds.add(sourceId);restoredChat++;
      }
      if(data.version===5 && window.FerV7Backup?.restore)await window.FerV7Backup.restore({data,zip,sb,activeUser});
      await Promise.all([loadPhotos(true),loadNotes(),loadVideos(),loadSongs(),loadStickers(),loadFavoriteStickers(),loadSavings(),loadChat(true)]);
      text($('backupMessage'), `Restauración terminada: ${restoredPhotos} fotos, ${restoredVideos} videos, ${restoredSongs} canciones y ${restoredNotes} notas, ${restoredChat} mensajes, ${restoredStickers} stickers, ${restoredGoals} metas y ${restoredEntries} movimientos; ${skipped} ya existían.`, true);

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
  window.FerCoreV7 = Object.freeze({
    sb, user:()=>activeUser, members:()=>members.slice(),
    photos:()=>photos.slice(), allPhotos:()=>fetchAll('couple_photos',pictureFields),
    goPage, openUpload, loadSavings:()=>loadSavings(), goals:()=>savingsGoals.slice(),
    downloadBlob, formatDate:fmtDate
  });
})();
