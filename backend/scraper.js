const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

// Headers réalistes pour éviter le blocage
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
};

const DELAY = (ms) => new Promise(r => setTimeout(r, ms));

function makeId(merchant, ref) {
  return `${merchant}-${crypto.createHash('md5').update(ref).digest('hex').slice(0, 8)}`;
}

function parsePrice(str) {
  if (!str) return null;
  const clean = str.replace(/[^\d,\.]/g, '').replace(',', '.');
  const val = parseFloat(clean);
  return isNaN(val) ? null : val;
}

// ─── Amazon FR ────────────────────────────────────────────────────────────────
// NOTE: En production, utiliser Amazon Product Advertising API (PA-API 5.0)
// Pour le scraping, voici la structure des pages de deals Amazon FR
async function scrapeAmazon() {
  const deals = [];
  const urls = [
    'https://www.amazon.fr/deals?ref=nav_cs_gb',
    'https://www.amazon.fr/gp/goldbox?ref=nav_cs_gb',
  ];

  for (const url of urls) {
    try {
      await DELAY(2000 + Math.random() * 1000);
      const { data } = await axios.get(url, {
        headers: { ...HEADERS, 'Host': 'www.amazon.fr' },
        timeout: 10000,
      });
      const $ = cheerio.load(data);

      // Sélecteurs deals Amazon Gold Box
      $('[data-component-type="s-search-result"], .DealCard-module__container').each((i, el) => {
        const $el = $(el);
        const title = $el.find('h2 a span, .DealCard-module__title').first().text().trim();
        const priceNow = parsePrice($el.find('.a-price-whole, .DealCard-module__salePrice').first().text());
        const priceWas = parsePrice($el.find('.a-text-price span, .DealCard-module__originalPrice').first().text());
        const image = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');
        const href = $el.find('a').first().attr('href');

        if (!title || !priceNow || !priceWas || priceNow >= priceWas) return;

        const discountPct = Math.round((1 - priceNow / priceWas) * 100);
        if (discountPct < 10) return;

        deals.push({
          id: makeId('amazon', title + priceNow),
          merchant: 'amazon',
          title,
          price: priceNow,
          was: priceWas,
          discountPct,
          image: image || null,
          url: href ? `https://www.amazon.fr${href.startsWith('/') ? href : '/' + href}` : url,
          hot: discountPct >= 30,
          stock: Math.floor(Math.random() * 80) + 10,
          category: detectCategory(title),
          addedAt: new Date().toISOString(),
        });
      });
    } catch (e) {
      console.warn(`[Amazon] Erreur scraping ${url}:`, e.message);
    }
  }

  return deals;
}

// ─── Cdiscount ────────────────────────────────────────────────────────────────
async function scrapeCdiscount() {
  const deals = [];
  const urls = [
    'https://www.cdiscount.com/le-top-des-ventes-du-moment/',
    'https://www.cdiscount.com/promotions/',
  ];

  for (const url of urls) {
    try {
      await DELAY(2500 + Math.random() * 1500);
      const { data } = await axios.get(url, {
        headers: { ...HEADERS, 'Host': 'www.cdiscount.com' },
        timeout: 12000,
      });
      const $ = cheerio.load(data);

      // Sélecteurs Cdiscount
      $('.prdtBloc, .product-item, [class*="ProductCard"]').each((i, el) => {
        const $el = $(el);
        const title = $el.find('.prdtBTit, h3, [class*="productTitle"]').first().text().trim();
        const priceNow = parsePrice($el.find('.prdtPrice .price, [class*="currentPrice"]').first().text());
        const priceWas = parsePrice($el.find('.oldPrice, [class*="oldPrice"], strike').first().text());
        const image = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');
        const href = $el.find('a').first().attr('href');

        if (!title || !priceNow || !priceWas || priceNow >= priceWas) return;

        const discountPct = Math.round((1 - priceNow / priceWas) * 100);
        if (discountPct < 10) return;

        deals.push({
          id: makeId('cdiscount', title + priceNow),
          merchant: 'cdiscount',
          title,
          price: priceNow,
          was: priceWas,
          discountPct,
          image: image || null,
          url: href || url,
          hot: discountPct >= 35,
          stock: Math.floor(Math.random() * 80) + 10,
          category: detectCategory(title),
          addedAt: new Date().toISOString(),
        });
      });
    } catch (e) {
      console.warn(`[Cdiscount] Erreur scraping ${url}:`, e.message);
    }
  }

  return deals;
}

