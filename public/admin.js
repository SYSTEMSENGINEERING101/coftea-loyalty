const TOKEN_KEY = 'coftea.admin.token';

const el = (id) => document.getElementById(id);

let token = sessionStorage.getItem(TOKEN_KEY) || '';
let batches = [];
let selectedBatch = null;
let selectedCodes = [];
let picked = new Set();
let toastTimer = null;
let searchTimer = null;
let cardsTimer = null;

/* ------------------------------------------------------------------ api */

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(path, { method = 'GET', body, auth } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }

  if (!res.ok) throw new ApiError((data && data.error) || 'Request failed.', res.status, data);
  return data;
}

/* ---------------------------------------------------------------- gate */

async function trySignIn(candidate) {
  await request('/admin/stats', { auth: candidate });
  token = candidate;
  sessionStorage.setItem(TOKEN_KEY, token);
  el('gate-error').hidden = true;
  await showApp();
}

function showGate() {
  el('gate').hidden = false;
  el('app').hidden = true;
  el('sign-out').hidden = true;
  el('token-input').focus();
}

function signOut(reload = true) {
  token = '';
  sessionStorage.removeItem(TOKEN_KEY);
  if (reload) location.reload();
  else showGate();
}

/* ---------------------------------------------------------------- load */

async function showApp() {
  el('gate').hidden = true;
  el('app').hidden = false;
  el('sign-out').hidden = false;

  if (!el('stats-date').value) el('stats-date').value = cafeToday();

  try {
    await Promise.all([loadStats(), loadBatches(), lookupCards('')]);
  } catch (err) {
    if (err.status === 401) signOut(false);
    else toast(err.message);
  }
}

function cafeToday() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

async function loadStats() {
  const date = el('stats-date').value || cafeToday();
  const data = await request(`/admin/stats?date=${encodeURIComponent(date)}`, { auth: token });

  const items = [
    ['Codes', data.codes_total, 'all time'],
    ['Unused', data.codes_unused, 'all time'],
    ['Used', data.codes_used, 'that day'],
    ['New cards', data.cards_new, 'that day'],
    ['Stamps', data.stamps_day, 'that day'],
    ['Rewards', data.rewards_day, 'that day'],
  ];

  const wrap = el('stats');
  wrap.replaceChildren();
  items.forEach(([label, value, tag]) => {
    const box = document.createElement('div');
    box.className = 'stat';
    const name = document.createElement('span');
    name.textContent = label;
    const num = document.createElement('b');
    num.textContent = String(value ?? 0);
    const note = document.createElement('em');
    note.className = 'stat-tag';
    note.textContent = tag;
    box.append(name, num, note);
    wrap.appendChild(box);
  });

  el('stats-scope').textContent = `Daily summary for ${fmtDay(date)}. Used, new cards, stamps and rewards cover that day; codes and unused stock are all-time.`;
}

async function loadBatches() {
  const data = await request('/admin/batches', { auth: token });
  batches = data.batches || [];

  const rows = el('batch-rows');
  rows.replaceChildren();

  if (!batches.length) {
    rows.appendChild(emptyRow(5, 'No batches yet. Generate your first batch above.'));
    return;
  }

  batches.forEach((batch) => {
    const unused = Number(batch.total) - Number(batch.used);
    const expired = new Date(batch.expires_at).getTime() < Date.now();

    const tr = document.createElement('tr');

    const nameCell = document.createElement('td');
    const strong = document.createElement('div');
    strong.textContent = batch.label;
    const idLine = document.createElement('div');
    idLine.className = 'mono';
    idLine.style.fontSize = '10px';
    idLine.style.color = 'var(--muted)';
    idLine.textContent = batch.id;
    nameCell.append(strong, idLine);

    const createdCell = document.createElement('td');
    createdCell.textContent = fmtDate(batch.created_at);

    const expiresCell = document.createElement('td');
    expiresCell.textContent = fmtDate(batch.expires_at);
    if (expired) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-expired';
      badge.style.marginLeft = '6px';
      badge.textContent = 'expired';
      expiresCell.appendChild(badge);
    }

    const unusedCell = document.createElement('td');
    unusedCell.textContent = `${unused} / ${batch.total}`;

    const actionsCell = document.createElement('td');
    actionsCell.className = 'right';
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.style.justifyContent = 'flex-end';

    const printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.className = 'mini primary';
    printBtn.textContent = 'Print';
    printBtn.addEventListener('click', () => printBatch(batch));

    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'mini';
    viewBtn.textContent = 'Codes';
    viewBtn.addEventListener('click', () => selectBatch(batch));

    actions.append(printBtn, viewBtn);
    actionsCell.appendChild(actions);

    tr.append(nameCell, createdCell, expiresCell, unusedCell, actionsCell);
    rows.appendChild(tr);
  });

  if (selectedBatch && !batches.some((b) => b.id === selectedBatch.id)) selectedBatch = null;

  if (!batches.length) {
    selectedCodes = [];
    picked.clear();
    el('codes-title').textContent = 'Codes';
    el('codes-sub').textContent = 'No batches yet. Generate a batch above.';
    el('code-rows').replaceChildren(emptyRow(4, 'No codes yet.'));
    updatePrintButton();
  } else if (!selectedBatch) {
    await selectBatch(batches[0]);
  }
}

