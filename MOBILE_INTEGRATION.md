# Dada Bespoke Concepts — Mobile App Integration Guide

## Architecture

React Native app calls our FastAPI backend directly over LAN. No proxy needed.

```
React Native App (phone)
        ↓
http://<SERVER_IP>:8001   ← LAN IP of the server machine, port 8001
        ↓
FastAPI Backend
        ↓
SQL Server (dbo.* tables)
```

> **Important:** Never use `localhost` from React Native — `localhost` on a phone means the phone itself. Always use the server's LAN IP.
>
> **Static IP required:** The server machine must be assigned a static LAN IP, otherwise the IP changes on reboot and the APK breaks. Current IP is `172.16.20.4` — fix this in the machine's network adapter settings before distributing the APK.

---

## Base URL

```
http://172.16.20.4:8001
```

CORS is fully open (`*`) — no extra configuration needed.

---

## Endpoints

### 1. Floor View — All Plants Live State

```
GET http://172.16.20.4:8001/api/plants
```

Returns all 6 plants in one array. Poll every 15 seconds.

**Response (array of plant objects):**
```json
[
  {
    "plant_id": "SP-01",
    "plant_name": "Spray Plant 1",
    "online": true,
    "belt_active": true,
    "in_break": false,
    "is_holiday": false,
    "is_weekly_off": false,
    "total_count": 143,
    "runtime_s": 7560.0,
    "idle_s": 360.0,
    "utilization": 95.4,
    "idle_sessions": 2,
    "active_session": {
      "session_id": 1812,
      "lot_no": "LT-4421",
      "plant": "SP-01",
      "start_time": "2026-06-24T08:11:00",
      "expected_pieces": 500,
      "current_pieces": 143,
      "type": "accounted",
      "session_type": "PRODUCTION",
      "order_no": "EXP/3249/26",
      "article_name": "Black Formal Upper",
      "colour_name": "Black",
      "party_name": "Servis Industries",
      "pk_code": "PK-001"
    }
  }
]
```

`active_session` is `null` when no session is running on that plant.

---

### 2. Sessions List

```
GET http://172.16.20.4:8001/api/sessions
GET http://172.16.20.4:8001/api/sessions?plant=SP-01
GET http://172.16.20.4:8001/api/sessions?plant=SP-01&limit=50
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `plant` | string | (all plants) | Filter by plant, e.g. `SP-01` |
| `limit` | int | 200 | Max rows returned (1–1000) |

Returns completed + active sessions, newest first.

**Response (array):**
```json
[
  {
    "session_id": 1812,
    "lot_no": "LT-4421",
    "plant": "SP-01",
    "start_time": "2026-06-24T08:11:00",
    "end_time": "2026-06-24T12:30:00",
    "expected_pieces": 500,
    "processed_pieces": 487,
    "status": "COMPLETED",
    "type": "accounted",
    "session_type": "PRODUCTION",
    "order_no": "EXP/3249/26",
    "article_name": "Black Formal Upper",
    "colour_name": "Black",
    "party_name": "Servis Industries",
    "pk_code": "PK-001"
  }
]
```

`end_time` is `null` for active (INPROCESS) sessions.
`lot_no` is `null` for unaccounted sessions.

---

### 3. Hourly Breakdown (Analytics)

```
GET http://172.16.20.4:8001/api/analytics/by-hour?date=2026-06-29&unit=SP-01
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `date` | YYYY-MM-DD | yes | The date to query |
| `unit` | string | yes | Plant ID e.g. `SP-01` |

**Response (array, one entry per hour that had activity):**
```json
[
  {
    "hour": 8,
    "pieces": 45,
    "uptime_pct": 82.3,
    "downtime_pct": 17.7,
    "idle_sessions": 1,
    "idle_time_s": 312.0,
    "avg_utilization_pct": 78.5
  }
]
```

`hour` is 0–23 (24-hour clock). Hours with no data are omitted.

---

### 4. Daily Summary (Analytics)

