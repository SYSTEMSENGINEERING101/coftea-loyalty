// public/_worker.js
// Advanced mode entry point. Running as _worker.js (not functions/) lets the whole
// site deploy through the Cloudflare dashboard's drag-and-drop upload.
// Everything under /api is handled here; all other paths fall through to static assets.

const TOTAL_SLOTS = 16;
const MILESTONES = [8, 16];
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS_PER_CARD = 8;
const MAX_FAILS_PER_IP = 40;
const CODE_RE = /^\d{7}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/_worker.js') return new Response('Not found.', { status: 404 });
    const seg = url.pathname.split('/').filter(Boolean);
    if (seg[0] !== 'api') return env.ASSETS.fetch(request);
    return handleApi(request, env, url, seg.slice(1));
  },
};

async function handleApi(request, env, url, seg) {
  const method = request.method.toUpperCase();

  try {
    if (seg[0] === 'card') {
      if (seg.length === 1 && method === 'POST') return createCard(request, env);
      if (seg.length === 2 && method === 'GET') return readCard(env, seg[1]);
      if (seg.length === 2 && method === 'PATCH') return savePhone(request, env, seg[1]);
      if (seg.length === 3 && seg[2] === 'reset' && method === 'POST') return resetCard(env, seg[1]);
      if (seg.length === 3 && seg[2] === 'redeem' && method === 'POST') return redeemReward(request, env, seg[1]);
    }

    if (seg[0] === 'stamp' && seg.length === 1 && method === 'POST') return stampSlot(request, env);

    if (seg[0] === 'admin') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      if (seg[1] === 'stats' && method === 'GET') return adminStats(env);
      if (seg[1] === 'batches' && seg.length === 2 && method === 'GET') return listBatches(env);
      if (seg[1] === 'batches' && seg.length === 2 && method === 'POST') return createBatch(request, env);
      if (seg[1] === 'batches' && seg.length === 4 && seg[3] === 'codes' && method === 'GET') {
        return listCodes(env, seg[2], url);
      }
      if (seg[1] === 'cards' && method === 'GET') return findCards(env, url);
    }

    return json({ error: 'Not found.' }, 404);
  } catch (err) {
    console.error('api error', err);
    return json({ error: 'Something went wrong.', detail: String((err && err.message) || err) }, 500);
  }
}

/* ------------------------------------------------------------------ cards */

async function createCard(request, env) {
  const body = await readJson(request);
  const phone = body.phone ? cleanPhone(body.phone) : null;
  const id = randHex(16);
  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO cards (id, phone, created_at, last_seen_at, cycle) VALUES (?, ?, ?, ?, 1)'
  )
    .bind(id, phone, now, now)
    .run();

  return json(await cardState(env, id), 201);
}

