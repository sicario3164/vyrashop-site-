# Relancer VyraShop après la perte de l'équipe Netlify

Novembre 2026. Suis les étapes **dans l'ordre** : chacune dépend de la précédente.

---

## Étape 0 : retrouver l'ancienne équipe Netlify (à faire en premier)

Le message « ce domaine appartient à une autre équipe » prouve que **l'ancienne équipe existe encore** : le domaine et probablement les anciens sites, avec leurs variables d'environnement, y sont toujours. En général, elle n'a pas disparu : tu es connecté à un **autre compte Netlify**.

Sur Netlify, chaque méthode de connexion (GitHub, GitLab, Bitbucket, Google, e-mail + mot de passe) peut créer un **compte séparé**, même avec la même adresse e-mail.

1. Déconnecte-toi de Netlify.
2. Reconnecte-toi successivement avec **chaque** méthode : « Log in with GitHub », « with Google », « with GitLab », « with Bitbucket », puis « with email ».
3. À chaque fois, ouvre le sélecteur d'équipe (en haut à gauche) et cherche l'ancienne équipe et le site VyraShop.
4. Regarde aussi dans ta boîte mail (et les spams) s'il y a des messages de Netlify : facture impayée, crédits épuisés, « site paused », « team suspended » ou invitation d'équipe. Si une facture est impayée, le site a pu être mis en pause, sans être supprimé.