```
GET http://172.16.20.4:8001/api/analytics/by-day
GET http://172.16.20.4:8001/api/analytics/by-day?from=2026-06-01&to=2026-06-29
GET http://172.16.20.4:8001/api/analytics/by-day?from=2026-06-01&to=2026-06-29&unit=SP-01
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | YYYY-MM-DD | 7 days ago | Start date |
| `to` | YYYY-MM-DD | today | End date |
| `unit` | string | (all plants) | Optional plant filter |

**Response (array, one row per plant per day):**
```json
[
  {
    "date": "2026-06-24",
    "unit": "SP-01",
    "pieces": 487,
    "uptime_pct": 85.2,
    "downtime_pct": 14.8,
    "idle_sessions": 3,
    "idle_time_s": 1200.0,
    "avg_utilization_pct": 80.1
  }
]
```

---

### 5. Shift Breakdown (Analytics)

```
GET http://172.16.20.4:8001/api/analytics/by-shift
GET http://172.16.20.4:8001/api/analytics/by-shift?from=2026-06-01&to=2026-06-29&unit=SP-01
```

Same query params as `/by-day`.

**Response (one row per plant per shift per day):**
```json
[
  {
    "date": "2026-06-24",
    "unit": "SP-01",
    "shift": "Morning",
    "pieces": 245,
    "uptime_pct": 88.1
  }
]
```

Shifts: `Morning` (06:00–14:00), `Afternoon` (14:00–22:00), `Night` (22:00–06:00).

---

### 6. Health Check

```
GET http://172.16.20.4:8001/health
```

```json
{ "status": "ok" }
```

Use this to verify the server is reachable before making data requests.

---

## Mapping UI Elements → API Fields

### Global KPI Bar

| UI Label | Calculation |
|----------|-------------|
| Total Pieces Today | `plants.reduce((s, p) => s + (p.total_count ?? 0), 0)` |
| Active Hours | `plants.reduce((s, p) => s + (p.runtime_s ?? 0), 0) / 3600` |
| Idle Hours | `plants.reduce((s, p) => s + (p.idle_s ?? 0), 0) / 3600` |
| Plants Running | `plants.filter(p => p.online && p.belt_active).length` |

### Per-Plant Card

| UI Element | Field | Source |
|------------|-------|--------|
| Plant ID | `plant.plant_id` | root |
| Running / Idle / Offline badge | see Belt Status Logic below | root |
| Pieces Today | `plant.total_count` | root |
| Active time | `plant.runtime_s` | root |
| Idle time | `plant.idle_s` | root |
| Utilization % | `plant.utilization` | root |
| Order Number | `plant.active_session.order_no` | active_session |
| Party | `plant.active_session.party_name` | active_session |
| Article | `plant.active_session.article_name` | active_session |
| Colour | `plant.active_session.colour_name` | active_session |
| Lot No | `plant.active_session.lot_no` | active_session |
| Expected Pieces | `plant.active_session.expected_pieces` | active_session |
| Current Pieces | `plant.active_session.current_pieces` | active_session |

### Plant Status Logic

**There is no separate status endpoint.** All status information is already inside the response from `GET http://172.16.20.4:8001/api/plants`. You derive the status from two fields in each plant object:

- `plant.online` / `plant.in_break` / `plant.is_holiday` / `plant.is_weekly_off` / `plant.belt_active` — system-level state
- `plant.active_session.session_type` — operating mode (WASHING / COLOR_MATCHING / MAINTENANCE)

**Step 1 — Call the endpoint:**
```
GET http://172.16.20.4:8001/api/plants
```

**Step 2 — Each plant object in the response looks like this:**
```json
{
  "plant_id": "SP-01",
  "plant_name": "Spray Plant 1",
  "online": true,
  "belt_active": true,
  "in_break": false,
  "is_holiday": false,
  "is_weekly_off": false,
  "total_count": 143,
  "runtime_s": 7560.0,
  "idle_s": 360.0,
  "utilization": 95.4,
  "active_session": {
    "session_id": 1812,
    "session_type": "WASHING",
    "lot_no": null,
    "plant": "SP-01",
    "start_time": "2026-06-29T08:11:00",
    "expected_pieces": null,
    "current_pieces": 45,
    "type": "unaccounted",
    "order_no": null,
    "article_name": null,
    "colour_name": null,
    "party_name": null,
    "pk_code": null
  }
}
```

