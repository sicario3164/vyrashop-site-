const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function encrypt(text) {
  if (!text) return null;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

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

function getClientIp(event) {
  return (event.headers['x-nf-client-connection-ip'] ||
          event.headers['x-forwarded-for'] ||
          'unknown').split(',')[0].trim();
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

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const ip = getClientIp(event);
  const adminKey = process.env.ADMIN_ACCESS_KEY;

  // Anti-bruteforce : vÃ©rifier les Ã©checs rÃ©cents pour cette IP
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: recentFails } = await sb
    .from('admin_attempts')
    .select('id')
    .eq('ip', ip)
    .eq('success', false)
    .gte('created_at', fifteenMinAgo);

  if (recentFails && recentFails.length >= 5) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de tentatives. RÃ©essaie dans 15 minutes.' }) };
  }

  if (!body.admin_key || body.admin_key !== adminKey) {
    await sb.from('admin_attempts').insert({ ip, success: false });
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Authentification rÃ©ussie
  await sb.from('admin_attempts').insert({ ip, success: true });

  async function logAction(action, targetEmail) {
    await sb.from('admin_logs').insert({ action, target_email: targetEmail, ip });
  }

  try {
    if (body.action === 'list') {
      const { data, error } = await sb.from('user_access').select('id,email,has_formation,has_shop,has_accompagnement,created_at').order('created_at', { ascending: false });
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ data }) };
    }

    if (body.action === 'save_access') {
      const email = body.email && body.email.trim().toLowerCase();
      if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email required' }) };

      let userId = null;
      const { data: usersData } = await sb.auth.admin.listUsers();
      const matchedUser = usersData && usersData.users && usersData.users.find(u => u.email && u.email.toLowerCase() === email);
      if (matchedUser) userId = matchedUser.id;

      const update = {
        email,
        has_formation: !!body.has_formation,
        has_shop: !!body.has_shop,
        has_accompagnement: !!body.has_accompagnement
      };
      if (userId) update.user_id = userId;

      const { data: existing } = await sb.from('user_access').select('id').eq('email', email).single();
      let result;
      if (existing) {
        result = await sb.from('user_access').update(update).eq('email', email);
      } else {
        result = await sb.from('user_access').insert(update);
      }
      if (result.error) throw result.error;
      await logAction('save_access', email);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (body.action === 'deliver_shop') {
      const email = body.email && body.email.trim().toLowerCase();
      if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email required' }) };

      const { data: existing } = await sb.from('user_access').select('id').eq('email', email).single();
      const update = {
        shop_login: encrypt(body.shop_login || null),
        shop_password: encrypt(body.shop_password || null),
        shop_notes: encrypt(body.shop_notes || null)
      };
      let result;
      if (existing) {
        result = await sb.from('user_access').update(update).eq('email', email);
      } else {
        update.email = email;
        update.has_shop = true;
        result = await sb.from('user_access').insert(update);
      }
      if (result.error) throw result.error;
      await logAction('deliver_shop', email);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (body.action === 'get_shop_creds') {
      const email = body.email && body.email.trim().toLowerCase();
      if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email required' }) };
      const { data, error } = await sb.from('user_access').select('shop_login,shop_password,shop_notes').eq('email', email).single();
      if (error || !data) return { statusCode: 200, headers, body: JSON.stringify({ shop_login: '', shop_password: '', shop_notes: '' }) };
      await logAction('view_shop_creds', email);
      return { statusCode: 200, headers, body: JSON.stringify({
        shop_login: decrypt(data.shop_login) || '',
        shop_password: decrypt(data.shop_password) || '',
        shop_notes: decrypt(data.shop_notes) || ''
      }) };
    }

    if (body.action === 'logs') {
      const { data, error } = await sb.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ data }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Server error' }) };
  }
};
