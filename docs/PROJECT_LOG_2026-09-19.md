markdown

# ProcureNepal — Daily Progress Log

**Date:** 2026-09-19 (Saturday)
**Session:** Day 1 of 15-day sprint
**Time Invested:** ~6 hours
**Machine:** Mac M2, 8 GB RAM, macOS 26.6.2 (Tahoe)
**Operator:** Bikash Neupane (github.com/bikashneupane1293)

---

## 🎯 Session Goal

Complete Phase 1 (Environment Setup) and Phase 2 (GitHub Repos) so that Day 2 can begin backend development immediately.

**Outcome:** ✅ Both phases completed. Backend scaffold started (Phase 3).

---

## ✅ ACCOMPLISHED TODAY

### Phase 1 — Environment Setup (100% Complete)

| # | Task | Result |
|---|------|--------|
| 1.1 | Homebrew | Already installed — 6.0.6 |
| 1.2 | Git | Already installed — 2.50.1 (Apple Git-155) |
| 1.3 | Move project out of Google Drive | 166 files copied to `~/ProcureNepal` |
| 1.4 | Create `.zshrc` | PATH, NVM, Python, aliases configured |
| 1.5 | nvm | Installed — 0.40.7 |
| 1.6 | Node.js 24 LTS | Installed — v24.21.0 |
| 1.7 | npm | Installed — 11.19.0 |
| 1.8 | NestJS CLI | Installed — 12.0.3 |
| 1.9 | Angular CLI | Installed — 22.1.8 |
| 1.10 | OrbStack | Installed — 2.2.3 (Docker 29.4.0, Compose v5.1.2) |
| 1.11 | Python 3.12 | Installed — 3.12.14 |
| 1.12 | Ollama | Installed — 0.34.2 |
| 1.13 | Ollama models | `qwen2.5-coder:1.5b` (986 MB), `nomic-embed-text` (274 MB) |
| 1.14 | Composer | Installed — 2.10.3 (PHP 8.5.10) |
| 1.15 | WP-CLI | Installed — 2.12.0 |
| 1.16 | rclone | Installed — 1.75.1 |
| 1.17 | Google Drive backup script | Created + tested — `~/ProcureNepal/backup.sh` |
| 1.18 | Antigravity CLI | Fixed — symlinked to `/usr/local/bin/code` |
| 1.19 | Antigravity extensions | 5 installed (Continue.dev SKIPPED — incompatible) |
| 1.20 | Final verification | All tools green ✅ |

### Phase 2 — GitHub Repos (100% Complete)

| # | Task | Result |
|---|------|--------|
| 2.1 | Create 6 GitHub repos | All 6 created as public empty repos |
| 2.2 | Commit scaffold | 100 files, commit `50549af` |
| 2.3 | SSH key setup | ed25519 key generated + added to GitHub |
| 2.4 | Push umbrella repo | Live at github.com/bikashneupane1293/procurenepal-umbrella |
| 2.5 | Profile README | Live at github.com/bikashneupane1293 |
| 2.6 | SSH passphrase cache | Added to macOS Keychain via `ssh-add --apple-use-keychain` |

### Phase 3 — Backend Foundation (Started)

| # | Task | Result |
|---|------|--------|
| 3.0 | Verify scaffold | Discovered all 100 files are empty (0 bytes) |
| 3.1 | Delete empty api/ + web/ | Clean slate ready |
| 3.2 | Scaffold NestJS app | In progress at session end |

---

## 🔧 INSTALLED SOFTWARE (Reference)

Homebrew 6.0.6
Git 2.50.1
nvm 0.40.7
Node.js v24.21.0
npm 11.19.0
NestJS CLI 12.0.3
Angular CLI 22.1.8
OrbStack 2.2.3
Docker 29.4.0
Compose v5.1.2
Python 3.12.14
pip 26.2.1
Ollama 0.34.2
Composer 2.10.3
PHP 8.5.10
WP-CLI 2.12.0
rclone 1.75.1
Antigravity 1.107.0
text


---

## 📁 FILES CREATED / MODIFIED

### In `~/ProcureNepal/`
- `~/ProcureNepal/.gitignore` — Node, Python, OS, IDE excludes
- `~/ProcureNepal/LICENSE` — MIT
- `~/ProcureNepal/README.md` — Project overview
- `~/ProcureNepal/backup.sh` — Google Drive backup script (executable)
- `~/ProcureNepal/docs/` — Placeholder markdown files
- `~/ProcureNepal/infrastructure/` — Placeholder docker/nginx configs
- `~/ProcureNepal/python-engine/` — Placeholder FastAPI files

