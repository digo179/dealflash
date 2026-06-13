// ─── DealFlash App ────────────────────────────────────────────────────────
const API = 'https://dealflash-api.onrender.com/api';
const AMAZON_TAG = 'nadjinal-21';

function addAffiliateTag(url, merchant) {
  if (!url) return url;
  if (merchant === 'amazon') {
    return url.includes('?') ? url + '&tag=' + AMAZON_TAG : url + '?tag=' + AMAZON_TAG;
  }
  return url;
}

let state = {
  deals: [], total: 0, skip: 0,
  filter: 'all', categoryFilter: '', search: '',
  sort: 'discount',
  page: 'home',
  currentDeal: null,
  compareDeal1: null, compareDeal2: null,
  favorites: JSON.parse(localStorage.getItem('favorites')||'[]'),
  alerts: JSON.parse(localStorage.getItem('alerts')||'[]'),
  stats: {},
};

async function apiFetch(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function loadDeals(reset=false) {
  if (reset) { state.deals=[]; state.skip=0; }
  showSkeleton();
  const params = new URLSearchParams({
    limit: 8, skip: state.skip, sort: state.sort,
    ...(state.filter!=='all' && ['amazon','cdiscount','boulanger','darty'].includes(state.filter) ? {merchant:state.filter} : {}),
    ...(state.categoryFilter ? {category:state.categoryFilter} : {}),
    ...(state.search ? {search:state.search} : {}),
  });
  const data = await apiFetch(`/deals?${params}`);
  state.deals = reset ? data.deals : [...state.deals, ...data.deals];
  state.total = data.total;
  state.skip += data.deals.length;
  renderDeals();
}

async function loadStats() {
  state.stats = await apiFetch('/stats');
  renderStats();
}

async function loadDealDetail(id) {
  const data = await apiFetch(`/deals/${id}`);
  state.currentDeal = data.deal;
  state.currentHistory = data.history || [];
  state.page = 'detail';
  renderPage();
}

function renderPage() {
  const pages = ['home','detail','compare','alerts','favorites'];
  pages.forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.style.display = p===state.page ? 'block' : 'none';
  });
  if (state.page==='detail')    renderDetail();
  if (state.page==='compare')   renderCompare();
  if (state.page==='alerts')    renderAlerts();
  if (state.page==='favorites') renderFavorites();
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navMap = {home:0, favorites:3, alerts:2};
  if (navMap[state.page]!==undefined)
    document.querySelectorAll('.nav-item')[navMap[state.page]]?.classList.add('active');
}

function showSkeleton() {
  if (state.skip > 0) return;
  document.getElementById('dealsFeed').innerHTML = Array(4).fill(`
    <div class="deal-card skeleton-card">
      <div class="skeleton-img"></div>
      <div class="deal-body">
        <div class="skeleton-line" style="width:40%"></div>
        <div class="skeleton-line" style="width:90%;margin-top:10px"></div>
        <div class="skeleton-line" style="width:70%"></div>
        <div class="skeleton-line" style="width:50%;margin-top:10px"></div>
      </div>
    </div>
  `).join('');
}

function renderStats() {
  const s = state.stats;
  document.getElementById('statTotal').textContent = s.total || 0;
  document.getElementById('statBest').textContent = s.bestDiscount ? `-${s.bestDiscount}%` : '—';
  document.getElementById('statLow').textContent = s.lowStock || 0;
}

function getMerchantColor(m) {
  return {amazon:'#FF9900',cdiscount:'#E2001A',boulanger:'#E40046',darty:'#FF6600'}[m]||'#888';
}
function getMerchantBg(m) {
  return {amazon:'rgba(255,153,0,0.15)',cdiscount:'rgba(226,0,26,0.15)',boulanger:'rgba(228,0,70,0.15)',darty:'rgba(255,102,0,0.15)'}[m]||'rgba(136,136,136,0.15)';
}

function stockInfo(s) {
  if (s<=10) return {cls:'low', label:`⚠️ ${s} restants`, pct:Math.min(s*3,30)};
  if (s<=30) return {cls:'mid', label:`Stock limité`,    pct:Math.min(s*1.5,60)};
  return           {cls:'high',label:`En stock`,          pct:Math.min(s,100)};
}

