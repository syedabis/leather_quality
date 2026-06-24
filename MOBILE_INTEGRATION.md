# Dada Bespoke Concepts — Mobile App Integration Guide

## Architecture

React Native app calls our backend **directly** over LAN. No proxy needed.

```
React Native App (phone)
        ↓
http://172.16.0.2:8001   ← server LAN IP, port 8001
        ↓
FastAPI Backend (our backend)
        ↓
SQL Server (dbo.* tables)
```

> **Important:** Never use `localhost` from the React Native app — localhost on a phone refers to the phone itself, not the server. Always use the LAN IP `172.16.0.2`.

---

## Base URL

```
http://172.16.0.2:8001
```

CORS is open (`*`) — no extra configuration needed.

---

## Endpoints

### 1. Floor View — All Plants Live State

```
GET http://172.16.0.2:8001/api/plants
```

Returns all 6 plants in a single response. Call this every 15 seconds to keep the UI live.

**Response shape (per plant):**
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
  "runtime_s": 7560,
  "idle_s": 360,
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
```

`active_session` is `null` if no session is running on that plant.

---

### 2. Sessions List

```
GET http://172.16.0.2:8001/api/sessions?limit=200
GET http://172.16.0.2:8001/api/sessions?plant=SP-01&limit=100
```

Returns completed + active sessions, newest first.

---

## Mapping UI Elements → API Fields

### Global KPI Bar

| UI Label | Field | Notes |
|----------|-------|-------|
| Total Pieces | `SUM(plant.total_count)` | Sum across all 6 plants |
| Total Active Hrs | `SUM(plant.runtime_s) / 3600` | Sum across all plants |
| Total Idle Hrs | `SUM(plant.idle_s) / 3600` | Sum across all plants |
| Plants Running | `plants.filter(p => p.online && p.belt_active).length` | Count of belt_active=true |

### Per-Plant Card

| UI Element | API Field | Location |
|------------|-----------|----------|
| Running / Idle / Offline badge | `plant.online` + `plant.belt_active` + `plant.in_break` | plant root |
| Order Number | `plant.active_session.order_no` | active_session |
| Party | `plant.active_session.party_name` | active_session |
| Plant ID | `plant.plant_id` | plant root |
| Article | `plant.active_session.article_name` | active_session |
| Colour | `plant.active_session.colour_name` | active_session |
| Pieces Today | `plant.total_count` | plant root |
| Active time | `plant.runtime_s` (convert to hours) | plant root |
| Idle time | `plant.idle_s` (convert to hours) | plant root |

### Belt Status Logic

```javascript
function getBeltStatus(plant) {
  if (!plant.online)       return 'Offline';
  if (plant.in_break)      return 'Break';
  if (plant.is_holiday)    return 'Holiday';
  if (plant.is_weekly_off) return 'Weekly Off';
  if (plant.belt_active)   return 'Running';
  return 'Idle';
}
```

### Session Type Badge

`active_session.session_type` can be:

| Value | Badge colour | Meaning |
|-------|-------------|---------|
| `PRODUCTION` | Green | Normal production session |
| `WASHING` | Blue | Machine being washed |
| `COLOR_MATCHING` | Purple | Color matching in progress |
| `MAINTENANCE` | Red | Under maintenance |

---

## Sample React Native Fetch

```javascript
const BACKEND = 'http://172.16.0.2:8001';

async function fetchFloorView() {
  const res = await fetch(`${BACKEND}/api/plants`);
  const plants = await res.json();

  const totalPieces      = plants.reduce((s, p) => s + (p.total_count ?? 0), 0);
  const totalActiveHrs   = plants.reduce((s, p) => s + (p.runtime_s ?? 0), 0) / 3600;
  const totalIdleHrs     = plants.reduce((s, p) => s + (p.idle_s ?? 0), 0) / 3600;
  const plantsRunning    = plants.filter(p => p.online && p.belt_active).length;

  return { plants, totalPieces, totalActiveHrs, totalIdleHrs, plantsRunning };
}
```

---

## DB Tables (for reference only — use API, not direct DB)

| Table | Purpose |
|-------|---------|
| `dbo.AppSessions` | Sessions (lot, pieces, status, session_type) |
| `dbo.WBIssuance_Info` | Order / party / article / colour (join on IssueNoCounter) |
| `dbo.CurrentHourMetrics` | Pieces today, active hrs, idle hrs per plant per hour |
| `dbo.PlantModes` | Current operating mode per plant (NORMAL / WASHING / COLOR_MATCHING / MAINTENANCE) |
| `dbo.Holidays` | Holiday and weekly-off dates |
| `dbo.Breaks` | Break windows per date |
