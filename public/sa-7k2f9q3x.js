const TOKEN_KEY = 'coftea.super.token';

const el = (id) => document.getElementById(id);

let token = sessionStorage.getItem(TOKEN_KEY) || '';
let staff = [];
let confirmAction = null;
let toastTimer = null;

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
      Authorization: `Bearer ${auth !== undefined ? auth : token}`,
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
  await request('/superadmin/staff', { auth: candidate });
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

function signOut() {
  token = '';
  sessionStorage.removeItem(TOKEN_KEY);
  location.reload();
}

async function showApp() {
  el('gate').hidden = true;
  el('app').hidden = false;
  el('sign-out').hidden = false;
  try {
    await loadStaff();
  } catch (err) {
    // First run on a fresh database: create the staff table, then load.
    await request('/superadmin/migrate', { method: 'POST', body: {} });
    await loadStaff();
    toast('Database prepared.');
  }
}

/* ---------------------------------------------------------------- staff */

async function loadStaff() {
  const data = await request('/superadmin/staff');
  staff = data.staff || [];
  renderStaff();
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true })
  );
}

function renderStaff() {
  const rows = el('staff-rows');
  rows.innerHTML = '';
  el('staff-empty').hidden = staff.length > 0;

  for (const member of staff) {
    const tr = document.createElement('tr');

    const name = document.createElement('td');
    name.textContent = member.name;

    const status = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge ' + (member.status === 'active' ? 'badge-unused' : 'badge-paused');
    badge.textContent = member.status === 'active' ? 'Active' : 'Paused';
    status.appendChild(badge);

    const created = document.createElement('td');
    created.textContent = fmtDate(member.created_at);

    const used = document.createElement('td');
    used.textContent = fmtDateTime(member.last_used_at);

    const actions = document.createElement('td');
    actions.className = 'right';
    const wrap = document.createElement('div');
    wrap.className = 'actions';
    wrap.style.justifyContent = 'flex-end';

    const rotate = document.createElement('button');
    rotate.className = 'mini';
    rotate.type = 'button';
    rotate.textContent = 'New password';
    rotate.addEventListener('click', () => rotateStaff(member));

    const pauseResume = document.createElement('button');
    pauseResume.className = 'mini';
    pauseResume.type = 'button';
    pauseResume.textContent = member.status === 'active' ? 'Pause' : 'Resume';
    pauseResume.addEventListener('click', () => toggleStaff(member));

    const del = document.createElement('button');
    del.className = 'mini danger';
    del.type = 'button';
    del.textContent = 'Delete';
    del.addEventListener('click', () => deleteStaff(member));

    wrap.append(rotate, pauseResume, del);
    actions.appendChild(wrap);

    tr.append(name, status, created, used, actions);
    rows.appendChild(tr);
  }
}

async function createStaff(name) {
  const data = await request('/superadmin/staff', { method: 'POST', body: { name } });
  await loadStaff();
  showToken(data.name, data.token);
  toast(`Token created for ${data.name}.`);
}

async function rotateStaff(member) {
  const data = await request(`/superadmin/staff/${member.id}/rotate`, { method: 'PATCH', body: {} });
  await loadStaff();
  showToken(member.name, data.token);
  toast(`New token issued for ${member.name}.`);
}

async function toggleStaff(member) {
  const action = member.status === 'active' ? 'pause' : 'resume';
  await request(`/superadmin/staff/${member.id}/${action}`, { method: 'PATCH', body: {} });
  await loadStaff();
  toast(member.status === 'active' ? `${member.name} paused.` : `${member.name} resumed.`);
}

function deleteStaff(member) {
  openConfirm(
    `Delete ${member.name}?`,
    'Their token stops working immediately. This cannot be undone.',
    async () => {
      await request(`/superadmin/staff/${member.id}`, { method: 'DELETE' });
      await loadStaff();
      toast(`${member.name} deleted.`);
    }
  );
}

/* ---------------------------------------------------------------- modal */

function showToken(name, value) {
  el('token-modal-name').textContent = name;
  el('token-value').textContent = value;
  el('token-copy-note').hidden = true;
  el('token-modal').hidden = false;
  el('token-done').focus();
}

function hideToken() {
  el('token-modal').hidden = true;
}

function openConfirm(title, text, action) {
  el('confirm-title').textContent = title;
  el('confirm-text').textContent = text;
  confirmAction = action;
  el('confirm-modal').hidden = false;
  el('confirm-cancel').focus();
}

function closeConfirm() {
  el('confirm-modal').hidden = true;
  confirmAction = null;
}

/* ---------------------------------------------------------------- toast */

function toast(message) {
  const box = el('toast');
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 3200);
}

/* ----------------------------------------------------------------- wire */

el('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const candidate = el('token-input').value.trim();
  if (!candidate) return;
  try {
    await trySignIn(candidate);
  } catch (err) {
    const box = el('gate-error');
    box.textContent = err.status === 429 ? err.message : 'Wrong token.';
    box.hidden = false;
  }
});

el('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = el('staff-name').value.trim();
  if (!name) return;
  const box = el('create-error');
  try {
    box.hidden = true;
    await createStaff(name);
    el('staff-name').value = '';
  } catch (err) {
    box.textContent = err.message;
    box.hidden = false;
  }
});

el('token-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = el('super-token').value.trim();
  const box = el('token-error');
  if (value.length < 10) {
    box.textContent = 'The new token must be at least 10 characters.';
    box.hidden = false;
    return;
  }
  try {
    box.hidden = true;
    await request('/superadmin/token', { method: 'POST', body: { token: value } });
    el('changed-modal').hidden = false;
  } catch (err) {
    box.textContent = err.message;
    box.hidden = false;
  }
});

el('changed-ok').addEventListener('click', () => {
  sessionStorage.removeItem(TOKEN_KEY);
  location.reload();
});

el('token-copy').addEventListener('click', async () => {
  const note = el('token-copy-note');
  try {
    await navigator.clipboard.writeText(el('token-value').textContent);
    note.textContent = 'Copied.';
    note.className = 'note';
  } catch {
    note.textContent = 'Copy failed — select the token and copy it manually.';
    note.className = 'err';
  }
  note.hidden = false;
});

el('token-done').addEventListener('click', hideToken);
el('confirm-cancel').addEventListener('click', closeConfirm);
el('confirm-ok').addEventListener('click', async () => {
  const action = confirmAction;
  closeConfirm();
  if (action) {
    try {
      await action();
    } catch (err) {
      toast(err.message || 'Something went wrong.');
    }
  }
});
el('sign-out').addEventListener('click', signOut);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el('token-modal').hidden) hideToken();
  if (!el('confirm-modal').hidden) closeConfirm();
});

if (token) {
  trySignIn(token).catch(() => showGate());
} else {
  showGate();
}
