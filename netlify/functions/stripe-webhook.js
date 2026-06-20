const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email = session.customer_details?.email;
    if (!email) return { statusCode: 200, body: 'No email' };

    // Récupérer les line items pour identifier le produit
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price'] });
    const priceId = lineItems.data[0]?.price?.id;

    const PRICE_FORMATION = process.env.STRIPE_FORMATION_PRICE_ID;
    const PRICE_SHOP = process.env.STRIPE_SHOP_PRICE_ID;
    const PRICE_ACCOMPAGNEMENT = process.env.STRIPE_ACCOMPAGNEMENT_PRICE_ID;

    // Chercher l'utilisateur Supabase par email
    const { data: users } = await sb.auth.admin.listUsers();
    const user = users?.users?.find(u => u.email === email);

    let update = { email };
    if (priceId === PRICE_FORMATION) update.has_formation = true;
    if (priceId === PRICE_SHOP) update.has_shop = true;
    if (priceId === PRICE_ACCOMPAGNEMENT) {
      update.has_accompagnement = true;
      if (session.customer) update.stripe_customer_id = session.customer;
      if (session.subscription) update.stripe_subscription_id = session.subscription;
    }

    if (user) {
      update.user_id = user.id;
      const { data: existing } = await sb.from('user_access').select('id').eq('user_id', user.id).single();
      if (existing) {
        await sb.from('user_access').update(update).eq('user_id', user.id);
      } else {
        await sb.from('user_access').insert(update);
      }
    } else {
      // Utilisateur pas encore inscrit — on pré-enregistre par email
      const { data: existingByEmail } = await sb.from('user_access').select('id').eq('email', email).single();
      if (existingByEmail) {
        await sb.from('user_access').update(update).eq('email', email);
      } else {
        await sb.from('user_access').insert(update);
      }
    }
  }

  // Gestion résiliation accompagnement
  if (stripeEvent.type === 'customer.subscription.deleted') {
    const sub = stripeEvent.data.object;
    const customerId = sub.customer;
    const customer = await stripe.customers.retrieve(customerId);
    const email = customer.email;
    if (email) {
      await sb.from('user_access').update({ has_accompagnement: false, stripe_subscription_id: null }).eq('email', email);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
