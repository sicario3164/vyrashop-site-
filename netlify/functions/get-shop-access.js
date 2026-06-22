const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { checkRateLimit } = require('./_lib/rate-limit');
const { getAuthenticatedEmail } = require('./_lib/auth');

const ALGO = 'aes-256-gcm';

function decrypt(b64) {
  if (!b64) return null;
  try {
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
    const data = Buffer.from(b64, 'base64');
    const iv = data.slice(0, 12);
    const tag = data.slice(12, 28);
    const encrypted = data.slice(28);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

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

  // F11 : cette fonction renvoie des identifiants déchiffrés, on est plus strict ici.
  const rl = await checkRateLimit(sb, event, 'get-shop-access', 15, 5);
  if (!rl.allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de requêtes. Réessaie dans quelques minutes.' }) };
  }

  // Vérifier le token et récupérer l'utilisateur authentifié
  const email = await getAuthenticatedEmail(sb, body.access_token);
  if (!email) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
  }

  const { data, error } = await sb.from('user_access').select('has_shop,shop_login,shop_password,shop_notes').eq('email', email).single();
  if (error || !data || !data.has_shop) {
    return { statusCode: 200, headers, body: JSON.stringify({ has_shop: false, delivered: false }) };
  }

  const login = decrypt(data.shop_login);
  const password = decrypt(data.shop_password);
  const notes = decrypt(data.shop_notes);

  return { statusCode: 200, headers, body: JSON.stringify({
    has_shop: true,
    delivered: !!login,
    shop_login: login || null,
    shop_password: password || null,
    shop_notes: notes || null
  }) };
};
