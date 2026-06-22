# Runbook Sauvegardes — VyraShop

Dernière mise à jour : juin 2026  
Responsable : opérateur du site

---

## 1. Ce qui doit être sauvegardé

| Composant | Contient | Criticité |
|---|---|---|
| Base de données Supabase | `user_access` (accès clients), `admin_logs`, `admin_attempts`, `rate_limit_counters` | 🔴 CRITIQUE |
| Variables d'environnement Netlify | Clés Stripe, clé Supabase service, clé de chiffrement, clé admin, secret TOTP, secret session | 🔴 CRITIQUE |
| Dépôt Git (code source) | Fonctions Netlify, pages HTML, assets | 🟡 IMPORTANT |
| PDF de formation | 15 ebooks dans `netlify/functions/_assets/formation/` | 🟡 IMPORTANT |

---

## 2. Base de données Supabase

### 2a. Sauvegarde automatique Supabase (déjà en place)

Supabase **Pro** et au-dessus : sauvegardes journalières automatiques, conservées 7 jours (Point-in-Time Recovery disponible sur les plans supérieurs). Vérifier périodiquement dans : **Supabase Dashboard → Project Settings → Backups**.

Sur le plan **Free** : pas de sauvegarde automatique — exécuter manuellement les commandes ci-dessous.

### 2b. Sauvegarde manuelle (à planifier si plan Free)

```bash
# Prérequis : Supabase CLI (npm install -g supabase)
# Connexion au projet
supabase login
supabase link --project-ref pdprwoskbrsoojtanmze

# Export de toutes les tables critiques en CSV (à exécuter une fois par semaine minimum)
supabase db dump --data-only -f backup-$(date +%Y%m%d).sql

# Vérifier que le fichier est non vide avant de le considérer valide
ls -la backup-*.sql
```

Stocker le fichier `.sql` obtenu dans un endroit sûr et chiffré (Bitwarden, 1Password, coffre-fort cloud privé). **Ne jamais stocker les sauvegardes dans le dépôt Git** (elles contiennent des emails et données personnelles).

### 2c. Export ciblé des tables critiques (via l'UI Supabase)

Dashboard → Table Editor → `user_access` → bouton **Export CSV**

Faire de même pour `admin_logs`. Fréquence recommandée : mensuelle minimum, hebdomadaire si volume de clients actif.

---

## 3. Variables d'environnement Netlify

⚠️ Ces variables ne sont **jamais** dans le dépôt Git. Si elles sont perdues (ex: suppression accidentelle du site Netlify), tout l'accès Formation/Shop cesse de fonctionner et les données Shop restent chiffrées et irrécupérables.

### Variables à conserver dans un gestionnaire de mots de passe (Bitwarden, 1Password…)

| Nom de la variable | Description | Impact si perdue |
|---|---|---|
| `SUPABASE_URL` | URL du projet Supabase | Toutes les fonctions cassées |
| `SUPABASE_SERVICE_KEY` | Clé de service Supabase (rôle admin) | Toutes les fonctions cassées |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe | Webhooks, annulation abonnement |
| `STRIPE_WEBHOOK_SECRET` | Secret de validation des webhooks Stripe | Webhooks ignorés → pas d'accès post-paiement |
| `STRIPE_FORMATION_PRICE_ID` | ID du produit Formation dans Stripe | Accès Formation bloqué |
| `STRIPE_SHOP_PRICE_ID` | ID du produit Shop dans Stripe | Attribution Shop incorrecte |
| `STRIPE_ACCOMPAGNEMENT_PRICE_ID` | ID du produit Accompagnement dans Stripe | Attribution Accompagnement incorrecte |
| `ENCRYPTION_KEY` | Clé AES-256-GCM (base64, 32 octets) | Identifiants Shop **irrécupérables** |
| `ADMIN_ACCESS_KEY` | Clé d'accès au panneau admin | Accès admin impossible |
| `ADMIN_TOTP_SECRET` | Secret TOTP pour le 2e facteur admin (MFA) | MFA cassée |
| `ADMIN_SESSION_SECRET` | Secret de signature des jetons de session admin | Optionnel (fallback sur ADMIN_ACCESS_KEY) |

**Procédure si Netlify est recréé de zéro :**
1. Aller sur Netlify → Site → Site configuration → Environment variables
2. Recréer chaque variable avec la valeur conservée dans le gestionnaire de mots de passe
3. Déclencher un nouveau déploiement
4. Vérifier le smoke test (voir workflow CI/CD)

---

## 4. Dépôt Git

Le code source doit être hébergé sur un dépôt Git privé (GitHub recommandé pour intégration avec les Actions CI/CD).

```bash
# Initialisation (une seule fois, si pas encore fait)
cd /chemin/vers/le/site
git init
git remote add origin git@github.com:<ton-compte>/vyrashop-site.git
git add .
git commit -m "Initial commit — site complet post-audit"
git push -u origin main
```

**Ce qui ne doit JAMAIS être commité :**
- Variables d'environnement (jamais de `.env` avec des vraies clés)
- Sauvegardes SQL
- Tout fichier contenant des mots de passe ou clés réelles

Le fichier `.gitignore` ci-dessous est fourni dans ce dépôt pour le garantir.

---

## 5. PDF de formation

Les 15 PDF sont dans `netlify/functions/_assets/formation/` et sont versionnés dans Git. Ils sont donc sauvegardés dès que le dépôt est sauvegardé.

Si les PDF sont modifiés/remplacés à l'avenir : faire un `git add` + `git commit` pour que la nouvelle version soit tracée.

---

## 6. Fréquence recommandée

| Action | Fréquence | Qui |
|---|---|---|
| Vérifier les sauvegardes auto Supabase | Mensuelle | Opérateur |
| Export CSV `user_access` | Mensuelle | Opérateur |
| Vérifier que toutes les variables Netlify sont bien dans le gestionnaire de mots de passe | Trimestrielle | Opérateur |
| Tester la procédure de restauration (créer un projet Supabase de test et importer le dump) | Semestrielle | Opérateur |

---

## 7. Procédure de restauration d'urgence

En cas de perte totale du site :

1. Créer un nouveau site Netlify, connecté au dépôt Git
2. Reconfigurer toutes les variables d'environnement (cf. section 3)
3. Recréer la table `rate_limit_counters` et la fonction `rate_limit_check` (SQL fourni dans `supabase-migrations/001-rate-limiting.sql`)
4. Si la base Supabase est perdue : importer le dernier dump `.sql` via `supabase db restore`
5. Vérifier avec le smoke test du workflow CI/CD que tout fonctionne
6. Tester manuellement un accès Formation et un accès Shop

**Temps de rétablissement estimé :** 30-60 minutes avec les sauvegardes à jour.
