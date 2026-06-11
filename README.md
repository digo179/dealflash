# DealFlash ⚡ — Bons Plans Amazon FR / Cdiscount / Boulanger / Darty

## Architecture

```
dealflash/
├── backend/          ← Node.js + Express API
│   ├── server.js     ← Serveur principal (scrapers, API REST, cron jobs)
│   ├── data/         ← Base de données NeDB (fichiers .db)
│   └── package.json
└── frontend/
    ├── index.html    ← App mobile-first (SPA)
    └── app.js        ← Logique JS (API, rendu, IA, favoris, alertes)
```

## Backend — API Endpoints

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/deals` | Liste deals (filtres: merchant, category, search, hot, sort, limit, skip) |
| GET | `/api/deals/:id` | Détail deal + historique prix |
| GET | `/api/stats` | Stats globales |
| GET | `/api/categories` | Catégories avec compteurs |
| POST | `/api/alerts` | Créer alerte prix `{email, externalId, dealTitle, targetPrice}` |
| DELETE | `/api/alerts/:id` | Supprimer alerte |
| POST | `/api/scrape` | Forcer un scraping manuel |

## Lancement local

### 1. Backend
```bash
cd backend
npm install
node server.js
# → API disponible sur http://localhost:3001
```

### 2. Frontend
```bash
# Option A — avec un serveur statique simple
npx serve frontend -p 3000

# Option B — ouvrir directement index.html dans le navigateur
# ⚠️ Changer API dans app.js: const API = 'http://localhost:3001/api'
```

## Déploiement Production

### Oracle Cloud Always Free (recommandé — tu as déjà un VM)

```bash
# Sur ton VM Oracle Cloud
git clone / upload les fichiers

# Backend — utilise PM2
npm install -g pm2
cd backend && npm install
pm2 start server.js --name dealflash-api
pm2 save && pm2 startup

# Frontend — Nginx
sudo apt install nginx
sudo cp -r frontend/* /var/www/html/
# Configurer nginx pour proxifier /api vers localhost:3001
```

**nginx.conf exemple:**
```nginx
server {
    listen 80;
    server_name ton-domaine.com;

    location /api {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
    }

    location / {
        root /var/www/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
```

Mettre à jour `const API` dans `app.js` :
```js
const API = 'https://ton-domaine.com/api';
```

### Variables d'environnement optionnelles

```env
PORT=3001
# Pour alertes email (prod) — brancher Nodemailer/SendGrid
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASS=SG.xxxxx
ALERT_FROM=noreply@dealflash.fr
```

## Scrapers

Les scrapers tournent automatiquement toutes les **2 heures** via node-cron.
En cas de blocage (anti-bot), options :
- Ajouter rotation de User-Agents
- Utiliser `puppeteer` ou `playwright` (scraping headless)
- Utiliser les APIs affiliées officielles (Amazon PA-API, etc.)

## Affiliation (pour monétiser)

| Marchand | Programme |
|----------|-----------|
| Amazon FR | [Amazon Associates](https://partenaires.amazon.fr) → ajouter `?tag=TON_TAG` aux URLs |
| Cdiscount | [Affidata](https://affidata.cdiscount.com) |
| Boulanger | [Effiliation](https://www.effiliation.com) |
| Darty | [Effiliation](https://www.effiliation.com) |

