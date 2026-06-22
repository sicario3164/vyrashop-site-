// Helper de rate limiting partagé (F11 + correctif de la race condition signalée lors
// de la revue de sécurité complémentaire). Repose sur la fonction Postgres atomique
// rate_limit_check() — voir le SQL à exécuter dans Supabase fourni séparément.
//
// L'ancien pattern (compter les échecs récents PUIS insérer) laissait une fenêtre où
// deux requêtes concurrentes pouvaient toutes deux passer la vérification avant qu'aucune
// n'ait enregistré sa tentative. Le compteur atomique côté Postgres (INSERT ... ON CONFLICT
// DO UPDATE ... RETURNING) élimine cette fenêtre : l'incrémentation et la lecture du
// compteur se font en une seule opération indivisible.

function getClientIp(event) {
  return (event.headers['x-nf-client-connection-ip'] ||
          event.headers['x-forwarded-for'] ||
          'unknown').split(',')[0].trim();
}

// Retourne { allowed: boolean, ip: string }. En cas d'erreur Supabase (table/fonction
// absente, panne), on choisit de NE PAS bloquer (fail-open) plutôt que de rendre toute la
// fonction indisponible à cause d'un problème de rate limiting — ce choix est documenté
// pour que tu puisses le reconsidérer si tu préfères l'inverse.
async function checkRateLimit(sb, event, functionName, maxAttempts, windowMinutes) {
  const ip = getClientIp(event);
  try {
    const { data, error } = await sb.rpc('rate_limit_check', {
      p_ip: ip,
      p_function: functionName,
      p_max: maxAttempts,
      p_window_minutes: windowMinutes,
    });
    if (error) {
      console.error('rate_limit_check RPC error (fail-open):', error);
      return { allowed: true, ip };
    }
    return { allowed: !!data, ip };
  } catch (e) {
    console.error('rate_limit_check unexpected error (fail-open):', e);
    return { allowed: true, ip };
  }
}

module.exports = { getClientIp, checkRateLimit };
