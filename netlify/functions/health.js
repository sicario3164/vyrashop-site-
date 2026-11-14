// health.js — diagnostic de configuration après (re)déploiement.
//
// Appel : https://<ton-site>/.netlify/functions/health?key=<ADMIN_ACCESS_KEY>
//
// Ne renvoie JAMAIS la valeur d'une variable : uniquement « présente / absente » et
// le résultat de tests de connexion (Supabase, tables, Stripe, Price IDs, Brevo).
// Si ADMIN_ACCESS_KEY n'est pas encore configurée, seule la liste des variables
// manquantes est renvoyée (pas de test de connexion).

const crypto = require('crypto');

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_FORMATION_PRICE_ID',
  'STRIPE_SHOP_PRICE_ID',
  'STRIPE_ACCOMPAGNEMENT_PRICE_ID',
  'ENCRYPTION_KEY',
  'ADMIN_ACCESS_KEY',
  'BREVO_API_KEY',
];
const OPTIONAL = [
  'ADMIN_TOTP_SECRET',
  'ADMIN_SESSION_SECRET',
  'BREVO_LEADMAGNET_LIST',
  'BREVO_FORMATION_LIST',
  'BREVO_SHOP_LIST',
  'BREVO_ACCOMPAGNEMENT_LIST',
];

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body, null, 2),
});

exports.handler = async function (event) {
  const env = process.env;
  const missingRequired = REQUIRED.filter((k) => !env[k]);
  const missingOptional = OPTIONAL.filter((k) => !env[k]);

  if (!env.ADMIN_ACCESS_KEY) {
    return json(200, {
      note: 'ADMIN_ACCESS_KEY absente : tests de connexion désactivés.',
      missingRequired,
      missingOptional,
    });
  }

  const key = (event.queryStringParameters || {}).key;
  if (!safeEqual(key, env.ADMIN_ACCESS_KEY)) {
    return json(401, { error: 'Ajoute ?key=<ADMIN_ACCESS_KEY> à l’URL.' });
  }

  const checks = {};

  // Clé de chiffrement : doit faire 32 octets en base64.
  if (env.ENCRYPTION_KEY) {
    const len = Buffer.from(env.ENCRYPTION_KEY, 'base64').length;
    checks.encryptionKey = len === 32 ? 'ok' : `invalide (${len} octets au lieu de 32)`;
  }

  // Supabase : connexion + présence des tables.
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
      for (const table of ['user_access', 'admin_logs', 'admin_attempts', 'rate_limit_counters']) {
        const { error } = await sb.from(table).select('*', { count: 'exact', head: true });
        checks[`supabase.${table}`] = error ? `erreur : ${error.message}` : 'ok';
      }
    } catch (e) {
      checks.supabase = `erreur : ${e.message}`;
    }
  }

  // Stripe : clé valide + Price IDs existants dans CE compte Stripe.
  if (env.STRIPE_SECRET_KEY) {
    try {
      const stripe = require('stripe')(env.STRIPE_SECRET_KEY);
      checks.stripeMode = env.STRIPE_SECRET_KEY.startsWith('sk_live') ? 'live' : 'test';
      for (const name of ['STRIPE_FORMATION_PRICE_ID', 'STRIPE_SHOP_PRICE_ID', 'STRIPE_ACCOMPAGNEMENT_PRICE_ID']) {
        if (!env[name]) continue;
        try {
          const price = await stripe.prices.retrieve(env[name]);
          checks[name] = `ok (${(price.unit_amount || 0) / 100} ${price.currency}${price.recurring ? ' / ' + price.recurring.interval : ''}${price.active ? '' : ' — INACTIF'})`;
        } catch (e) {
          checks[name] = `introuvable : ${e.message}`;
        }
      }
    } catch (e) {
      checks.stripe = `erreur : ${e.message}`;
    }
  }

  // Brevo : clé valide.
  if (env.BREVO_API_KEY) {
    try {
      const res = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': env.BREVO_API_KEY } });
      checks.brevo = res.ok ? 'ok' : `erreur HTTP ${res.status}`;
    } catch (e) {
      checks.brevo = `erreur : ${e.message}`;
    }
  }

  return json(200, { missingRequired, missingOptional, checks });
};