async function readCard(env, id) {
  const state = await cardState(env, id);
  if (!state) return json({ error: 'Card not found.' }, 404);
  await env.DB.prepare('UPDATE cards SET last_seen_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), id)
    .run();
  return json(state);
}

async function savePhone(request, env, id) {
  const body = await readJson(request);
  const card = await getCard(env, id);
  if (!card) return json({ error: 'Card not found.' }, 404);

  const raw = typeof body.phone === 'string' ? body.phone.trim() : '';
  const phone = raw === '' ? null : cleanPhone(raw);
  if (raw !== '' && !phone) return json({ error: 'Enter a valid phone number.' }, 400);

  await env.DB.prepare('UPDATE cards SET phone = ?, last_seen_at = ? WHERE id = ?')
    .bind(phone, new Date().toISOString(), id)
    .run();

  return json(await cardState(env, id));
}

async function resetCard(env, id) {
  const card = await getCard(env, id);
  if (!card) return json({ error: 'Card not found.' }, 404);

  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM stamps WHERE card_id = ? AND cycle = ?'
  )
    .bind(id, card.cycle)
    .first();

  if (Number(row.n) < TOTAL_SLOTS) {
    return json({ error: 'The card is not complete yet.' }, 409);
  }

  await env.DB.prepare('UPDATE cards SET cycle = cycle + 1, last_seen_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), id)
    .run();

  return json(await cardState(env, id));
}

async function redeemReward(request, env, id) {
  const body = await readJson(request);
  const milestone = Number(body.milestone);
  if (!MILESTONES.includes(milestone)) return json({ error: 'Unknown reward.' }, 400);

  const card = await getCard(env, id);
  if (!card) return json({ error: 'Card not found.' }, 404);

  const stamped = await env.DB.prepare(
    'SELECT 1 AS ok FROM stamps WHERE card_id = ? AND cycle = ? AND slot = ?'
  )
    .bind(id, card.cycle, milestone)
    .first();

  if (!stamped) return json({ error: 'That reward is not unlocked yet.' }, 409);

  await env.DB.prepare(
    'INSERT OR IGNORE INTO redemptions (card_id, cycle, milestone, claimed_at) VALUES (?, ?, ?, ?)'
  )
    .bind(id, card.cycle, milestone, new Date().toISOString())
    .run();

  return json(await cardState(env, id));
}

/* ------------------------------------------------------------------ stamp */

async function stampSlot(request, env) {
  const body = await readJson(request);
  const cardId = String(body.cardId || '');
  const slot = Number(body.slot);
  const code = String(body.code || '').trim();
  const ip = request.headers.get('CF-Connecting-IP') || '';

  if (!cardId) return json({ error: 'Missing card.' }, 400);
  if (!Number.isInteger(slot) || slot < 1 || slot > TOTAL_SLOTS) return json({ error: 'Invalid slot.' }, 400);
  if (!CODE_RE.test(code)) return json({ error: 'Enter the 7-digit code.' }, 400);

  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();

  const cardFails = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM attempts WHERE card_id = ? AND ok = 0 AND at >= ?'
  )
    .bind(cardId, since)
    .first();
  if (Number(cardFails.n) >= MAX_FAILS_PER_CARD) return tooManyAttempts();

  if (ip) {
    const ipFails = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM attempts WHERE ip = ? AND ok = 0 AND at >= ?'
    )
      .bind(ip, since)
      .first();
    if (Number(ipFails.n) >= MAX_FAILS_PER_IP) return tooManyAttempts();
  }

  const state = await cardState(env, cardId);
  if (!state) return json({ error: 'Card not found.' }, 404);

  const filled = state.stamps.length;
  if (slot <= filled) return json({ error: 'That slot is already stamped.', card: state }, 409);
  if (slot !== filled + 1) {
    return json({ error: `Stamp slot ${filled + 1} first.`, card: state }, 409);
  }

  const now = new Date().toISOString();

  // Burning the code is the security-critical step: one statement, only if unused and unexpired.
  const burn = await env.DB.prepare(
    `UPDATE codes
        SET used_at = ?, used_by_card = ?, used_by_slot = ?
      WHERE code = ?
        AND used_at IS NULL
        AND batch_id IN (SELECT id FROM batches WHERE expires_at > ?)`
  )
    .bind(now, cardId, slot, code, now)
    .run();

  const changed = burn.meta ? Number(burn.meta.changes || 0) : 0;

  if (!changed) {
    await recordAttempt(env, cardId, ip, false);
    return json({ error: "That code isn't valid or has already been used." }, 400);
  }

  try {
    await env.DB.prepare(
      'INSERT INTO stamps (card_id, cycle, slot, code, stamped_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(cardId, state.cycle, slot, code, now)
      .run();
  } catch (err) {
    // Same slot was stamped by a concurrent request: give the code back.
    await env.DB.prepare(
      'UPDATE codes SET used_at = NULL, used_by_card = NULL, used_by_slot = NULL WHERE code = ?'
    )
      .bind(code)
      .run();
    return json({ error: 'That slot was just stamped. Please refresh.', card: await cardState(env, cardId) }, 409);
  }

  return json(await cardState(env, cardId));
}

async function recordAttempt(env, cardId, ip, ok) {
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO attempts (card_id, ip, ok, at) VALUES (?, ?, ?, ?)')
    .bind(cardId, ip || null, ok ? 1 : 0, now)
    .run();
  await env.DB.prepare('DELETE FROM attempts WHERE at < ?')
    .bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .run();
}

function tooManyAttempts() {
  return json({ error: 'Too many wrong codes. Please wait a few minutes and try again.' }, 429);
}

/* ------------------------------------------------------------------ admin */

