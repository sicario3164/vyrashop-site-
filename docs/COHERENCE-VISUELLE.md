# Cohérence visuelle — Stripe, Supabase, Brevo

Le site utilise la palette « Cyan & Rose » et le nouveau logo. Ces trois services ont leurs propres pages et e-mails : il faut les régler à la main, une seule fois.

## Codes couleur de référence

| Rôle | Code |
|---|---|
| Fond | `#09090d` |
| Cartes / encadrés | `#121218` |
| Rose (boutons, action principale) | `#fe2c55` |
| Cyan (accents, liens) | `#25f4ee` |
| Texte principal | `#ffffff` |
| Texte secondaire | `#d4d4d9` / `#91919f` |

Fichiers du logo : `assets/brand/` (télécharge-les depuis GitHub : ouvre le fichier → bouton « Download raw »).

---

## 1. Stripe (pages de paiement, reçus, factures)

Stripe Dashboard → **Settings** (roue dentée) → **Business** → **Branding**

| Réglage | Valeur |
|---|---|
| Icon | `assets/brand/stripe-icone-512.png` |
| Logo | `assets/brand/stripe-logo-800.png` |
| Brand color | `#09090d` (fond de la colonne gauche du paiement) |
| Accent color | `#fe2c55` (boutons) |

Puis **Save**. Le réglage s'applique automatiquement aux Payment Links, au paiement, aux reçus et aux factures envoyées par le webhook.

À vérifier aussi :
- **Settings → Business → Public details** : nom affiché « VyraShop Academy », e-mail de support `contact@vyrashop.com`.
- **Settings → Customer emails** : coche « Successful payments » et « Refunds » pour que les reçus partent avec la nouvelle charte.
- Ouvre chacun des 3 Payment Links pour contrôler le rendu.

---

## 2. Supabase (e-mails de compte)

Supabase Dashboard → projet → **Authentication** → **Emails** (ou « Email Templates »)

Pour chaque modèle : remplace le **Subject**, puis colle tout le contenu du fichier dans **Message body** (onglet « Source » / HTML), puis **Save**.

| Modèle Supabase | Objet (Subject) | Fichier |
|---|---|---|
| Confirm signup | `Confirme ton compte VyraShop ✨` | `docs/emails/supabase-confirmation-inscription.html` |
| Reset password | `Ton nouveau mot de passe VyraShop` | `docs/emails/supabase-reinitialisation-mot-de-passe.html` |
| Change email address | `Confirme ta nouvelle adresse e-mail` | `docs/emails/supabase-changement-email.html` |

Ne touche pas aux balises `{{ .ConfirmationURL }}` et `{{ .NewEmail }}` : Supabase les remplace par le vrai lien.

Si tu utilises un SMTP personnalisé (Authentication → Emails → SMTP Settings), mets **Sender name** = `VyraShop Academy`.

---

## 3. Brevo (séquences e-mail)

1. Brevo → **Campagnes / Automatisations → Modèles** → **Nouveau modèle** → **Coder votre propre modèle** (HTML).
2. Colle `docs/emails/brevo-modele-de-base.html`. Remplace les textes entre crochets `[...]` par le contenu de chaque e-mail (voir `docs/sequences-email.html`).
3. Conseillé : importe le logo dans la **bibliothèque d'images Brevo** et remplace l'adresse de l'image par celle que Brevo te donne (plus fiable que le site).
4. Duplique ce modèle pour chaque e-mail des séquences, puis remplace les anciens modèles dans tes automatisations.
5. **Expéditeur** : nom « VyraShop Academy ».

Garde `{{ contact.PRENOM }}` et `{{ unsubscribe }}` : le prénom personnalise l'e-mail, le lien de désinscription est obligatoire.

---

## 4. Quand vyrashop.com sera récupéré

Dans les 4 fichiers `docs/emails/*.html` (et dans les modèles déjà collés dans Supabase / Brevo), remplace
`https://lighthearted-beignet-10239c.netlify.app` par `https://vyrashop.com`.
