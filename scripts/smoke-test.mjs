// End-to-end check against a local `wrangler pages dev` server.
// Usage: ADMIN_TOKEN=coftea-dev-token node scripts/smoke-test.mjs

const BASE = process.env.BASE || 'http://localhost:8788';
const TOKEN = process.env.ADMIN_TOKEN || 'coftea-dev-token';
const SUPER_TOKEN = process.env.SUPERADMIN_TOKEN || 'karungo@2016Pass';

let passed = 0;
const failures = [];

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data };
}

console.log(`Smoke test against ${BASE}\n`);

// 1. admin auth
const noAuth = await call('/admin/stats');
check('admin rejects a missing token', noAuth.status === 401);

const badAuth = await call('/admin/stats', { token: 'nope' });
check('admin rejects a wrong token', badAuth.status === 401);

// 2. card
const newCard = await call('/card', { method: 'POST', body: {} });
check('card is created', newCard.status === 201 && !!newCard.data.id, `status ${newCard.status}`);
const card = newCard.data;

const readCard = await call(`/card/${card.id}`);
check('card reads back empty', readCard.status === 200 && readCard.data.stamps.length === 0);

// 3. batch
const batch = await call('/admin/batches', {
  method: 'POST',
  token: TOKEN,
  body: { label: 'Smoke test', count: 20, days: 30 },
});
check('batch of 20 codes is generated', batch.status === 201 && batch.data.count === 20, `count ${batch.data && batch.data.count}`);

const list = await call(`/admin/batches/${batch.data.id}/codes?status=unused`, { token: TOKEN });
const codes = (list.data.codes || []).map((c) => c.code);
check('20 unused codes come back', codes.length === 20, `${codes.length} codes`);
check('every code is 7 digits', codes.every((c) => /^\d{7}$/.test(c)));

// 4. stamping
const first = await call('/stamp', { method: 'POST', body: { cardId: card.id, slot: 1, code: codes[0] } });
check('slot 1 stamps with a valid code', first.status === 200 && first.data.stamps.length === 1, `status ${first.status}`);

const reuse = await call('/stamp', { method: 'POST', body: { cardId: card.id, slot: 2, code: codes[0] } });
check('a used code cannot stamp again', reuse.status === 400, `status ${reuse.status}`);

const skip = await call('/stamp', { method: 'POST', body: { cardId: card.id, slot: 4, code: codes[2] } });
check('out-of-order slot is refused', skip.status === 409, `status ${skip.status}`);

const bogus = await call('/stamp', { method: 'POST', body: { cardId: card.id, slot: 2, code: '0000001' } });
check('unknown code is refused', bogus.status === 400, `status ${bogus.status}`);

for (let slot = 2; slot <= 16; slot += 1) {
  const res = await call('/stamp', {
    method: 'POST',
    body: { cardId: card.id, slot, code: codes[slot - 1] },
  });
  if (res.status !== 200) {
    check(`slot ${slot} stamps`, false, `status ${res.status} ${res.data && res.data.error}`);
  }
}
check('all 16 slots stamped', true);

const full = await call(`/card/${card.id}`);
check('card reports 16 stamps', full.data.stamps.length === 16, `${full.data.stamps.length}`);

// 5. rewards
const upsize = await call(`/card/${card.id}/redeem`, { method: 'POST', body: { milestone: 8 } });
check('slot 8 reward redeems', upsize.status === 200 && upsize.data.redemptions.includes(8));

const upsizeAgain = await call(`/card/${card.id}/redeem`, { method: 'POST', body: { milestone: 8 } });
check('redeeming twice is harmless', upsizeAgain.status === 200 && upsizeAgain.data.redemptions.length === 1);

const early = await call(`/card/${card.id}/redeem`, { method: 'POST', body: { milestone: 4 } });
check('unknown milestone is refused', early.status === 400);

const drink = await call(`/card/${card.id}/redeem`, { method: 'POST', body: { milestone: 16 } });
check('slot 16 reward redeems', drink.status === 200 && drink.data.redemptions.includes(16));

// 6. reset
const reset = await call(`/card/${card.id}/reset`, { method: 'POST', body: {} });
check('full card resets to a new cycle', reset.status === 200 && reset.data.cycle === 2 && reset.data.stamps.length === 0);

const resetAgain = await call(`/card/${card.id}/reset`, { method: 'POST', body: {} });
check('empty card cannot be reset', resetAgain.status === 409, `status ${resetAgain.status}`);

// 7. phone
const phone = await call(`/card/${card.id}`, { method: 'PATCH', body: { phone: '+63 917 000 1122' } });
check('phone is saved and normalised', phone.status === 200 && phone.data.phone === '+639170001122', phone.data && phone.data.phone);

const found = await call('/admin/cards?q=9170001122', { token: TOKEN });
check('staff can find the card by phone', found.data.cards.some((c) => c.id === card.id));

const recent = await call('/admin/cards', { token: TOKEN });
check('card list defaults to 5 recent cards', recent.data.limit === 5 && recent.data.cards.length <= 5 && typeof recent.data.total === 'number');

const detail = await call(`/admin/cards/${card.id}`, { token: TOKEN });
check(
  'card detail returns stamps, rewards and lifetime totals',
  detail.status === 200 &&
    detail.data.card.id === card.id &&
    detail.data.stamps.length === 0 &&
    Array.isArray(detail.data.rewards) &&
    detail.data.lifetime.stamps >= 16,
  `status ${detail.status}`
);