async function adminStats(env) {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM codes) AS codes_total,
       (SELECT COUNT(*) FROM codes WHERE used_at IS NULL) AS codes_unused,
       (SELECT COUNT(*) FROM codes WHERE used_at IS NOT NULL) AS codes_used,
       (SELECT COUNT(*) FROM cards) AS cards_total,
       (SELECT COUNT(*) FROM stamps) AS stamps_total,
       (SELECT COUNT(*) FROM redemptions) AS rewards_total`
  ).first();

  const week = await env.DB.prepare('SELECT COUNT(*) AS n FROM stamps WHERE stamped_at >= ?')
    .bind(new Date(Date.now() - 7 * 86400000).toISOString())
    .first();

  return json({ ...row, stamps_week: week.n });
}

async function listBatches(env) {
  const rows = await env.DB.prepare(
    `SELECT b.id, b.label, b.created_at, b.expires_at,
            COUNT(c.code) AS total,
            COALESCE(SUM(CASE WHEN c.used_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS used
       FROM batches b
       LEFT JOIN codes c ON c.batch_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC`
  ).all();

  return json({ batches: rows.results || [] });
}

async function createBatch(request, env) {
  const body = await readJson(request);
  const count = clampInt(body.count, 1, 2000, 500);
  const days = clampInt(body.days, 1, 3650, 90);
  const label = String(body.label || '').trim().slice(0, 60) || `Batch ${new Date().toISOString().slice(0, 10)}`;

  const id = 'B' + Date.now().toString(36).toUpperCase() + '-' + randHex(3).toUpperCase();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 86400000).toISOString();

  await env.DB.prepare('INSERT INTO batches (id, label, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(id, label, now.toISOString(), expiresAt)
    .run();

  let inserted = 0;
  for (let round = 0; round < 6 && inserted < count; round++) {
    const need = count - inserted;
    const fresh = new Set();
    while (fresh.size < need) fresh.add(randomCode());

    const codes = [...fresh];
    const stmts = [];
    for (let i = 0; i < codes.length; i += 40) {
      const chunk = codes.slice(i, i + 40);
      const values = chunk.map(() => '(?, ?)').join(', ');
      stmts.push(
        env.DB.prepare(`INSERT OR IGNORE INTO codes (code, batch_id) VALUES ${values}`).bind(
          ...chunk.flatMap((c) => [c, id])
        )
      );
    }
    if (stmts.length) await env.DB.batch(stmts);

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM codes WHERE batch_id = ?')
      .bind(id)
      .first();
    inserted = Number(row.n || 0);
  }

  return json({ id, label, count: inserted, expiresAt }, 201);
}

async function listCodes(env, batchId, url) {
  const status = url.searchParams.get('status') || 'all';
  const q = (url.searchParams.get('q') || '').replace(/\D/g, '').slice(0, 7);

  const batch = await env.DB.prepare(
    'SELECT id, label, created_at, expires_at FROM batches WHERE id = ?'
  )
    .bind(batchId)
    .first();
  if (!batch) return json({ error: 'Batch not found.' }, 404);

  const where = ['batch_id = ?'];
  const params = [batchId];
  if (status === 'used') where.push('used_at IS NOT NULL');
  if (status === 'unused') where.push('used_at IS NULL');
  if (q) {
    where.push('code LIKE ?');
    params.push(q + '%');
  }

  const rows = await env.DB.prepare(
    `SELECT code, used_at FROM codes WHERE ${where.join(' AND ')} ORDER BY code LIMIT 600`
  )
    .bind(...params)
    .all();

  return json({ batch, codes: rows.results || [] });
}

async function findCards(env, url) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
  const like = '%' + q + '%';

  const rows = await env.DB.prepare(
    `SELECT c.id, c.phone, c.created_at, c.last_seen_at, c.cycle,
            (SELECT COUNT(*) FROM stamps s WHERE s.card_id = c.id AND s.cycle = c.cycle) AS stamps,
            (SELECT COUNT(*) FROM redemptions r WHERE r.card_id = c.id AND r.cycle = c.cycle) AS rewards
       FROM cards c
      WHERE (? = '' OR c.phone LIKE ? OR c.id LIKE ?)
      ORDER BY c.last_seen_at DESC
      LIMIT 25`
  )
    .bind(q, like, like)
    .all();

  return json({ cards: rows.results || [] });
}

/* ---------------------------------------------------------------- helpers */

async function cardState(env, id) {
  const card = await getCard(env, id);
  if (!card) return null;

  const stamps = await env.DB.prepare(
    'SELECT slot FROM stamps WHERE card_id = ? AND cycle = ? ORDER BY slot'
  )
    .bind(id, card.cycle)
    .all();

  const redemptions = await env.DB.prepare(
    'SELECT milestone FROM redemptions WHERE card_id = ? AND cycle = ? ORDER BY milestone'
  )
    .bind(id, card.cycle)
    .all();

  return {
    id: card.id,
    cycle: card.cycle,
    phone: card.phone || null,
    createdAt: card.created_at,
    total: TOTAL_SLOTS,
    milestones: MILESTONES,
    stamps: (stamps.results || []).map((r) => r.slot),
    redemptions: (redemptions.results || []).map((r) => r.milestone),
  };
}

async function getCard(env, id) {
  return env.DB.prepare('SELECT * FROM cards WHERE id = ?').bind(id).first();
}

function requireAdmin(request, env) {
  const expected = env.ADMIN_TOKEN || '';
  if (!expected) return json({ error: 'Admin token is not configured on the server.' }, 500);

  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqual(token, expected)) return json({ error: 'Unauthorized.' }, 401);
  return null;
}

function timingSafeEqual(a, b) {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

function cleanPhone(value) {
  const s = String(value).trim().replace(/[^\d+]/g, '');
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return s.startsWith('+') ? '+' + digits : digits;
}

function randomCode() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(1000000 + (buf[0] % 9000000));
}

function randHex(bytes) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
