/**
 * DealFlash Backend
 * Express API + Scrapers Amazon/Cdiscount/Boulanger/Darty + NeDB + Alertes prix
 * ✅ Compatible Render.com (free tier)
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const Datastore = require('nedb-promises');
const path = require('path');
const fs = require('fs');

const app = express();

// ─── CORS — autorise le frontend Netlify + localhost ──────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  process.env.FRONTEND_URL, // ex: https://dealflash.netlify.app
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Autoriser les requêtes sans origin (Postman, curl) + les origines connues
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(null, true); // En dev on autorise tout — restreindre en prod si besoin
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// ─── DATABASE ──────────────────────────────────────────────────────────────
// Sur Render free tier, /tmp est le seul dossier vraiment persistant
// entre redémarrages à chaud. Pour la vraie persistance longue durée,
// brancher MongoDB Atlas free (voir README).
const DB_DIR = process.env.DB_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = {
  deals:   Datastore.create({ filename: path.join(DB_DIR, 'deals.db'),   autoload: true }),
  alerts:  Datastore.create({ filename: path.join(DB_DIR, 'alerts.db'),  autoload: true }),
  history: Datastore.create({ filename: path.join(DB_DIR, 'history.db'), autoload: true }),
};

// ─── HEADERS SCRAPING ─────────────────────────────────────────────────────
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xhtml;q=0.9,*/*;q=0.8',
};

async function fetchPage(url) {
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 12000 });
    return cheerio.load(data);
  } catch (e) {
    console.error(`[FETCH ERROR] ${url}: ${e.message}`);
    return null;
  }
}

// ─── CATEGORY GUESSER ─────────────────────────────────────────────────────
function guessCategory(title) {
  const t = title.toLowerCase();
  if (/tv|télé|oled|qled|écran|moniteur/.test(t)) return 'TV & Écrans';
  if (/casque|écouteur|airpods|enceinte|audio|son|barre de son/.test(t)) return 'Audio';
  if (/laptop|macbook|pc portable|ordinateur|surface/.test(t)) return 'Informatique';
  if (/iphone|samsung|xiaomi|pixel|smartphone|téléphone/.test(t)) return 'Smartphones';
  if (/ipad|tablette|galaxy tab/.test(t)) return 'Tablettes';
  if (/playstation|xbox|nintendo|manette|jeu vidéo|gaming/.test(t)) return 'Gaming';
  if (/aspirateur|robot|lave-vaisselle|réfrigérateur|four|micro-onde/.test(t)) return 'Électroménager';
  if (/nespresso|café|cuisine|robot culinaire|blender/.test(t)) return 'Cuisine';
  if (/appareil photo|camera|gopro|objectif/.test(t)) return 'Photo & Vidéo';
  if (/montre|watch|bracelet connecté/.test(t)) return 'Montres';
  return 'High-Tech';
}

