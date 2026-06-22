const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit } = require('./_lib/rate-limit');
const { getAuthenticatedEmail } = require('./_lib/auth');

exports.handler = async function(event) {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid body' }) };
  }

  if (!body.access_token) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing access token' }) };
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // F11 : action sensible (résiliation), limite stricte.
  const rl = await checkRateLimit(sb, event, 'cancel-subscription', 5, 15);
  if (!rl.allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de requêtes. Réessaie dans quelques minutes.' }) };
  }

  // Vérifier le token et récupérer l'utilisateur authentifié
  const email = await getAuthenticatedEmail(sb, body.access_token);
  if (!email) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
  }

  const { data: access, error: accessErr } = await sb
    .from('user_access')
    .select('has_accompagnement,stripe_subscription_id')
    .eq('email', email)
    .single();

  if (accessErr || !access || !access.has_accompagnement) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Aucun accompagnement actif' }) };
  }

  if (!access.stripe_subscription_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Abonnement introuvable. Contacte le support via WhatsApp.' }) };
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  try {
    await stripe.subscriptions.update(access.stripe_subscription_id, { cancel_at_period_end: true });
  } catch (e) {
    // F9 (FAIBLE) : ne plus renvoyer e.message brut au client. Le rapport Phase 2 avait jugé
    // ce risque négligeable (message Stripe déjà pensé pour l'utilisateur final), mais on
    // l'aligne ici sur le même traitement que les autres fonctions, par cohérence.
    console.error('cancel-subscription Stripe error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur lors de la résiliation. Réessaie, ou contacte le support via WhatsApp.' }) };
  }

  // L'accès reste actif jusqu'à la fin de la période déjà payée.
  // Le webhook customer.subscription.deleted coupera l'accès à cette date-là.
  return { statusCode: 200, headers, body: JSON.stringify({ cancelled: true, mode: 'end_of_period' }) };
};
