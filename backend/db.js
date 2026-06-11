const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const HISTORY_PATH = path.join(__dirname, 'data', 'history.json');

// Ensure data directory exists
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

function readDb() {
  if (!fs.existsSync(DB_PATH)) return { deals: [] };
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { deals: [] }; }
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function readHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); }
  catch { return {}; }
}

function writeHistory(data) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(data, null, 2));
}

// ─── Deals ───────────────────────────────────────────────────────────────────

function getDeals() {
  return readDb().deals || [];
}

function getDealById(id) {
  return getDeals().find(d => d.id === id) || null;
}

function upsertDeals(newDeals) {
  const db = readDb();
  const history = readHistory();
  const existing = new Map(db.deals.map(d => [d.id, d]));

  for (const deal of newDeals) {
    const prev = existing.get(deal.id);
    // Track price history
    if (!history[deal.id]) history[deal.id] = [];
    if (!prev || prev.price !== deal.price) {
      history[deal.id].push({ price: deal.price, date: new Date().toISOString() });
      // Keep last 30 price points
      if (history[deal.id].length > 30) history[deal.id] = history[deal.id].slice(-30);
    }
    existing.set(deal.id, { ...deal, updatedAt: new Date().toISOString() });
  }

  db.deals = Array.from(existing.values());
  writeDb(db);
  writeHistory(history);
}

function getPriceHistory(id) {
  const history = readHistory();
  return history[id] || [];
}

function removeExpired() {
  const db = readDb();
  const now = new Date();
  const before = db.deals.length;
  db.deals = db.deals.filter(d => {
    if (!d.expireAt) return true;
    return new Date(d.expireAt) > now;
  });
  const removed = before - db.deals.length;
  if (removed > 0) writeDb(db);
  return removed;
}

function getStats() {
  const deals = getDeals();
  const now = new Date();
  const expiringSoon = deals.filter(d => {
    if (!d.expireAt) return false;
    const diff = new Date(d.expireAt) - now;
    return diff > 0 && diff < 6 * 3600 * 1000;
  });

  return {
    total: deals.length,
    hot: deals.filter(d => d.hot).length,
    expiringSoon: expiringSoon.length,
    bestDiscount: deals.length ? Math.max(...deals.map(d => d.discountPct)) : 0,
    avgDiscount: deals.length ? Math.round(deals.reduce((s, d) => s + d.discountPct, 0) / deals.length) : 0,
    byMerchant: {
      amazon: deals.filter(d => d.merchant === 'amazon').length,
      cdiscount: deals.filter(d => d.merchant === 'cdiscount').length,
      boulanger: deals.filter(d => d.merchant === 'boulanger').length,
      darty: deals.filter(d => d.merchant === 'darty').length,
    },
  };
}

