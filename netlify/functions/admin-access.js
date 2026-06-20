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

  const adminKey = process.env.ADMIN_ACCESS_KEY;
  if (!body.admin_key || body.admin_key !== adminKey) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    if (body.action === 'list') {
      const { data, error } = await sb.from('user_access').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ data }) };
    }

    if (body.action === 'save_access') {
      const email = body.email && body.email.trim().toLowerCase();
      if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email required' }) };

      // Trouver le user_id Supabase si dÃ©jÃ  inscrit
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
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (body.action === 'deliver_shop') {
      const email = body.email && body.email.trim().toLowerCase();
      if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email required' }) };

      const { data: existing } = await sb.from('user_access').select('id').eq('email', email).single();
      const update = {
        shop_login: body.shop_login || null,
        shop_password: body.shop_password || null,
        shop_notes: body.shop_notes || null
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
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Server error' }) };
  }
};
