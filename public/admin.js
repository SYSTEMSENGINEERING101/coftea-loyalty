const TOKEN_KEY = 'coftea.admin.token';

const el = (id) => document.getElementById(id);

let token = sessionStorage.getItem(TOKEN_KEY) || '';
let batches = [];
let selectedBatch = null;
let selectedCodes = [];
let toastTimer = null;
let searchTimer = null;

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

  try {
    await Promise.all([loadStats(), loadBatches()]);
  } catch (err) {
    if (err.status === 401) signOut(false);
    else toast(err.message);
  }
}

async function loadStats() {
  const data = await request('/admin/stats', { auth: token });
  const items = [
    ['Codes', data.codes_total],
    ['Unused', data.codes_unused],
    ['Used', data.codes_used],
    ['Cards', data.cards_total],
    ['Stamps', data.stamps_total],
    ['Rewards', data.rewards_total],
  ];

  const wrap = el('stats');
  wrap.replaceChildren();
  items.forEach(([label, value]) => {
    const box = document.createElement('div');
    box.className = 'stat';
    const name = document.createElement('span');
    name.textContent = label;
    const num = document.createElement('b');
    num.textContent = String(value ?? 0);
    box.append(name, num);
    wrap.appendChild(box);
  });
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

  if (!selectedBatch && batches.length) selectBatch(batches[0]);
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
  renderCodes();
}

function renderCodes() {
  const rows = el('code-rows');
  rows.replaceChildren();

  if (!selectedCodes.length) {
    rows.appendChild(emptyRow(3, 'No codes match this view.'));
    return;
  }

  selectedCodes.forEach((code) => {
    const tr = document.createElement('tr');

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

    tr.append(codeCell, statusCell, usedCell);
    rows.appendChild(tr);
  });
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

    buildSheets(batch, codes, el('layout').value);

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
  } catch (err) {
    toast(err.message);
  }
}

function buildSheets(batch, codes, layout) {
  const perPage = layout === '50' ? 500 : 250;
  const pages = Math.ceil(codes.length / perPage);
  const root = el('print-root');
  root.replaceChildren();

  for (let page = 0; page < pages; page += 1) {
    const slice = codes.slice(page * perPage, (page + 1) * perPage);

    const sheet = document.createElement('section');
    sheet.className = 'sheet layout-' + layout;

    const head = document.createElement('div');
    head.className = 'sheet-head';

    const left = document.createElement('span');
    const title = document.createElement('b');
    title.textContent = 'Coftea Cafe — Ipil';
    const meta = document.createElement('span');
    meta.textContent = `  ${batch.label}  ·  ${batch.id}  ·  expires ${fmtDate(batch.expires_at)}`;
    left.append(title, meta);

    const right = document.createElement('span');
    right.textContent = `Page ${page + 1} of ${pages}  ·  ${codes.length} codes  ·  1 code = 1 stamp`;

    head.append(left, right);

    const grid = document.createElement('div');
    grid.className = 'cut-grid';

    slice.forEach((code) => {
      const cell = document.createElement('div');
      cell.className = 'cut-cell';

      const span = document.createElement('span');
      span.className = 'cut-code';
      span.textContent = code;
      cell.appendChild(span);

      if (layout === '25') {
        const note = document.createElement('span');
        note.className = 'cut-note';
        note.textContent = '1 code = 1 stamp';
        cell.appendChild(note);
      }

      grid.appendChild(cell);
    });

    sheet.append(head, grid);
    root.appendChild(sheet);
  }
}

/* --------------------------------------------------------------- cards */

async function lookupCards(query) {
  const rows = el('card-rows');

  try {
    const data = await request(`/admin/cards?q=${encodeURIComponent(query)}`, { auth: token });
    const cards = data.cards || [];
    rows.replaceChildren();

    if (!cards.length) {
      rows.appendChild(emptyRow(5, 'No cards found.'));
      return;
    }

    cards.forEach((card) => {
      const tr = document.createElement('tr');

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

      tr.append(idCell, phoneCell, stampsCell, rewardsCell, seenCell);
      rows.appendChild(tr);
    });
  } catch (err) {
    toast(err.message);
  }
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

el('card-form').addEventListener('submit', (event) => {
  event.preventDefault();
  lookupCards(el('card-query').value.trim());
});

/* ---------------------------------------------------------------- boot */

if (token) {
  showApp().catch(() => signOut(false));
} else {
  showGate();
}
