const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

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

  // VÃ©rifier le token et rÃ©cupÃ©rer l'utilisateur authentifiÃ©
  const { data: userData, error: userErr } = await sb.auth.getUser(body.access_token);
  if (userErr || !userData || !userData.user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
  }

  const email = userData.user.email.toLowerCase();

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
