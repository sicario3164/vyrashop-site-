/* Formation VyraShop : logique commune (connexion, appels à la fonction, progression, rendu du texte).
   Aucun contenu de formation ici : tout passe par /.netlify/functions/formation après vérification d'accès. */
(function () {
  var SUPABASE_URL = 'https://pdprwoskbrsoojtanmze.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_8bOARWbOH9NbbsYbtoaJ8Q_z59Eht4f';
  var sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  var CLE = 'vs_formation_faits';

  function lireLocal() { try { return JSON.parse(localStorage.getItem(CLE) || '[]'); } catch (e) { return []; } }
  function ecrireLocal(a) { try { localStorage.setItem(CLE, JSON.stringify(a)); } catch (e) {} }

  async function token() {
    if (!sb) return null;
    try { var r = await sb.auth.getSession(); return r.data && r.data.session ? r.data.session.access_token : null; } catch (e) { return null; }
  }

  async function api(action, extra) {
    var t = await token();
    if (!t) { var e = new Error('login'); e.code = 401; throw e; }
    var body = Object.assign({ access_token: t, action: action }, extra || {});
    var res = await fetch('/.netlify/functions/formation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) { var err = new Error(data.error || 'erreur'); err.code = res.status; throw err; }
    return data;
  }

  /* Progression : le serveur fait foi quand la table existe, sinon le navigateur. */
  var faits = new Set(lireLocal());
  async function chargerProgression() {
    try {
      var p = await api('progression');
      if (p.stockage) {
        var serveur = new Set(p.faits);
        // éléments cochés hors ligne : on les envoie
        faits.forEach(function (id) { if (!serveur.has(id)) { api('valider', { id: id, fait: true }).catch(function () {}); serveur.add(id); } });
        faits = serveur;
        ecrireLocal(Array.from(faits));
      }
    } catch (e) { if (e.code === 401 || e.code === 403) throw e; }
    return faits;
  }
  function estFait(id) { return faits.has(id); }
  function marquer(id, fait) {
    if (fait) faits.add(id); else faits.delete(id);
    ecrireLocal(Array.from(faits));
    api('valider', { id: id, fait: fait }).catch(function () {});
  }

  /* Rendu d'un texte de leçon (sous-ensemble de Markdown), après échappement du HTML. */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inline(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
  function rendre(md) {
    var blocs = md.split(/\n\s*\n/), out = [];
    blocs.forEach(function (b) {
      var lignes = b.split('\n');
      var img = b.match(/^!\[([^\]]*)\]\((\/assets\/[^)\s]+)\)$/);
      if (img) { out.push('<figure><img src="' + esc(img[2]) + '" alt="' + esc(img[1]) + '" loading="lazy"/><figcaption>' + esc(img[1]) + '</figcaption></figure>'); return; }
      if (/^## /.test(b)) {
        out.push('<h2>' + inline(lignes[0].slice(3)) + '</h2>');
        lignes = lignes.slice(1); if (!lignes.length) return; b = lignes.join('\n');
      }
      if (/^!! /.test(b)) { out.push('<p class="warn">' + inline(b.slice(3)) + '</p>'); return; }
      if (/^> /.test(b)) { out.push('<p class="tip">' + inline(b.replace(/^> /gm, '')) + '</p>'); return; }
      if (lignes.every(function (l) { return /^- /.test(l); })) { out.push('<ul>' + lignes.map(function (l) { return '<li>' + inline(l.slice(2)) + '</li>'; }).join('') + '</ul>'); return; }
      if (lignes.every(function (l) { return /^\d+\. /.test(l); })) { out.push('<ol>' + lignes.map(function (l) { return '<li>' + inline(l.replace(/^\d+\. /, '')) + '</li>'; }).join('') + '</ol>'); return; }
      // bloc mixte : texte puis liste
      var html = '', liste = null;
      lignes.forEach(function (l) {
        var puce = /^- /.test(l), num = /^\d+\. /.test(l);
        if (puce || num) {
          var tag = puce ? 'ul' : 'ol';
          if (!liste) { liste = tag; html += '<' + tag + '>'; }
          html += '<li>' + inline(l.replace(/^(- |\d+\. )/, '')) + '</li>';
        } else {
          if (liste) { html += '</' + liste + '>'; liste = null; }
          html += '<p>' + inline(l) + '</p>';
        }
      });
      if (liste) html += '</' + liste + '>';
      out.push(html);
    });
    return out.join('');
  }

  function toast(msg) {
    var t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 1600);
  }
  async function copier(texte, bouton) {
    try { await navigator.clipboard.writeText(texte); }
    catch (e) {
      var ta = document.createElement('textarea'); ta.value = texte; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} ta.remove();
    }
    if (bouton) { var avant = bouton.textContent; bouton.textContent = 'Copié'; bouton.classList.add('done'); setTimeout(function () { bouton.textContent = avant; bouton.classList.remove('done'); }, 1400); }
    toast('Copié');
  }

  /* Écran affiché quand l'accès n'est pas confirmé. */
  function afficherAcces(cible, code) {
    var msg = code === 403
      ? "<h1>Accès non trouvé<span>pour ce compte.</span></h1><p>Ce compte n'a pas encore la formation. Vérifie que tu es connecté avec <strong>le même e-mail que lors de l'achat</strong>.</p>"
      : "<h1>Connecte-toi<span>pour commencer.</span></h1><p>Ta formation se trouve dans ton espace membre. Connecte-toi (ou crée ton compte) avec l'e-mail utilisé lors de l'achat.</p>";
    cible.innerHTML = '<div class="gate">' + msg + '<div class="acts"><a class="btn btn-rose" href="/espace-membre/login.html">Aller à mon compte</a><a class="btn btn-line btn-sm" href="mailto:contact@vyrashop.com">Contacter le support</a></div></div>';
  }

  window.VS = { token: token, api: api, chargerProgression: chargerProgression, estFait: estFait, marquer: marquer, rendre: rendre, esc: esc, copier: copier, afficherAcces: afficherAcces, toast: toast };
})();