**Si tu retrouves l'ancienne équipe**, c'est la meilleure issue :
- Note toutes les variables (Project configuration → Environment variables) dans un gestionnaire de mots de passe.
- Soit tu relances simplement le site dans l'ancienne équipe (régler la facture si besoin), et le domaine revient tout seul.
- Soit tu déplaces le domaine vers la nouvelle équipe : Team settings → Domains → vyrashop.com → **Transfer domain** (vers l'autre équipe), après avoir ajouté le même compte comme membre des deux équipes.

**Si tu ne la retrouves pas** : contacte le support Netlify (https://www.netlify.com/support/ → « Domains / Billing »). Donne :
- le nom de domaine `vyrashop.com`
- la facture d'achat du domaine (PDF) et l'adresse e-mail de facturation
- le nom de la nouvelle équipe vers laquelle transférer le domaine
- et demande aussi, en plus du transfert, s'ils peuvent **restaurer les anciens sites et leurs variables d'environnement**.

Seul Netlify peut faire ce transfert : le domaine a été acheté chez eux et le registrar est leur partenaire.

⚠️ **Date d'expiration** : un domaine acheté sur Netlify se renouvelle chaque année avec la carte de l'équipe. Si cette équipe n'a plus de moyen de paiement, le domaine peut expirer. Vérifie la date sur https://lookup.icann.org/fr/lookup (tape `vyrashop.com`). S'il est expiré, signale-le **en urgence** au support : il y a environ 30 jours de grâce, puis environ 30 jours de « rédemption » payante, et ensuite le domaine est perdu.

⚠️ **E-mail contact@vyrashop.com** : si les DNS du domaine étaient gérés par Netlify, les enregistrements MX (réception de mails) dépendent aussi de l'ancienne équipe. Teste en envoyant un mail à contact@vyrashop.com. S'il revient en erreur, recrée les MX de ton fournisseur de mail une fois le domaine récupéré.

---

## Étape 1 : faire tourner le site sur l'adresse provisoire (sans attendre le domaine)

Le code a été adapté : la navigation, la réinitialisation de mot de passe et la confirmation d'inscription fonctionnent maintenant sur **n'importe quelle adresse** (`xxx.netlify.app` ou `vyrashop.com`).

1. Nouvelle équipe Netlify → Add new project → Import from GitHub → dépôt `vyrashop-site-`, branche principale.
2. Réglages de build : laisse vide (le `netlify.toml` du dépôt s'en charge). Netlify installe les dépendances de `package.json` automatiquement.
3. Note l'adresse provisoire, par exemple `https://vyrashop-xxxx.netlify.app`. Dans la suite, on l'appelle **`SITE`**.

---

## Étape 2 : Supabase (base de données et e-mails de connexion)

### 2a. Le projet existe-t-il encore ?

Va sur https://supabase.com/dashboard et cherche le projet `pdprwoskbrsoojtanmze`.

- **Il est en pause** (« Paused ») : clique sur **Restore project**. Les projets gratuits se mettent en pause après 7 jours sans trafic, ce qui arrive vite quand le site est hors ligne. Toutes les données (clients, accès) sont conservées.
- **Il a disparu** : crée un nouveau projet, puis dans SQL Editor exécute `supabase-migrations/000-schema-complet.sql`, puis `001-rate-limiting.sql`. Remplace ensuite l'URL et la clé anon dans le code (voir 2d).

### 2b. Réparer les e-mails Supabase (confirmation d'inscription, mot de passe oublié)

Authentication → **URL Configuration** :
- **Site URL** : `SITE` pour l'instant (puis `https://vyrashop.com` une fois le domaine récupéré).
- **Redirect URLs** : ajoute les quatre lignes suivantes :
  - `https://vyrashop.com/**`
  - `https://www.vyrashop.com/**`
  - `https://*.netlify.app/**` (ou plus précis : `SITE/**`)
  - `http://localhost:8888/**`

Sans ces adresses, les liens reçus par e-mail renvoient vers un domaine mort ou sont refusés.

Authentication → **Emails → SMTP Settings** : si tu utilisais un SMTP personnalisé (par exemple Brevo, `smtp-relay.brevo.com`, port 587), vérifie que l'identifiant et le mot de passe SMTP Brevo sont toujours valides. En cas de doute, régénère une clé SMTP dans Brevo (Settings → SMTP & API → SMTP) et recolle-la ici.
- L'**adresse d'expédition** `@vyrashop.com` ne passera plus si le domaine n'est plus vérifié chez Brevo. En attendant le domaine, mets temporairement une adresse expéditeur déjà validée dans Brevo.
- Sans SMTP personnalisé, Supabase n'envoie que 2 à 4 e-mails par heure, vers les membres de l'équipe uniquement. En production, il **faut** un SMTP.

Teste ensuite : SITE/espace-membre/login.html → « Mot de passe oublié » → tu dois recevoir le mail, et le lien doit ouvrir `SITE/espace-membre/reset.html`.

### 2c. Récupérer les clés pour Netlify

Project Settings → **API** (ou « API Keys ») :
- `SUPABASE_URL` = Project URL
- `SUPABASE_SERVICE_KEY` = clé **service_role** (secrète, uniquement dans Netlify, jamais dans le HTML)

### 2d. Uniquement si c'est un NOUVEAU projet Supabase

L'URL `https://pdprwoskbrsoojtanmze.supabase.co` et la clé **anon** sont écrites dans 10 pages HTML (`espace-membre/*.html`, `formation/*.html`). Il faut les remplacer par celles du nouveau projet. Donne-moi la nouvelle URL et la nouvelle clé anon (elle est publique, il n'y a pas de risque à la partager) et je fais le remplacement.

---

## Étape 3 : Stripe

### 3a. Les Payment Links

Dans le code, il y a trois liens de paiement :

| Produit | Lien | Où dans le code |
|---|---|---|
| Formation | `https://buy.stripe.com/bJe6oJdwDcub93h06O93y01` | `index.html` |
| Shop | `https://buy.stripe.com/3cI4gB0JR65NgvJbPw93y04` | `index.html` |
| Accompagnement | `https://buy.stripe.com/7sY5kFakr9hZdjx2eW93y05` | `index.html` et `formation/module3.html` |

Ouvre chacun dans un navigateur.
- **La page de paiement s'affiche** : le lien marche, il n'y a qu'à corriger la redirection (voir ci-dessous).
- **Le lien est désactivé ou introuvable** : Stripe Dashboard → Payment Links → réactive le lien ou crée-en un nouveau, puis envoie-moi les nouvelles URL et je les mets dans le code.

Pour **chaque** Payment Link : onglet **After payment** → « Don't show confirmation page » → redirection vers :
- Formation : `SITE/formation/?session_id={CHECKOUT_SESSION_ID}`
- Shop : `SITE/merci-shop.html`
- Accompagnement : `SITE/merci-accompagnement.html`

Si les anciens liens pointent encore vers `https://vyrashop.com/...`, les clients arrivent sur une page morte après paiement, même s'ils ont bien payé. Une fois le domaine récupéré, remets `https://vyrashop.com/...`.

### 3b. Le webhook (accès automatique après paiement)

Developers → **Webhooks** → Add endpoint :
- URL : `SITE/.netlify/functions/stripe-webhook`
- Événements : `checkout.session.completed`, `customer.subscription.deleted`, `refund.updated`, `charge.refunded`
- Copie le **Signing secret** (`whsec_...`) : c'est `STRIPE_WEBHOOK_SECRET`.
- Supprime ou désactive l'ancien endpoint qui pointe vers `vyrashop.com` s'il est en échec. Sinon, Stripe t'enverra des alertes d'échec.

⚠️ Le secret change à chaque nouvel endpoint. Quand tu repasseras sur `vyrashop.com`, modifie l'URL de **cet** endpoint plutôt que d'en créer un autre, pour garder le même secret.

### 3c. Clés et Price IDs

- `STRIPE_SECRET_KEY` : Developers → API keys → Secret key. Si tu ne peux plus la voir, utilise **Roll key** (ou crée une clé restreinte).
- `STRIPE_FORMATION_PRICE_ID`, `STRIPE_SHOP_PRICE_ID`, `STRIPE_ACCOMPAGNEMENT_PRICE_ID` : Product catalog → clique sur le produit → section Pricing → l'ID commence par `price_...`. Il faut **le prix utilisé par le Payment Link**.

---

## Étape 4 : Brevo (e-mails marketing et lead magnet)

- `BREVO_API_KEY` : Brevo → Settings → **SMTP & API** → API Keys → Generate a new API key.
- Listes : Contacts → **Lists**. Note l'ID de chaque liste : Lead magnet (2 par défaut), Formation (3), Shop (4), Accompagnement (5). Ne crée les variables `BREVO_*_LIST` que si tes ID sont différents de ces valeurs par défaut.
- Senders & domains : vérifie que l'expéditeur est encore valide (voir 2b).

---

## Étape 5 : variables Netlify

Nouvelle équipe → ton site → Project configuration → **Environment variables** → Add a variable. La liste complète se trouve dans `.env.example`.

| Variable | D'où elle vient |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Étape 2c |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_*_PRICE_ID` | Étape 3 |
| `BREVO_API_KEY` (+ `BREVO_*_LIST` si besoin) | Étape 4 |
| `ADMIN_ACCESS_KEY` | **Nouvelle** : `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` |
| `ADMIN_SESSION_SECRET` | **Nouvelle** : même commande |
| `ADMIN_TOTP_SECRET` | **Nouvelle** : `node -e "console.log(require('./netlify/functions/_lib/totp').generateSecret('admin','VyraShop'))"` (à lancer à la racine du dépôt). Ajoute le `secret` dans Google Authenticator ou une autre appli (saisie manuelle) et supprime l'ancienne entrée VyraShop de l'appli. |
| `ENCRYPTION_KEY` | Voir ci-dessous |

**`ENCRYPTION_KEY`** chiffre les identifiants TikTok Shop livrés aux clients.
- **Si tu as l'ancienne valeur** (gestionnaire de mots de passe, ancienne équipe retrouvée) : remets-la telle quelle.
- **Sinon** : génère-en une nouvelle avec `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Les identifiants Shop déjà enregistrés deviennent illisibles : il faudra les **re-livrer** à chaque client Shop depuis le panneau admin.

Ensuite : Deploys → **Trigger deploy → Clear cache and deploy site**. Les variables ne sont prises en compte qu'après un nouveau déploiement.

---

## Étape 6 : vérifier que tout fonctionne

Ouvre `SITE/.netlify/functions/health?key=<ADMIN_ACCESS_KEY>`.

Tu dois obtenir `missingRequired: []`, et tout à `ok` dans `checks` : tables Supabase, Price IDs Stripe (avec le bon montant), Brevo, clé de chiffrement. Chaque ligne en erreur indique précisément ce qui reste à corriger.

Ensuite, teste à la main :
1. Formulaire ebook gratuit sur la page d'accueil : le contact doit apparaître dans la liste Brevo.
2. Inscription sur l'espace membre : un e-mail de confirmation doit arriver.
3. « Mot de passe oublié » : un e-mail doit arriver, et le lien doit marcher.
4. Achat test (Stripe en mode test, ou vrai achat remboursé ensuite) : redirection, webhook « Succeeded » dans Stripe, accès visible dans l'espace membre.
5. Panneau admin `SITE/espace-membre/admin.html` : connexion avec la clé et le code TOTP.

---

## Étape 7 : une fois `vyrashop.com` récupéré

1. Netlify → Domain management → Add domain → `vyrashop.com` (+ `www`), puis HTTPS → Verify DNS / Provision certificate.
2. Supabase → Site URL = `https://vyrashop.com`.
3. Stripe → redirections des 3 Payment Links et URL du webhook → `https://vyrashop.com/...`.
4. Brevo → re-vérifier le domaine expéditeur (DKIM/SPF dans les DNS Netlify).
5. Recrée les enregistrements MX / SPF / DKIM de la messagerie `contact@vyrashop.com`.
6. Lance à nouveau `/.netlify/functions/health` et les tests de l'étape 6.

## Pour que ça n'arrive plus

- Copie **toutes** les variables Netlify dans un gestionnaire de mots de passe (Bitwarden, 1Password).
- Utilise toujours la même méthode de connexion Netlify et active la 2FA.
- Pense à transférer un jour le domaine vers un registrar indépendant (OVH, Cloudflare, Gandi…), puis à le pointer vers Netlify. Le domaine ne dépendra alors plus d'une équipe Netlify.
- Exporte la table `user_access` en CSV une fois par mois (voir `SAUVEGARDES.md`).
