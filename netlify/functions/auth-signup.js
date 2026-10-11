// ===== CORE INLINÉ — zéro dépendance npm (Node builtins + fetch global) =====
const crypto = require('crypto');

// --- Client minimal Netlify Blobs (REST direct) ---
// Contexte : event.blobs (base64 JSON {url, token}) + header x-nf-site-id,
// repli : variable d'environnement NETLIFY_BLOBS_CONTEXT (base64 JSON).
const BLOBS_STORE = 'site:saas-qr';
const SIGNED_ACCEPT = 'application/json;type=signed-url';

function blobsCtx(event) {
  try {
    const h = event.headers || {};
    const siteID = h['x-nf-site-id'] || h['X-Nf-Site-Id'];
    if (event.blobs && siteID) {
      const d = JSON.parse(Buffer.from(event.blobs, 'base64').toString('utf8'));
      if (d && d.token) return { siteID: String(siteID), token: d.token };
    }
  } catch (e) {}
  try {
    const raw = process.env.NETLIFY_BLOBS_CONTEXT;
    if (raw) {
      const d = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      if (d && d.siteID && d.token) return { siteID: String(d.siteID), token: d.token };
    }
  } catch (e) {}
  return null;
}

async function bSignedURL(c, method, key) {
  const url = 'https://api.netlify.com/api/v1/blobs/' + c.siteID + '/' + BLOBS_STORE + '/' + key;
  const r = await fetch(url, { method, headers: { authorization: 'Bearer ' + c.token, accept: SIGNED_ACCEPT } });
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error('blobs/sign ' + r.status);
  const j = await r.json();
  return j.url || null;
}

async function bGet(event, key) {
  const c = blobsCtx(event);
  if (!c) throw new Error('blobs: contexte manquant');
  const s = await bSignedURL(c, 'GET', key);
  if (!s) return null;
  const r = await fetch(s);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('blobs/get ' + r.status);
  return r.json();
}

async function bSet(event, key, obj) {
  const c = blobsCtx(event);
  if (!c) throw new Error('blobs: contexte manquant');
  const s = await bSignedURL(c, 'PUT', key);
  if (!s) throw new Error('blobs: signed url nulle');
  const r = await fetch(s, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
  if (!r.ok) throw new Error('blobs/put ' + r.status);
}

async function bDel(event, key) {
  const c = blobsCtx(event);
  if (!c) throw new Error('blobs: contexte manquant');
  const url = 'https://api.netlify.com/api/v1/blobs/' + c.siteID + '/' + BLOBS_STORE + '/' + key;
  const r = await fetch(url, { method: 'DELETE', headers: { authorization: 'Bearer ' + c.token } });
  if (![200, 204, 404].includes(r.status)) throw new Error('blobs/del ' + r.status);
}

async function bList(event, prefix) {
  const c = blobsCtx(event);
  if (!c) throw new Error('blobs: contexte manquant');
  const url = 'https://api.netlify.com/api/v1/blobs/' + c.siteID + '/' + BLOBS_STORE + '?prefix=' + encodeURIComponent(prefix);
  const r = await fetch(url, { headers: { authorization: 'Bearer ' + c.token } });
  if (!r.ok) throw new Error('blobs/list ' + r.status);
  const j = await r.json();
  return (j.blobs || []).map((b) => b.key);
}

// --- Réponses JSON + CORS ---
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }, body: JSON.stringify(body) };
}
const ok = (b) => json(200, b);
const created = (b) => json(201, b);
const bad = (m) => json(400, { error: m });
const unauthorized = (m = 'Non autorisé') => json(401, { error: m });
const notFound = (m = 'Introuvable') => json(404, { error: m });
const serverError = (m = 'Erreur serveur') => json(500, { error: m });
function handleOptions(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  return null;
}
function parseBody(event) {
  try { return JSON.parse(event.body || '{}'); } catch (e) { return null; }
}

// --- Auth : scrypt natif, tokens, validation ---
const SCRYPT_LEN = 64;
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(pw, salt, SCRYPT_LEN).toString('hex');
}
function verifyPassword(pw, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const exp = Buffer.from(parts[2], 'hex');
    const chk = crypto.scryptSync(String(pw), parts[1], SCRYPT_LEN);
    return chk.length === exp.length && crypto.timingSafeEqual(chk, exp);
  } catch (e) { return false; }
}
const newToken = () => crypto.randomBytes(32).toString('hex');
const newId = () => crypto.randomBytes(16).toString('hex');
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;

async function getUserFromRequest(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(auth.trim());
  if (!m) return null;
  const token = m[1].toLowerCase();
  const sess = await bGet(event, 'sessions/' + token);
  if (!sess || !sess.userId || typeof sess.expiresAt !== 'number' || sess.expiresAt < Date.now()) return null;
  const user = await bGet(event, 'users/' + sess.userId);
  if (!user || !user.id || !user.email) return null;
  return { user: { id: user.id, email: user.email }, token };
}

const _hits = new Map();
function rateLimit(ip, max, winMs) {
  const now = Date.now(), k = ip || 'unknown';
  const a = (_hits.get(k) || []).filter((t) => now - t < winMs);
  a.push(now); _hits.set(k, a);
  if (_hits.size > 5000) _hits.clear();
  return a.length <= max;
}
function clientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || 'unknown';
}
// ===== FIN CORE =====

// POST /.netlify/functions/auth-signup  { email, password } -> { token, email }
exports.handler = async (event) => {
  const opt = handleOptions(event);
  if (opt) return opt;
  if (event.httpMethod !== 'POST') return bad('Méthode non supportée');
  if (!rateLimit(clientIp(event), 10, 10 * 60 * 1000)) return bad('Trop de tentatives, réessayez dans quelques minutes');
  const body = parseBody(event);
  if (!body) return bad('Corps JSON invalide');
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  if (!validEmail(email)) return bad('Adresse email invalide');
  if (password.length < 8) return bad('Mot de passe : 8 caractères minimum');
  if (password.length > 128) return bad('Mot de passe trop long');
  try {
    const emailKey = 'users-by-email/' + sha256hex(email);
    if (await bGet(event, emailKey)) return bad('Un compte existe déjà avec cet email');
    const userId = newId();
    await bSet(event, 'users/' + userId, { id: userId, email, passwordHash: hashPassword(password), createdAt: new Date().toISOString() });
    await bSet(event, emailKey, { userId });
    const token = newToken();
    await bSet(event, 'sessions/' + token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
    return created({ token, email });
  } catch (e) { console.error('auth-signup', e); return serverError(); }
};
