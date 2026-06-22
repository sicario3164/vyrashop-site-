// CORRECTIF APPLIQUÉ (audit sécurité — voir PHASE2-Audit-Securite-VyraShop.md) :
//   F3 (ÉLEVÉE) : les 15 PDF de la Formation étaient servis comme fichiers statiques
//                  dans /formation/, accessibles par n'importe qui connaissant l'URL,
//                  sans aucun contrôle d'accès. Ils ont été déplacés hors du dossier
//                  publié (netlify/functions/_assets/formation/, non servi en statique)
//                  et ne sont désormais livrés que par cette fonction, qui revérifie
//                  le token Supabase et le flag has_formation à CHAQUE téléchargement —
//                  contrairement au flag localStorage côté client, qui n'est qu'un
//                  raccourci d'affichage et ne doit jamais faire autorité.
//
// Hors périmètre de ce correctif : le contenu texte des modules (module1/2/3.html)
// reste présent dans le HTML envoyé à tout visiteur, gate ou pas (cf. note transmise
// séparément) — seule la livraison des PDF était couverte par le finding F3.

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { checkRateLimit } = require('./_lib/rate-limit');
const { getAuthenticatedEmail } = require('./_lib/auth');

// Liste blanche : identifiant court (jamais le nom de fichier réel) -> fichier réel.
// Empêche toute tentative de path traversal via un identifiant arbitraire.
const EBOOKS = {
  ebook1: 'EBOOK1 MonetisationTikTok.pdf',
  ebook2: 'EBOOK2 CreatorFundStrategiesAvancees.pdf',
  ebook3: 'EBOOK3 LivesEtCadeauxVirtuels.pdf',
  ebook4: 'EBOOK4 PartenariatsDeMarques.pdf',
  ebook5: 'EBOOK5 RevenusPassifsAutomatisation.pdf',
  ebook6: 'EBOOK6 DebuterTikTokShop.pdf',
  ebook7: 'EBOOK7 MeilleursProduitsTikTokShop.pdf',
  ebook8: 'EBOOK8 VideosTikTokShop.pdf',
  ebook9: 'EBOOK9 ScalerCommissionsTikTokShop.pdf',
  ebook10: 'EBOOK10 AutomatiserRevenusShop.pdf',
  ebook11: 'EBOOK11 AlgorithmeTikTok.pdf',
  ebook12: 'EBOOK12 HooksQuiAccrochent.pdf',
  ebook13: 'EBOOK13 MontageViral.pdf',
  ebook14: 'EBOOK14 PostingStrategy.pdf',
  ebook15: 'EBOOK15 0a10KAbonnes.pdf',
};

exports.handler = async function (event) {
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

  const ebookFile = EBOOKS[body.ebook];
  if (!ebookFile) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown ebook' }) };
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // F11 : chaque PDF fait l'objet d'un calcul + d'une requête DB (cf. note scalabilité) ;
  // limite raisonnable pour un usage normal (15 ebooks max sur le site) tout en bornant l'abus.
  const rl = await checkRateLimit(sb, event, 'get-formation-pdf', 20, 10);
  if (!rl.allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de requêtes. Réessaie dans quelques minutes.' }) };
  }

  // Revérifie le token et l'accès Formation à chaque téléchargement — jamais de confiance
  // dans un état mis en cache côté client.
  const email = await getAuthenticatedEmail(sb, body.access_token);
  if (!email) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
  }

  let access;
  try {
    const { data, error } = await sb.from('user_access').select('has_formation').eq('email', email).single();
    if (error || !data || !data.has_formation) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'No formation access' }) };
    }
    access = data;
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'server_error' }) };
  }

  try {
    const filePath = path.join(__dirname, '_assets', 'formation', ebookFile);
    const fileBuffer = fs.readFileSync(filePath);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${ebookFile}"`,
        'Cache-Control': 'no-store, private',
      },
      body: fileBuffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'File not available' }) };
  }
};
