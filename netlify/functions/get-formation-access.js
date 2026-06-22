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

  // F11 : 30 requêtes / 5 min par IP — généreux pour un usage normal (le gate appelle cette
  // fonction à chaque chargement de page), mais borne un abus automatisé.
  const rl = await checkRateLimit(sb, event, 'get-formation-access', 30, 5);
  if (!rl.allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de requêtes. Réessaie dans quelques minutes.' }) };
  }

  // Vérifie le token et récupère l'utilisateur authentifié (espace membre)
  const email = await getAuthenticatedEmail(sb, body.access_token);
  if (!email) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
  }

  const { data, error } = await sb.from('user_access').select('has_formation').eq('email', email).single();
  if (error || !data) {
    return { statusCode: 200, headers, body: JSON.stringify({ has_formation: false }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ has_formation: !!data.has_formation }) };
};
