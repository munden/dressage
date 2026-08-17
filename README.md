# 🐴 Pixel Passage

**A AAA-polished, pixel-art dressage judging & rider notebook app — built for Donna Shar, with zero npm dependencies and unbridled enthusiasm.**

Judge a test at a full-speed one-tap canter, keep a rider's notebook worth reining about, run the show calendar, and email pixel-branded scoresheets — all from one tiny Node server you could balance on a saddle horn. No frameworks. No `node_modules`. No foalin' around.

---

## 🏇 Quick start (30 seconds, no lunging required)

```bash
git clone <your-repo-url> dressage
cd dressage
node server/server.js
```

Then open **http://localhost:8420** and enter at A. That's it — no `npm install`, because there is *nothing to install*. Node 22+ is the whole herd.

### Seeded logins (change these before the show!)

| Username | Password    | Role  | Notes |
|----------|-------------|-------|-------|
| `donna`  | `piaffe!`   | admin | Forced password change on first login — new reins required |
| `judge`  | `halt-at-x` | judge | Scoring, tests, events, reports |
| `rider`  | `free-walk` | rider | Personal notebook + calendar |

The server prints these at first boot with a stern warning. Heed it — a barn is only as secure as its gate.

---

## 🏆 Feature tour

### The Judge's Booth — speed is the contract
One movement at a time, a **giant score pad** (4–8 front and center, half-point toggle, or long-press any key for +½), and every tap scores *and* auto-advances with an undo toast. Quick-note chips ("obedient", "above bit", "20m too small") append judge shorthand without typing. Errors of course are one button (−2, −4, elimination — the bell confirms before ringing). Scores autosave to the server as you go, live final % with coefficients, then **Sign & Finalize** for a confetti-worthy result screen with HTML/CSV scoresheets and one-tap email. In-progress rides resume right where you left them. There's a test editor too, with factory reset to USDF-style defaults (Intro A → First 3, plus the Pixel Freestyle).

### The Rider's Notebook
Notes with date, horse, title, tags, and a 1–5 **pixel horseshoe mood rating**. Search, tag filters, a "Ride recap" template (Warmup / Work / Wins / Homework), quick-note chips, and stable stats — streaks, herd size, average mood. Your notes are yours alone; admins excepted, no peeking.

### Calendar
Month grid with ring-colored pips (Ring A blue, Ring B green, warm-up gold, clinic purple), day sheets with the order of go, a week-list view for phones, and an event editor with an entries editor for judges/admins. The **downloads bar** serves a real `.ics` for your phone, a printable color-coded schedule, and a CSV. A mini calendar lives in the sidebar on wide screens.

### The Stable Office (admin)
Users (lockout status + one-tap unlock, password resets, role changes — can't delete the last admin, someone has to hold the reins), SMTP settings with a **Test connection** button, report batching by event / date-range / hand-pick, a filterable **audit log** of every hoofprint, and app settings (show name, the trotting-horse page transition, and the all-important pun level: *reined-in* or *unbridled*).

---

## 🥚 Easter egg hints (no full spoilers — that would be a gait fault)

- The logo appreciates *persistent* affection.
- Old-school gamers know a code that summons the cavalry. 🎮
- Type the thing every test ends with, anywhere, and the whole app obeys.
- A perfect 10 doesn't go uncelebrated.
- Some horseshoes are luckier than others — give one a spin.
- Roughly one toast in twenty has… hooves.

---

## 🚀 Deploying to a DigitalOcean droplet (Ubuntu)

A $6 droplet carries this app like a pony carries a ribbon. Zero dependencies means deployment is `git clone` and a systemd unit.

**1. Install Node 22 (NodeSource):**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**2. Fetch the app:**

```bash
sudo git clone <your-repo-url> /opt/dressage
```

**3. Create the systemd unit** at `/etc/systemd/system/dressage.service`:

```ini
[Unit]
Description=Pixel Passage dressage app
After=network.target

[Service]
WorkingDirectory=/opt/dressage
ExecStart=/usr/bin/node server/server.js
Environment=PORT=80
Restart=always
RestartSec=3
# Port 80 needs either root or this capability:
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dressage
```

Open `http://your-droplet-ip/`, log in as `donna`, and change the seeded passwords before anyone else finds the gate.

**HTTPS:** for a proper bridle path, put [Caddy](https://caddyserver.com) in front — it fetches and renews Let's Encrypt certificates automatically. Set `PORT=8420` in the unit above and use a two-line `Caddyfile`:

```
dressage.example.com {
    reverse_proxy localhost:8420
}
```

**Backups:** every scrap of data — users, scores, notes, settings, audit log, and the mail outbox — lives in **`server/data/`** (a JSON database plus `.eml` files). Back up that one folder and you've backed up the whole barn:

```bash
tar czf dressage-backup-$(date +%F).tgz -C /opt/dressage server/data
```

---

## 🔧 Architecture notes (for the curious groom)

- **Genuinely zero dependencies.** `package.json` has no `dependencies`, no `devDependencies`, nothing. The server is plain `node:http`; the SMTP client is hand-rolled on `node:net`/`node:tls` (STARTTLS, implicit TLS, AUTH LOGIN/PLAIN, dot-stuffing and all); the frontend is classic-script vanilla JS. The only external request the browser makes is Google Fonts.
- **Passwords:** scrypt with a per-user 16-byte random salt, verified with `crypto.timingSafeEqual`. 5 failed attempts locks the stall for 15 minutes; a per-IP damper (20 attempts / 10 min → 429) blunts brute force. Sessions are 32-byte random tokens in an `HttpOnly; SameSite=Strict` cookie with a sliding 7-day expiry.
- **Audit log:** every login (success, fail, lockout), logout, create/update/delete across users, tests, events, rides, notes and settings, every password change and report send — capped at 5,000 entries, newest first, filterable in the admin UI. Secrets never appear in it.
- **Mail never dies:** if SMTP isn't configured or the handshake fails, the fully-formed email is written as a `.eml` file to `server/data/outbox/` and the API says so honestly (`{sent:false, outbox:"…"}`). Open it in any mail client and send it by hand, or fix SMTP and resend. Straight to the hay bale, one way or another.
- **Storage:** a single JSON file (`server/data/db.json`) with atomic tmp+rename writes, debounced saves, and a synchronous flush on exit — Ctrl+C performs a square halt, never a bolt.
- **Scoring math:** movement and collective points carry coefficients; errors of course deduct −2 / −6 total / elimination; final % is points ÷ max × 100 to three decimals — computed identically in the judge UI and in the printed reports.

*Halt at X. Salute. 🫡*