// ─── SCRAPERS ─────────────────────────────────────────────────────────────
// ─── DEALABS RSS SCRAPER ──────────────────────────────────────────────────
async function scrapeDealabs() {
  const deals = [];
  const feeds = [
    'https://www.dealabs.com/rss/feeds/hotdeals',
    'https://www.dealabs.com/rss/feeds/group/8',
    'https://www.dealabs.com/rss/feeds/group/13',
    'https://www.dealabs.com/rss/feeds/group/9',
    'https://www.dealabs.com/rss/feeds/group/11',
  ];
  for (const feedUrl of feeds) {
    try {
      const { data } = await axios.get(feedUrl, {
        headers: { ...HEADERS, 'Accept': 'application/rss+xml, application/xml, text/xml' },
        timeout: 10000
      });
      const $ = cheerio.load(data, { xmlMode: true });
      $('item').each((i, el) => {
        try {
          const $el = $(el);
          const title   = $el.find('title').first().text().trim();
          const link    = $el.find('link').first().text().trim() || $el.find('guid').first().text().trim();
          const desc    = $el.find('description').first().text().trim();
          const pubDate = $el.find('pubDate').first().text().trim();
          const enclosure = $el.find('enclosure').attr('url') || null;
          if (!title || !link) return;
          const priceMatch = (title+' '+desc).match(/(\d+[.,]\d{0,2})\s*€|€\s*(\d+[.,]\d{0,2})/);
          const wasMatch   = (title+' '+desc).match(/(?:au lieu de|était|instead of|was)\s*(\d+[.,]\d{0,2})\s*€/i);
          const discMatch  = (title+' '+desc).match(/-(\d+)\s*%/);
          const price = priceMatch ? parseFloat((priceMatch[1]||priceMatch[2]).replace(',','.')) : null;
          const was   = wasMatch   ? parseFloat(wasMatch[1].replace(',','.')) : null;
          const discount = discMatch ? `-${discMatch[1]}%` : (price&&was ? `-${Math.round((1-price/was)*100)}%` : null);
          const merchant = detectMerchant(link+' '+title+' '+desc);
          let image = enclosure;
          if (!image) { const m=desc.match(/<img[^>]+src=["']([^"']+)["']/i); if(m) image=m[1]; }
          deals.push({
            externalId: `dlb-${Buffer.from(link).toString('base64').slice(0,24)}`,
            merchant, title:title.slice(0,120), price, was, discount, image,
            url:link, category:guessCategory(title),
            scrapedAt: pubDate?new Date(pubDate):new Date(),
            stock:Math.floor(Math.random()*60)+20,
            hot:!!(discount&&parseInt(discount)>=30),
            source:'dealabs',
          });
        } catch(_){}
      });
    } catch(e){ console.error(`[DEALABS] ${feedUrl}: ${e.message}`); }
  }
  const withPrice = deals.filter(d=>d.price&&d.price>0);
  console.log(`[DEALABS] ${deals.length} bruts → ${withPrice.length} avec prix`);
  return withPrice;
}

function detectMerchant(text) {
  const t = text.toLowerCase();
  if (/amazon\.fr|amazon\.com/.test(t)) return 'amazon';
  if (/cdiscount/.test(t)) return 'cdiscount';
  if (/boulanger/.test(t)) return 'boulanger';
  if (/darty/.test(t)) return 'darty';
  if (/fnac/.test(t)) return 'fnac';
  if (/ldlc/.test(t)) return 'ldlc';
  if (/rueducommerce|rue du commerce/.test(t)) return 'rueducommerce';
  if (/rakuten/.test(t)) return 'rakuten';
  if (/leclerc/.test(t)) return 'leclerc';
  return 'autres';
}

// ─── SCRAPERS ─────────────────────────────────────────────────────────────

async function scrapeAmazon() {
  const deals = [];
  const $ = await fetchPage('https://www.amazon.fr/deals?ref=nav_cs_gb');
  if (!$) return deals;
  $('[data-testid="deal-card"], .octopus-dlp-asin-section').each((i, el) => {
    try {
      const $el = $(el);
      const title = $el.find('[data-testid="title"], .a-size-base-plus').first().text().trim();
      const priceT = $el.find('.a-price .a-offscreen').first().text().trim();
      const wasT   = $el.find('.a-text-strike').first().text().trim();
      const img    = $el.find('img').first().attr('src');
      const link   = $el.find('a').first().attr('href');
      const pct    = $el.find('.savingsPercentage').first().text().trim();
      if (!title || !priceT) return;
      const price = parseFloat(priceT.replace(/[^0-9,]/g,'').replace(',','.'));
      const was   = parseFloat(wasT.replace(/[^0-9,]/g,'').replace(',','.')) || null;
      if (isNaN(price) || price <= 0) return;
      deals.push({
        externalId: `amz-${Buffer.from(title).toString('base64').slice(0,20)}`,
        merchant: 'amazon', title: title.slice(0,120), price, was,
        discount: pct || (was ? `-${Math.round((1-price/was)*100)}%` : null),
        image: img || null,
        url: link ? (link.startsWith('http') ? link : `https://www.amazon.fr${link}`) : 'https://www.amazon.fr/deals',
        category: guessCategory(title), scrapedAt: new Date(),
        stock: Math.floor(Math.random()*80)+10, hot: !!(was && price < was * 0.75),
      });
    } catch(_) {}
  });
  return deals;
}

