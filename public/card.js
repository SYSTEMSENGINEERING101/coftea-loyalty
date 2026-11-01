const CARD_KEY = 'coftea.card.id';
const TUT_KEY = 'coftea.tutorial.seen';

const el = (id) => document.getElementById(id);

let card = null;
let busy = false;
let toastTimer = null;

/* ------------------------------------------------------------------ api */

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }

  if (!res.ok) {
    const error = new Error((data && data.error) || 'Request failed.');
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

/* ----------------------------------------------------------------- boot */

async function boot() {
  try {
    const linked = new URLSearchParams(location.search).get('card');
    if (linked && linked !== localStorage.getItem(CARD_KEY)) {
      try {
        const imported = await api('/card/' + encodeURIComponent(linked));
        localStorage.setItem(CARD_KEY, imported.id);
        history.replaceState({}, '', location.pathname);
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }

    const saved = localStorage.getItem(CARD_KEY);

    if (saved) {
      try {
        card = await api('/card/' + encodeURIComponent(saved));
      } catch (err) {
        if (err.status === 404) localStorage.removeItem(CARD_KEY);
        else throw err;
      }
    }

    if (!card) {
      card = await api('/card', { method: 'POST', body: {} });
      localStorage.setItem(CARD_KEY, card.id);
    }

    el('card').setAttribute('aria-busy', 'false');
    el('fine').hidden = false;
    render();

    if (!localStorage.getItem(TUT_KEY)) openHow();
  } catch (err) {
    showFatal();
  }
}

function showFatal() {
  el('card').setAttribute('aria-busy', 'false');
  el('slots').hidden = true;
  el('rewards').hidden = true;

  let box = el('fatal');
  if (!box) {
    box = document.createElement('div');
    box.id = 'fatal';
    box.className = 'err';
    box.style.margin = '28px 0 0';
    box.style.textAlign = 'center';
    el('slots').before(box);
  }

  const text = document.createElement('div');
  text.textContent = "We can't reach the cafe's server right now. Check your connection and try again.";
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn-outline btn-sm';
  retry.style.marginTop = '12px';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => location.reload());

  box.replaceChildren(text, retry);
}

/* --------------------------------------------------------------- render */

const ICONS = {
  cup: '<svg class="cup" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><path d="M6 1v3M10 1v3M14 1v3"/></svg>',
  lock: '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  check: '<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>',
};

function render(justStamped = null) {
  const stamped = new Set(card.stamps);
  const redeemed = new Set(card.redemptions);
  const filled = card.stamps.length;
  const next = filled + 1;

  const grid = el('slots');
  grid.hidden = false;
  grid.replaceChildren();

  for (let slot = 1; slot <= card.total; slot += 1) {
    const done = stamped.has(slot);
    const locked = !done && slot !== next;
    const milestone = card.milestones.includes(slot);
    const isRedeemed = redeemed.has(slot);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slot' + (done ? ' done' : '') + (locked ? ' locked' : '');
    button.setAttribute('role', 'listitem');
    button.dataset.slot = String(slot);

    let label = `Slot ${slot}`;
    if (done) label += milestone ? (isRedeemed ? ', reward redeemed' : ', reward unlocked') : ', stamped';
    else if (locked) label += ', locked';
    else label += ', stamp this slot';
    button.setAttribute('aria-label', label);

    if (milestone) {
      const tag = document.createElement('span');
      tag.className = 'tag ' + (slot === 8 ? 'tag-gold' : 'tag-ink');
      tag.textContent = (slot === 8 ? 'Free upsize' : 'Free drink') + (isRedeemed ? ' ✓' : '');
      button.appendChild(tag);
    }

    const icon = done ? ICONS.check : locked ? ICONS.lock : ICONS.cup;
    button.insertAdjacentHTML('beforeend', icon + `<span class="num">${slot}</span>`);

    if (justStamped === slot) button.classList.add('pop');

    button.addEventListener('click', () => onSlot(slot));
    grid.appendChild(button);
  }

  el('progress').innerHTML = `<strong>${filled}</strong> / ${card.total} stamps`;
  el('reset-btn').hidden = filled !== card.total;

  renderRewards(stamped, redeemed);
  renderFine();
}

function renderRewards(stamped, redeemed) {
  const wrap = el('rewards');
  wrap.replaceChildren();

  const unlocked = card.milestones.filter((slot) => stamped.has(slot) && !redeemed.has(slot));

  if (!unlocked.length) {
    wrap.hidden = true;
    return;
  }

  unlocked.forEach((slot) => {
    const isDrink = slot === 16;
    const item = document.createElement('div');
    item.className = 'reward' + (isDrink ? ' is-drink' : '');

    const copy = document.createElement('div');
    const title = document.createElement('h3');
    title.className = 'reward-title';
    title.textContent = isDrink ? 'Free drink unlocked' : 'Free upsize unlocked';
    const sub = document.createElement('p');
    sub.className = 'reward-sub';
    sub.textContent = 'Show this to staff to claim it.';
    copy.append(title, sub);

    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'btn btn-sm';
    cta.textContent = 'Redeem';
    cta.addEventListener('click', () => openReward(slot));

    item.append(copy, cta);
    wrap.appendChild(item);
  });

  wrap.hidden = false;
}

function renderFine() {
  const text = el('fine-text');
  const button = el('phone-btn');

  if (card.phone) {
    text.textContent = `Recovery phone: ${card.phone}.`;
    button.textContent = 'Change number';
  } else {
    text.textContent = 'This card is saved on this device.';
    button.textContent = 'Add a phone number for recovery';
  }
}

/* ---------------------------------------------------------------- slots */

function onSlot(slot) {
  if (busy) return;

  const isStamped = card.stamps.includes(slot);
  const isRedeemed = card.redemptions.includes(slot);

  if (isStamped) {
    if (card.milestones.includes(slot) && !isRedeemed) {
      openReward(slot);
      return;
    }
    toast(`Slot ${slot} is already stamped.`);
    return;
  }

  const next = card.stamps.length + 1;
  if (slot !== next) {
    if (slot === 8) toast('Stamp the first 7 slots to unlock your free upsize.');
    else if (slot === 16) toast('Stamp all 15 slots before it to unlock your free drink.');
    else toast(`Stamp slot ${next} first.`);
    return;
  }

  openCode(slot);
}

/* ------------------------------------------------------------ code modal */

let codeSlot = null;

function openCode(slot) {
  codeSlot = slot;
  el('code-slot').textContent = String(slot);
  el('code-input').value = '';
  el('code-error').hidden = true;
  el('code-submit').disabled = false;
  el('code-submit').textContent = 'Validate & stamp';
  el('code-dialog').showModal();
  setTimeout(() => el('code-input').focus(), 60);
}

async function submitCode(event) {
  event.preventDefault();
  if (busy) return;

  const code = el('code-input').value.replace(/\D/g, '').slice(0, 7);
  const errorEl = el('code-error');

  if (code.length !== 7) {
    errorEl.textContent = 'Enter the full 7-digit code.';
    errorEl.hidden = false;
    return;
  }

  busy = true;
  errorEl.hidden = true;
  el('code-submit').disabled = true;
  el('code-submit').textContent = 'Checking…';

  try {
    card = await api('/stamp', { method: 'POST', body: { cardId: card.id, slot: codeSlot, code } });
    const stampedSlot = codeSlot;
    closeDialog(el('code-dialog'));
    render(stampedSlot);

    if (card.milestones.includes(stampedSlot)) openReward(stampedSlot);
    else toast(`Slot ${stampedSlot} stamped. ${card.total - card.stamps.length} to go.`);
  } catch (err) {
    if (err.data && err.data.card) {
      card = err.data.card;
      render();
    }
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    el('code-input').select();
  } finally {
    busy = false;
    el('code-submit').disabled = false;
    el('code-submit').textContent = 'Validate & stamp';
  }
}

/* ------------------------------------------------------------ rewards */

let rewardSlot = null;

function openReward(slot) {
  rewardSlot = slot;
  const isDrink = slot === 16;

  el('reward-title').textContent = isDrink ? 'Free drink' : 'Free upsize';
  el('reward-sub').textContent = 'Show this screen to staff. They will tap the button once it is handed over.';
  el('reward-claim').disabled = false;
  el('reward-claim').textContent = 'Mark as redeemed';
  el('reward-dialog').showModal();
}

async function claimReward() {
  if (busy) return;
  busy = true;
  el('reward-claim').disabled = true;
  el('reward-claim').textContent = 'Redeeming…';

  try {
    card = await api(`/card/${card.id}/redeem`, { method: 'POST', body: { milestone: rewardSlot } });
    closeDialog(el('reward-dialog'));
    render();
    toast(
      card.stamps.length === card.total
        ? 'Enjoy! You can reset the card for a fresh one.'
        : 'Enjoy your reward.'
    );
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
    el('reward-claim').disabled = false;
    el('reward-claim').textContent = 'Mark as redeemed';
  }
}

/* --------------------------------------------------------------- reset */

function openReset() {
  el('reset-confirm').disabled = false;
  el('reset-confirm').textContent = 'Yes, reset the card';
  el('reset-dialog').showModal();
}

async function confirmReset() {
  if (busy) return;
  busy = true;
  el('reset-confirm').disabled = true;
  el('reset-confirm').textContent = 'Resetting…';

  try {
    card = await api(`/card/${card.id}/reset`, { method: 'POST', body: {} });
    closeDialog(el('reset-dialog'));
    render();
    toast('Fresh card. 16 stamps to go.');
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
    el('reset-confirm').disabled = false;
    el('reset-confirm').textContent = 'Yes, reset the card';
  }
}

/* ------------------------------------------------------------- tutorial */

const STEPS = [
  {
    title: 'Your card lives here',
    text: 'Add this page to your home screen and it opens like an app — no download, no sign-up.',
  },
  {
    title: 'Earn a stamp',
    text: 'Buy any drink and the barista hands you a slip with a 7-digit code. Tap the next empty slot and enter it.',
  },
  {
    title: 'Unlock rewards',
    text: 'Slot 8 gives you a free upsize, slot 16 gives you a free drink. Slots fill in order so every card is fair.',
  },
  {
    title: 'Start again',
    text: 'When all 16 are stamped, claim your free drink and reset the card to begin a new one.',
  },
];

let howStep = 0;

function openHow(auto = false) {
  howStep = 0;
  renderHow();
  el('how-dialog').dataset.auto = auto ? '1' : '';
  el('how-dialog').showModal();
}

function renderHow() {
  const step = STEPS[howStep];
  el('how-title').textContent = step.title;
  el('how-text').textContent = step.text;
  el('how-next').textContent = howStep === STEPS.length - 1 ? 'Start collecting' : 'Next';

  const dots = el('how-dots');
  dots.replaceChildren();
  STEPS.forEach((_, index) => {
    const dot = document.createElement('i');
    if (index === howStep) dot.className = 'on';
    dots.appendChild(dot);
  });
}

function nextHow() {
  if (howStep < STEPS.length - 1) {
    howStep += 1;
    renderHow();
  } else {
    closeHow();
  }
}

function closeHow() {
  closeDialog(el('how-dialog'));
  localStorage.setItem(TUT_KEY, '1');
}

/* ----------------------------------------------------------- phone modal */

function openPhone() {
  el('phone-input').value = card.phone || '';
  el('phone-error').hidden = true;
  el('phone-dialog').showModal();
  setTimeout(() => el('phone-input').focus(), 60);
}

async function savePhone(event) {
  event.preventDefault();
  const phone = el('phone-input').value.trim();
  const errorEl = el('phone-error');
  errorEl.hidden = true;

  try {
    card = await api(`/card/${card.id}`, { method: 'PATCH', body: { phone } });
    closeDialog(el('phone-dialog'));
    render();
    toast(phone ? 'Phone saved. Staff can find your card with it.' : 'Phone number removed.');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}

async function copyCardLink() {
  const link = `${location.origin}/?card=${encodeURIComponent(card.id)}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Card link copied. Open it on another device to move this card.');
  } catch {
    window.prompt('Copy this link:', link);
  }
}

/* -------------------------------------------------------------- helpers */

function closeDialog(dialog) {
  if (dialog && dialog.open) dialog.close();
}

function toast(message) {
  const node = el('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 3200);
}

/* ---------------------------------------------------------------- wiring */

el('code-form').addEventListener('submit', submitCode);
el('reward-claim').addEventListener('click', claimReward);
el('reset-btn').addEventListener('click', openReset);
el('reset-confirm').addEventListener('click', confirmReset);
el('how-btn').addEventListener('click', () => openHow());
el('how-next').addEventListener('click', nextHow);
el('how-skip').addEventListener('click', closeHow);
el('phone-btn').addEventListener('click', openPhone);
el('phone-form').addEventListener('submit', savePhone);
el('copy-link').addEventListener('click', copyCardLink);

document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => closeDialog(button.closest('dialog')));
});

el('code-input').addEventListener('input', (event) => {
  event.target.value = event.target.value.replace(/\D/g, '').slice(0, 7);
});

el('how-dialog').addEventListener('close', () => {
  localStorage.setItem(TUT_KEY, '1');
});

boot();
