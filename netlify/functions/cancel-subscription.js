const { createClient } = require('@supabase/supabase-js');

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

  // Vérifier le token et récupérer l'utilisateur authentifié
  const { data: userData, error: userErr } = await sb.auth.getUser(body.access_token);
  if (userErr || !userData || !userData.user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
  }

  const email = userData.user.email.toLowerCase();

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
    await stripe.subscriptions.cancel(access.stripe_subscription_id);
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur Stripe: ' + e.message }) };
  }

  // Mise à jour immédiate (le webhook fera aussi cette mise à jour en confirmation)
  await sb.from('user_access').update({ has_accompagnement: false, stripe_subscription_id: null }).eq('email', email);

  return { statusCode: 200, headers, body: JSON.stringify({ cancelled: true }) };
};