async function scrapeCdiscount() {
  const deals = [];
  const $ = await fetchPage('https://www.cdiscount.com/le-deals-du-moment.html');
  if (!$) return deals;
  $('.prdtBloc, .product-listing-item').each((i, el) => {
    try {
      const $el = $(el);
      const title  = $el.find('.prdtTitle, h2, h3').first().text().trim();
      const priceT = $el.find('.price, .prdtPriceAmt').first().text().trim();
      const wasT   = $el.find('.strikethrough, .priceStrike').first().text().trim();
      const img    = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');
      const link   = $el.find('a').first().attr('href');
      if (!title || !priceT) return;
      const price = parseFloat(priceT.replace(/[^0-9,]/g,'').replace(',','.'));
      const was   = parseFloat(wasT.replace(/[^0-9,]/g,'').replace(',','.')) || null;
      if (isNaN(price) || price <= 0) return;
      deals.push({
        externalId: `cds-${Buffer.from(title).toString('base64').slice(0,20)}`,
        merchant: 'cdiscount', title: title.slice(0,120), price, was,
        discount: was ? `-${Math.round((1-price/was)*100)}%` : null,
        image: img || null,
        url: link ? (link.startsWith('http') ? link : `https://www.cdiscount.com${link}`) : 'https://www.cdiscount.com',
        category: guessCategory(title), scrapedAt: new Date(),
        stock: Math.floor(Math.random()*80)+10, hot: !!(was && price < was * 0.70),
      });
    } catch(_) {}
  });
  return deals;
}

async function scrapeBoulanger() {
  const deals = [];
  const $ = await fetchPage('https://www.boulanger.com/promotions');
  if (!$) return deals;
  $('.product-gridItem, .product-item').each((i, el) => {
    try {
      const $el = $(el);
      const title  = $el.find('.product-title, h2, h3').first().text().trim();
      const priceT = $el.find('.price, .current-price').first().text().trim();
      const wasT   = $el.find('.old-price, .crossed-price').first().text().trim();
      const img    = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');
      const link   = $el.find('a').first().attr('href');
      if (!title || !priceT) return;
      const price = parseFloat(priceT.replace(/[^0-9,]/g,'').replace(',','.'));
      const was   = parseFloat(wasT.replace(/[^0-9,]/g,'').replace(',','.')) || null;
      if (isNaN(price) || price <= 0) return;
      deals.push({
        externalId: `bou-${Buffer.from(title).toString('base64').slice(0,20)}`,
        merchant: 'boulanger', title: title.slice(0,120), price, was,
        discount: was ? `-${Math.round((1-price/was)*100)}%` : null,
        image: img || null,
        url: link ? (link.startsWith('http') ? link : `https://www.boulanger.com${link}`) : 'https://www.boulanger.com',
        category: guessCategory(title), scrapedAt: new Date(),
        stock: Math.floor(Math.random()*80)+10, hot: !!(was && price < was * 0.72),
      });
    } catch(_) {}
  });
  return deals;
}

async function scrapeDarty() {
  const deals = [];
  const $ = await fetchPage('https://www.darty.com/nav/nos_promotions.html');
  if (!$) return deals;
  $('.product-cell, .product-item').each((i, el) => {
    try {
      const $el = $(el);
      const title  = $el.find('.product-title, h2, h3').first().text().trim();
      const priceT = $el.find('.price-integer, .price').first().text().trim();
      const wasT   = $el.find('.price-old, .old-price').first().text().trim();
      const img    = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');
      const link   = $el.find('a').first().attr('href');
      if (!title || !priceT) return;
      const price = parseFloat(priceT.replace(/[^0-9,]/g,'').replace(',','.'));
      const was   = parseFloat(wasT.replace(/[^0-9,]/g,'').replace(',','.')) || null;
      if (isNaN(price) || price <= 0) return;
      deals.push({
        externalId: `dar-${Buffer.from(title).toString('base64').slice(0,20)}`,
        merchant: 'darty', title: title.slice(0,120), price, was,
        discount: was ? `-${Math.round((1-price/was)*100)}%` : null,
        image: img || null,
        url: link ? (link.startsWith('http') ? link : `https://www.darty.com${link}`) : 'https://www.darty.com',
        category: guessCategory(title), scrapedAt: new Date(),
        stock: Math.floor(Math.random()*80)+10, hot: !!(was && price < was * 0.72),
      });
    } catch(_) {}
  });
  return deals;
}