function isFav(id) { return state.favorites.includes(id); }

function dealCardHTML(d) {
  const si = stockInfo(d.stock||50);
  const fav = isFav(d._id);
  const badgeHtml = d.hot ? `<div class="badge-hot">🔥 DEAL</div>` : '';
  const imgHtml = d.image
    ? `<img class="deal-card-img" src="${d.image}" alt="${escHtml(d.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const emojiMap={'Audio':'🎧','TV & Écrans':'📺','Informatique':'💻','Smartphones':'📱','Tablettes':'📱','Gaming':'🎮','Électroménager':'🏠','Cuisine':'☕','Photo & Vidéo':'📷','Montres':'⌚','Maison Connect.':'💡'};
  const emoji = emojiMap[d.category]||'🛍️';
  return `
<div class="deal-card${d.hot?' hot':''}" data-id="${d._id}">
  ${imgHtml}
  <div class="deal-img-placeholder" style="display:${d.image?'none':'flex'}">${emoji}</div>
  ${badgeHtml}
  ${d.discount ? `<div class="badge-discount">${d.discount}</div>` : ''}
  <div class="deal-body">
    <div class="merchant-row">
      <span class="merchant-tag" style="background:${getMerchantBg(d.merchant)};color:${getMerchantColor(d.merchant)}">${cap(d.merchant)}</span>
      <span class="deal-category">${d.category||''}</span>
    </div>
    <div class="deal-title">${escHtml(d.title)}</div>
    <div class="price-row">
      <span class="price-now">${fmt(d.price)}</span>
      ${d.was ? `<span class="price-was">${fmt(d.was)}</span>` : ''}
      ${d.was ? `<span class="discount-badge">${Math.round((1-d.price/d.was)*100)}% off</span>` : ''}
    </div>
    <div class="stock-row">
      <div class="stock-bar-wrap"><div class="stock-bar-fill ${si.cls}" style="width:${si.pct}%"></div></div>
      <span class="stock-label ${si.cls}">${si.label}</span>
    </div>
    <div class="deal-footer">
      <button class="btn-deal" onclick="openDeal('${d._id}')">Voir le deal →</button>
      <div class="btn-action${fav?' saved':''}" onclick="toggleFav('${d._id}',event)">${fav?'❤️':'🤍'}</div>
      <div class="btn-action" onclick="addToCompare('${d._id}',event)" title="Comparer">⚖️</div>
    </div>
  </div>
</div>`;
}

function renderDeals() {
  const feed = document.getElementById('dealsFeed');
  if (!state.deals.length) {
    feed.innerHTML = `<div class="empty-state">😕<br>Aucun deal trouvé</div>`;
    document.getElementById('loadMoreBtn').style.display='none';
    return;
  }
  feed.innerHTML = state.deals.map(dealCardHTML).join('');
  document.getElementById('dealCount').textContent = state.total;
  document.getElementById('loadMoreBtn').style.display = state.deals.length < state.total ? 'block' : 'none';
}

function renderDetail() {
  const d = state.currentDeal;
  if (!d) return;
  const fav = isFav(d._id);
  const si = stockInfo(d.stock||50);
  const savings = d.was ? (d.was - d.price) : 0;
  const emojiMap={'Audio':'🎧','TV & Écrans':'📺','Informatique':'💻','Smartphones':'📱','Gaming':'🎮','Électroménager':'🏠','Cuisine':'☕','Photo & Vidéo':'📷','Montres':'⌚','Tablettes':'📱'};
  const emoji = emojiMap[d.category]||'🛍️';
  const dealUrl = addAffiliateTag(d.url, d.merchant);

  document.getElementById('page-detail').innerHTML = `
<div class="detail-header">
  <button class="back-btn" onclick="goHome()">← Retour</button>
  <div class="detail-actions">
    <div class="btn-action${fav?' saved':''}" onclick="toggleFav('${d._id}',event)">${fav?'❤️':'🤍'}</div>
    <div class="btn-action" onclick="addToCompare('${d._id}',event)">⚖️</div>
    <div class="btn-action" onclick="shareDetail()">📤</div>
  </div>
</div>
<div class="detail-img-wrap">
  ${d.image
    ? `<img src="${d.image}" alt="${escHtml(d.title)}" class="detail-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : ''}
  <div class="detail-img-placeholder" style="display:${d.image?'none':'flex'}">${emoji}</div>
  ${d.hot?`<div class="badge-hot" style="top:12px;left:12px">🔥 DEAL</div>`:''}
</div>
<div class="detail-body">
  <div class="merchant-row">
    <span class="merchant-tag" style="background:${getMerchantBg(d.merchant)};color:${getMerchantColor(d.merchant)}">${cap(d.merchant)}</span>
    <span class="deal-category">${d.category||''}</span>
  </div>
  <h1 class="detail-title">${escHtml(d.title)}</h1>
  <div class="detail-price-block">
    <span class="price-now" style="font-size:32px">${fmt(d.price)}</span>
    ${d.was?`<span class="price-was" style="font-size:18px">${fmt(d.was)}</span>`:''}
    ${d.discount?`<span class="discount-badge" style="font-size:16px">${d.discount}</span>`:''}
  </div>
  ${savings>0?`<div class="savings-tag">💰 Tu économises ${fmt(savings)}</div>`:''}

  <div class="detail-stock">
    <div class="stock-row" style="margin-bottom:0">
      <div class="stock-bar-wrap" style="flex:1"><div class="stock-bar-fill ${si.cls}" style="width:${si.pct}%"></div></div>
      <span class="stock-label ${si.cls}">${si.label}</span>
    </div>
  </div>

  <div class="section-card">
    <div class="section-card-title">📈 Historique des prix</div>
    <canvas id="priceChart" height="120"></canvas>
    <div id="priceChartEmpty" style="display:none;text-align:center;color:#666;padding:20px;font-size:13px">Pas encore d'historique</div>
  </div>

  <div class="section-card">
    <div class="section-card-title">🔔 Alerte prix</div>
    <div style="font-size:12px;color:#888;margin-bottom:10px">Reçois une notification quand le prix baisse sous ton seuil</div>
    <div class="alert-form">
      <input id="alertEmail" class="alert-input" type="email" placeholder="ton@email.fr" />
      <input id="alertPrice" class="alert-input" type="number" placeholder="Prix cible (€)" step="0.01" value="${d.price}" />
      <button class="btn-alert" onclick="createAlert()">Créer l'alerte 🔔</button>
    </div>
  </div>

  <div class="section-card">
    <div class="section-card-title">ℹ️ Infos deal</div>
    <div class="info-grid">
      <div class="info-row"><span class="info-label">Marchand</span><span class="info-val">${cap(d.merchant)}</span></div>
      <div class="info-row"><span class="info-label">Catégorie</span><span class="info-val">${d.category||'N/A'}</span></div>
      ${d.was?`<div class="info-row"><span class="info-label">Prix normal</span><span class="info-val">${fmt(d.was)}</span></div>`:''}
      ${d.was?`<div class="info-row"><span class="info-label">Réduction</span><span class="info-val" style="color:var(--green)">${Math.round((1-d.price/d.was)*100)}%</span></div>`:''}
      <div class="info-row"><span class="info-label">Stock</span><span class="info-val ${si.cls}">${d.stock} unités</span></div>
      ${d.merchant==='amazon'?`<div class="info-row"><span class="info-label">Affiliation</span><span class="info-val" style="color:var(--green)">✅ Lien affilié actif</span></div>`:''}
    </div>
  </div>

  <a href="${dealUrl}" target="_blank" rel="noopener" class="btn-deal-big" onclick="trackClick('${d._id}','${d.merchant}')">
    Voir sur ${cap(d.merchant)} →
  </a>
</div>`;

  setTimeout(() => drawPriceChart(d, state.currentHistory||[]), 100);
}

function drawPriceChart(deal, history) {
  const canvas = document.getElementById('priceChart');
  if (!canvas) return;
  const allPoints = [
    ...history.map(h => ({ date: new Date(h.date), price: h.price })),
    { date: new Date(), price: deal.price }
  ].sort((a,b) => a.date - b.date);

  if (allPoints.length < 2) {
    canvas.style.display='none';
    const empty = document.getElementById('priceChartEmpty');
    if(empty) empty.style.display='block';
    return;
  }
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.parentElement.offsetWidth - 32;
  const H = canvas.height = 120;
  const prices = allPoints.map(p=>p.price);
  const minP = Math.min(...prices)*0.95;
  const maxP = Math.max(...prices)*1.05;
  const pad = {l:50,r:16,t:16,b:32};
  const cw = W-pad.l-pad.r, ch = H-pad.t-pad.b;

  ctx.clearRect(0,0,W,H);

  const px = i => pad.l + (i/(allPoints.length-1))*cw;
  const py = v => pad.t + ch - ((v-minP)/(maxP-minP))*ch;

  ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth=1;
  [0,0.5,1].forEach(f=>{
    const y=pad.t+ch*f;
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(pad.l+cw,y); ctx.stroke();
    ctx.fillStyle='#555'; ctx.font='10px Inter'; ctx.textAlign='right';
    ctx.fillText(fmt(minP+(maxP-minP)*(1-f)), pad.l-4, y+4);
  });

  const grad = ctx.createLinearGradient(0,pad.t,0,pad.t+ch);
  grad.addColorStop(0,'rgba(0,196,106,0.3)');
  grad.addColorStop(1,'rgba(0,196,106,0)');
  ctx.beginPath();
  ctx.moveTo(px(0), py(allPoints[0].price));
  allPoints.forEach((_,i)=>{ if(i>0) ctx.lineTo(px(i),py(allPoints[i].price)); });
  ctx.lineTo(px(allPoints.length-1),pad.t+ch);
  ctx.lineTo(px(0),pad.t+ch);
  ctx.closePath(); ctx.fillStyle=grad; ctx.fill();

  ctx.beginPath(); ctx.strokeStyle='#00C46A'; ctx.lineWidth=2.5;
  allPoints.forEach((p,i)=>{ i===0 ? ctx.moveTo(px(i),py(p.price)) : ctx.lineTo(px(i),py(p.price)); });
  ctx.stroke();

  allPoints.forEach((p,i)=>{
    ctx.beginPath();
    ctx.arc(px(i),py(p.price),4,0,Math.PI*2);
    ctx.fillStyle=i===allPoints.length-1?'#FF2D55':'#00C46A';
    ctx.fill();
  });

  ctx.fillStyle='#555'; ctx.font='9px Inter'; ctx.textAlign='center';
  [0, Math.floor(allPoints.length/2), allPoints.length-1].forEach(i=>{
    if(allPoints[i]) {
      const d=allPoints[i].date;
      ctx.fillText(`${d.getDate()}/${d.getMonth()+1}`, px(i), H-6);
    }
  });
}

function renderCompare() {
  const d1=state.compareDeal1, d2=state.compareDeal2;
  const el = document.getElementById('page-compare');

  const slotHTML = (d, slot) => d ? `
    <div class="compare-slot filled">
      ${d.image ? `<img src="${d.image}" alt="" class="compare-thumb" onerror="this.style.display='none'">` : ''}
      <div class="compare-slot-title">${escHtml(d.title.slice(0,60))}...</div>
      <div style="font-size:22px;font-weight:900;color:var(--green);margin:6px 0">${fmt(d.price)}</div>
      ${d.was?`<div style="font-size:13px;color:var(--muted);text-decoration:line-through">${fmt(d.was)}</div>`:''}
      <div class="merchant-tag" style="background:${getMerchantBg(d.merchant)};color:${getMerchantColor(d.merchant)};margin:8px auto;display:inline-block">${cap(d.merchant)}</div>
      <button class="btn-remove-compare" onclick="removeCompare(${slot})">✕ Retirer</button>
    </div>` :
    `<div class="compare-slot empty" onclick="goHome()">
      <div style="font-size:32px">➕</div>
      <div style="font-size:13px;color:var(--muted);margin-top:8px">Ajoute un deal<br>depuis l'accueil</div>
    </div>`;

  const versusHTML = (d1&&d2) ? (() => {
    const cheaper = d1.price < d2.price ? d1 : d2;
    const savePct1 = d1.was ? Math.round((1-d1.price/d1.was)*100) : 0;
    const savePct2 = d2.was ? Math.round((1-d2.price/d2.was)*100) : 0;
    const winner = savePct1 > savePct2 ? d1 : d2;
    return `
    <div class="versus-block">
      <div class="versus-row">
        <span>💰 Prix le plus bas</span>
        <strong style="color:var(--green)">${cap(cheaper.merchant)} — ${fmt(cheaper.price)}</strong>
      </div>
      <div class="versus-row">
        <span>🏆 Meilleure remise</span>
        <strong style="color:var(--green)">${cap(winner.merchant)} — ${savePct1>savePct2?savePct1:savePct2}% off</strong>
      </div>
      <div class="versus-row">
        <span>📦 Plus de stock</span>
        <strong>${cap(d1.stock>d2.stock?d1.merchant:d2.merchant)} — ${Math.max(d1.stock,d2.stock)} unités</strong>
      </div>
      <div style="background:rgba(0,196,106,0.1);border:1px solid rgba(0,196,106,0.3);border-radius:12px;padding:12px;margin-top:8px;text-align:center">
        <span style="color:var(--green);font-weight:700;font-size:14px">✅ Notre conseil : ${cap(winner.merchant)}</span>
      </div>
    </div>`;
  })() : '';

  el.innerHTML = `
<div class="detail-header">
  <button class="back-btn" onclick="goHome()">← Retour</button>
  <span style="font-size:15px;font-weight:700">⚖️ Comparateur</span>
</div>
<div style="padding:12px">
  <div class="compare-grid">
    ${slotHTML(d1,1)}
    <div class="vs-separator">VS</div>
    ${slotHTML(d2,2)}
  </div>
  ${versusHTML}
</div>`;
}

function addToCompare(id, event) {
  if (event) event.stopPropagation();
  const deal = state.deals.find(d=>d._id===id) || state.currentDeal;
  if (!deal) { showToast('Deal introuvable'); return; }
  if (!state.compareDeal1) {
    state.compareDeal1 = deal;
    showToast('✅ Deal 1 ajouté — ajoute le 2ème');
  } else if (!state.compareDeal2) {
    if (state.compareDeal1._id===deal._id) { showToast('Choisis un deal différent'); return; }
    state.compareDeal2 = deal;
    state.page = 'compare';
    renderPage();
  } else {
    state.compareDeal1 = deal; state.compareDeal2 = null;
    showToast('✅ Comparaison réinitialisée');
  }
}

function removeCompare(slot) {
  if (slot===1) state.compareDeal1 = null;
  else state.compareDeal2 = null;
  renderCompare();
}

function renderAlerts() {
  const el = document.getElementById('page-alerts');
  const alerts = state.alerts;
  el.innerHTML = `
<div class="detail-header">
  <button class="back-btn" onclick="goHome()">← Retour</button>
  <span style="font-size:15px;font-weight:700">🔔 Mes Alertes Prix</span>
</div>
<div style="padding:12px">
  ${!alerts.length ? `<div class="empty-state">🔕<br>Aucune alerte configurée<br><small style="color:#666;margin-top:6px;display:block">Va sur un deal pour créer une alerte</small></div>` :
    alerts.map(a=>`
    <div class="alert-card">
      <div class="alert-card-title">${escHtml((a.dealTitle||'').slice(0,60))}...</div>
      <div class="alert-card-row">
        <span class="alert-email">📧 ${escHtml(a.email)}</span>
        <span class="alert-price">Cible : ${fmt(a.targetPrice)}</span>
      </div>
      <div class="alert-card-row">
        <span style="font-size:11px;color:${a.triggered?'var(--green)':'var(--orange)'}">${a.triggered?'✅ Déclenché':'⏳ En attente'}</span>
        <button class="btn-remove-alert" onclick="removeAlert('${a.localId}')">Supprimer</button>
      </div>
    </div>`).join('')
  }
</div>`;
}

async function createAlert() {
  const email = document.getElementById('alertEmail')?.value?.trim();
  const price = parseFloat(document.getElementById('alertPrice')?.value);
  const d = state.currentDeal;
  if (!email || !email.includes('@')) { showToast('❌ Email invalide'); return; }
  if (!price || price<=0) { showToast('❌ Prix invalide'); return; }
  const alert = {
    localId: Date.now().toString(),
    email, targetPrice: price,
    externalId: d.externalId || d._id,
    dealTitle: d.title,
    triggered: false, createdAt: new Date().toISOString()
  };
  state.alerts.push(alert);
  localStorage.setItem('alerts', JSON.stringify(state.alerts));
  try {
    await fetch(`${API}/alerts`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(alert) });
  } catch(_) {}
  showToast('🔔 Alerte créée !');
  document.getElementById('alertEmail').value='';
}

