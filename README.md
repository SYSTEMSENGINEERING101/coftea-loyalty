# Coftea Cafe — Ipil · Virtual Loyalty Card

A real, server-side loyalty card: customers collect 16 stamps by entering one-time 7-digit codes that staff hand out with each drink. Slot 8 is a free upsize, slot 16 is a free drink. Staff generate codes in batches and print POS-sized slips.

**Stack:** Cloudflare Pages (static + `_worker.js`) · D1 (SQLite) · vanilla JS · no build step.

---

## 1. What is in here

```
coftea-loyalty/
├── public/                  everything that gets deployed
│   ├── index.html           customer card
│   ├── admin.html           staff dashboard + printing
│   ├── card.js              customer logic
│   ├── admin.js             admin logic
│   ├── styles.css           all styles, including print CSS
│   ├── manifest.json        "add to home screen" metadata
│   ├── _worker.js           the entire API + static asset fallback
│   └── _headers             security headers
├── migrations/
│   └── 0001_init.sql        D1 schema
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

It creates a card, generates a batch, stamps all 16 slots, checks that a code cannot be reused, checks out-of-order refusal, redeems both rewards, resets the card, and verifies staff lookup. 23 checks.

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
3. Pick a **receipt width**: `58 mm` for a small POS printer or `80 mm` for a standard one.
4. Set **Slips to print** (`1` by default). Type the number or use the `−`/`+` buttons; the arrow opens a scrollable number list up to the batch's available codes.
5. Print either:
   - that many slips from a batch — **Print** on the batch row (takes the first unused codes in the batch), or
   - only specific slips — tick codes in the **Codes** table and press **Print selected**. Used codes cannot be ticked.
6. Each slip is a compact receipt block — café name, the 7-digit code, the site address and the expiry — about 28 mm tall, one after another with a dashed cut line between them. In the print dialog pick your receipt printer, **100% scale**, and turn off headers and footers.
7. Hand one slip per drink.
8. Print a QR code pointing at the site root and put it on the counter / table tent.
9. Customer scans, gets a card instantly (saved on their phone), and types the code into the next slot.

**Daily overview:** the Overview panel defaults to today. Use the calendar chip for presets (Today, Yesterday, This month, This year, Last month) or click two dates for a custom range. Used codes, new cards, stamps and rewards follow the range; codes and unused stock are always all-time totals. Each card is clickable: Codes/Unused/Used jump to the Codes table with that filter applied, and New cards/Stamps/Rewards jump to the customer card list.

**Find a customer:** the card table lists the 5 most recent cards; search by phone number or card id, then **Open** a card to see every stamp (slot, code, time) and claimed reward for the current cycle, plus lifetime totals.

**Resetting codes:** the Reset codes panel can delete all unused codes (keeps used ones and their history) or delete every code and batch. Both ask for a typed confirmation and never touch cards or stamps.

**How long a batch lasts:** one code = one stamp, so 500 codes = 500 drinks ≈ 31 complete cards (31 free drinks + 31 upsizes). At 50 drinks a day that is about 10 days. Generate batches ahead of time; old batches keep working until they expire, so nothing you have printed goes dead when a new batch is made.

---

## 5. Rules the server enforces

| Rule | Where |
|---|---|
| Every slot needs an unused, unexpired 7-digit code | `stampSlot` |
| A code can only ever be spent once, atomically | single `UPDATE ... WHERE used_at IS NULL` |
| Slots fill in order (slot N needs N−1) | `stampSlot` |
| Wrong codes are rate-limited: 8 per card / 10 min, 40 per IP | `attempts` table |
| Reset only when all 16 slots are stamped | `resetCard` |
| Rewards (8, 16) must be unlocked and can be claimed once per cycle | `redeemReward` |
| Admin routes require `Authorization: Bearer <ADMIN_TOKEN>` | `requireAdmin` |

Codes are never hashed — a 7-digit space is brute-forceable from a hash anyway, so the real defences are rate limits and the server-side pool.

---

## 6. Printing notes

- Slips are sized for POS receipt paper: `58 mm` (small) or `80 mm` (standard). Set the printer's paper width to match, and print at 100% with no margins.
- Each slip is a small receipt block, roughly 28 mm tall: café name, "Enter your 7-digit code", the code, the one-line rule with the site address, and the batch/expiry footer. Slips are separated by a dashed line and print continuously instead of one page per slip.
- Printing a batch produces the number of slips chosen in **Slips to print** (one code per slip, default 1); printing a selection produces one slip per ticked code. Hand over exactly the slips you printed.
- The dashboard warns you if you try to print an expired batch (its codes would be refused).
- "Include used codes" exists for reprints after a paper jam; normally leave it off.
- If the browser's print preview shows a full A4 page, check that the printer's paper size is set to the receipt roll (58 mm or 80 mm) rather than A4.

---

## 7. Backups

D1 has point-in-time restore, but keep a human-readable copy:

```bash
npx wrangler d1 export coftea-loyalty --remote --output backups/coftea-$(date +%F).sql
```

Do this monthly and after every new batch. On Windows PowerShell, use `"backups/coftea-$(Get-Date -Format yyyy-MM-dd).sql"`.

---

## 8. Decisions you may want to revisit

- **The 16th slot needs a code.** The build matches your original brief: a code per stamp, rewards unlocked at 8 and 16. If you'd rather the free drink fill itself when slot 15 is stamped, that is a small change in `stampSlot` (allow slot 16 without burning a code).
- **Codes are bearer tokens.** Whoever holds a slip can stamp it. That is the point — it is the proof of purchase. Staff should only hand slips out against a purchase.
- **No customer accounts.** The card id lives on the phone; a phone number can be saved for staff lookup, and "Copy card link" moves a card to a new device. There is no password, by design — the reward is worth less than the friction of a login.
- **One admin token, shared.** Fine for a small shop. If several staff need different access, add Cloudflare Access in front of `/admin.html`.

---

## 9. Known limits

- Google Fonts is loaded from a CDN. If you want fully offline rendering, drop licensed `Hatton` and `Raleway` woff2 files into `public/fonts/`, add `@font-face` rules to `styles.css`, and remove the Google link. Hatton is commercial — you need the licence.
- No stamp reversal or refund tool yet. A mis-stamped slot can only be fixed with a database update.
- No push notifications or email; the phone number is for staff lookup only.
- No multi-branch support. Add a `branch_id` to `batches` if that day comes.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `D1_ERROR: no such table` | migrations not applied: `npm run db:migrate` (local) or run `migrations/0001_init.sql` in the D1 console / `--remote` (production) |
| Stamping returns 404 or `Not found` | the upload did not include `public/_worker.js` at its top level — upload the contents of `public/`, not the project folder |
| Admin says "Admin token is not configured" | `.dev.vars` missing locally, or the secret was added after the last deployment — deploy again |
| Bindings empty / `env.DB` undefined | the D1 binding was added after the last deployment — create a new deployment (dashboard) or redeploy (CLI) |
| Every code says invalid | the code's batch expired, or you are testing against a different database than the one that generated them |
| Print sheet is blank | wait for the slip list to build, then confirm the print dialog opened; if the preview is A4-sized, set the printer paper to 58 mm / 80 mm receipt paper |
| Code refuses to stamp | slot order: the card only accepts the next slot in sequence |
