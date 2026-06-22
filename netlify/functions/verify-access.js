// Vérifie auprès de Stripe qu'une session de paiement (?session_id=...) est réelle,
// payée, et correspond au bon produit, avant d'autoriser l'accès à la formation.
//
// CORRECTIFS APPLIQUÉS (audit sécurité — voir PHASE2-Audit-Securite-VyraShop.md et suivi) :
//   F1 (CRITIQUE) : anti-bruteforce sur admin_key, comparaison à temps constant (F8).
//   F6 (MOYENNE)  : vérification du produit acheté désormais obligatoire (fail-closed).
//   F7 (MOYENNE)  : session_id limité à 72h après l'achat (jeton non permanent).
//   Race condition (relevée lors de la revue complémentaire) : le rate limiting passe par
//   le compteur Postgres atomique partagé (_lib/rate-limit.js), qui élimine la fenêtre de
//   contournement de l'ancien pattern "compter les échecs récents PUIS insérer".

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { checkRateLimit, getClientIp } = require('./_lib/rate-limit');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    try { crypto.timingSafeEqual(bufA, bufA); } catch (e) {}
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

exports.handler = async function (event) {
  const headers = { "Content-Type": "application/json" };
  const params = event.queryStringParameters || {};

  // --- Accès admin : clé secrète, protégée par anti-bruteforce atomique (F1) ---
  const adminKey = process.env.ADMIN_ACCESS_KEY;
  if (params.admin_key) {
    if (!adminKey || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ valid: false, reason: "server_misconfigured" }) };
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const ip = getClientIp(event);

    const rl = await checkRateLimit(sb, event, 'verify-access-admin', 5, 15);
    if (!rl.allowed) {
      return { statusCode: 429, headers, body: JSON.stringify({ valid: false, reason: "too_many_attempts" }) };
    }

    if (safeEqual(params.admin_key, adminKey)) {
      await sb.from('admin_attempts').insert({ ip, success: true });
      return { statusCode: 200, headers, body: JSON.stringify({ valid: true, admin: true }) };
    }

    await sb.from('admin_attempts').insert({ ip, success: false });
    return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: "invalid_admin_key" }) };
  }

  const sessionId = params.session_id;

  // Un vrai Checkout Session Stripe commence toujours par "cs_"
  if (!sessionId || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ valid: false, reason: "missing_or_invalid_session_id" }) };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  // F6 (MOYENNE) : la vérification du produit acheté est désormais obligatoire.
  // Avant, si STRIPE_FORMATION_PRICE_ID n'était pas configurée, l'accès était accordé
  // sans contrôle (fail-open) ; on refuse maintenant plutôt que d'accorder silencieusement.
  const allowedPriceId = process.env.STRIPE_FORMATION_PRICE_ID;
  if (!secretKey || !allowedPriceId) {
    return { statusCode: 500, headers, body: JSON.stringify({ valid: false, reason: "server_misconfigured" }) };
  }

  try {
    const resp = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    const session = await resp.json();

    if (!resp.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: "session_not_found" }) };
    }

    if (session.payment_status !== "paid") {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: "not_paid" }) };
    }

    // F7 (MOYENNE) : sans limite de temps, ce session_id reste un jeton porteur permanent
    // et partageable indéfiniment (ex: posté publiquement) une fois connu. On le limite à
    // 72h après l'achat — au-delà, le client doit créer/utiliser son compte espace membre
    // (get-formation-access.js), qui lui n'expose aucun jeton partageable.
    const SESSION_VALIDITY_SECONDS = 72 * 60 * 60;
    if (typeof session.created === "number" && (Date.now() / 1000 - session.created) > SESSION_VALIDITY_SECONDS) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: "session_expired", hint: "create_account" }) };
    }

    const items = (session.line_items && session.line_items.data) || [];
    const matches = items.some((item) => item.price && item.price.id === allowedPriceId);
    if (!matches) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: "wrong_product" }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ valid: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ valid: false, reason: "server_error" }) };
  }
};