function removeAlert(localId) {
  state.alerts = state.alerts.filter(a=>a.localId!==localId);
  localStorage.setItem('alerts', JSON.stringify(state.alerts));
  renderAlerts();
  showToast('Alerte supprimée');
}

async function renderFavorites() {
  const el = document.getElementById('page-favorites');
  el.innerHTML = `
<div class="detail-header">
  <button class="back-btn" onclick="goHome()">← Retour</button>
  <span style="font-size:15px;font-weight:700">❤️ Mes Favoris</span>
</div>
<div id="favsFeed" style="padding:0 12px"></div>`;

  if (!state.favorites.length) {
    document.getElementById('favsFeed').innerHTML=`<div class="empty-state">🤍<br>Aucun favori encore<br><small style="color:#666;margin-top:6px;display:block">Tape 🤍 sur un deal pour l'ajouter</small></div>`;
    return;
  }
  const deals = (await Promise.allSettled(
    state.favorites.map(id => apiFetch(`/deals/${id}`).then(r=>r.deal))
  )).filter(r=>r.status==='fulfilled').map(r=>r.value);
  document.getElementById('favsFeed').innerHTML = deals.map(dealCardHTML).join('');
}

function toggleFav(id, event) {
  if(event) event.stopPropagation();
  if (state.favorites.includes(id)) {
    state.favorites = state.favorites.filter(f=>f!==id);
    showToast('Retiré des favoris');
  } else {
    state.favorites.push(id);
    showToast('❤️ Ajouté aux favoris !');
  }
  localStorage.setItem('favorites', JSON.stringify(state.favorites));
  if (state.page==='home') renderDeals();
  else if (state.page==='detail') renderDetail();
  else if (state.page==='favorites') renderFavorites();
}

