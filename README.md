# Coftea Cafe — Ipil · Virtual Loyalty Card

A real, server-side loyalty card: customers collect 16 stamps by entering one-time 7-digit codes that staff hand out with each drink. Slot 8 is a free upsize, slot 16 is a free drink. Staff generate codes in batches and print the codes on POS receipt paper.

**Stack:** Cloudflare Pages (static + `_worker.js`) · D1 (SQLite) · vanilla JS · no build step.

---

## 1. What is in here

```
coftea-loyalty/
├── public/                  everything that gets deployed
│   ├── index.html           customer card
│   ├── admin.html           staff dashboard + printing
│   ├── sa-7k2f9q3x.html     hidden superadmin page (staff tokens only)
│   ├── card.js              customer logic
│   ├── admin.js             admin logic
│   ├── sa-7k2f9q3x.js       superadmin logic
│   ├── styles.css           all styles, including print CSS
│   ├── manifest.json        "add to home screen" metadata
│   ├── _worker.js           the entire API + static asset fallback
│   └── _headers             security headers
├── migrations/
│   ├── 0001_init.sql        D1 schema
│   ├── 0002_staff.sql       staff token table
│   └── 0003_settings.sql    key/value settings (superadmin hash lives here)
├── scripts/
│   └── smoke-test.mjs       end-to-end test of the whole loop
└── wrangler.toml            Pages + D1 binding (CLI/local only)
```

Data model: `batches` → `codes` → `stamps` / `cards` / `redemptions`. Cards keep a `cycle` counter so resetting a full card starts a new cycle without deleting history.

---

## 2. Run it on your machine

Requirements: Node 18+ and a Cloudflare account (only needed for deploying).

```bash
cd D:\Coffee\coftea-loyalty
npm install
npm run db:migrate      # creates the local SQLite tables
npm run dev             # http://localhost:8788
```

Open:

- Customer card — <http://localhost:8788/>
- Staff page — <http://localhost:8788/admin.html>, token `coftea-dev-token` (from `.dev.vars`)

Run the full flow as a test:

```bash
npm run test:smoke
```

It creates a card, generates a batch, stamps all 16 slots, checks that a code cannot be reused, checks out-of-order refusal, redeems both rewards, resets the card, verifies staff lookup, and exercises the whole superadmin/staff-token lifecycle (create, pause, resume, rotate, delete, superadmin-token rotation, plus the legacy token). 58 checks.

Local data lives in `.wrangler/state`. Delete that folder to start fresh.

---

## 3. Deploy to Cloudflare

Two ways, same result. Pick one.

### Option A — dashboard only (no commands)

1. **Create the database.** Dashboard → **Storage & Databases → D1 SQL Database → Create**, name it `coftea-loyalty`.
2. **Create the tables.** Open the database → **Console** tab → paste the whole of `migrations/0001_init.sql` → **Execute**. If it only runs the first statement, run each `CREATE` block separately.
3. **Create the project.** **Workers & Pages → Create → Pages → Upload assets**, name it `coftea-loyalty`, and upload the **contents of `public/`** — drag the folder itself, or a zip whose root contains `index.html`. `_worker.js` must sit at the top level of the upload; dashboard uploads run it but do not compile a `functions/` folder.
4. **Bind the database.** Project → **Settings → Bindings → Add → D1 database**, variable name `DB`, select `coftea-loyalty`.
5. **Set the admin token.** **Settings → Variables and Secrets → Add**, name `ADMIN_TOKEN`, type **Secret**, value = a long random string.
6. **Upload again.** **Deployments → Create deployment**, upload `public/` once more — bindings and secrets only take effect on deployments created after they are added.
7. Open the URL, stamp one code, then sign in at `/admin`.

Dashboard upload limits are 1,000 files (this project uses 10) and 25 MiB per file.

### Option B — CLI

```bash
npx wrangler login

# 1. create the database
npx wrangler d1 create coftea-loyalty
```

Copy the `database_id` it prints into `wrangler.toml`, replacing `00000000-0000-0000-0000-000000000000`.

```bash
# 2. create the tables in the real database
npx wrangler d1 migrations apply coftea-loyalty --remote

# 3. create the Pages project (once)
npx wrangler pages project create coftea-loyalty --production-branch main

# 4. set the admin token — use a long random string, not the dev one
npx wrangler pages secret put ADMIN_TOKEN --project-name coftea-loyalty

# 5. deploy (run twice if the secret was set after the first deploy)
npx wrangler pages deploy public --project-name coftea-loyalty
```

You get `https://coftea-loyalty.pages.dev`. Later changes deploy with the same last command.

To check the schema landed:

```bash
npx wrangler d1 execute coftea-loyalty --remote --command "SELECT COUNT(*) FROM codes"
```

### Option C — GitHub + Pages Git integration

