// formation.js — sert le contenu de la formation (leçons, outils, quiz) et la progression.
//
// Même niveau de protection que get-formation-pdf.js : le contenu n'est JAMAIS dans le HTML
// public. Chaque appel revérifie le token Supabase et le flag has_formation.
//
// POST { access_token, action, id?, fait? }
//   action = "catalogue"   -> modules + titres des leçons (sans le texte)
//            "lecon"       -> une leçon complète (+ quiz si c'est la dernière du module)
//            "outils"      -> hooks, scripts, modèles
//            "progression" -> liste des éléments terminés
//            "valider"     -> marque un élément (leçon ou "quiz-mX") comme fait / pas fait

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { checkRateLimit } = require('./_lib/rate-limit');
const { getAuthenticatedEmail } = require('./_lib/auth');

let COURS = null;
function cours() {
  if (!COURS) {
    COURS = JSON.parse(fs.readFileSync(path.join(__dirname, '_assets', 'formation', 'cours.json'), 'utf8'));
  }
  return COURS;
}

function toutesLesLecons() {
  const out = [];
  cours().modules.forEach((m) => m.lecons.forEach((l) => out.push(l)));
  return out;
}

function idValide(id) {
  if (typeof id !== 'string' || id.length > 20) return false;
  if (/^quiz-m[0-9]$/.test(id)) return !!cours().quiz[id.slice(5)];
  return toutesLesLecons().some((l) => l.id === id);
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' },
  body: JSON.stringify(body),
});

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Invalid body' }); }
  if (!body.access_token) return json(400, { error: 'Missing access token' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const rl = await checkRateLimit(sb, event, 'formation', 120, 5);
  if (!rl.allowed) return json(429, { error: 'Trop de requêtes. Réessaie dans quelques minutes.' });

  const email = await getAuthenticatedEmail(sb, body.access_token);
  if (!email) return json(401, { error: 'Invalid session' });

  try {
    const { data, error } = await sb.from('user_access').select('has_formation').eq('email', email).single();
    if (error || !data || !data.has_formation) return json(403, { error: 'No formation access' });
  } catch (e) {
    return json(500, { error: 'server_error' });
  }

  const c = cours();

  switch (body.action) {
    case 'catalogue':
      return json(200, {
        modules: c.modules.map((m) => ({
          id: m.id, titre: m.titre, sous: m.sous, quiz: !!c.quiz[m.id],
          lecons: m.lecons.map((l) => ({ id: l.id, titre: l.titre, duree: l.duree, resume: l.resume, jour: l.jour, action: l.action })),
        })),
      });

    case 'lecon': {
      const toutes = toutesLesLecons();
      const i = toutes.findIndex((l) => l.id === body.id);
      if (i < 0) return json(404, { error: 'Leçon introuvable' });
      const l = toutes[i];
      const mod = c.modules.find((m) => m.id === l.module);
      const derniere = mod.lecons[mod.lecons.length - 1].id === l.id;
      return json(200, {
        lecon: l,
        module: { id: mod.id, titre: mod.titre, total: mod.lecons.length, rang: mod.lecons.findIndex((x) => x.id === l.id) + 1 },
        precedente: i > 0 ? { id: toutes[i - 1].id, titre: toutes[i - 1].titre } : null,
        suivante: i < toutes.length - 1 ? { id: toutes[i + 1].id, titre: toutes[i + 1].titre } : null,
        quiz: derniere && c.quiz[mod.id] ? { id: 'quiz-' + mod.id, questions: c.quiz[mod.id] } : null,
      });
    }

    case 'outils':
      return json(200, c.outils);

    case 'progression': {
      const { data, error } = await sb.from('formation_progress').select('item').eq('email', email);
      if (error) return json(200, { faits: [], stockage: false });
      return json(200, { faits: data.map((r) => r.item), stockage: true });
    }

    case 'valider': {
      if (!idValide(body.id)) return json(400, { error: 'Élément inconnu' });
      const res = body.fait === false
        ? await sb.from('formation_progress').delete().eq('email', email).eq('item', body.id)
        : await sb.from('formation_progress').upsert({ email, item: body.id }, { onConflict: 'email,item' });
      if (res.error) return json(200, { ok: false, stockage: false });
      return json(200, { ok: true });
    }

    default:
      return json(400, { error: 'Unknown action' });
  }
};
