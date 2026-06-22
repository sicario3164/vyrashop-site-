# Runbook Opérationnel — VyraShop

Dernière mise à jour : juin 2026

---

## Incident 1 : Un client n'a pas accès à sa Formation après paiement

**Causes possibles par ordre de fréquence :**

1. **Le webhook Stripe n'a pas été reçu** (délai Stripe, erreur réseau)
2. **L'email du compte Supabase ne correspond pas à l'email d'achat Stripe** (ex: faute de frappe)
3. **`STRIPE_WEBHOOK_SECRET` incorrect** → webhook rejeté silencieusement
4. **`STRIPE_FORMATION_PRICE_ID` incorrect** → produit non reconnu, accès non accordé

**Diagnostic :**

```
1. Stripe Dashboard → Developers → Webhooks → ton endpoint → onglet Events récents
   → chercher l'événement checkout.session.completed correspondant
   → vérifier s'il est marqué "Success" ou "Failed"

2. Supabase Dashboard → Table Editor → user_access
   → chercher l'email du client
   → vérifier la colonne has_formation

3. Netlify → Functions → stripe-webhook → Function log
   → chercher les erreurs autour de l'heure d'achat
```

**Correction rapide (accès admin) :**

```
1. Ouvrir espace-membre/admin.html
2. Saisir la clé admin + code TOTP
3. Section "Gérer les accès" → entrer l'email du client → cocher Formation → Enregistrer
```

---

## Incident 2 : L'accès admin est bloqué (trop de tentatives)

Le rate limiting bloque l'IP après 5 tentatives incorrectes en 15 minutes.

**Si c'est toi qui es bloqué :**

```
Attendre 15 minutes — le compteur se réinitialise automatiquement à la prochaine fenêtre.
```

**Si tu dois débloquer d'urgence :**

```sql
-- Supabase Dashboard → SQL Editor
DELETE FROM rate_limit_counters
WHERE function_name = 'admin-access'
AND ip = '<ton_ip>';
```

Trouver son IP publique : https://ifconfig.me

---

## Incident 3 : Rotation des clés (compromission suspectée)

**Si ADMIN_ACCESS_KEY est compromise :**

```
1. Netlify → Environment variables → ADMIN_ACCESS_KEY → modifier
2. Déployer (Netlify → Deploys → Trigger deploy)
3. Toutes les sessions admin en cours sont immédiatement invalidées
   (les jetons de session sont signés avec cette clé)
4. Changer aussi ADMIN_SESSION_SECRET si configuré
```

**Si ENCRYPTION_KEY est compromise :**

```
⚠️  CRITIQUE — les identifiants Shop existants sont tous compromis.

1. Générer une nouvelle clé :
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

2. Mettre à jour ENCRYPTION_KEY dans Netlify

3. Re-chiffrer tous les identifiants existants :
   → Pour chaque client ayant un accès Shop :
      Admin → charger les identifiants (avec l'ancienne clé, tant qu'elle est disponible)
      → noter les valeurs en clair
      → changer la clé dans Netlify
      → re-livrer les identifiants via le panneau admin (re-chiffre avec la nouvelle clé)

4. Prévenir tous les clients Shop de changer leurs mots de passe TikTok Shop
```

**Si STRIPE_SECRET_KEY est compromise :**

```
1. Stripe Dashboard → Developers → API keys → Roll secret key
2. Mettre à jour STRIPE_SECRET_KEY dans Netlify
3. Mettre à jour STRIPE_WEBHOOK_SECRET si tu recrées aussi l'endpoint webhook
4. Déployer
```

---

## Incident 4 : Le site est inaccessible / erreurs 500

**Diagnostic rapide :**

```bash
# Vérifier le statut du dernier déploiement Netlify
# Netlify Dashboard → Deploys → voir le dernier déploiement

# Vérifier les logs des fonctions
# Netlify Dashboard → Functions → [nom de la fonction] → Function log

# Vérifier le statut de Supabase
# https://status.supabase.com

# Vérifier le statut de Netlify
# https://www.netlifystatus.com
```

**Rollback rapide :**

```
Netlify Dashboard → Deploys → cliquer sur un déploiement précédent qui fonctionnait
→ bouton "Publish deploy"
```

---

## Incident 5 : Déploiement CI/CD en échec

**Causes fréquentes :**

| Erreur | Cause | Correction |
|---|---|---|
| `npm ci` échoue | package-lock.json manquant (F12) | `npm install --package-lock-only` + commiter le lockfile |
| `gitleaks` détecte un secret | Clé/token dans le code | Retirer le secret, `git commit --amend` ou history rewrite |
| `npm audit` HIGH | Vulnérabilité dans une dépendance | `npm audit fix` ou mettre à jour la dépendance |
| Smoke test HTTP ≠ 200 | Déploiement raté ou site KO | Vérifier les logs Netlify |

---

## Procédure de mise à jour des dépendances

À faire trimestriellement (ou quand `npm audit` signale une vulnérabilité) :

```bash
# Vérifier ce qui est disponible
npm outdated

# Mettre à jour en restant dans les plages semver déclarées dans package.json
npm update

# Mettre à jour le lockfile
npm install --package-lock-only

# Vérifier qu'il n'y a pas de régression
node --check netlify/functions/*.js
node --check netlify/functions/_lib/*.js

# Commiter et pousser → la CI vérifiera tout automatiquement
git add package.json package-lock.json
git commit -m "chore: mise à jour des dépendances npm"
git push
```