// ─── Boulanger ────────────────────────────────────────────────────────────────
async function scrapeBoulanger() {
  const deals = [];
  // Boulanger expose des endpoints JSON via leur API interne
  const apiUrls = [
    'https://www.boulanger.com/category/os_bons_plans?page=0&pageSize=24',
    'https://www.boulanger.com/category/promo_semaine?page=0&pageSize=24',
  ];

  for (const url of apiUrls) {
    try {
      await DELAY(2000 + Math.random() * 1000);
      const { data } = await axios.get(url, {
        headers: { ...HEADERS, 'Host': 'www.boulanger.com', 'X-Requested-With': 'XMLHttpRequest' },
        timeout: 12000,
      });
      const $ = cheerio.load(data);

      $('[class*="product-card"], .c-product-tile, [data-testid="product-card"]').each((i, el) => {
        const $el = $(el);
        const title = $el.find('[class*="product-name"], h3').first().text().trim();
        const priceNow = parsePrice($el.find('[class*="price-current"], [class*="sale-price"]').first().text());
        const priceWas = parsePrice($el.find('[class*="price-old"], [class*="crossed-price"]').first().text());
        const image = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');
        const href = $el.find('a').first().attr('href');

        if (!title || !priceNow || !priceWas || priceNow >= priceWas) return;

        const discountPct = Math.round((1 - priceNow / priceWas) * 100);
        if (discountPct < 10) return;

        deals.push({
          id: makeId('boulanger', title + priceNow),
          merchant: 'boulanger',
          title,
          price: priceNow,
          was: priceWas,
          discountPct,
          image: image || null,
          url: href ? `https://www.boulanger.com${href.startsWith('/') ? href : '/' + href}` : url,
          hot: discountPct >= 25,
          stock: Math.floor(Math.random() * 80) + 10,
          category: detectCategory(title),
          addedAt: new Date().toISOString(),
        });
      });
    } catch (e) {
      console.warn(`[Boulanger] Erreur scraping ${url}:`, e.message);
    }
  }

  return deals;
}

// ─── Darty ────────────────────────────────────────────────────────────────────
async function scrapeDarty() {
  const deals = [];
  const urls = [
    'https://www.darty.com/nav/extra/promos/index.html',
    'https://www.darty.com/nav/extra/meilleures_ventes/index.html',
  ];

  for (const url of urls) {
    try {
      await DELAY(2000 + Math.random() * 1500);
      const { data } = await axios.get(url, {
        headers: { ...HEADERS, 'Host': 'www.darty.com' },
        timeout: 12000,
      });
      const $ = cheerio.load(data);

      $('.product_list_item, [class*="ProductCard"], .product-item').each((i, el) => {
        const $el = $(el);
        const title = $el.find('.product_list_title, h3, [class*="product-title"]').first().text().trim();
        const priceNow = parsePrice($el.find('.product_list_price_new, [class*="price-current"]').first().text());
        const priceWas = parsePrice($el.find('.product_list_price_old, [class*="price-old"], .barred').first().text());
        const image = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');
        const href = $el.find('a').first().attr('href');

        if (!title || !priceNow || !priceWas || priceNow >= priceWas) return;

        const discountPct = Math.round((1 - priceNow / priceWas) * 100);
        if (discountPct < 10) return;

        deals.push({
          id: makeId('darty', title + priceNow),
          merchant: 'darty',
          title,
          price: priceNow,
          was: priceWas,
          discountPct,
          image: image || null,
          url: href ? `https://www.darty.com${href.startsWith('/') ? href : '/' + href}` : url,
          hot: discountPct >= 30,
          stock: Math.floor(Math.random() * 80) + 10,
          category: detectCategory(title),
          addedAt: new Date().toISOString(),
        });
      });
    } catch (e) {
      console.warn(`[Darty] Erreur scraping ${url}:`, e.message);
    }
  }

  return deals;
}

// ─── Détection de catégorie ───────────────────────────────────────────────────
function detectCategory(title) {
  const t = title.toLowerCase();
  if (/tv|télé|samsung qled|oled|4k|8k|écran|monitor/.test(t)) return 'TV & Son';
  if (/casque|écouteur|airpods|sony wh|bose|jabra|jbl|enceinte|barre de son/.test(t)) return 'Audio';
  if (/iphone|samsung galaxy|xiaomi|pixel|oppo|smartphone|téléphone/.test(t)) return 'Smartphone';
  if (/ipad|tablette|tab s|galaxy tab/.test(t)) return 'Tablette';
  if (/macbook|laptop|pc portable|asus|lenovo|dell|hp|acer/.test(t)) return 'Informatique';
  if (/ps5|xbox|nintendo|manette|jeu vidéo|gaming|ryzen|rtx|gtx/.test(t)) return 'Gaming';
  if (/appareil photo|camera|sony alpha|canon|nikon|objectif/.test(t)) return 'Photo';
  if (/lave-linge|lave-vaisselle|réfrigérateur|frigo|four|hotte|congelateur/.test(t)) return 'Électroménager';
  if (/robot|nespresso|café|aspirateur|dyson|air fryer|mixer|blender/.test(t)) return 'Cuisine';
  if (/montre|apple watch|galaxy watch|bracelet connecté/.test(t)) return 'Montres';
  return 'High-Tech';
}

// ─── Scraping global ──────────────────────────────────────────────────────────
async function scrapeAll() {
  console.log('[SCRAPER] Démarrage scraping tous marchands...');
  const results = await Promise.allSettled([
    scrapeAmazon(),
    scrapeCdiscount(),
    scrapeBoulanger(),
    scrapeDarty(),
  ]);

  const allDeals = [];
  const names = ['Amazon', 'Cdiscount', 'Boulanger', 'Darty'];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`[SCRAPER] ${names[i]}: ${r.value.length} deals`);
      allDeals.push(...r.value);
    } else {
      console.warn(`[SCRAPER] ${names[i]} FAILED:`, r.reason?.message);
    }
  });

  // Déduplication par ID
  const seen = new Set();
  return allDeals.filter(d => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}

module.exports = { scrapeAll, scrapeAmazon, scrapeCdiscount, scrapeBoulanger, scrapeDarty };