1. Push this repository to GitHub (private recommended).
2. Create the D1 database in the dashboard, then put its ID into `wrangler.toml` **before the first deployment**. When that file is present, Pages treats it as the source of truth for bindings and the dashboard fields become read-only; the placeholder ID would fail the deploy.
3. Apply `migrations/0001_init.sql` in the D1 console (step 2 of Option A).
4. **Workers & Pages → Create → Pages → Connect to Git**, pick the repository, then:
   - Framework preset: **None**
   - Build command: **leave empty**
   - Build output directory: **`public`**
5. Project → **Settings → Variables and Secrets → Add**, name `ADMIN_TOKEN`, type **Secret**. Create a new deployment (or push) so it takes effect.
6. Every push to `main` deploys. The D1 binding comes from `wrangler.toml` — do not add a second one in the dashboard.
7. Preview deployments use the same database. Don't test destructive changes on a branch preview.

### Custom domain (optional)

Cloudflare dashboard → Workers & Pages → `coftea-loyalty` → Custom domains → add `loyalty.cofteacafe.ph` (or whichever domain is on Cloudflare).

---

## 4. First day of operation

1. Open `/admin.html`, sign in with the admin token.
2. **Generate a code batch**: label `November 2026`, 500 codes, 90 days.
3. Set **Codes to print** (`1` by default). Type the number or use the `−`/`+` buttons; the arrow opens a scrollable number list up to the batch's available codes.
4. Print either:
   - that many codes from a batch — **Print** on the batch row (takes the first unused codes in the batch), or
   - only specific codes — tick codes in the **Codes** table and press **Print selected**. Used codes cannot be ticked.
5. Printing is codes only: **four across**, centred with equal 2 mm margins left and right, with the digits automatically enlarged to the widest size each cell allows (~16 pt on 80 mm). No page width is forced, so the grid fills the paper the printer reports — it cannot leave a blank strip on the roll. Rows are generously spaced with one thin grey cut line and no vertical or outer lines; long runs continue onto the next page. In the print dialog pick your receipt printer, **100% scale**, and set margins to **None**.
6. Cut the grid into individual codes and hand one per drink.
7. Print a QR code pointing at the site root and put it on the counter / table tent.
8. Customer scans, gets a card instantly (saved on their phone), and types the code into the next slot.

**Daily overview:** the Overview panel defaults to today. Use the calendar chip for presets (Today, Yesterday, This month, This year, Last month) or click two dates for a custom range. Used codes, new cards, stamps and rewards follow the range; codes and unused stock are always all-time totals. Each card is clickable: Codes/Unused/Used jump to the Codes table with that filter applied, and New cards/Stamps/Rewards jump to the customer card list.

**Find a customer:** the card table lists the 5 most recent cards; search by phone number or card id, then **Open** a card to see every stamp (slot, code, time) and claimed reward for the current cycle, plus lifetime totals.

**Resetting codes:** the Reset codes panel can delete all unused codes (keeps used ones and their history) or delete every code and batch. Both ask for a typed confirmation and never touch cards or stamps.

**How long a batch lasts:** one code = one stamp, so 500 codes = 500 drinks ≈ 31 complete cards (31 free drinks + 31 upsizes). At 50 drinks a day that is about 10 days. Generate batches ahead of time; old batches keep working until they expire, so nothing you have printed goes dead when a new batch is made.

---

## 5. Superadmin and staff tokens

The dashboard accepts two kinds of sign-in: the **master admin token** (`ADMIN_TOKEN` secret) and per-staff tokens. The **superadmin** exists only to manage those staff tokens — create, new password, pause, resume, delete — and to rotate its own token. The superadmin token cannot see or change codes, cards, stats, or anything else, and staff tokens cannot touch superadmin routes.

- The superadmin page is deliberately unlinked: open `/sa-7k2f9q3x.html` directly (add `.html`). Nobody can find it from the site; don't bookmark it on shared machines, don't mention the address around staff.
- Sign in with the superadmin token. The token's **SHA-256 hash** lives in the database (`settings` table, key `superadmin_hash`) — the first successful sign-in writes it there automatically, and it is never stored in code or plaintext. The hash baked into `public/_worker.js` (`SUPERADMIN_HASH`) is only the factory default used until the first sign-in. Staff tokens are also stored hashed. A new staff token is shown **once** at creation; copy it and hand it over in private.
- **Change superadmin token** (on the superadmin page): type the new token, confirm, and every superadmin session is signed out — the old token stops working immediately. No deploy needed.
- **Pause** blocks a staff token immediately (e.g. staff leaves); **Resume** re-enables it; **New password** rotates it and kills the old one (there is a safety check on rotating the last active token); **Delete** is permanent.
- The legacy `ADMIN_TOKEN` secret keeps working alongside staff tokens as a master key — keep it in the owner’s password manager, not on the counter.
- Failed superadmin sign-ins are rate-limited (5 per IP per 10 minutes, separate from the stamp-code limit); one successful sign-in clears that IP's counter.

**Self-hosters — set your own superadmin token before going live:** sign in at `/sa-7k2f9q3x.html` with the default token from the repo's `SUPERADMIN_HASH` (ask the repo owner for it, or compute it), then use **Change superadmin token**. From that moment only your token works. You can verify the change by signing out and confirming the old token is refused.

