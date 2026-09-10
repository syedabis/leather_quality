# Spray Plant Monitoring System

Leather spray-plant monitoring for Dada Enterprises (Kasur). YOLO-based camera counting of leather pieces across 6 plants (SP-01..SP-06), with session/lot tracking, shape-triggered modes (Washing/Color Matching/Maintenance), and reporting.

## Architecture

```
inference-client (Python, native on the "Plant" PC — NOT Docker)
  → writes directly to SQL Server (AppSessions, CurrentHourMetrics, IdlePeriods)
  → also posts live frames/state to the backend over HTTP (for Floor View during a DB outage)

backend (FastAPI, Docker)      ← reads/writes the same SQL Server
dashboard (Next.js, Docker)    ← calls backend's REST + WebSocket API

LeatherFlow mobile backend (Node.js/Express, separate repo) ← reads/writes the SAME SQL Server
Expo/React Native mobile app  ← calls LeatherFlow's API
```

All four systems (inference-client, backend, mobile backend, and the pieces of the dashboard that hit SQL directly) share **one SQL Server database**. There is no message queue or event bus between them — SQL Server rows are the source of truth everyone polls or reads.

## Database

- Server: `Plant,1433` (or `172.16.20.4,1433` from inside a Docker container — containers can't resolve the Windows hostname, must use the IP)
- Database: `nEXP1314`
- Auth: `sa` / credentials in `.env` (same creds the mobile backend already uses — don't duplicate, reuse)

Key tables:
- **`AppSessions`** — every lot (accounted/unaccounted) and every mode (WASHING/COLOR_MATCHING/MAINTENANCE) is one row here. `LotNo IS NULL` = unaccounted; `LotNo` set = accounted (mobile-assigned). `session_type` is `'PRODUCTION'` (both accounted AND unaccounted use this — it does NOT distinguish them), `'WASHING'`, `'COLOR_MATCHING'`, or `'MAINTENANCE'`. `Status` is `'INPROCESS'` or `'COMPLETED'`. `ProcessedPieces` on an `INPROCESS` row is a live count, heartbeat-written every 5s — not final until `Status='COMPLETED'`.
- **`CurrentHourMetrics`** — one row per (plant, hour), `piece_count` etc., written on *every processed frame* regardless of session state. This is raw camera truth, independent of whether any session exists. Rows are **never finalized/deleted** — `FrameProcessor.finalize_hour()` (which would move them to `HourlyMetrics`) exists but is **never called** anywhere in the live pipeline. `HourlyMetrics` is effectively dead/unused.
- **`IdlePeriods`** — belt-idle windows, written when the belt goes from idle back to active.

## Known gotchas

- **"In Session" vs "Out of Session" (Daily Summary)**: `_batch_session_metrics()` only sums `COMPLETED` sessions by default — a currently-running session contributes *zero* to "In Session" until it ends, which inflates "Out of Session" for as long as that session stays open. `daily_summary()` passes `include_live_session=True` to fix this for itself; `get_plant_states()` (Floor View) and `get_plant_wise()` still default to completed-only.
- **Floor_view (inference-client) has a hard blind spot**: it only logs pieces that arrive with *no active session* and never reach the 10-in-50s threshold. It has zero visibility into pieces lost *while* a session or mode *is* active — that was a real, separate bug (multi-piece-per-frame undercounting, fixed in `session_manager.py`/`mode_manager.py`'s `on_piece_detected`), not something floor_view could ever have caught.
- **Two unrelated "notification" systems**: (1) `backend/app/notifications.py` + `routers/notifications.py` — system health alerts (DB offline, camera down), stored in a flat JSONL file *deliberately not SQL Server* (has to work even when SQL Server is down), dashboard bell/toast. (2) The planned mobile plant-status notifications (see `Mobile_Plant_Status_Notifications_Plan.md`) — mode/lot activity toasts, proposed to live in a new `PlantNotifications` SQL table. Different purpose, different storage, don't conflate them.
- **MAINTENANCE sessions**: excluded from Run Time/Idle Time everywhere (footer-only total), but *do* get a timeline row in Daily Detail (restored after being hidden for a period) and *do* count toward total pieces.
- **Shape triggers require 5 consecutive detection hits** (~15s at 3s intervals) at conf ≥0.89 with nothing else in the ROI — most real-world attempts fail partway through, which is normal, not a bug.
- **Plant Wise multi-select filter is client-side**: the API always returns all plants (no `?plant=` sent); `MultiPlantSelect` filters the returned rows in the browser so the footer totals always reflect only the visible plants.

## File map

```
backend/
└── app/
    ├── main.py                    FastAPI entry point, mounts all routers
    ├── auth.py                    Clerk session-token verification (admin-only endpoints)
    ├── live_state.py              in-memory fallback for live piece/session data, pushed by
    │                              inference-client only while ITS OWN db connection is down
    ├── notifications.py           system health alerts (DB offline, camera down) — JSONL
    │                              file, deliberately NOT SQL Server (must work when DB is down)
    ├── watchdog.py                background checks that raise alerts + shift-end email scheduler
    │                              (polls 15 mins if production lot INPROCESS; skips off-days)
    ├── db/
    │   ├── connection.py          pyodbc connection builder, reads .env
    │   ├── schema.py              creates all tables/indexes/procs on startup if missing
    │   │                          (includes dbo.EmailRecipients table creation)
    │   ├── frame_processor.py     writes CurrentHourMetrics per frame (backend's own copy;
    │   │                          inference-client has its own separate one too)
    │   └── queries.py             *** the big one *** all report-building SQL:
    │                              _batch_session_metrics() (shared by Floor View/Daily
    │                              Summary/Plant Wise), get_daily_detail(), get_plant_wise(),
    │                              get_app_sessions(), get_frame_metrics()
    ├── services/
    │   └── email_service.py       HTML email report generator (Day Wise & Month Wise tables
    │                              with bold tfoot totals strip) + smtplib SMTP dispatch
    ├── routers/
    │   ├── reports.py             /api/reports/* — daily-summary, daily-detail, plant-wise,
    │   │                          Excel export, /send-daily-summary, and /send-test-email
    │   ├── email_recipients.py    /api/settings/email-recipients — CRUD endpoints for dbo.EmailRecipients
    │   ├── sessions.py            /api/sessions — raw session list (Sessions page)
    │   ├── analytics.py           real-time aggregates from CurrentHourMetrics
    │   ├── counts.py              piece-counts API
    │   ├── settings.py            system settings (shift hours, targets, etc.)
    │   └── notifications.py       bell/toast API for system alerts + /ws/notifications
    └── websocket/
        ├── live.py                /ws/counts    — push all-unit counts, ~3s cadence
        ├── plants.py              /ws/plants    — push per-plant DB data, ~3s cadence
        └── plant_feed.py          /ws/plant/{id} — live camera thumbnail push

dashboard/
└── app/
    ├── reports/page.tsx           Daily Summary / Daily Detail / Plant Wise tabs
    │                              Plant Wise: MultiPlantSelect checkbox dropdown (client-side
    │                              filter — always fetches all plants, filters in browser) +
    │                              footer totals strip (Total Run Time, Idle, Maintenance,
    │                              Overtime, Pieces, Avg Utilisation %)
    ├── monitoring/page.tsx        live 6-plant grid ("Monitoring" screen)
    ├── floor-view/page.tsx        live plant cards — pieces today, active session, idle breakdown
    ├── sessions/page.tsx          session history list/filter
    ├── plant/[id]/page.tsx        single-plant detail view
    ├── overview/page.tsx          dashboard landing/summary
    ├── notifications/page.tsx     system-alert bell/history (see gotcha below)
    ├── users/page.tsx             admin user management
    ├── settings/page.tsx          system settings + Email Configuration panel (add/delete recipients,
    │                              allocated plant checkboxes, SMTP tester, manual report trigger)
    ├── help/page.tsx              reference/help page
    ├── login/page.tsx             )
    ├── sign-in/[[...rest]]/       ) Clerk auth flow
    └── welcome/page.tsx           )

inference-client/                  runs NATIVELY on the Plant PC — NOT Docker
    ├── run_all_plants.py          *** the main process *** per-plant capture/inference loop,
    │                              YOLO piece counting + tracking, shape detection dispatch,
    │                              all DB-write call sites
    ├── gap_monitor.py             standalone diagnostic: polls CurrentHourMetrics vs active
    │                              session growth every 30s, flags live counting lag.
    │                              Run manually when investigating a discrepancy, not
    │                              part of the pipeline
    └── app/
        ├── floor_view_logger.py   local log of pieces counted but never in any session
        ├── db/
            ├── session_manager.py accounted/unaccounted lot lifecycle: polls AppSessions
            │                      for mobile-assigned lots, auto-detects unaccounted runs
            │                      (10 pieces in 50s), sparse-piece drop logging
            ├── mode_manager.py    WASHING/COLOR_MATCHING/MAINTENANCE state machine, shape-hit
            │                      confirmation, piece-burst mode-ending logic
            ├── frame_processor.py writes CurrentHourMetrics per frame
            ├── outbox.py          store-and-forward buffer (db_outbox.jsonl) for when SQL
            │                      Server is unreachable; replays + coalesces on reconnect
            └── connection.py      pyodbc connection builder (reads root .env)
```

## Deploy

- **backend/dashboard**: `docker build -t datacrumbs762/spray-plant-backend:latest .` (or `-dashboard`, from that folder) then `docker push`. Client pulls with `docker compose pull && docker compose up -d --force-recreate`.
- **inference-client**: no Docker. Copy changed files to the same relative paths on the client PC, restart the process (or let the 5am scheduled restart pick it up).
- Only rebuild/push the image(s) that actually changed — check `git status` first.

## Mobile backend (LeatherFlow — index.js)

Runs as a plain Node.js process on the server (not Docker). Key endpoints:

- `POST   /api/sessions` — start a lot session (`body: { lotNo, plant, startTime? }`)
- `PATCH  /api/sessions/:id/assign-lot` — assign/correct LOT on an existing session
- `GET    /api/sessions/:id` — fetch one session (mobile polls for completion)
- `PUT    /api/sessions/:id/end` — end a session
- `GET    /api/sessions/active` — all INPROCESS sessions across plants (supervisor overview).
  **Must be registered BEFORE `/:id` in Express** or "active" is treated as a session ID.
- `GET    /api/sessions/:id/live` — **live piece count** for an INPROCESS session. Reads
  `AppSessions.ProcessedPieces`, heartbeat-written every ~5s by the inference-client.
  Mobile polls every 3–5s to show a live counter on the active session card.
  See `Mobile_LivePieceCount_Plan.md` for full spec and code.

`AppSessions.ProcessedPieces` is the camera count (YOLO), NOT the ERP/store balance
(`SR_UnderProcess_Finish.BalancePCS`). Do not mix them.

## Key Features

### Automated Day-End Email Summary Reports
- **Status**: Live / Implemented (`email_service.py`, `watchdog.py`, `reports.py`, `email_recipients.py`).
- **Functionality**:
  - Automatically dispatches HTML email reports at shift end (e.g. 5:00 PM).
  - Contains **Day Wise Plant Report** and cumulative **Month Wise Plant Report** tables.
  - Tables include a bold `tfoot` summary totals row (Total Run Time, Total Idle Time, Maintenance, Overtime, Total Pieces, and Average Utilisation %).
  - **Manager Scoping**: Managers receive reports filtered strictly to their allocated plants (e.g. `SP-01, SP-05, SP-06`).
  - **Director Master Report**: Directors receive the all-plant master report plus copies of each manager's report.
  - **Smart Scheduler**: Polling checks active `INPROCESS` production lots; delays email dispatch by 15 mins if a lot is running (with a 10 PM cutoff). Skips holidays and off-days.
  - **Dashboard Control**: Admin settings page provides recipient management table, allocated plant checkboxes, SMTP connection tester, and manual report trigger button.
  - **`.env` variables**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS`, `SMTP_SSL`.

## Pending features (blocked / in progress)

### Mobile — Clerk auth (v2 metadata shape)
See `Mobile_Clerk_Auth_Implementation_Plan.md`. `publicMetadata` now has nested
`dashboard{enabled,role}` and `mobile{enabled,role,plant}` — not a flat `role`.
Dashboard Users page, `backend/app/auth.py`, `dashboard/middleware.ts`, and the
mobile backend Clerk middleware all need updating to the new shape.

### Mobile — Plant-status notifications
See `Mobile_Plant_Status_Notifications_Plan.md`. New `PlantNotifications` SQL table;
mobile backend polls `AppSessions` for new `INPROCESS` rows every 5s and inserts
notification rows; mobile app polls `GET /api/notifications` for toasts + bell list.

## Where plans/docs live

Standalone plan/handoff docs are saved as plain `.md` files in the repo root:

| File | What it covers |
|---|---|
| `Mobile_LivePieceCount_Plan.md` | Live piece count on active session cards (new) |
| `Mobile_Plant_Status_Notifications_Plan.md` | Mode/lot-start push notifications |
| `Mobile_Clerk_Auth_Implementation_Plan.md` | Clerk v2 nested metadata auth scheme |
| `Mobile_Developer_Handoff.md` | Original Clerk sign-in handoff |
| `email_template_preview.html` | Static preview HTML file for report email formatting |

Check these before redesigning something that may already be planned out.
