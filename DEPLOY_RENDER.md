# 🚀 Déploiement DealFlash sur Render + Netlify

## Architecture cible

```
GitHub repo
    ├── backend/   → Render.com  (API Node.js gratuite)
    └── frontend/  → Netlify     (site statique gratuit)
```

---

## ÉTAPE 1 — Mettre le code sur GitHub

```bash
# Dans le dossier dealflash/
git init
git add .
git commit -m "DealFlash initial"

# Créer un repo sur github.com puis :
git remote add origin https://github.com/TON_USER/dealflash.git
git push -u origin main
```

---

## ÉTAPE 2 — Backend sur Render (gratuit)

1. Va sur **https://render.com** → créer un compte (GitHub login)

2. "**New +**" → "**Web Service**"

3. Connecte ton repo GitHub `dealflash`

4. Configure :
   | Champ | Valeur |
   |-------|--------|
   | **Root Directory** | `backend` |
   | **Runtime** | `Node` |
   | **Build Command** | `npm install` |
   | **Start Command** | `node server.js` |
   | **Plan** | Free |
   | **Region** | Frankfurt (EU) |

5. Dans **"Environment"**, ajoute ces variables :
   | Clé | Valeur |
   |-----|--------|
   | `NODE_ENV` | `production` |
   | `PORT` | `10000` |
   | `DB_PATH` | `/opt/render/project/src/data` |

6. Clique **"Create Web Service"**

7. Attends 2-3 min → tu obtiens une URL genre :
   ```
   https://dealflash-api.onrender.com
   ```

8. Teste : `https://dealflash-api.onrender.com/health` → doit retourner `{"status":"ok",...}`

---

## ÉTAPE 3 — Frontend sur Netlify (gratuit)

### Option A — Drag & Drop (le plus simple)

1. Va sur **https://netlify.com** → créer un compte
2. Dashboard → "**Add new site**" → "**Deploy manually**"
3. Glisse-dépose le dossier `frontend/` dans la zone de dépôt
4. Netlify te donne une URL genre `https://amazing-name-123.netlify.app`

### Option B — Via GitHub (auto-deploy à chaque push)

1. "New site" → "Import from Git" → connecte ton repo
2. **Base directory** : `frontend`
3. **Build command** : *(laisser vide)*
4. **Publish directory** : `frontend`

---

## ÉTAPE 4 — Connecter frontend → backend

Ouvre `frontend/app.js` et remplace la 1ère ligne :

```js
// AVANT (local)
const API = 'http://localhost:3001/api';

// APRÈS (production)
const API = 'https://dealflash-api.onrender.com/api';
```

Puis redéploie le frontend (drag & drop à nouveau sur Netlify, ou `git push`).

---

## ÉTAPE 5 — UptimeRobot (anti-sleep gratuit)

Le free tier de Render endort le service après 15 min d'inactivité.
**UptimeRobot** ping ton API toutes les 5 min gratuitement pour la maintenir éveillée.

1. Créer un compte sur **https://uptimerobot.com**
2. "Add New Monitor" :
   - Type : **HTTP(s)**
   - URL : `https://dealflash-api.onrender.com/health`
   - Interval : **5 minutes**
3. C'est tout. Ton API reste éveillée 24/7 🎉

---

## Résumé des coûts

| Service | Prix |
|---------|------|
| Render (free) | **0€/mois** |
| Netlify (free) | **0€/mois** |
| UptimeRobot (free) | **0€/mois** |
| **Total** | **0€/mois** ✅ |

### Pour passer en prod sérieuse (toujours-allumé)

| Service | Prix |
|---------|------|
| Render Starter | 7$/mois (always-on, pas de sleep) |
| MongoDB Atlas M0 | 0€ (remplace NeDB, persistance garantie) |