function goHome() {
  state.page='home';
  renderPage();
  loadDeals(true);
  loadStats();
}

function openDeal(id) {
  loadDealDetail(id);
}

function trackClick(id, merchant) {
  console.log(`[CLICK] ${id} — ${merchant}`);
}

function shareDetail() {
  const d = state.currentDeal;
  if (!d) return;
  const dealUrl = addAffiliateTag(d.url, d.merchant);
  const text = `🔥 Deal : ${d.title} — ${fmt(d.price)}${d.was?` au lieu de ${fmt(d.was)}`:''}`;
  if (navigator.share) navigator.share({ title: d.title, text, url: dealUrl });
  else { navigator.clipboard?.writeText(dealUrl); showToast('Lien copié !'); }
}

function fmt(n) { return n!=null ? n.toLocaleString('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:0}) : '—'; }
function cap(s) { return s ? s.charAt(0).toUpperCase()+s.slice(1) : ''; }
function escHtml(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(()=>t.classList.remove('show'), 2400);
}

async function askAI() {
  const input = document.getElementById('aiInput');
  const query = input.value.trim();
  if (!query) return;
  const loading = document.getElementById('aiLoading');
  const response = document.getElementById('aiResponse');
  loading.style.display='flex'; response.innerHTML=''; input.value='';
  try {
    const dealsCtx = state.deals.slice(0,6).map(d=>`${d.title} (${fmt(d.price)}${d.was?` au lieu de ${fmt(d.was)}`:''}${d.discount?`, ${d.discount}`:''})`).join('\n');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-20250514', max_tokens:800,
        system:`Tu es DealBot, expert bons plans sur Amazon FR, Cdiscount, Boulanger et Darty. Tu es direct, concis (max 4 phrases), en français. Deals actuellement disponibles :\n${dealsCtx}`,
        messages:[{ role:'user', content:query }]
      })
    });
    const data = await res.json();
    loading.style.display='none';
    response.innerHTML = (data.content?.[0]?.text||'Désolé, je n\'ai pas pu répondre.')
      .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
      .replace(/\n/g,'<br>');
  } catch(e) {
    loading.style.display='none';
    response.innerHTML='Erreur de connexion.';
  }
}