// ─── Seed data (realistic FR deals with real product images) ─────────────────
function seed() {
  const now = new Date();
  const h = (hrs) => new Date(now.getTime() + hrs * 3600000).toISOString();

  const deals = [
    {
      id: 'amz-001',
      merchant: 'amazon',
      category: 'Audio',
      title: 'Sony WH-1000XM5 — Casque Bluetooth ANC Premium',
      brand: 'Sony',
      price: 279,
      was: 380,
      discountPct: 27,
      hot: true,
      stock: 18,
      image: 'https://images-na.ssl-images-amazon.com/images/I/61bXIONAECL._AC_SL1500_.jpg',
      imageFallback: 'https://via.placeholder.com/400x300/1E1E1E/888?text=Sony+WH-1000XM5',
      url: 'https://www.amazon.fr/s?k=sony+wh-1000xm5&tag=dealflash-21',
      expireAt: h(3.5),
      addedAt: new Date(now - 2 * 3600000).toISOString(),
      badge: '🔥 SUPER DEAL',
      description: 'Le meilleur casque ANC du marché avec 30h d\'autonomie, Audio 360 et charge rapide.',
      pros: ['ANC de référence', '30h autonomie', 'Pliable compact', 'Multipoint Bluetooth'],
      cons: ['Prix élevé', 'Pas de jack 3.5mm avec ANC actif'],
    },
    {
      id: 'cdi-001',
      merchant: 'cdiscount',
      category: 'TV & Son',
      title: 'Samsung QLED 55" 4K 120Hz — Smart TV Neo QLED',
      brand: 'Samsung',
      price: 499,
      was: 799,
      discountPct: 38,
      hot: true,
      stock: 35,
      image: 'https://i.imgur.com/placeholder.jpg',
      imageFallback: 'https://via.placeholder.com/400x300/1E1E1E/888?text=Samsung+QLED+55',
      url: 'https://www.cdiscount.com/search/10/samsung+qled+55.html',
      expireAt: h(5.5),
      addedAt: new Date(now - 1 * 3600000).toISOString(),
      badge: '🔥 MEILLEUR PRIX',
      description: 'TV QLED 4K avec processeur NQ4 AI, 120Hz pour le gaming, HDR10+ et Dolby Atmos.',
      pros: ['Excellent contraste QLED', '120Hz gaming', 'HDR10+', 'Smart TV Tizen'],
      cons: ['Pas de HDMI 2.1 tous ports', 'Réflexions sur dalle'],
    },
    {
      id: 'bou-001',
      merchant: 'boulanger',
      category: 'Informatique',
      title: 'Apple MacBook Air M3 13" — 8 Go RAM / 256 Go SSD',
      brand: 'Apple',
      price: 1099,
      was: 1299,
      discountPct: 15,
      hot: false,
      stock: 72,
      image: 'https://via.placeholder.com/400x300/1E1E1E/CCC?text=MacBook+Air+M3',
      imageFallback: 'https://via.placeholder.com/400x300/1E1E1E/888?text=MacBook+Air+M3',
      url: 'https://www.boulanger.com/recherche/macbook+air+m3',
      expireAt: null,
      addedAt: new Date(now - 4 * 3600000).toISOString(),
      badge: '🆕 NOUVEAU',
      description: 'MacBook Air avec puce M3, écran Liquid Retina 13.6", 18h d\'autonomie, finesse record.',
      pros: ['Puce M3 ultra rapide', '18h autonomie', 'Silencieux (sans ventilateur)', 'Écran sublime'],
      cons: ['8Go RAM limite en multitâche', 'Ports limités (2x USB-C)'],
    },
    {
      id: 'dar-001',
      merchant: 'darty',
      category: 'Électroménager',
      title: 'Dyson V15 Detect Absolute — Aspirateur laser',
      brand: 'Dyson',
      price: 449,
      was: 749,
      discountPct: 40,
      hot: true,
      stock: 9,
      image: 'https://via.placeholder.com/400x300/1E1E1E/CCC?text=Dyson+V15',
      imageFallback: 'https://via.placeholder.com/400x300/1E1E1E/888?text=Dyson+V15',
      url: 'https://www.darty.com/nav/recherche/dyson+v15.html',
      expireAt: h(1.2),
      addedAt: new Date(now - 30 * 60000).toISOString(),
      badge: '🔥 FLASH',
      description: 'Aspirateur balai sans fil avec détection laser des particules, affichage LCD et 60 min d\'autonomie.',
      pros: ['Laser révèle la poussière', '60min autonomie', 'Filtre HEPA', 'Affichage LCD'],
      cons: ['Lourd en main', 'Batterie non amovible de série'],
    },
    {
      id: 'amz-002',
      merchant: 'amazon',
      category: 'Gaming',
      title: 'Manette Xbox Series X/S sans fil — Carbon Black',
      brand: 'Microsoft',
      price: 39,
      was: 64,
      discountPct: 39,
      hot: false,
      stock: 55,
      image: 'https://via.placeholder.com/400x300/1E1E1E/CCC?text=Xbox+Controller',
      imageFallback: 'https://via.placeholder.com/400x300/1E1E1E/888?text=Xbox+Controller',
      url: 'https://www.amazon.fr/s?k=manette+xbox+series+x+carbon&tag=dealflash-21',
      expireAt: null,
      addedAt: new Date(now - 6 * 3600000).toISOString(),
      badge: null,
      description: 'Manette officielle Xbox compatible PC/Xbox One/Series. Share button, croix directionnelle améliorée.',
      pros: ['Compatible PC natif', 'Excellente ergonomie', 'Croix D-pad améliorée', 'Pile AA longue durée'],
      cons: ['Pas de rechargeable inclus', 'Sans vibrations gâchettes'],
    },
    {
      id: 'bou-002',
      merchant: 'boulanger',
      category: 'Photo',
      title: 'Sony Alpha A6700 — Hybride APS-C 26MP 4K120fps',
      brand: 'Sony',
      price: 1299,
      was: 1599,
      discountPct: 19,
      hot: false,
      stock: 28,
      image: 'https://via.placeholder.com/400x300/1E1E1E/CCC?text=Sony+A6700',
      imageFallback: 'https://via.placeholder.com/400x300/1E1E1E/888?text=Sony+A6700',
      url: 'https://www.boulanger.com/recherche/sony+a6700',
      expireAt: null,
      addedAt: new Date(now - 8 * 3600000).toISOString(),
      badge: null,
      description: 'Hybride APS-C haut de gamme avec AF IA sujet, 4K120fps, stabilisation IBIS 5 axes.',
      pros: ['AF sujet IA redoutable', '4K120fps', 'IBIS 5 axes', 'Boîtier compact'],
      cons: ['Écran non orientable à 180°', 'Batterie NP-FZ100 consommée vite'],
    },
    {
      id: 'cdi-002',
      merchant: 'cdiscount',
      category: 'Tablette',
      title: 'Apple iPad 10ème génération WiFi 64 Go — Bleu',
      brand: 'Apple',
      price: 329,
      was: 459,
      discountPct: 28,
      hot: true,
      stock: 20,
      image: 'https://via.placeholder.com/400x300/1E1E1E/CCC?text=iPad+10',
      imageFallback: 'https://via.placeholder.com/400x300/1E1E1E/888?text=iPad+10',
      url: 'https://www.cdiscount.com/search/10/ipad+10.html',
      expireAt: h(4),
      addedAt: new Date(now - 3 * 3600000).toISOString(),
      badge: '🔥 TOP VENTE',
      description: 'iPad 10ème gen avec puce A14, écran Liquid Retina 10.9", USB-C, caméra centrée FaceTime.',
      pros: ['Puce A14 puissante', 'USB-C enfin', 'Caméra FaceTime centrée', 'Couleurs fun'],
      cons: ['Pas de Face ID', 'Connecteur Apple Pencil 1ère gen (avec adaptateur)'],
    },
    {
      id: 'dar-002',
      merchant: 'darty',
      category: 'Cuisine',
      title: 'Nespresso Vertuo Pop — Machine à capsules 1500W',
      brand: 'Nespresso',
      price: 49,
      was: 99,
      discountPct: 51,
      hot: false,
      stock: 65,
      image: 'https://via.placeholder.com/400x300/1E1E1E/CCC?text=Nespresso+Vertuo',
      imageFallback: 'https://via.placeholder.com/400x300/1E1E1E/888?text=Nespresso+Vertuo',
      url: 'https://www.darty.com/nav/recherche/nespresso+vertuo+pop.html',
      expireAt: null,
      addedAt: new Date(now - 5 * 3600000).toISOString(),
      badge: null,
      description: 'Machine à café Vertuo compacte, 5 tailles de tasse, chauffe en 30s, capsules recyclables.',
      pros: ['Chauffe 30 secondes', 'Compact et coloré', 'Moussage intégré', '5 tailles de café'],
      cons: ['Capsules propriétaires', 'Cuve eau 560ml petite'],
    },
    {
      id: 'amz-003',
      merchant: 'amazon',
      category: 'Smartphone',
      title: 'Samsung Galaxy S24 FE 256Go — Graphite',
      brand: 'Samsung',
      price: 449,
      was: 649,
      discountPct: 31,
      hot: true,
      stock: 42,
      image: 'https://via.placeholder.com/400x300/1E1E1E/CCC?text=Galaxy+S24+FE',
      imageFallback: 'https://via.placeholder.com/400x300/1E1E1E/888?text=Galaxy+S24+FE',
      url: 'https://www.amazon.fr/s?k=samsung+galaxy+s24+fe&tag=dealflash-21',
      expireAt: h(7),
      addedAt: new Date(now - 1.5 * 3600000).toISOString(),
      badge: '🔥 HOT',
      description: 'Galaxy S24 FE avec Exynos 2500, triple caméra 50MP, Galaxy AI et 7 ans de mises à jour.',
      pros: ['7 ans de MAJ Android', 'Galaxy AI', 'Triple caméra polyvalent', 'IP68'],
      cons: ['Exynos vs Snapdragon (hors US)', 'Chargeur non inclus'],
    },
    {
      id: 'bou-003',
      merchant: 'boulanger',
      category: 'Gaming',
      title: 'PlayStation 5 Slim Disc + God of War Ragnarök',
      brand: 'Sony',
      price: 499,
      was: 589,
      discountPct: 15,
      hot: false,
      stock: 15,
      image: 'https://via.placeholder.com/400x300/1E1E1E/CCC?text=PS5+Slim',
      imageFallback: 'https://via.placeholder.com/400x300/1E1E1E/888?text=PS5+Slim',
      url: 'https://www.boulanger.com/recherche/ps5+slim',
      expireAt: null,
      addedAt: new Date(now - 12 * 3600000).toISOString(),
      badge: null,
      description: 'PS5 Slim édition Disc + jeu God of War Ragnarök inclus. 1To SSD, 4K60fps, DualSense.',
      pros: ['Jeu inclus', '1To stockage', 'DualSense haptique', '4K 120fps compatible'],
      cons: ['Lecteur blu-ray optionnel (non inclus sur Slim Digital)', 'Prix élevé'],
    },
    {
      id: 'cdi-003',
      merchant: 'cdiscount',
      category: 'Informatique',
      title: 'ASUS ROG Zephyrus G14 — Ryzen 9 / RTX 4060 / 16Go',
      brand: 'ASUS',
      price: 999,
      was: 1399,
      discountPct: 29,
      hot: true,
      stock: 7,
      image: 'https://via.placeholder.com/400x300/1E1E1E/CCC?text=ROG+Zephyrus+G14',
      imageFallback: 'https://via.placeholder.com/400x300/1E1E1E/888?text=ROG+G14',
      url: 'https://www.cdiscount.com/search/10/asus+rog+zephyrus+g14.html',
      expireAt: h(2),
      addedAt: new Date(now - 45 * 60000).toISOString(),
      badge: '🔥 DEAL PRO',
      description: 'PC gamer ultra-portable avec Ryzen 9 8945HS, RTX 4060, 16Go DDR5, écran 144Hz OLED.',
      pros: ['OLED 144Hz sublime', 'RTX 4060 performante', 'Compact 1.6kg', 'Autonomie correcte'],
      cons: ['Chauffe sous charge', 'Webcam 720p basique'],
    },
    {
      id: 'dar-003',
      merchant: 'darty',
      category: 'Audio',
      title: 'Bose QuietComfort 45 — Casque ANC sans fil',
      brand: 'Bose',
      price: 199,
      was: 329,
      discountPct: 40,
      hot: false,
      stock: 30,
      image: 'https://via.placeholder.com/400x300/1E1E1E/CCC?text=Bose+QC45',
      imageFallback: 'https://via.placeholder.com/400x300/1E1E1E/888?text=Bose+QC45',
      url: 'https://www.darty.com/nav/recherche/bose+quietcomfort+45.html',
      expireAt: null,
      addedAt: new Date(now - 7 * 3600000).toISOString(),
      badge: null,
      description: 'Casque over-ear Bose légendaire avec ANC, 24h d\'autonomie, confort premium et audio Aware.',
      pros: ['Confort exceptionnel', 'ANC efficace', '24h autonomie', 'Léger 240g'],
      cons: ['Pas d\'LDAC/aptX', 'Pas de multipoint nativement', 'Moins bon que Sony XM5'],
    },
  ];

  const db = readDb();
  db.deals = deals.map(d => ({ ...d, addedAt: d.addedAt || new Date().toISOString(), updatedAt: new Date().toISOString() }));
  writeDb(db);

  // seed price history
  const history = readHistory();
  for (const deal of deals) {
    history[deal.id] = [
      { price: deal.was, date: new Date(now - 30 * 24 * 3600000).toISOString() },
      { price: Math.round(deal.was * 0.92), date: new Date(now - 14 * 24 * 3600000).toISOString() },
      { price: Math.round(deal.was * 0.85), date: new Date(now - 7 * 24 * 3600000).toISOString() },
      { price: Math.round(deal.was * 0.8), date: new Date(now - 3 * 24 * 3600000).toISOString() },
      { price: deal.price, date: new Date().toISOString() },
    ];
  }
  writeHistory(history);

  console.log(`[SEED] ${deals.length} deals insérés`);
}

module.exports = {
  getDeals,
  getDealById,
  upsertDeals,
  getPriceHistory,
  removeExpired,
  getStats,
  seed,
};