// ─── SCRAPE ALL ────────────────────────────────────────────────────────────
async function runAllScrapers() {
  console.log('[SCRAPER] Démarrage...');
  const scrapers = [
    { name:'Dealabs',   fn:scrapeDealabs },
    { name:'Amazon', fn:scrapeAmazon },
    { name:'Cdiscount', fn:scrapeCdiscount },
    { name:'Boulanger', fn:scrapeBoulanger },
    { name:'Darty', fn:scrapeDarty },
  ];
  let totalNew = 0;
  for (const { name, fn } of scrapers) {
    try {
      const deals = await fn();
      console.log(`[${name}] ${deals.length} deals`);
      for (const deal of deals) {
        const existing = await db.deals.findOne({ externalId: deal.externalId });
        if (existing && existing.price !== deal.price) {
          await db.history.insert({ externalId:deal.externalId, price:existing.price, date:new Date() });
          await checkPriceAlerts(deal);
        }
        await db.deals.update({ externalId: deal.externalId }, { $set: deal }, { upsert: true });
        if (!existing) totalNew++;
      }
    } catch(e) { console.error(`[${name}] ERR:`, e.message); }
  }
  console.log(`[SCRAPER] Terminé. ${totalNew} nouveaux.`);
}

async function checkPriceAlerts(deal) {
  const alerts = await db.alerts.find({ externalId: deal.externalId, triggered: false });
  for (const alert of alerts) {
    if (deal.price <= alert.targetPrice) {
      console.log(`[ALERT] 🔔 ${alert.email} — "${deal.title}" à ${deal.price}€ (cible: ${alert.targetPrice}€)`);
      await db.alerts.update({ _id: alert._id }, { $set: { triggered:true, triggeredAt:new Date() } });
    }
  }
}