**Step 3 — Derive the status using this function:**
```javascript
function getPlantStatus(plant) {
  if (!plant.online)       return 'Offline';
  if (plant.in_break)      return 'Break';
  if (plant.is_holiday)    return 'Holiday';
  if (plant.is_weekly_off) return 'Weekly Off';

  const sessionType = plant.active_session?.session_type;
  if (sessionType === 'WASHING')        return 'Washing';
  if (sessionType === 'COLOR_MATCHING') return 'Color Matching';
  if (sessionType === 'MAINTENANCE')    return 'Maintenance';

  if (plant.belt_active)  return 'Running';
  return 'Idle';
}

// Usage:
const plants = await fetch('http://172.16.20.4:8001/api/plants').then(r => r.json());
plants.forEach(plant => {
  console.log(plant.plant_id, '→', getPlantStatus(plant));
});
// Output:
// SP-01 → Washing
// SP-02 → Running
// SP-03 → Idle
// SP-04 → Offline
// SP-05 → Break
// SP-06 → Maintenance
```

**All possible statuses and where they come from:**

| Status | Badge colour | Which field triggers it |
|--------|-------------|------------------------|
| `Offline` | Gray | `plant.online === false` (inference not running) |
| `Break` | Orange | `plant.in_break === true` |
| `Holiday` | Yellow | `plant.is_holiday === true` |
| `Weekly Off` | Yellow | `plant.is_weekly_off === true` |
| `Washing` | Blue | `plant.active_session.session_type === 'WASHING'` |
| `Color Matching` | Purple | `plant.active_session.session_type === 'COLOR_MATCHING'` |
| `Maintenance` | Red | `plant.active_session.session_type === 'MAINTENANCE'` |
| `Running` | Green | `plant.belt_active === true` (belt moving, normal production) |
| `Idle` | Gray | online but belt not active, no special mode |

---

## Sample React Native Code

```javascript
const BACKEND = 'http://172.16.20.4:8001';

// Floor view — call every 15 seconds
async function fetchFloorView() {
  const res    = await fetch(`${BACKEND}/api/plants`);
  const plants = await res.json();

  const totalPieces    = plants.reduce((s, p) => s + (p.total_count ?? 0), 0);
  const totalActiveHrs = plants.reduce((s, p) => s + (p.runtime_s  ?? 0), 0) / 3600;
  const totalIdleHrs   = plants.reduce((s, p) => s + (p.idle_s     ?? 0), 0) / 3600;
  const plantsRunning  = plants.filter(p => p.online && p.belt_active).length;

  return { plants, totalPieces, totalActiveHrs, totalIdleHrs, plantsRunning };
}

// Sessions for one plant
async function fetchSessions(plant, limit = 100) {
  const res = await fetch(`${BACKEND}/api/sessions?plant=${plant}&limit=${limit}`);
  return res.json();
}

// Today's hourly chart for one plant
async function fetchHourly(plant) {
  const today = new Date().toISOString().slice(0, 10);
  const res   = await fetch(`${BACKEND}/api/analytics/by-hour?date=${today}&unit=${plant}`);
  return res.json();
}

// Last 7 days daily summary
async function fetchDailySummary(plant) {
  const res = await fetch(`${BACKEND}/api/analytics/by-day&unit=${plant}`);
  return res.json();
}
```

---

## DB Tables (reference only — use the API, not direct DB)

| Table | Purpose |
|-------|---------|
| `dbo.AppSessions` | Sessions (lot, pieces, status, session_type) |
| `dbo.WBIssuance_Info` | Order / party / article / colour (joined on IssueNoCounter) |
| `dbo.CurrentHourMetrics` | Pieces today, active/idle time per plant per hour |
| `dbo.PlantModes` | Current operating mode per plant |
| `dbo.Holidays` | Holiday and weekly-off dates |
| `dbo.Breaks` | Break windows per date |