// 8. daily stats
const stats = await call('/admin/stats', { token: TOKEN });
check(
  'stats default to a single day',
  stats.status === 200 &&
    stats.data.from === stats.data.to &&
    /^\d{4}-\d{2}-\d{2}$/.test(stats.data.from || ''),
  `${stats.data.from}..${stats.data.to}`
);
check('stats count today\'s burned codes', Number(stats.data.codes_used) >= 16, `used ${stats.data.codes_used}`);
check('stats count today\'s rewards', Number(stats.data.rewards_day) >= 2, `rewards ${stats.data.rewards_day}`);
check('stats keep unused stock as an all-time total', Number(stats.data.codes_unused) >= 3, `unused ${stats.data.codes_unused}`);

const oldDay = await call('/admin/stats?date=2000-01-01', { token: TOKEN });
check('an empty day reports zero activity', Number(oldDay.data.stamps_day) === 0 && Number(oldDay.data.codes_used) === 0);

const rangeStats = await call('/admin/stats?from=2000-01-01&to=2000-01-02', { token: TOKEN });
check(
  'a date range is accepted',
  rangeStats.status === 200 && rangeStats.data.from === '2000-01-01' && rangeStats.data.to === '2000-01-02'
);

// 9. reset codes
const clearUnused = await call('/admin/codes/reset', { method: 'POST', token: TOKEN, body: { mode: 'unused' } });
check('unused codes can be cleared', clearUnused.status === 200 && clearUnused.data.deleted_codes >= 1, `status ${clearUnused.status}`);

const afterUnused = await call('/admin/stats', { token: TOKEN });
check('unused stock is zero after clearing', Number(afterUnused.data.codes_unused) === 0);

const clearAll = await call('/admin/codes/reset', { method: 'POST', token: TOKEN, body: { mode: 'all' } });
check('every code can be deleted', clearAll.status === 200 && clearAll.data.mode === 'all');

const afterAll = await call('/admin/stats', { token: TOKEN });
check('codes are zero after a full reset', Number(afterAll.data.codes_total) === 0 && Number(afterAll.data.codes_unused) === 0);

// 10. superadmin + staff tokens
const migrated = await call('/superadmin/migrate', { method: 'POST', token: SUPER_TOKEN, body: {} });
check('superadmin prepares the staff table', migrated.status === 200 && migrated.data.migrated === true);

const migratedAgain = await call('/superadmin/migrate', { method: 'POST', token: SUPER_TOKEN, body: {} });
check('preparing the staff table is idempotent', migratedAgain.status === 200);

const superNoAuth = await call('/superadmin/staff');
check('superadmin rejects a missing token', superNoAuth.status === 401);

const superBad = await call('/superadmin/staff', { token: 'nope' });
check('superadmin rejects a wrong token', superBad.status === 401);

const superAsAdmin = await call('/admin/stats', { token: SUPER_TOKEN });
check('the superadmin token cannot read admin data', superAsAdmin.status === 401, `status ${superAsAdmin.status}`);

const staffAsSuper = await call('/superadmin/staff', { token: TOKEN });
check('a staff/master token cannot use superadmin', staffAsSuper.status === 401, `status ${staffAsSuper.status}`);

const created = await call('/superadmin/staff', { method: 'POST', token: SUPER_TOKEN, body: { name: 'Smoke tester' } });
check(
  'superadmin creates a staff token (shown once)',
  created.status === 201 && !!created.data.token && created.data.token.startsWith('ct-'),
  `status ${created.status}`
);
const staffId = created.data && created.data.id;
const staffToken = created.data && created.data.token;

const staffOk = await call('/admin/stats', { token: staffToken });
check('a staff token opens the dashboard', staffOk.status === 200, `status ${staffOk.status}`);

const wrongStaff = await call('/admin/stats', { token: 'ct-' + '0'.repeat(48) });
check('a wrong staff token is rejected', wrongStaff.status === 401);

const listed = await call('/superadmin/staff', { token: SUPER_TOKEN });
check(
  'the staff list never contains tokens',
  listed.status === 200 && listed.data.staff.some((s) => s.id === staffId) && listed.data.staff.every((s) => !('token' in s) && !('token_hash' in s))
);

const paused = await call(`/superadmin/staff/${staffId}/pause`, { method: 'PATCH', token: SUPER_TOKEN, body: {} });
check('a staff token can be paused', paused.status === 200 && paused.data.status === 'paused');

const pausedDenied = await call('/admin/stats', { token: staffToken });
check('a paused token is rejected', pausedDenied.status === 401);

const resumed = await call(`/superadmin/staff/${staffId}/resume`, { method: 'PATCH', token: SUPER_TOKEN, body: {} });
check('a staff token can be resumed', resumed.status === 200 && resumed.data.status === 'active');

const resumedOk = await call('/admin/stats', { token: staffToken });
check('a resumed token works again', resumedOk.status === 200);

const rotated = await call(`/superadmin/staff/${staffId}/rotate`, { method: 'PATCH', token: SUPER_TOKEN, body: { force: true } });
check('rotating issues a new token', rotated.status === 200 && !!rotated.data.token && rotated.data.token !== staffToken);

const oldDenied = await call('/admin/stats', { token: staffToken });
check('the old token dies after rotation', oldDenied.status === 401);

const newOk = await call('/admin/stats', { token: rotated.data.token });
check('the rotated token works', newOk.status === 200);

const deleted = await call(`/superadmin/staff/${staffId}`, { method: 'DELETE', token: SUPER_TOKEN });
check('a staff token can be deleted', deleted.status === 200 && deleted.data.deleted === true);

const deletedDenied = await call('/admin/stats', { token: rotated.data.token });
check('a deleted token is rejected', deletedDenied.status === 401);

const legacy = await call('/admin/stats', { token: TOKEN });
check('the legacy admin token still works', legacy.status === 200);

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