// ─── SEED ─────────────────────────────────────────────────────────────────
async function seedDemoData() {
  const count = await db.deals.count({});
  if (count > 0) {
    // Mise à jour des URLs existantes avec les vraies fiches produit
    await db.deals.update({externalId:'demo-001'},{$set:{url:'https://www.amazon.fr/dp/B09XS7JWHH'}},{});
    await db.deals.update({externalId:'demo-002'},{$set:{url:'https://www.cdiscount.com/tv-son-photo/televiseurs/samsung-qe55q80c-tv-qled-55-139cm-4k-uhd-smart-t/f-1060201-sam8806094900960.html'}},{});
    await db.deals.update({externalId:'demo-003'},{$set:{url:'https://www.boulanger.com/ref/macbook-air-13-puce-apple-m3-8-go-256-go-minuit-mxd13fna'}},{});
    await db.deals.update({externalId:'demo-004'},{$set:{url:'https://www.darty.com/nav/achat/electromenager/aspirateur_et_nettoyeur/aspirateur_balai/dyson_v15_detect_absolute_392704-01.html'}},{});
    await db.deals.update({externalId:'demo-005'},{$set:{url:'https://www.amazon.fr/dp/B0BDHWDR12'}},{});
    await db.deals.update({externalId:'demo-006'},{$set:{url:'https://www.amazon.fr/dp/B0CMDHS22L'}},{});
    await db.deals.update({externalId:'demo-007'},{$set:{url:'https://www.cdiscount.com/informatique/tablette-tactile/apple-ipad-10-9-wi-fi-64go-bleu-10eme-generation/f-1071035-apl0194253384.html'}},{});
    await db.deals.update({externalId:'demo-008'},{$set:{url:'https://www.boulanger.com/ref/sony-ilce-6700-boitier-nu-noir'}},{});
    await db.deals.update({externalId:'demo-009'},{$set:{url:'https://www.darty.com/nav/achat/petit_electromenager/machine_a_cafe/nespresso_vertuo_pop_d70_rouge.html'}},{});
    await db.deals.update({externalId:'demo-010'},{$set:{url:'https://www.amazon.fr/dp/B08DF248LD'}},{});
    await db.deals.update({externalId:'demo-011'},{$set:{url:'https://www.boulanger.com/ref/lg-oled65c34la'}},{});
    await db.deals.update({externalId:'demo-012'},{$set:{url:'https://www.cdiscount.com/jeux-pc-video-console/consoles/sony-playstation-5-slim-edition-standard/f-10629-son711719576630.html'}},{});
    await db.deals.update({externalId:'demo-013'},{$set:{url:'https://www.amazon.fr/dp/B0CHX2LKJB'}},{});
    await db.deals.update({externalId:'demo-014'},{$set:{url:'https://www.darty.com/nav/achat/multimedia/domotique/eclairage_connecte/philips_hue_white_color_ambiance_kit_de_demarrage_3_ampoules_e27.html'}},{});
    await db.deals.update({externalId:'demo-015'},{$set:{url:'https://www.boulanger.com/ref/jbl-charge-5-noir'}},{});
    console.log('[SEED] URLs mises à jour');
    return;
  }
  const demo = [
    { externalId:'demo-001', merchant:'amazon',    title:'Sony WH-1000XM5 — Casque Bluetooth ANC Premium',          price:279,  was:380,  discount:'-27%', image:'https://m.media-amazon.com/images/I/71o8Q5XJS5L._AC_SL1500_.jpg', url:'https://www.amazon.fr/dp/B09XS7JWHH',         category:'Audio',         hot:true,  stock:15, scrapedAt:new Date() },
    { externalId:'demo-002', merchant:'cdiscount', title:'Samsung QLED 55" 4K 120Hz Smart TV QE55Q80C',             price:499,  was:799,  discount:'-38%', image:'https://images.samsung.com/fr/televisions-home-theater/qled-tv/q80c/QE55Q80CATXXN_001_Front_Black.jpg', url:'https://www.cdiscount.com/tv-son-photo/televiseurs/samsung-qe55q80c-tv-qled-55-139cm-4k-uhd-smart-t/f-1060201-sam8806094900960.html', category:'TV & Écrans',   hot:true,  stock:40, scrapedAt:new Date() },
    { externalId:'demo-003', merchant:'boulanger', title:'Apple MacBook Air M3 13" 8Go/256Go Minuit',               price:1099, was:1299, discount:'-15%', image:'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/mba13-midnight-select-202402?wid=904&hei=840&fmt=jpeg&qlt=90', url:'https://www.boulanger.com/ref/macbook-air-13-puce-apple-m3-8-go-256-go-minuit-mxd13fna', category:'Informatique',  hot:false, stock:70, scrapedAt:new Date() },
    { externalId:'demo-004', merchant:'darty',     title:'Dyson V15 Detect Absolute — Aspirateur sans fil',         price:349,  was:649,  discount:'-46%', image:'https://dyson-h.assetsadobe2.com/is/image/content/dam/dyson/products/vacuums/cordless/sv22-v15-detect-absolute/sku-images/sv22-v15-detect-absolute-iron-yellow.png', url:'https://www.darty.com/nav/achat/electromenager/aspirateur_et_nettoyeur/aspirateur_balai/dyson_v15_detect_absolute_392704-01.html', category:'Électroménager',hot:true,  stock:8,  scrapedAt:new Date() },
    { externalId:'demo-005', merchant:'amazon',    title:'Apple AirPods Pro 2ème génération avec USB-C',            price:199,  was:279,  discount:'-29%', image:'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/MQD83?wid=1144&hei=1144&fmt=jpeg&qlt=90', url:'https://www.amazon.fr/dp/B0BDHWDR12', category:'Audio',         hot:true,  stock:33, scrapedAt:new Date() },
    { externalId:'demo-006', merchant:'amazon',    title:'Samsung Galaxy S24 Ultra 256Go Titanium Black',           price:899,  was:1319, discount:'-32%', image:'https://images.samsung.com/fr/smartphones/galaxy-s24-ultra/buy/galaxy-s24-ultra-titanium-black-galaxy-s24-ultra-titanium-black-1.jpg', url:'https://www.amazon.fr/dp/B0CMDHS22L', category:'Smartphones',   hot:true,  stock:25, scrapedAt:new Date() },
    { externalId:'demo-007', merchant:'cdiscount', title:'Apple iPad 10ème génération 64Go WiFi — Bleu',            price:329,  was:459,  discount:'-28%', image:'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/ipad-10gen-select-202210-blue?wid=1144&hei=1144&fmt=jpeg', url:'https://www.cdiscount.com/informatique/tablette-tactile/apple-ipad-10-9-wi-fi-64go-bleu-10eme-generation/f-1071035-apl0194253384.html', category:'Tablettes',     hot:false, stock:50, scrapedAt:new Date() },
    { externalId:'demo-008', merchant:'boulanger', title:'Sony Alpha 6700 Hybride APS-C 26MP Boîtier Nu',           price:1299, was:1599, discount:'-19%', image:'https://www.sony.fr/image/5d02da5df552836db8bb2d75105bc9e2?fmt=pjpeg&wid=660&bgcolor=FFFFFF', url:'https://www.boulanger.com/ref/sony-ilce-6700-boitier-nu-noir', category:'Photo & Vidéo', hot:false, stock:18, scrapedAt:new Date() },
    { externalId:'demo-009', merchant:'darty',     title:'Nespresso Vertuo Pop + 50 capsules offertes',             price:49,   was:99,   discount:'-51%', image:'https://www.nespresso.com/ecom/medias/sys_master/public/13773070032926/M700-Env.png', url:'https://www.darty.com/nav/achat/petit_electromenager/machine_a_cafe/nespresso_vertuo_pop_d70_rouge.html', category:'Cuisine',       hot:false, stock:90, scrapedAt:new Date() },
    { externalId:'demo-010', merchant:'amazon',    title:'Manette Xbox Series X/S Sans fil — Carbon Black',         price:39,   was:64,   discount:'-39%', image:'https://m.media-amazon.com/images/I/61MJjPgZqFL._AC_SL1000_.jpg', url:'https://www.amazon.fr/dp/B08DF248LD', category:'Gaming',        hot:true,  stock:55, scrapedAt:new Date() },
    { externalId:'demo-011', merchant:'boulanger', title:'LG OLED evo 65" C3 4K 120Hz HDR Dolby Vision',           price:1299, was:2199, discount:'-41%', image:'https://www.lg.com/fr/images/televisions/md07572497/gallery/large01.jpg', url:'https://www.boulanger.com/ref/lg-oled65c34la', category:'TV & Écrans',   hot:true,  stock:12, scrapedAt:new Date() },
    { externalId:'demo-012', merchant:'cdiscount', title:'PlayStation 5 Slim Edition Standard + Spider-Man 2',     price:499,  was:569,  discount:'-12%', image:'https://gmedia.playstation.com/is/image/SIEPDC/ps5-slim-disc-edition-product-thumbnail-01-en-14sep23.png', url:'https://www.cdiscount.com/search/10/ps5+slim.html',  category:'Gaming',        hot:false, stock:28, scrapedAt:new Date() },
    { externalId:'demo-013', merchant:'amazon',    title:'Apple Watch Series 9 GPS 41mm Aluminium Minuit',         price:349,  was:449,  discount:'-22%', image:'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/MQDY3ref_VW_34FR+watch-case-41-aluminum-midnight-nc-9s_VW_34FR_WF_CO+watch-face-41-aluminum-midnight-9s_VW_34FR_WF_CO?wid=700&hei=700', url:'https://www.amazon.fr/s?k=apple+watch+series+9',   category:'Montres',       hot:false, stock:42, scrapedAt:new Date() },
    { externalId:'demo-014', merchant:'darty',     title:'Philips Hue Starter Kit 3 ampoules White & Color',       price:59,   was:89,   discount:'-34%', image:'https://www.philips-hue.com/en-us/images/products/8718699703424_01.jpg', url:'https://www.darty.com/nav/recherche/philips+hue.html', category:'Maison Connect.',hot:false, stock:60, scrapedAt:new Date() },
    { externalId:'demo-015', merchant:'boulanger', title:'JBL Charge 5 — Enceinte Bluetooth portable waterproof',  price:139,  was:199,  discount:'-30%', image:'https://www.jbl.com/dw/image/v2/AAUJ_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwcb9793dc/JBL_Charge5_Product%20Image_Hero_Black.png', url:'https://www.boulanger.com/recherche/jbl+charge+5',   category:'Audio',         hot:false, stock:35, scrapedAt:new Date() },
  ];
  for (const d of demo) await db.deals.insert(d);
  // Historique prix fictif pour démo
  await db.history.insert({ externalId:'demo-001', price:380, date:new Date(Date.now()-7*86400000) });
  await db.history.insert({ externalId:'demo-001', price:349, date:new Date(Date.now()-4*86400000) });
  await db.history.insert({ externalId:'demo-001', price:299, date:new Date(Date.now()-2*86400000) });
  await db.history.insert({ externalId:'demo-002', price:799, date:new Date(Date.now()-10*86400000) });
  await db.history.insert({ externalId:'demo-002', price:649, date:new Date(Date.now()-5*86400000) });
  console.log('[SEED] 15 deals demo insérés');
}

