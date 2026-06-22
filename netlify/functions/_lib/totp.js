// TOTP (RFC 6238) implémenté avec uniquement le module `crypto` natif de Node — aucune
// dépendance npm supplémentaire (pas de package.json à modifier, pas de besoin de
// régénérer un lockfile).
//
// Utilisé pour ajouter un deuxième facteur (MFA) à l'accès admin, en plus de la clé
// secrète existante (ADMIN_ACCESS_KEY). Tant que la variable d'environnement
// ADMIN_TOTP_SECRET n'est pas configurée, la vérification MFA est simplement ignorée
// (comportement actuel inchangé) — c'est un choix délibéré pour ne pas verrouiller
// l'accès admin avant que tu aies configuré une application d'authentification.

const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input) {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.substring(i, i + 5).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return output;
}

function hotp(secretBuffer, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24) |
                   ((hmac[offset + 1] & 0xff) << 16) |
                   ((hmac[offset + 2] & 0xff) << 8) |
                   (hmac[offset + 3] & 0xff);
  return (binCode % 1000000).toString().padStart(6, '0');
}

// Vérifie un code à 6 chiffres avec une tolérance de ±1 pas de 30s (dérive d'horloge).
function verifyTOTP(base32Secret, token) {
  if (!base32Secret || !token || !/^\d{6}$/.test(String(token).trim())) return false;
  const secretBuffer = base32Decode(base32Secret);
  if (secretBuffer.length === 0) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  const cleanToken = String(token).trim();
  for (let errorWindow = -1; errorWindow <= 1; errorWindow++) {
    if (hotp(secretBuffer, counter + errorWindow) === cleanToken) return true;
  }
  return false;
}

// Génère un nouveau secret aléatoire (à faire une seule fois, à la configuration initiale).
function generateSecret(label, issuer) {
  const secret = base32Encode(crypto.randomBytes(20));
  const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer || 'VyraShop')}:${encodeURIComponent(label || 'admin')}?secret=${secret}&issuer=${encodeURIComponent(issuer || 'VyraShop')}&algorithm=SHA1&digits=6&period=30`;
  return { secret, otpauthUrl };
}

module.exports = { verifyTOTP, generateSecret };
