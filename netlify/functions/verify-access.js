exports.handler = async function (event) {
  const headers = { "Content-Type": "application/json" };
  const params = event.queryStringParameters || {};
  const adminKey = process.env.ADMIN_ACCESS_KEY;
  if (params.admin_key && adminKey && params.admin_key === adminKey) {
    return { statusCode: 200, headers, body: JSON.stringify({ valid: true, admin: true }) };
  }
  const sessionId = params.session_id;
  if (!sessionId || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ valid: false, reason: "missing_or_invalid_session_id" }) };
  }
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ valid: false, reason: "server_misconfigured" }) };
  }
  try {
    const resp = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    const session = await resp.json();
    if (!resp.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: "session_not_found" }) };
    }
    if (session.payment_status !== "paid") {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: "not_paid" }) };
    }
    const allowedPriceId = process.env.STRIPE_FORMATION_PRICE_ID;
    if (allowedPriceId) {
      const items = (session.line_items && session.line_items.data) || [];
      const matches = items.some((item) => item.price && item.price.id === allowedPriceId);
      if (!matches) {
        return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: "wrong_product" }) };
      }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ valid: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ valid: false, reason: "server_error" }) };
  }
};
