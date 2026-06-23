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

    // F5 (MOYENNE) : ne pas accorder l'accès si le paiement n'est pas confirmé.
    // checkout.session.completed peut se déclencher avant confirmation pour certains
    // moyens de paiement asynchrones ; payment_status === 'paid' est la seule garantie réelle.
    if (session.payment_status !== 'paid') {
      console.error('checkout.session.completed reçu sans paiement confirmé, ignoré:', session.id);
      return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'not_paid' }) };
    }

    // F10 (FAIBLE) : email normalisé en minuscules dès l'entrée, utilisé tel quel partout
    // dans ce bloc pour rester cohérent avec le reste du fichier (cf. ligne du remboursement).
    const email = (session.customer_details?.email || '').toLowerCase();
    if (!email) return { statusCode: 200, body: 'No email' };

    // Récupérer les line items pour identifier le produit
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price'] });
    const priceId = lineItems.data[0]?.price?.id;

    const PRICE_FORMATION = process.env.STRIPE_FORMATION_PRICE_ID;
    const PRICE_SHOP = process.env.STRIPE_SHOP_PRICE_ID;
    const PRICE_ACCOMPAGNEMENT = process.env.STRIPE_ACCOMPAGNEMENT_PRICE_ID;

    // Chercher l'utilisateur Supabase par email
    const { data: users } = await sb.auth.admin.listUsers();
    const user = users?.users?.find(u => (u.email || '').toLowerCase() === email);

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


    // BREVO — ajoute l'acheteur à la liste email correspondante pour déclencher
    // la séquence automatisée (J0, J3, J7, J14...).
    // Variables requises : BREVO_API_KEY, BREVO_FORMATION_LIST, BREVO_SHOP_LIST, BREVO_ACCOMPAGNEMENT_LIST
    try {
      const brevoKey = process.env.BREVO_API_KEY;
      if (brevoKey && priceId) {
        const brevoLists = {
          [process.env.STRIPE_FORMATION_PRICE_ID]:      parseInt(process.env.BREVO_FORMATION_LIST      || '3', 10),
          [process.env.STRIPE_SHOP_PRICE_ID]:           parseInt(process.env.BREVO_SHOP_LIST           || '4', 10),
          [process.env.STRIPE_ACCOMPAGNEMENT_PRICE_ID]: parseInt(process.env.BREVO_ACCOMPAGNEMENT_LIST || '5', 10),
        };
        const brevoListId = brevoLists[priceId];
        if (brevoListId) {
          const rawName = session.customer_details?.name || '';
          const prenom  = rawName.split(' ')[0] || '';
          await fetch('https://api.brevo.com/v3/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'api-key': brevoKey },
            body: JSON.stringify({
              email,
              attributes: { PRENOM: prenom, NOM: rawName },
              listIds: [brevoListId],
              updateEnabled: true,
            }),
          });
          console.log('Brevo: contact ajouté liste', brevoListId, 'pour', email);
        }
      }
    } catch (brevoErr) {
      // Non bloquant — l'accès produit est déjà accordé
      console.error('Erreur Brevo (non bloquant):', brevoErr.message);
    }

    // FACTURE AUTOMATIQUE — génère une facture PDF conforme et l'envoie par email au client.
    // Mentions obligatoires auto-entrepreneur exonéré de TVA (art. 293 B du CGI) incluses.
    // La facture est créée uniquement si le client a un customer_id Stripe (toujours le cas
    // pour un paiement via Payment Link avec collecte d'adresse activée).
    try {
      if (session.customer) {
        // Nom du produit pour la description de la facture
        const productNames = {
          [process.env.STRIPE_FORMATION_PRICE_ID]: 'Formation TikTok Expert — Accès à vie',
          [process.env.STRIPE_SHOP_PRICE_ID]: 'Accès TikTok Shop Prêt à l\'Emploi',
          [process.env.STRIPE_ACCOMPAGNEMENT_PRICE_ID]: 'Accompagnement WhatsApp Premium — 1 mois',
        };
        const productName = productNames[priceId] || 'Produit VyraShop';

        // Créer l'élément de facture correspondant au paiement
        await stripe.invoiceItems.create({
          customer: session.customer,
          amount: session.amount_total,
          currency: session.currency,
          description: productName,
        });

        // Créer et finaliser la facture — Stripe l'envoie automatiquement par email
        const invoice = await stripe.invoices.create({
          customer: session.customer,
          footer: 'TVA non applicable, art. 293 B du CGI — VyraShop (Auto-entrepreneur)',
          auto_advance: true,
          collection_method: 'send_invoice',
          days_until_due: 0,
          metadata: {
            checkout_session_id: session.id,
            product_price_id: priceId || '',
          },
        });
        await stripe.invoices.finalizeInvoice(invoice.id);
        await stripe.invoices.sendInvoice(invoice.id);
        console.log('Facture envoyée:', invoice.id, 'pour', email);
      }
    } catch (invoiceErr) {
      // On ne laisse pas une erreur de facturation bloquer l'accès au produit
      console.error('Erreur génération facture (non bloquant):', invoiceErr.message);
    }
  }

  // Gestion résiliation accompagnement
  if (stripeEvent.type === 'customer.subscription.deleted') {
    const sub = stripeEvent.data.object;
    const customerId = sub.customer;
    const customer = await stripe.customers.retrieve(customerId);
    const email = (customer.email || '').toLowerCase();
    if (email) {
      await sb.from('user_access').update({ has_accompagnement: false, stripe_subscription_id: null }).eq('email', email);
    }
  }

  // Gestion remboursement : on ne coupe l'accès qu'en cas de remboursement TOTAL
  // (un remboursement partiel, geste commercial, ne doit pas couper automatiquement l'accès)
  //
  // Sur les comptes Stripe récents, l'événement à écouter est "refund.updated"
  // (charge.refunded n'apparaît plus dans le sélecteur d'événements du Dashboard
  // pour ces comptes — on garde charge.refunded en repli au cas où).
  if (stripeEvent.type === 'refund.updated' || stripeEvent.type === 'charge.refunded') {
    let charge = null;

    if (stripeEvent.type === 'refund.updated') {
      const refund = stripeEvent.data.object;
      if (refund.status !== 'succeeded' || !refund.charge) {
        return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'refund_not_succeeded' }) };
      }
      try {
        charge = await stripe.charges.retrieve(refund.charge);
      } catch (err) {
        console.error('Erreur lors de la récupération de la charge remboursée:', err.message);
        return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'charge_fetch_failed' }) };
      }
    } else {
      charge = stripeEvent.data.object;
    }

    if (!charge.refunded) {
      return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'partial_refund' }) };
    }

    const email = charge.billing_details && charge.billing_details.email;
    if (!email) {
      return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'no_email' }) };
    }

    const PRICE_FORMATION = process.env.STRIPE_FORMATION_PRICE_ID;
    const PRICE_SHOP = process.env.STRIPE_SHOP_PRICE_ID;
    const PRICE_ACCOMPAGNEMENT = process.env.STRIPE_ACCOMPAGNEMENT_PRICE_ID;

    let update = null;
    try {
      if (charge.payment_intent) {
        // Remonter à la session Checkout d'origine pour identifier le produit acheté,
        // de la même façon que pour checkout.session.completed
        const sessions = await stripe.checkout.sessions.list({ payment_intent: charge.payment_intent, limit: 1 });
        const session = sessions.data[0];
        if (session) {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price'] });
          const priceId = lineItems.data[0]?.price?.id;
          if (priceId === PRICE_FORMATION) update = { has_formation: false };
          if (priceId === PRICE_SHOP) update = { has_shop: false };
          if (priceId === PRICE_ACCOMPAGNEMENT) update = { has_accompagnement: false };
        }
      }
    } catch (err) {
      console.error('Erreur lors de la recherche du produit remboursé:', err.message);
    }

    // Si on n'a pas pu identifier le produit (ex: remboursement d'une charge de
    // renouvellement d'abonnement, non rattachée à une session Checkout), on ne
    // touche à rien automatiquement plutôt que de risquer une mauvaise coupure.
    if (update) {
      await sb.from('user_access').update(update).eq('email', email.toLowerCase());
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