---

## 6. Rules the server enforces

| Rule | Where |
|---|---|
| Every slot needs an unused, unexpired 7-digit code | `stampSlot` |
| A code can only ever be spent once, atomically | single `UPDATE ... WHERE used_at IS NULL` |
| Slots fill in order (slot N needs N−1) | `stampSlot` |
| Wrong codes are rate-limited: 8 per card / 10 min, 40 per IP | `attempts` table |
| Reset only when all 16 slots are stamped | `resetCard` |
| Rewards (8, 16) must be unlocked and can be claimed once per cycle | `redeemReward` |
| Admin routes accept the master token or an active staff token | `requireStaff` |
| Superadmin routes accept only the superadmin token, 5 fails / IP / 10 min | `requireSuper` |
| Staff tokens are stored and compared as SHA-256 hashes | `staff_tokens` table |

Codes are never hashed — a 7-digit space is brute-forceable from a hash anyway, so the real defences are rate limits and the server-side pool.

---

## 7. Printing notes

- Paper is POS receipt roll: `58 mm` (small) or `80 mm` (standard). Set the printer's paper width to match, and print at 100% with no margins.
- The printout is codes only — no café name, no instructions, no expiry. Codes run across the paper in a clean, centred grid: **four across**, 2 mm margins each side, no vertical or outer lines, and a single light rule under each row as a cutting guide. The digits are sized automatically to the widest that fits a cell (roughly 16 pt on 80 mm with a condensed face), with 3.8 mm of breathing room above and below each row.
- There is no receipt-width setting: the grid measures the page the printer reports and fills it. The same sheet prints correctly on 80 mm, 58 mm or A4 paper; only the digit size changes.
- Long batches simply flow onto the next page; rows never split in half.
- Printing a batch produces the number of codes chosen in **Codes to print** (default 1); printing a selection produces one cell per ticked code. Hand over exactly the codes you printed.
- The dashboard warns you if you try to print an expired batch (its codes would be refused).
- "Include used codes" exists for reprints after a paper jam; normally leave it off.
- If the browser's print preview shows a full A4 page, set the printer's paper size to the receipt roll (58 mm or 80 mm) rather than A4. The grid stretches to whatever paper is used, so on A4 the codes print very large instead of leaving blank space.
- Printing a single code (the default) prints it across the full paper width, not as one small cell.

---

## 8. Backups

D1 has point-in-time restore, but keep a human-readable copy:

```bash
npx wrangler d1 export coftea-loyalty --remote --output backups/coftea-$(date +%F).sql
```

Do this monthly and after every new batch. On Windows PowerShell, use `"backups/coftea-$(Get-Date -Format yyyy-MM-dd).sql"`.

---

## 9. Decisions you may want to revisit

- **The 16th slot needs a code.** The build matches your original brief: a code per stamp, rewards unlocked at 8 and 16. If you'd rather the free drink fill itself when slot 15 is stamped, that is a small change in `stampSlot` (allow slot 16 without burning a code).
- **Codes are bearer tokens.** Whoever holds a slip can stamp it. That is the point — it is the proof of purchase. Staff should only hand slips out against a purchase.
- **No customer accounts.** The card id lives on the phone; a phone number can be saved for staff lookup, and "Copy card link" moves a card to a new device. There is no password, by design — the reward is worth less than the friction of a login.
- **Staff sign-in.** Each staff member can have their own token managed by the superadmin (section 5); the master `ADMIN_TOKEN` remains as the owner’s fallback.

---

## 10. Known limits

- Google Fonts is loaded from a CDN. If you want fully offline rendering, drop licensed `Hatton` and `Raleway` woff2 files into `public/fonts/`, add `@font-face` rules to `styles.css`, and remove the Google link. Hatton is commercial — you need the licence.
- No stamp reversal or refund tool yet. A mis-stamped slot can only be fixed with a database update.
- No push notifications or email; the phone number is for staff lookup only.
- No multi-branch support. Add a `branch_id` to `batches` if that day comes.

---

## 11. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `D1_ERROR: no such table` | migrations not applied: `npm run db:migrate` (local) or run `migrations/0001_init.sql` in the D1 console / `--remote` (production) |
| Stamping returns 404 or `Not found` | the upload did not include `public/_worker.js` at its top level — upload the contents of `public/`, not the project folder |
| Admin says "Admin token is not configured" | `.dev.vars` missing locally, or the secret was added after the last deployment — deploy again |
| Bindings empty / `env.DB` undefined | the D1 binding was added after the last deployment — create a new deployment (dashboard) or redeploy (CLI) |
| Every code says invalid | the code's batch expired, or you are testing against a different database than the one that generated them |
| Print sheet is blank | wait for the code grid to build, then confirm the print dialog opened; if the preview is A4-sized, set the printer paper to 58 mm / 80 mm receipt paper |
| Code refuses to stamp | slot order: the card only accepts the next slot in sequence |