/* --------------------------------------------------------------- codes */

async function selectBatch(batch) {
  selectedBatch = batch;
  el('codes-title').textContent = `Codes · ${batch.label}`;
  el('codes-sub').textContent = `${batch.id} · created ${fmtDate(batch.created_at)} · expires ${fmtDate(batch.expires_at)}`;
  el('code-search').value = '';
  el('code-status').value = 'all';
  await loadCodes();
}

async function loadCodes() {
  if (!selectedBatch) return;

  const status = el('code-status').value;
  const q = el('code-search').value.replace(/\D/g, '').slice(0, 7);
  const params = new URLSearchParams({ status });
  if (q) params.set('q', q);

  const data = await request(`/admin/batches/${encodeURIComponent(selectedBatch.id)}/codes?${params}`, { auth: token });
  selectedCodes = data.codes || [];
  picked.clear();
  renderCodes();
}

function renderCodes() {
  const rows = el('code-rows');
  rows.replaceChildren();

  if (!selectedCodes.length) {
    rows.appendChild(emptyRow(4, 'No codes match this view.'));
    el('code-select-all').checked = false;
    el('code-select-all').disabled = true;
    updatePrintButton();
    return;
  }

  const printable = selectedCodes.filter((c) => !c.used_at);
  el('code-select-all').disabled = printable.length === 0;
  el('code-select-all').checked = printable.length > 0 && printable.every((c) => picked.has(c.code));

  selectedCodes.forEach((code) => {
    const tr = document.createElement('tr');

    const pickCell = document.createElement('td');
    pickCell.className = 'pick';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.disabled = Boolean(code.used_at);
    box.checked = !code.used_at && picked.has(code.code);
    box.setAttribute('aria-label', `Select code ${code.code}`);
    box.addEventListener('change', () => {
      if (box.checked) picked.add(code.code);
      else picked.delete(code.code);
      updatePrintButton();
      renderSelectAllState();
    });
    pickCell.appendChild(box);

    const codeCell = document.createElement('td');
    codeCell.className = 'mono';
    codeCell.textContent = code.code;

    const statusCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge ' + (code.used_at ? 'badge-used' : 'badge-unused');
    badge.textContent = code.used_at ? 'Used' : 'Unused';
    statusCell.appendChild(badge);

    const usedCell = document.createElement('td');
    usedCell.textContent = code.used_at ? fmtDateTime(code.used_at) : '—';

    tr.append(pickCell, codeCell, statusCell, usedCell);
    rows.appendChild(tr);
  });

  updatePrintButton();
}

function renderSelectAllState() {
  const printable = selectedCodes.filter((c) => !c.used_at);
  el('code-select-all').checked = printable.length > 0 && printable.every((c) => picked.has(c.code));
}

function updatePrintButton() {
  const button = el('print-selected');
  const n = picked.size;
  button.disabled = n === 0;
  button.textContent = n ? `Print selected (${n})` : 'Print selected';
}

/* --------------------------------------------------------------- print */

