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

  // Vérifie le token et récupère l'utilisateur authentifié (espace membre)
  const { data: userData, error: userErr } = await sb.auth.getUser(body.access_token);
  if (userErr || !userData || !userData.user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
  }

  const email = userData.user.email.toLowerCase();

  const { data, error } = await sb.from('user_access').select('has_formation').eq('email', email).single();
  if (error || !data) {
    return { statusCode: 200, headers, body: JSON.stringify({ has_formation: false }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ has_formation: !!data.has_formation }) };
};
