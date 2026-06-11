const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALERTS_PATH = path.join(__dirname, 'data', 'alerts.json');

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

function readAlerts() {
  if (!fs.existsSync(ALERTS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8')); }
  catch { return []; }
}

function writeAlerts(data) {
  fs.writeFileSync(ALERTS_PATH, JSON.stringify(data, null, 2));
}

function create({ email, keyword, merchant, maxPrice }) {
  const alerts = readAlerts();
  const alert = {
    id: crypto.randomUUID(),
    email,
    keyword: keyword.toLowerCase().trim(),
    merchant: merchant || null,
    maxPrice: maxPrice ? parseFloat(maxPrice) : null,
    createdAt: new Date().toISOString(),
    lastTriggered: null,
    triggerCount: 0,
    active: true,
  };
  alerts.push(alert);
  writeAlerts(alerts);
  return alert;
}

function remove(id) {
  const alerts = readAlerts().filter(a => a.id !== id);
  writeAlerts(alerts);
}

// Vérifie toutes les alertes contre les deals disponibles
function checkAlerts(deals) {
  const alerts = readAlerts().filter(a => a.active);
  const matched = [];

  for (const alert of alerts) {
    const matchingDeals = deals.filter(deal => {
      // Correspondance mot-clé dans le titre
      if (!deal.title.toLowerCase().includes(alert.keyword)) return false;
      // Filtre marchand optionnel
      if (alert.merchant && deal.merchant !== alert.merchant) return false;
      // Filtre prix max optionnel
      if (alert.maxPrice && deal.price > alert.maxPrice) return false;
      return true;
    });

    if (matchingDeals.length > 0) {
      const bestDeal = matchingDeals.sort((a, b) => b.discountPct - a.discountPct)[0];
      // Éviter de notifier trop souvent (cooldown 6h)
      const lastTrig = alert.lastTriggered ? new Date(alert.lastTriggered) : null;
      const cooldown = 6 * 3600 * 1000;
      if (!lastTrig || Date.now() - lastTrig.getTime() > cooldown) {
        matched.push({ alert, deal: bestDeal });
      }
    }
  }

  if (matched.length > 0) {
    // Mettre à jour les alertes déclenchées
    const allAlerts = readAlerts();
    for (const { alert } of matched) {
      const idx = allAlerts.findIndex(a => a.id === alert.id);
      if (idx !== -1) {
        allAlerts[idx].lastTriggered = new Date().toISOString();
        allAlerts[idx].triggerCount++;
      }
    }
    writeAlerts(allAlerts);

    // Log les notifications (en prod: envoyer emails/push)
    for (const { alert, deal } of matched) {
      console.log(`[ALERT] Notification → ${alert.email}: "${deal.title}" à ${deal.price}€ (-${deal.discountPct}%) sur ${deal.merchant}`);
      // TODO en prod: sendEmail(alert.email, deal) ou sendPushNotification(...)
    }
  }

  return matched;
}

function getAll() {
  return readAlerts();
}

module.exports = { create, remove, checkAlerts, getAll };