async function printBatch(batch) {
  try {
    const expired = new Date(batch.expires_at).getTime() < Date.now();
    if (expired && !confirm(`This batch expired on ${fmtDate(batch.expires_at)}. Its codes will be refused.\n\nPrint anyway?`)) {
      return;
    }

    const status = el('include-used').checked ? 'all' : 'unused';
    const data = await request(
      `/admin/batches/${encodeURIComponent(batch.id)}/codes?status=${status}`,
      { auth: token }
    );
    const codes = (data.codes || []).map((c) => c.code);

    if (!codes.length) {
      toast('Nothing to print for this batch.');
      return;
    }

    printCodes(batch, codes);
  } catch (err) {
    toast(err.message);
  }
}

function printSelected() {
  if (!selectedBatch || !picked.size) {
    toast('Pick at least one unused code first.');
    return;
  }

  const codes = selectedCodes.filter((c) => picked.has(c.code) && !c.used_at).map((c) => c.code);
  if (!codes.length) {
    toast('The selected codes are already used.');
    return;
  }

  printCodes(selectedBatch, codes);
}

function printCodes(batch, codes) {
  buildSlips(batch, codes, el('receipt-width').value);

  const previousTitle = document.title;
  document.title = `Coftea ${batch.label} - ${codes.length} codes`;
  window.addEventListener(
    'afterprint',
    () => {
      document.title = previousTitle;
      el('print-root').replaceChildren();
    },
    { once: true }
  );

  setTimeout(() => window.print(), 120);
}

function buildSlips(batch, codes, width) {
  const root = el('print-root');
  root.replaceChildren();

  codes.forEach((code) => {
    const slip = document.createElement('article');
    slip.className = 'pos-slip';

    const brand = document.createElement('div');
    brand.className = 'pos-brand';
    brand.textContent = 'Coftea Cafe — Ipil';

    const caption = document.createElement('div');
    caption.className = 'pos-caption';
    caption.textContent = 'LOYALTY CODE';

    const num = document.createElement('div');
    num.className = 'pos-code';
    num.textContent = code;

    const note = document.createElement('div');
    note.className = 'pos-note';
    note.textContent = '1 code = 1 stamp';

    const meta = document.createElement('div');
    meta.className = 'pos-meta';
    meta.textContent = `${batch.label} · expires ${fmtDate(batch.expires_at)}`;

    slip.append(brand, caption, num, note, meta);
    root.appendChild(slip);
  });

  setPageSize(width);
}

function setPageSize(width) {
  let style = document.getElementById('pos-page');
  if (!style) {
    style = document.createElement('style');
    style.id = 'pos-page';
    document.head.appendChild(style);
  }
  style.textContent = `@media print { @page { size: ${width}mm 40mm; margin: 0; } #print-root { width: ${width}mm; } .pos-slip { width: ${width}mm; height: 38mm; } }`;
}

/* --------------------------------------------------------------- cards */

async function lookupCards(query = '') {
  const rows = el('card-rows');

  try {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    const data = await request(`/admin/cards?${params}`, { auth: token });
    const cards = data.cards || [];
    rows.replaceChildren();

    if (!cards.length) {
      rows.appendChild(emptyRow(6, query ? 'No cards match that number or card id.' : 'No customer cards yet.'));
    } else {
      cards.forEach((card) => {
        const tr = document.createElement('tr');
        tr.className = 'clickable';
        tr.addEventListener('click', () => loadCardDetail(card.id));

        const idCell = document.createElement('td');
        idCell.className = 'mono';
        idCell.style.fontSize = '10.5px';
        idCell.textContent = card.id.slice(0, 10) + '…';
        idCell.title = card.id;

        const phoneCell = document.createElement('td');
        phoneCell.textContent = card.phone || '—';

        const stampsCell = document.createElement('td');
        stampsCell.textContent = `${card.stamps} / 16`;

        const rewardsCell = document.createElement('td');
        rewardsCell.textContent = String(card.rewards);

        const seenCell = document.createElement('td');
        seenCell.textContent = fmtDateTime(card.last_seen_at);

        const openCell = document.createElement('td');
        openCell.className = 'right';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'mini';
        open.textContent = 'Open';
        open.addEventListener('click', (event) => {
          event.stopPropagation();
          loadCardDetail(card.id);
        });
        openCell.appendChild(open);

        tr.append(idCell, phoneCell, stampsCell, rewardsCell, seenCell, openCell);
        rows.appendChild(tr);
      });
    }

    el('cards-hint').textContent = data.total > cards.length
      ? `Showing ${cards.length} of ${data.total} cards, most recent first. Search by phone number or card id to narrow down.`
      : `Showing ${cards.length} card${cards.length === 1 ? '' : 's'}. Open a card to see its stamps and rewards.`;
  } catch (err) {
    toast(err.message);
  }
}

