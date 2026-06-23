/**
 * subscribe.js — VyraShop Academy
 * Ajout d'un contact Brevo depuis le formulaire lead magnet (ebook gratuit).
 * Variables d'environnement requises (Netlify → Site config → Environment variables) :
 *   BREVO_API_KEY          → ta clé API Brevo (Settings → API keys)
 *   BREVO_LEADMAGNET_LIST  → ID de la liste Brevo "Lead Magnet" (ex: 2)
 */

exports.handler = async function (event) {
  /* ── CORS preflight ── */
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  /* ── Parse body ── */
  let phone, email;
  try {
    ({ phone, email } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON invalide' }) };
  }

  if (!email || !phone) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'email et telephone sont requis' }),
    };
  }

  const apiKey  = process.env.BREVO_API_KEY;
  const listId  = parseInt(process.env.BREVO_LEADMAGNET_LIST || '2', 10);

  if (!apiKey) {
    console.error('BREVO_API_KEY manquante');
    return { statusCode: 500, body: JSON.stringify({ error: 'Config serveur manquante' }) };
  }

  /* ── Appel API Brevo ── */
  try {
    const res = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        email: email.toLowerCase().trim(),
        attributes: {
          SMS: phone.trim(),
          WHATSAPP: phone.trim(),
        },
        listIds: [listId],
        updateEnabled: true,   // met à jour si le contact existe déjà
      }),
    });

    /* 201 Created ou 204 No Content (contact mis à jour) → succès */
    if (res.status === 201 || res.status === 204) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true }),
      };
    }

    const errBody = await res.text();
    console.error('Brevo error', res.status, errBody);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Erreur Brevo', status: res.status }),
    };
  } catch (err) {
    console.error('Fetch error', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Erreur réseau' }),
    };
  }
};