### In `~/.zshrc`
```bash
eval "$(/opt/homebrew/bin/brew shellenv)"

export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"

export PATH="/opt/homebrew/opt/python@3.12/libexec/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"

alias ll='ls -la'
alias pn='cd ~/ProcureNepal'

export EDITOR='open -a "Antigravity IDE"'

In ~/.ssh/

    id_ed25519 + id_ed25519.pub — SSH key for GitHub

    config — SSH config (existing)

    known_hosts — GitHub fingerprint added

Symlinks

    /usr/local/bin/code → /Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide

Google Drive Backup Structure
text

GoogleDrive-shishir1213@apollointcollege.edu.np/My Drive/
├── ProcureNepal-Backups/    ← backup-YYYYMMDD-HHMMSS/ folders
└── ProcureNepal-Docs/       ← reserved for docs

GitHub Repos Created (all public, empty)

    procurenepal-api

    procurenepal-web

    procurenepal-python-engine

    procurenepal-docs

    procurenepal-infra

    procurenepal-umbrella

    bikashneupane1293 (profile repo, has README)

📦 INSTALLED ANTIGRAVITY EXTENSIONS

    Angular Language Service

    ESLint

    Prettier

    Python

    Docker

Not installed: Continue.dev — confirmed incompatible with Antigravity IDE v1.107.0. Antigravity's built-in AI + terminal ollama run replaces it.
🔑 KEY COMMANDS REFERENCE
Backup project to Google Drive
bash

~/ProcureNepal/backup.sh

Open project in Antigravity IDE
bash

cd ~/ProcureNepal
code .

Run Ollama AI in terminal
bash

ollama run qwen2.5-coder:1.5b "your prompt here"

Push changes to GitHub
bash

cd ~/ProcureNepal
git add .
git commit -m "your message"
git push

Check environment status
bash

node --version && npm --version && python3 --version && docker --version

🐛 ISSUES ENCOUNTERED & FIXED
Issue	Resolution
Project was inside Google Drive (sync chaos)	Moved via rsync to ~/ProcureNepal
code CLI not found	Symlinked antigravity-ide → /usr/local/bin/code
Continue.dev incompatible	Skipped — Antigravity native AI + Ollama used instead
rclone Google Drive OAuth blocked	Abandoned rclone — Google Drive Desktop app used directly
SSH push failed (publickey)	Generated ed25519 key, added to GitHub, cached passphrase
Scaffold files all empty (0 bytes)	Deleted api/ and web/, regenerating with nest new
zsh # comments interpreted as commands	Cosmetic — ignore (paste without comments)
🎯 NEXT SESSION — PICK UP HERE
Session Start Command

Type: "BEGIN TODAY" to resume from this point.
Immediate Next Steps (Phase 3 continued)

    Verify NestJS scaffold created successfully:
    bash

    cd ~/ProcureNepal/api && ls && cat package.json | grep @nestjs/core

    Create infrastructure/docker/docker-compose.yml with:

        PostgreSQL 18 (port 5432)

        Redis 7 (port 6379)

        Healthchecks enabled

    Start containers:
    bash

    cd ~/ProcureNepal/infrastructure/docker
    docker compose up -d
    docker ps

    Write full prisma/schema.prisma (all models: Tenant, User, Subscription, FeatureFlag, Certificate, Tender, Qualification, Audit)

    Run migration:
    bash

    cd ~/ProcureNepal/api
    npx prisma migrate dev --name init

    Apply RLS policies (SQL file at prisma/rls.sql)

    Seed roles + WPI data (prisma/seed.ts)

    Push clean scaffold to GitHub (procurenepal-umbrella)

    Start Phase 4 — Auth + Multi-Tenancy + Feature Flags

📊 15-DAY SPRINT STATUS
Phase	Day	Status
Phase 1 — Environment	Day 1	✅ 100% Complete
Phase 2 — GitHub Repos	Day 2	✅ 100% Complete
Phase 3 — Backend Foundation	Day 3	🟢 30% (scaffold in progress)
Phase 4 — Auth + Multi-Tenancy	Day 4	⬜ Not started
Phase 5 — Business Modules	Days 5–8	⬜ Not started
Phase 6 — Frontend	Days 9–12	⬜ Not started
Phase 7 — Payments + Deploy	Days 13–15	⬜ Not started
💡 DESIGN DECISIONS LOCKED TODAY

    Development environment: Mac M2 + Antigravity IDE (not VS Code) + Ollama local AI

    Backend: NestJS 11 + Prisma + PostgreSQL 18 + Redis (via OrbStack)

    Frontend: Angular 22 + Navy (#0a1f3d) + Gold (#d4a017) theme

    Multi-tenancy: Shared schema with Row-Level Security (RLS)

    Feature flags: Database-backed, per-tenant toggles for subscription tiers

    Payments: eSewa + Khalti + NepalPay (Nepal) + Stripe/PayPal (global sandbox)

    Hosting: Hybrid — WordPress on Ncell CloudSuite + NestJS on Render + PostgreSQL on Supabase + Frontend on Vercel

    Backup: Google Drive via rsync (daily manual + scheduled later)

    Git strategy: Monorepo procurenepal-umbrella (single repo, all apps inside)

    AI stack: Antigravity native (Gemini) + Ollama qwen2.5-coder:1.5b in terminal

🔒 SECURITY NOTES

    SSH key passphrase cached in macOS Keychain (no typing per push)

    GitHub SSH key added as Authentication Key (not Signing Key)

    Google Drive backups are NOT encrypted at rest — treat as trusted zone only

    .env files excluded from Git via .gitignore

    No API keys or secrets committed to GitHub

📝 BACKUP VERIFIED

Last backup: backup-20260919-213448
Location: GoogleDrive-shishir1213@apollointcollege.edu.np/My Drive/ProcureNepal-Backups/
Contents: All source files (excluding node_modules, .git, build artifacts)
🏁 SESSION END STATE

    Environment: Fully operational ✅

    GitHub: 2 repos live, SSH working ✅

    Backend: Scaffold removed, ready for clean nest new ⚠️

    Data safety: Google Drive backup tested ✅

    Documentation: This file ✅

Ready to resume at Phase 3, Task 3.2.

End of log — 2026-09-19 22:00 NPT