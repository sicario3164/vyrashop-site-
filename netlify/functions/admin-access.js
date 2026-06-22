const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { getClientIp, checkRateLimit } = require('./_lib/rate-limit');
const { verifyTOTP } = require('./_lib/totp');

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

// F8 (FAIBLE) : comparaison à temps constant pour admin_key (timing attack).
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

// MFA admin : une fois le code TOTP validé, on émet un jeton de session signé (HMAC) plutôt
// que de redemander un code à 6 chiffres à chaque clic — un code TOTP n'est valable que 30s,
// ce qui serait inutilisable pour une session de travail normale. Le jeton est sans état
// (rien à stocker côté serveur) : sa propre signature + son expiration encodée suffisent à
// le valider.
function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_ACCESS_KEY || '';
}
function makeSessionToken() {
  const expiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2h
  const sig = crypto.createHmac('sha256', sessionSecret()).update(String(expiresAt)).digest('hex');
  return expiresAt + '.' + sig;
}
function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return false;
  const [expiresAt, sig] = token.split('.');
  if (!expiresAt || !sig) return false;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(expiresAt).digest('hex');
  if (!safeEqual(sig, expected)) return false;
  return Number(expiresAt) > Date.now();
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

  // Anti-bruteforce (F1) : la décision de blocage repose désormais sur le compteur Postgres
  // atomique (rate_limit_check), qui élimine la race condition de l'ancien pattern
  // "compter les échecs récents PUIS insérer". La table admin_attempts est conservée comme
  // journal d'audit (qui a tenté quoi, depuis où) mais ne sert plus à la décision elle-même.
  const rl = await checkRateLimit(sb, event, 'admin-access', 5, 15);
  if (!rl.allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' }) };
  }

  if (!body.admin_key || !safeEqual(body.admin_key, adminKey)) {
    await sb.from('admin_attempts').insert({ ip, success: false });
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // MFA (2e facteur) : actif seulement si ADMIN_TOTP_SECRET est configuré, pour ne pas
  // verrouiller l'accès admin tant que l'application d'authentification n'est pas en place.
  // Une fois configuré : soit un jeton de session valide est déjà présent (action courante
  // dans une session déjà authentifiée), soit un code TOTP à 6 chiffres doit être fourni.
  let newSessionToken = null;
  const totpSecret = process.env.ADMIN_TOTP_SECRET;
  if (totpSecret) {
    const hasValidSession = verifySessionToken(body.admin_session_token);
    if (!hasValidSession) {
      if (!verifyTOTP(totpSecret, body.admin_totp)) {
        await sb.from('admin_attempts').insert({ ip, success: false });
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'totp_required' }) };
      }
      newSessionToken = makeSessionToken();
    }
  }

  // Authentification réussie
  await sb.from('admin_attempts').insert({ ip, success: true });

  // Injecte le jeton de session MFA (s'il vient d'être émis) dans toute réponse de succès,
  // sans dupliquer cette logique dans chaque action.
  function respond(statusCode, data) {
    if (newSessionToken) data = Object.assign({}, data, { session_token: newSessionToken });
    return { statusCode, headers, body: JSON.stringify(data) };
  }

  async function logAction(action, targetEmail) {
    await sb.from('admin_logs').insert({ action, target_email: targetEmail, ip });
  }

  try {
    if (body.action === 'list') {
      const { data, error } = await sb.from('user_access').select('id,email,has_formation,has_shop,has_accompagnement,created_at').order('created_at', { ascending: false });
      if (error) throw error;
      return respond(200, { data });
    }

    if (body.action === 'save_access') {
      const email = body.email && body.email.trim().toLowerCase();
      if (!email) return respond(400, { error: 'Email required' });

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
      return respond(200, { success: true });
    }

    if (body.action === 'deliver_shop') {
      const email = body.email && body.email.trim().toLowerCase();
      if (!email) return respond(400, { error: 'Email required' });

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
      return respond(200, { success: true });
    }

    if (body.action === 'get_shop_creds') {
      const email = body.email && body.email.trim().toLowerCase();
      if (!email) return respond(400, { error: 'Email required' });
      const { data, error } = await sb.from('user_access').select('shop_login,shop_password,shop_notes').eq('email', email).single();
      if (error || !data) return respond(200, { shop_login: '', shop_password: '', shop_notes: '' });
      await logAction('view_shop_creds', email);
      return respond(200, {
        shop_login: decrypt(data.shop_login) || '',
        shop_password: decrypt(data.shop_password) || '',
        shop_notes: decrypt(data.shop_notes) || ''
      });
    }

    if (body.action === 'logs') {
      const { data, error } = await sb.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return respond(200, { data });
    }

    return respond(400, { error: 'Unknown action' });
  } catch (err) {
    // F9 (FAIBLE) : ne plus renvoyer err.message brut au client (CWE-209) ;
    // détail conservé uniquement dans les logs serveur.
    console.error('admin-access error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