function renderMiniCards() {
  const hotDeals = state.deals.filter(d=>d.hot).slice(0,6);
  const el = document.getElementById('hotScroll');
  if (!el) return;
  if (!hotDeals.length) { el.parentElement.style.display='none'; return; }
  el.innerHTML = hotDeals.map(d => {
    const emojiMap={'Audio':'🎧','TV & Écrans':'📺','Informatique':'💻','Smartphones':'📱','Gaming':'🎮','Électroménager':'🏠','Cuisine':'☕','Photo & Vidéo':'📷'};
    return `
    <div class="mini-card" onclick="openDeal('${d._id}')">
      ${d.image
        ? `<img src="${d.image}" alt="" class="mini-card-img-real" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
      <div class="mini-card-img" style="display:${d.image?'none':'flex'}">${emojiMap[d.category]||'🛍️'}</div>
      <div class="mini-card-body">
        <div class="mini-card-title">${escHtml(d.title)}</div>
        <div class="mini-card-price">${fmt(d.price)}</div>
        ${d.was?`<div class="mini-card-was">${fmt(d.was)}</div>`:''}
        ${d.discount?`<div class="mini-card-badge">${d.discount}</div>`:''}
      </div>
    </div>`;
  }).join('');
}

async function loadCategories() {
  try {
    const cats = await apiFetch('/categories');
    const el = document.getElementById('categoriesRow');
    if (!el) return;
    el.innerHTML = `<div class="chip active" data-cat="" onclick="filterCat(this,'')">Toutes</div>` +
      cats.slice(0,8).map(c=>`<div class="chip" data-cat="${escHtml(c.name)}" onclick="filterCat(this,'${escHtml(c.name)}')">${escHtml(c.name)} <span style="opacity:.5;font-size:10px">${c.count}</span></div>`).join('');
  } catch(_) {}
}

function filterCat(el, cat) {
  document.querySelectorAll('#categoriesRow .chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  state.categoryFilter = cat;
  loadDeals(true).then(renderMiniCards);
}

async function init() {
  document.querySelectorAll('.nav-item').forEach((item,i) => {
    item.addEventListener('click', () => {
      const pages=['home','trending','alerts','favorites','profile'];
      if (pages[i]==='home') { state.page='home'; renderPage(); loadDeals(true); loadStats(); }
      else if (pages[i]==='alerts') { state.page='alerts'; renderPage(); }
      else if (pages[i]==='favorites') { state.page='favorites'; renderPage(); renderFavorites(); }
      else showToast('Section bientôt disponible');
    });
  });

  document.querySelectorAll('#filtersRow .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#filtersRow .chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active');
      state.filter = chip.dataset.filter;
      loadDeals(true).then(renderMiniCards);
    });
  });

  document.getElementById('sortSelect')?.addEventListener('change', e => {
    state.sort = e.target.value;
    loadDeals(true);
  });

  let searchTimer;
  document.getElementById('searchInput')?.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search=e.target.value; loadDeals(true); }, 400);
  });

  document.getElementById('loadMoreBtn')?.addEventListener('click', () => loadDeals(false));
  document.getElementById('aiBtn')?.addEventListener('click', askAI);
  document.getElementById('aiInput')?.addEventListener('keydown', e=>{ if(e.key==='Enter') askAI(); });

  await Promise.all([loadDeals(true), loadStats(), loadCategories()]);
  renderMiniCards();

  setInterval(async ()=>{
    if(state.page!=='home') return;
    try {
      const data = await apiFetch(`/deals?limit=8&skip=0&sort=${state.sort}`);
      data.deals.forEach(fresh => {
        const idx = state.deals.findIndex(d=>d._id===fresh._id);
        if(idx>=0 && state.deals[idx].stock !== fresh.stock) {
          state.deals[idx].stock = fresh.stock;
        }
      });
      renderDeals();
    } catch(_){}
  }, 20000);
}

document.addEventListener('DOMContentLoaded', init);