// ─── ROUTES ───────────────────────────────────────────────────────────────

app.get('/api/deals', async (req, res) => {
  try {
    const { merchant, category, search, hot, sort='discount', limit=20, skip=0 } = req.query;
    const query = {};
    if (merchant)    query.merchant = merchant;
    if (category)    query.category = category;
    if (hot==='true') query.hot = true;
    if (search)      query.title = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i');
    let deals = await db.deals.find(query);
    if (sort==='discount') deals.sort((a,b)=>{ const da=a.was?(1-a.price/a.was):0, db_=b.was?(1-b.price/b.was):0; return db_-da; });
    else if (sort==='price_asc')  deals.sort((a,b)=>a.price-b.price);
    else if (sort==='price_desc') deals.sort((a,b)=>b.price-a.price);
    else if (sort==='recent')     deals.sort((a,b)=>new Date(b.scrapedAt)-new Date(a.scrapedAt));
    const total = deals.length;
    deals = deals.slice(Number(skip), Number(skip)+Number(limit));
    res.json({ total, deals });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/deals/:id', async (req, res) => {
  try {
    const deal = await db.deals.findOne({ _id: req.params.id });
    if (!deal) return res.status(404).json({ error:'Deal introuvable' });
    const history = await db.history.find({ externalId: deal.externalId });
    history.sort((a,b)=>new Date(a.date)-new Date(b.date));
    res.json({ deal, history });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/stats', async (req, res) => {
  try {
    const all = await db.deals.find({});
    const bestDiscount = all.reduce((max,d)=>{ const p=d.was?Math.round((1-d.price/d.was)*100):0; return p>max?p:max; },0);
    const byMerchant = {};
    all.forEach(d=>{ byMerchant[d.merchant]=(byMerchant[d.merchant]||0)+1; });
    res.json({ total:all.length, hot:all.filter(d=>d.hot).length, bestDiscount, lowStock:all.filter(d=>d.stock<=15).length, byMerchant });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/categories', async (req, res) => {
  try {
    const all = await db.deals.find({});
    const cats = {};
    all.forEach(d=>{ if(d.category) cats[d.category]=(cats[d.category]||0)+1; });
    res.json(Object.entries(cats).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/alerts', async (req, res) => {
  try {
    const { email, externalId, dealTitle, targetPrice } = req.body;
    if (!email||!externalId||!targetPrice) return res.status(400).json({ error:'Champs manquants' });
    const alert = await db.alerts.insert({ email, externalId, dealTitle, targetPrice:parseFloat(targetPrice), createdAt:new Date(), triggered:false });
    res.json({ success:true, alert });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.delete('/api/alerts/:id', async (req, res) => {
  try {
    await db.alerts.remove({ _id: req.params.id });
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/scrape', async (req, res) => {
  res.json({ message:'Scraping lancé' });
  runAllScrapers().catch(console.error);
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────
// Render appelle GET /health pour vérifier que le service est vivant.
// Doit répondre 200 en < 10s sinon Render considère le service mort.
app.get('/health', async (req, res) => {
  try {
    const count = await db.deals.count({});
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      deals: count,
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      env: process.env.NODE_ENV || 'development',
      ts: new Date().toISOString(),
    });
  } catch(e) {
    res.status(503).json({ status: 'error', error: e.message });
  }
});

// ─── SCHEDULER ────────────────────────────────────────────────────────────
// Scraping toutes les 2h
// Dealabs toutes les heures
cron.schedule('0 * * * *', () => scrapeDealabs().then(async deals => { for(const d of deals) { const ex=await db.deals.findOne({externalId:d.externalId}); if(!ex) await db.deals.insert(d); } console.log(`[CRON-DEALABS] ${deals.length} deals`); }).catch(console.error));
// Scrapers complets toutes les 2h
cron.schedule('0 */2 * * *', () => runAllScrapers().catch(console.error));

// Nettoyage des vieux deals à 3h du matin
cron.schedule('0 3 * * *', async () => {
  const cutoff = new Date(Date.now() - 7*24*3600*1000);
  const n = await db.deals.remove({ scrapedAt:{ $lt:cutoff } }, { multi:true });
  console.log(`[CLEAN] ${n} vieux deals supprimés`);
});

// Simulation variation stock (démo)
setInterval(async () => {
  try {
    const deals = await db.deals.find({});
    for (const d of deals) {
      if (d.stock > 1 && Math.random() < 0.2)
        await db.deals.update({ _id:d._id }, { $inc:{ stock:-1 } });
    }
  } catch(_) {}
}, 20000);

// ─── KEEP-ALIVE (anti-sleep Render free tier) ─────────────────────────────
// Render free endort le service après 15 min d'inactivité.
// Ce ping interne toutes les 14 min évite le cold start pour les utilisateurs.
// ⚠️ Fonctionne seulement quand le process tourne (pas un vrai uptime garanti).
// Pour un uptime 100%, passer sur Render Starter ($7/mois) ou utiliser
// un service externe comme UptimeRobot (gratuit) qui ping /health toutes les 5 min.
if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
  const SELF_URL = `${process.env.RENDER_EXTERNAL_URL}/health`;
  setInterval(async () => {
    try {
      await axios.get(SELF_URL, { timeout: 8000 });
      console.log(`[KEEP-ALIVE] ping OK → ${new Date().toLocaleTimeString('fr-FR')}`);
    } catch(e) {
      console.warn(`[KEEP-ALIVE] ping failed: ${e.message}`);
    }
  }, 14 * 60 * 1000); // toutes les 14 minutes
  console.log(`[KEEP-ALIVE] Activé → ${SELF_URL}`);
}

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────
// Render envoie SIGTERM avant de redémarrer le container.
// On laisse 5s pour finir les requêtes en cours.
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM reçu — arrêt propre...');
  server.close(() => {
    console.log('[SHUTDOWN] Serveur fermé.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
});

// ─── START ────────────────────────────────────────────────────────────────
// ⚠️ Render exige d'écouter sur 0.0.0.0 (pas 127.0.0.1)
// Le port est injecté par Render via process.env.PORT
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, async () => {
  console.log(`\n🚀 DealFlash API démarrée`);
  console.log(`   → Local  : http://localhost:${PORT}`);
  if (process.env.RENDER_EXTERNAL_URL)
    console.log(`   → Public : ${process.env.RENDER_EXTERNAL_URL}`);
  console.log(`   → Health : http://localhost:${PORT}/health\n`);
  console.log(`   → Health : http://localhost:${PORT}/health\n`);
  await seedDemoData();
  // Lancer Dealabs au démarrage pour avoir de vrais deals immédiatement
  setTimeout(async () => {
    console.log('[STARTUP] Scraping Dealabs...');
    try {
      const deals = await scrapeDealabs();
      let added = 0;
      for (const deal of deals) {
        const existing = await db.deals.findOne({ externalId: deal.externalId });
        if (!existing) { await db.deals.insert(deal); added++; }
        else await db.deals.update({ externalId: deal.externalId }, { $set: deal });
      }
      console.log(`[STARTUP] Dealabs: ${added} nouveaux deals ajoutés`);
    } catch(e) { console.error('[STARTUP] Dealabs erreur:', e.message); }
  }, 3000);
});
