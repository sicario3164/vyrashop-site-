// Mutualise la vérification de session Supabase, dupliquée identiquement dans
// get-formation-access.js, get-shop-access.js, cancel-subscription.js et
// get-formation-pdf.js (Phase 5/6 : c'est exactement ce type de duplication qui avait
// permis qu'un correctif appliqué à un seul exemplaire ne soit pas répercuté ailleurs).
//
// Retourne l'email (en minuscules) de l'utilisateur authentifié, ou null si le token
// est absent, invalide ou expiré.
async function getAuthenticatedEmail(sb, accessToken) {
  if (!accessToken) return null;
  let userData, userErr;
  try {
    ({ data: userData, error: userErr } = await sb.auth.getUser(accessToken));
  } catch (e) {
    return null;
  }
  if (userErr || !userData || !userData.user || !userData.user.email) return null;
  return userData.user.email.toLowerCase();
}

module.exports = { getAuthenticatedEmail };