async function loadCardDetail(id) {
  try {
    const data = await request(`/admin/cards/${encodeURIComponent(id)}`, { auth: token });
    renderCardDetail(data);
  } catch (err) {
    toast(err.message);
  }
}

function renderCardDetail(data) {
  const card = data.card;

  el('detail-title').textContent = `Card ${card.id.slice(0, 10)}…`;
  el('detail-sub').textContent =
    `${card.id} · ${card.phone || 'no recovery phone'} · created ${fmtDateTime(card.created_at)} · ` +
    `last seen ${fmtDateTime(card.last_seen_at)} · cycle ${card.cycle}`;

  const stats = [
    ['Stamps', data.stamps.length, 'this cycle'],
    ['Rewards', data.rewards.length, 'this cycle'],
    ['Stamps', data.lifetime.stamps, 'lifetime'],
    ['Rewards', data.lifetime.rewards, 'lifetime'],
  ];
  const statWrap = el('detail-stats');
  statWrap.replaceChildren();
  stats.forEach(([label, value, tag]) => {
    const box = document.createElement('div');
    box.className = 'stat';
    const name = document.createElement('span');
    name.textContent = label;
    const num = document.createElement('b');
    num.textContent = String(value ?? 0);
    const note = document.createElement('em');
    note.className = 'stat-tag';
    note.textContent = tag;
    box.append(name, num, note);
    statWrap.appendChild(box);
  });

  const filled = new Set(data.stamps.map((s) => s.slot));
  const slots = el('detail-slots');
  slots.replaceChildren();
  for (let slot = 1; slot <= 16; slot += 1) {
    const chip = document.createElement('span');
    chip.className = 'slot';
    if (filled.has(slot)) chip.classList.add('filled');
    if (slot === 8 || slot === 16) chip.classList.add('milestone');
    chip.textContent = slot === 8 ? '8 ★' : slot === 16 ? '16 ★' : String(slot);
    slots.appendChild(chip);
  }

  const stampRows = el('detail-stamps');
  stampRows.replaceChildren();
  if (!data.stamps.length) {
    stampRows.appendChild(emptyRow(3, 'No stamps in this cycle.'));
  } else {
    data.stamps.forEach((stamp) => {
      const tr = document.createElement('tr');
      const slotCell = document.createElement('td');
      slotCell.textContent = String(stamp.slot);
      const codeCell = document.createElement('td');
      codeCell.className = 'mono';
      codeCell.textContent = stamp.code;
      const timeCell = document.createElement('td');
      timeCell.textContent = fmtDateTime(stamp.stamped_at);
      tr.append(slotCell, codeCell, timeCell);
      stampRows.appendChild(tr);
    });
  }

  const rewardRows = el('detail-rewards');
  rewardRows.replaceChildren();
  if (!data.rewards.length) {
    rewardRows.appendChild(emptyRow(2, 'No rewards claimed in this cycle.'));
  } else {
    data.rewards.forEach((reward) => {
      const tr = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = rewardName(reward.milestone);
      const timeCell = document.createElement('td');
      timeCell.textContent = fmtDateTime(reward.claimed_at);
      tr.append(nameCell, timeCell);
      rewardRows.appendChild(tr);
    });
  }

  const panel = el('card-detail');
  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function rewardName(milestone) {
  if (Number(milestone) === 8) return 'Free Upsize';
  if (Number(milestone) === 16) return 'Free Drink';
  return 'Reward';
}

/* ------------------------------------------------------------- helpers */

function emptyRow(cols, message) {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = cols;
  td.className = 'empty';
  td.textContent = message;
  tr.appendChild(td);
  return tr;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDay(dateStr) {
  if (!dateStr) return '—';
  return new Date(`${dateStr}T12:00:00+08:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toast(message) {
  const node = el('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 3200);
}

/* --------------------------------------------------------------- wiring */

el('gate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const candidate = el('token-input').value.trim();
  const errorEl = el('gate-error');
  errorEl.hidden = true;

  if (!candidate) {
    errorEl.textContent = 'Enter the admin token.';
    errorEl.hidden = false;
    return;
  }

  try {
    await trySignIn(candidate);
  } catch (err) {
    errorEl.textContent = err.status === 401 ? 'That token is not correct.' : err.message;
    errorEl.hidden = false;
  }
});

el('sign-out').addEventListener('click', () => signOut());

el('batch-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = el('batch-submit');
  const note = el('batch-note');

  button.disabled = true;
  button.textContent = 'Generating…';
  note.hidden = true;

  try {
    const result = await request('/admin/batches', {
      method: 'POST',
      auth: token,
      body: {
        label: el('batch-label').value.trim(),
        count: Number(el('batch-count').value),
        days: Number(el('batch-days').value),
      },
    });

    note.textContent = `Created ${result.count} codes in “${result.label}”. They expire ${fmtDate(result.expiresAt)}.`;
    note.hidden = false;
    el('batch-label').value = '';

    const keep = result.id;
    await Promise.all([loadStats(), loadBatches()]);
    const created = batches.find((b) => b.id === keep);
    if (created) await selectBatch(created);
  } catch (err) {
    if (err.status === 401) signOut(false);
    else toast(err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Generate';
  }
});

el('code-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadCodes, 220);
});
el('code-status').addEventListener('change', loadCodes);

el('code-select-all').addEventListener('change', (event) => {
  picked.clear();
  if (event.target.checked) {
    selectedCodes.filter((c) => !c.used_at).forEach((c) => picked.add(c.code));
  }
  renderCodes();
});

el('print-selected').addEventListener('click', printSelected);

el('stats-date').addEventListener('change', () => loadStats().catch((err) => toast(err.message)));

el('day-prev').addEventListener('click', () => shiftDay(-1));
el('day-next').addEventListener('click', () => shiftDay(1));
el('day-today').addEventListener('click', () => {
  el('stats-date').value = cafeToday();
  loadStats().catch((err) => toast(err.message));
});

function shiftDay(delta) {
  const current = el('stats-date').value || cafeToday();
  const d = new Date(`${current}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + delta);
  el('stats-date').value = new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  loadStats().catch((err) => toast(err.message));
}

el('card-form').addEventListener('submit', (event) => {
  event.preventDefault();
  lookupCards(el('card-query').value.trim());
});

el('card-query').addEventListener('input', () => {
  clearTimeout(cardsTimer);
  cardsTimer = setTimeout(() => lookupCards(el('card-query').value.trim()), 300);
});

el('detail-close').addEventListener('click', () => {
  el('card-detail').hidden = true;
});

el('clear-unused').addEventListener('click', () => resetCodes('unused'));
el('clear-all').addEventListener('click', () => resetCodes('all'));

async function resetCodes(mode) {
  const first =
    mode === 'all'
      ? 'Delete EVERY code and every batch? Used code history will be gone. Cards and stamps stay.'
      : 'Delete all unused codes? Batches with no used codes will be removed too.';
  if (!confirm(first)) return;

  const word = mode === 'all' ? 'DELETE' : 'RESET';
  const typed = prompt(`Type ${word} to confirm.`);
  if (typed !== word) {
    toast('Cancelled — nothing was deleted.');
    return;
  }

  try {
    const result = await request('/admin/codes/reset', { method: 'POST', auth: token, body: { mode } });
    toast(`Deleted ${result.deleted_codes} codes and ${result.deleted_batches} batches.`);

    el('card-detail').hidden = true;
    await Promise.all([loadStats(), loadBatches(), lookupCards(el('card-query').value.trim())]);
  } catch (err) {
    if (err.status === 401) signOut(false);
    else toast(err.message);
  }
}

/* ---------------------------------------------------------------- boot */

if (token) {
  showApp().catch(() => signOut(false));
} else {
  showGate();
}
