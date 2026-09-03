require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { query, getPool, sql } = require("./db");
const {
  ISSUER,
  verifyToken,
  getMobileAccess,
  requireAuth,
  requireMobile,
  scopePlant,
  plantForbidden,
} = require("./auth");
const { startPoller } = require("./notificationPoller");

// The six spray plants. A mobile "admin" joins all of these socket rooms; a "user"
// joins only their one plant. Emitting to a plant room is what scopes notifications.
const PLANTS = ["SP-01", "SP-02", "SP-03", "SP-04", "SP-05", "SP-06"];

const app = express();
app.use(cors());
app.use(express.json());

// Request logger — prints every incoming request and its response status.
// Helps debug "mobile says error but no log" situations.
app.use((req, res, next) => {
  const t0 = Date.now();
  const tag = `[${new Date().toISOString()}] ${req.method} ${req.url}`;
  const bodyPreview = req.method !== "GET" && req.body
    ? ` body=${JSON.stringify(req.body)}`
    : "";
  console.log(`${tag} <- from ${req.ip}${bodyPreview}`);
  res.on("finish", () => {
    console.log(`${tag} -> ${res.statusCode} (${Date.now() - t0}ms)`);
  });
  next();
});

// ---------- helpers ----------

// Machine-state sessions created by the spray-plant shape detector (star / plus /
// triangle cards). They live in AppSessions alongside production batches but are
// NOT production: they must never carry a LOT, and they always yield to a real
// batch. Rows with session_type NULL are ordinary production/unaccounted sessions.
const MODE_SESSION_TYPES = ["WASHING", "COLOR_MATCHING", "MAINTENANCE"];

function isModeSession(sessionType) {
  return MODE_SESSION_TYPES.includes(String(sessionType || "").toUpperCase());
}

// Shape the mobile app expects. Extended to expose SR fields used by Active LOTs / Sessions screens.
function shapeLot(row) {
  const receivingPcs = row.ReceivingPCS != null ? Number(row.ReceivingPCS) : 0;
  const balancePcs = row.BalancePCS != null ? Number(row.BalancePCS) : 0;
  return {
    IssueNoCounter: row.IssueNoCounter,
    FinishCounter: row.FinishCounter ?? null,
    Date: row.ReceivingDate || row.Date,
    ReceivingDate: row.ReceivingDate ?? null,
    CompletionDate:
      row.CompletionDate && new Date(row.CompletionDate).getFullYear() > 1901
        ? row.CompletionDate
        : null,
    LotNo: row.LotNo ?? "",
    PK: row.PK ?? "",
    PCS: receivingPcs || row.PCS || 0,
    ReceivingPCS: receivingPcs,
    BalancePCS: balancePcs,
    ProcessedPCS: Math.max(0, receivingPcs - balancePcs),
    Status: balancePcs > 0 ? "INPROCESS" : "COMPLETED",
    _From: row._FROM ?? row.FromDept ?? "",
    FromDept: row.FromDept ?? "",
    OrderNo: row.OrderNo ?? "",
    PartyName: row.PartyName ?? "",
    ArticleName: row.ArticleName ?? "",
    ColourName: row.ColourName ?? "",
  };
}

// Columns we project after the JOIN. Used by every lot-returning endpoint.
const LOT_COLUMNS = `
  sr.FinishCounter,
  wb.IssueNoCounter,
  sr.ReceivingDate,
  wb.LotNo,
  wb.PK,
  wb.OrderNo,
  wb.PartyName,
  wb.ArticleName,
  wb.ColourName,
  sr.ReceivingPCS,
  sr.BalancePCS,
  sr.CompletionDate,
  sr.FromDept
`;

// Slice TOP @limit rows from SR FIRST by ReceivingDate DESC, then JOIN to WBIssuance_Info.
// Note: no forced index hint — SQL Server picks its own plan. A hint was originally added
// for `idx_SR_ReceivingDate_FC` but that index may not exist on all DB instances (e.g. after
// the migration to nEXP1314), causing a hard query error. Removing it is safe; the ORDER BY
// still sorts on ReceivingDate and FinishCounter.
function buildRecentSql(extraWhere = "") {
  return `
    SELECT ${LOT_COLUMNS}
    FROM (
      SELECT TOP (@limit) FinishCounter, IssueNoCounter, ReceivingDate, ReceivingPCS, BalancePCS, CompletionDate, FromDept
      FROM dbo.SR_UnderProcess_Finish
      ${extraWhere}
      ORDER BY ReceivingDate DESC, FinishCounter DESC
    ) sr
    INNER JOIN dbo.WBIssuance_Info wb ON wb.IssueNoCounter = sr.IssueNoCounter
    ORDER BY sr.ReceivingDate DESC, sr.FinishCounter DESC
  `;
}

// ---------- routes ----------

app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1 AS ok");
    res.json({ status: "ok", message: "LeatherFlow SQL API is running", db: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", db: "disconnected", error: err.message });
  }
});

// ---------- auth gate ----------
// Everything BELOW this line needs a valid Clerk session token from an account that
// was granted mobile access on the dashboard's Users page. /api/health stays above it
// and public, so PM2 and monitoring can keep polling without a token.
//
// Safe to blanket-protect: this API is called only by the mobile app. The spray-plant
// stack writes sessions straight to SQL (inference-client/app/db/session_manager.py)
// and never calls these routes.
app.use("/api", requireAuth, requireMobile, scopePlant);

// Recent lots — TOP N rows by ReceivingDate DESC.
// Used by Add LOT (top 5) and Sessions screen (top 100+).
app.get("/api/lots/recent", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit) || 5));
    const rows = await query(buildRecentSql(), { limit });
    res.json({ data: rows.map(shapeLot), limit });
  } catch (err) {
    console.error("recent lots error:", err.message);
    res.status(500).json({ error: "Failed to fetch recent lots" });
  }
});

// Search lots — by LotNo, OrderNo, ArticleName, ColourName, PartyName, PK.
// Pull TOP 100 matches from WB first (cheap on indexed columns), then JOIN to SR for ReceivingPCS.
app.get("/api/lots/search", async (req, res) => {
  try {
    const { query: q } = req.query;
    if (!q || !q.trim()) {
      return res.json({ data: [], total: 0 });
    }
    const term = `%${q.trim()}%`;
    const rows = await query(
      `
      SELECT ${LOT_COLUMNS}
      FROM (
        SELECT TOP 100 IssueNoCounter, LotNo, PK, OrderNo, PartyName, ArticleName, ColourName
        FROM dbo.WBIssuance_Info
        WHERE LotNo LIKE @term
           OR OrderNo LIKE @term
           OR ArticleName LIKE @term
           OR ColourName LIKE @term
           OR PartyName LIKE @term
           OR PK LIKE @term
        ORDER BY IssueNoCounter DESC
      ) wb
      INNER JOIN dbo.SR_UnderProcess_Finish sr ON sr.IssueNoCounter = wb.IssueNoCounter
      ORDER BY sr.FinishCounter DESC
      `,
      { term }
    );
    res.json({ data: rows.map(shapeLot), total: rows.length });
  } catch (err) {
    console.error("search lots error:", err.message);
    res.status(500).json({ error: "Search failed" });
  }
});

// Active lots — currently being processed (still has work remaining).
// BalancePCS > 0 means some pieces are yet to be processed in this batch.
app.get("/api/active-lots", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
    const rows = await query(buildRecentSql("WHERE BalancePCS > 0"), { limit });
    res.json({ data: rows.map(shapeLot), total: rows.length });
  } catch (err) {
    console.error("active lots error:", err.message);
    res.status(500).json({ error: "Failed to fetch active lots" });
  }
});

// Single lot lookup by IssueNoCounter.
app.get("/api/lots/:id", async (req, res) => {
  try {
    const rows = await query(
      `
      SELECT ${LOT_COLUMNS}
      FROM dbo.SR_UnderProcess_Finish sr
      INNER JOIN dbo.WBIssuance_Info wb ON wb.IssueNoCounter = sr.IssueNoCounter
      WHERE wb.IssueNoCounter = @id
      ORDER BY sr.FinishCounter DESC
      `,
      { id: parseInt(req.params.id, 10) }
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Lot not found" });
    }
    res.json(shapeLot(rows[0]));
  } catch (err) {
    console.error("get lot error:", err.message);
    res.status(500).json({ error: "Failed to fetch lot" });
  }
});

// ---------- Sessions ----------

// Look up a LOT in WBIssuance_Info. Returns first match or null.
async function lookupLot(lotNo) {
  const rows = await query(
    `SELECT TOP 1 IssueNoCounter, LotNo, PCS
       FROM dbo.WBIssuance_Info
      WHERE LotNo = @lotNo
      ORDER BY IssueNoCounter DESC`,
    { lotNo: String(lotNo) }
  );
  return rows[0] || null;
}

// Start a session.
// Two modes:
//   1. Worker-initiated (mobile): body { lotNo, plant, startTime? }
//      Backend looks up IssueNoCounter + PCS from WBIssuance_Info.
//      409 if an INPROCESS session for the same LOT already exists on this plant.
//   2. Model-initiated unaccounted (spray-plant): body { plant, startTime? }
//      Inserts a row with LotNo = NULL, IssueNoCounter = NULL.
app.post("/api/sessions", async (req, res) => {
  try {
    const { lotNo, plant: requestedPlant, startTime, endPrevious } = req.body || {};

    // A "user"-role account is pinned to one plant. The server's value wins over
    // whatever the client sent, so such an account can never open a session on
    // another plant — even if the request body says otherwise. "admin" is unscoped
    // (forcedPlant is null) and keeps using the plant it asked for.
    const plant = req.forcedPlant || requestedPlant;

    let resolvedLotNo = null;
    let issueNoCounter = null;
    let expectedPieces = null;

    if (lotNo) {
      const lot = await lookupLot(lotNo);
      if (!lot) {
        return res.status(404).json({ error: `LOT '${lotNo}' not found in WBIssuance_Info` });
      }
      resolvedLotNo = String(lot.LotNo);
      issueNoCounter = lot.IssueNoCounter;
      expectedPieces = lot.PCS != null ? Math.round(Number(lot.PCS)) : null;

      // Global concurrent guard — the same LOT cannot be INPROCESS on a DIFFERENT
      // plant. The current plant is EXCLUDED so that re-selecting the same lot on the
      // plant already running it isn't hard-blocked here; it falls through to the
      // per-plant Switch flow below (confirm → end old → start new). Same lot on a
      // different plant is still blocked (one lot shouldn't run on two plants).
      const dup = await query(
        `SELECT TOP 1 SessionId, Plant FROM dbo.AppSessions
          WHERE LotNo = @lotNo AND Status = 'INPROCESS'
            AND (@plant IS NULL OR Plant <> @plant)`,
        { lotNo: resolvedLotNo, plant: plant || null }
      );
      if (dup.length > 0) {
        return res.status(409).json({
          reason: "lot_running_elsewhere",
          error: `LOT '${resolvedLotNo}' is already running on ${dup[0].Plant || "another plant"} (SessionId ${dup[0].SessionId}). It must complete before being started again.`,
          existingSessionId: dup[0].SessionId,
          existingPlant: dup[0].Plant,
        });
      }
    }

    // Per-plant active guard — each plant can only run ONE batch at a time
    // (applies to both worker-initiated and model-initiated unaccounted sessions).
    if (plant) {
      const plantBusy = await query(
        `SELECT TOP 1 SessionId, LotNo, session_type FROM dbo.AppSessions
          WHERE Plant = @plant AND Status = 'INPROCESS'`,
        { plant }
      );
      if (plantBusy.length > 0) {
        const busy = plantBusy[0];

        if (isModeSession(busy.session_type)) {
          // WASHING / COLOR_MATCHING / MAINTENANCE is running. A real production
          // batch always wins — close the mode session silently and carry on. No
          // operator confirmation: these are machine states, not batches, so there
          // is no production data to lose by ending one.
          await query(
            `UPDATE dbo.AppSessions
                SET Status = 'COMPLETED', EndTime = GETDATE()
              WHERE SessionId = @sid AND Status = 'INPROCESS'`,
            { sid: busy.SessionId }
          );
          console.log(
            `[sessions] ${plant}: auto-closed ${busy.session_type} session ${busy.SessionId} — production batch starting`
          );
        } else if (endPrevious) {
          // Worker confirmed the switch (new LOT arrived) — auto-end the plant's
          // current batch, preserving ITS own ProcessedPieces, then start the new
          // one below. The spray-plant poller supersedes its in-memory state to match.
          await query(
            `UPDATE dbo.AppSessions
                SET Status = 'COMPLETED', EndTime = GETDATE()
              WHERE SessionId = @sid AND Status = 'INPROCESS'`,
            { sid: busy.SessionId }
          );
        } else {
          const otherLot = busy.LotNo || "an unaccounted batch";
          return res.status(409).json({
            reason: "plant_busy",
            error: `${plant} is already running ${otherLot} (SessionId ${busy.SessionId}). Only one active batch per plant is allowed.`,
            existingSessionId: busy.SessionId,
            existingLotNo: busy.LotNo,
          });
        }
      }
    }

    const rows = await query(
      `INSERT INTO dbo.AppSessions (LotNo, IssueNoCounter, Plant, StartTime, ExpectedPieces)
       OUTPUT INSERTED.SessionId, INSERTED.LotNo, INSERTED.IssueNoCounter,
              INSERTED.Plant, INSERTED.StartTime, INSERTED.ExpectedPieces, INSERTED.Status
       VALUES (@lotNo, @issueNoCounter, @plant, COALESCE(@startTime, GETDATE()), @expectedPieces)`,
      {
        lotNo: resolvedLotNo,
        issueNoCounter,
        plant: plant || null,
        startTime: startTime ? new Date(startTime) : null,
        expectedPieces,
      }
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("create session error:", err.message);
    res.status(500).json({ error: "Failed to start session" });
  }
});

// Assign OR change (edit/correct) the LOT on a session.
// Body: { lotNo }. Backend resolves IssueNoCounter + PCS from WBIssuance_Info.
// Two uses on the SAME endpoint (both keep the same SessionId):
//   - Unaccounted session (LotNo IS NULL) → assigns a LOT for the first time.
//   - Accounted session (LotNo already set) → corrects a mistaken LOT#.
// Either way StartTime / EndTime / ProcessedPieces / Status are preserved; only the
// LOT identity (LotNo, IssueNoCounter) and ExpectedPieces change.
//
// A WASHING / COLOR_MATCHING / MAINTENANCE session is REJECTED here. Those rows also
// have LotNo = NULL, so they look like unaccounted sessions in the app's list — but
// they are machine states, not production batches. Stamping a LOT on one makes the
// spray-plant poller adopt it as a production session and count pieces into it.
app.patch("/api/sessions/:id/assign-lot", async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const { lotNo } = req.body || {};
    if (!lotNo) return res.status(400).json({ error: "lotNo is required" });

    // Reject mode sessions before touching anything.
    const target = await query(
      `SELECT TOP 1 SessionId, Plant, Status, session_type
         FROM dbo.AppSessions WHERE SessionId = @id`,
      { id: sessionId }
    );
    if (target.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }
    // The row is identified by SessionId, so there is nothing to silently substitute
    // here — a scoped account touching another plant's session is simply refused.
    if (req.forcedPlant && target[0].Plant !== req.forcedPlant) {
      return plantForbidden(res, req.forcedPlant);
    }
    if (isModeSession(target[0].session_type)) {
      const t = String(target[0].session_type).toUpperCase();
      return res.status(409).json({
        reason: "mode_session",
        error: `SessionId ${sessionId} is a ${t} session on ${target[0].Plant}, not a production batch — a LOT cannot be assigned to it. Start a new session on ${target[0].Plant} instead; that will close the ${t} session automatically.`,
        sessionType: t,
        plant: target[0].Plant,
      });
    }

    const lot = await lookupLot(lotNo);
    if (!lot) {
      return res.status(404).json({ error: `LOT '${lotNo}' not found in WBIssuance_Info` });
    }
    const expectedPieces = lot.PCS != null ? Math.round(Number(lot.PCS)) : null;

    // Global concurrent guard — the target LOT cannot be INPROCESS on a DIFFERENT
    // session (excluding this one, so re-picking the same LOT is a no-op, not a conflict).
    const dup = await query(
      `SELECT TOP 1 SessionId, Plant FROM dbo.AppSessions
        WHERE LotNo = @lotNo AND Status = 'INPROCESS' AND SessionId <> @id`,
      { lotNo: String(lot.LotNo), id: sessionId }
    );
    if (dup.length > 0) {
      return res.status(409).json({
        error: `LOT '${lot.LotNo}' is currently running on ${dup[0].Plant || "another plant"} (SessionId ${dup[0].SessionId}). Cannot assign until it completes.`,
        existingSessionId: dup[0].SessionId,
        existingPlant: dup[0].Plant,
      });
    }

    // Same SessionId — relabel only. No `LotNo IS NULL` restriction, so this works
    // for both first-time assign and correcting an existing LOT#. The session_type
    // guard below is a belt-and-braces repeat of the check above: it makes the UPDATE
    // itself a no-op on a mode row even if one is somehow reached.
    const rows = await query(
      `UPDATE dbo.AppSessions
          SET LotNo = @lotNo, IssueNoCounter = @issueNoCounter, ExpectedPieces = @expectedPieces
       OUTPUT INSERTED.SessionId, INSERTED.LotNo, INSERTED.IssueNoCounter,
              INSERTED.Plant, INSERTED.StartTime, INSERTED.EndTime,
              INSERTED.ExpectedPieces, INSERTED.ProcessedPieces, INSERTED.Status,
              INSERTED.session_type
        WHERE SessionId = @id
          AND (session_type IS NULL OR session_type NOT IN ('WASHING', 'COLOR_MATCHING', 'MAINTENANCE'))`,
      {
        id: sessionId,
        lotNo: String(lot.LotNo),
        issueNoCounter: lot.IssueNoCounter,
        expectedPieces,
      }
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("assign-lot error:", err.message);
    res.status(500).json({ error: "Failed to assign LOT" });
  }
});

// Active sessions — all INPROCESS rows, with lot details joined in.
// Optional ?plant= filter. A "user" account is silently forced to their own plant.
// IMPORTANT: this route MUST come before GET /api/sessions/:id — Express matches top-to-bottom
// and would otherwise try to parse the literal string "active" as a session ID.
app.get("/api/sessions/active", async (req, res) => {
  try {
    const { plant: requestedPlant } = req.query;
    const plant = req.forcedPlant || requestedPlant;
    const clauses = ["s.Status = 'INPROCESS'"];
    const params = {};
    if (plant) { clauses.push("s.Plant = @plant"); params.plant = plant; }

    const rows = await query(
      `SELECT s.SessionId, s.Plant, s.LotNo, s.Status, s.session_type,
              s.ProcessedPieces, s.ExpectedPieces, s.StartTime,
              wb.OrderNo, wb.ArticleName, wb.ColourName, wb.PartyName, wb.PK
         FROM dbo.AppSessions s
         LEFT JOIN dbo.WBIssuance_Info wb ON wb.IssueNoCounter = s.IssueNoCounter
        WHERE ${clauses.join(" AND ")}
        ORDER BY s.SessionId DESC`,
      params
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error("active sessions error:", err.message);
    res.status(500).json({ error: "Failed to fetch active sessions" });
  }
});

// List sessions with lot details (JOIN with WBIssuance_Info for OrderNo/Article/Colour).
// Optional filters: plant, status, date (YYYY-MM-DD — matches sessions started on that day).
// session_type is returned so the app can tell a production batch (NULL) apart from a
// machine-state session (WASHING / COLOR_MATCHING / MAINTENANCE) and hide "Assign LOT"
// on the latter — they have LotNo = NULL and would otherwise look like unaccounted rows.
app.get("/api/sessions", async (req, res) => {
  try {
    const { plant: requestedPlant, status, date } = req.query;
    // Same pinning as POST /api/sessions — a scoped account only ever sees its own
    // plant's sessions, whatever `plant` the query string asked for.
    const plant = req.forcedPlant || requestedPlant;
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
    const clauses = [];
    const params = { limit };
    if (plant) { clauses.push("s.Plant = @plant"); params.plant = plant; }
    if (status) { clauses.push("s.Status = @status"); params.status = status; }
    if (date) { clauses.push("CAST(s.StartTime AS DATE) = @date"); params.date = date; }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const rows = await query(
      `SELECT
         s.SessionId, s.LotNo, s.IssueNoCounter, s.Plant,
         s.StartTime, s.EndTime, s.ExpectedPieces, s.ProcessedPieces, s.Status,
         s.session_type,
         wb.OrderNo, wb.ArticleName, wb.ColourName, wb.PartyName, wb.PK
       FROM dbo.AppSessions s
       LEFT JOIN dbo.WBIssuance_Info wb ON wb.IssueNoCounter = s.IssueNoCounter
       ${where}
       ORDER BY s.StartTime DESC
       OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`,
      params
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error("list sessions error:", err.message);
    res.status(500).json({ error: "Failed to list sessions" });
  }
});

// Get one session (mobile polls this to see if spray-plant marked it complete).
app.get("/api/sessions/:id", async (req, res) => {
  try {
    const rows = await query(
      `SELECT SessionId, LotNo, IssueNoCounter, Plant,
              StartTime, EndTime, ExpectedPieces, ProcessedPieces, Status,
              session_type
       FROM dbo.AppSessions WHERE SessionId = @id`,
      { id: parseInt(req.params.id, 10) }
    );
    if (rows.length === 0) return res.status(404).json({ error: "Session not found" });
    if (req.forcedPlant && rows[0].Plant !== req.forcedPlant) {
      return plantForbidden(res, req.forcedPlant);
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("get session error:", err.message);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

// Mark a session ended (spray-plant integration).
// Body: { processedPieces?, endTime? }
//   - processedPieces: final piece count from the camera/AI model
//   - endTime: ISO timestamp of when session actually ended (e.g. moment of grace timeout).
//             If omitted, server's current time is used.
app.put("/api/sessions/:id/end", async (req, res) => {
  try {
    const { processedPieces, endTime } = req.body || {};
    const sessionId = parseInt(req.params.id, 10);

    // Same refusal as assign-lot: a scoped account may only end its own plant's session.
    if (req.forcedPlant) {
      const target = await query(
        `SELECT TOP 1 Plant FROM dbo.AppSessions WHERE SessionId = @id`,
        { id: sessionId }
      );
      if (target.length === 0) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (target[0].Plant !== req.forcedPlant) {
        return plantForbidden(res, req.forcedPlant);
      }
    }

    const rows = await query(
      `UPDATE dbo.AppSessions
       SET EndTime = COALESCE(@endTime, GETDATE()),
           Status = 'COMPLETED',
           ProcessedPieces = COALESCE(@pieces, ProcessedPieces)
       OUTPUT INSERTED.SessionId, INSERTED.LotNo, INSERTED.Plant,
              INSERTED.StartTime, INSERTED.EndTime, INSERTED.Status, INSERTED.ProcessedPieces
       WHERE SessionId = @id AND Status = 'INPROCESS'`,
      {
        id: sessionId,
        pieces: processedPieces != null ? parseInt(processedPieces, 10) : null,
        endTime: endTime ? new Date(endTime) : null,
      }
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Session not found or already completed" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("end session error:", err.message);
    res.status(500).json({ error: "Failed to end session" });
  }
});

// Live piece count for a single session — polled every ~4 s by the batch-status screen.
// Returns only the columns needed for the live display; intentionally lightweight.
// Plant-scoping applies (a "user" cannot poll another plant's session — 403).
app.get("/api/sessions/:id/live", async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      return res.status(400).json({ error: "Invalid session ID" });
    }

    const rows = await query(
      `SELECT SessionId, Plant, LotNo, Status, session_type,
              ProcessedPieces, ExpectedPieces, StartTime, EndTime
         FROM dbo.AppSessions
        WHERE SessionId = @id`,
      { id: sessionId }
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    // A scoped ("user") account must not poll another plant's session.
    if (req.forcedPlant && rows[0].Plant !== req.forcedPlant) {
      return plantForbidden(res, req.forcedPlant);
    }

    const s = rows[0];
    res.json({
      session_id: s.SessionId,
      plant: s.Plant,
      lot_no: s.LotNo ?? null,
      status: s.Status,
      session_type: s.session_type ?? null,
      processed_pieces: s.ProcessedPieces ?? 0,
      expected_pieces: s.ExpectedPieces ?? null,
      start_time: s.StartTime ? s.StartTime.toISOString() : null,
      end_time: s.EndTime ? s.EndTime.toISOString() : null,
    });
  } catch (err) {
    console.error("live session error:", err.message);
    res.status(500).json({ error: "Failed to fetch live session data" });
  }
});

// ---------- Notifications ----------

// History list for the bell screen. Scoped exactly like the session routes: a
// "user" only ever sees their own plant's notifications; an "admin" sees all.
// The live toast comes over the socket; this endpoint is the persisted backlog.
app.get("/api/notifications", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
    const where = req.forcedPlant ? "WHERE Plant = @plant" : "";
    const params = { limit };
    if (req.forcedPlant) params.plant = req.forcedPlant;

    const rows = await query(
      `SELECT NotificationId, Plant, EventType, Message, LotNo, SessionId, CreatedAt
         FROM dbo.PlantNotifications
         ${where}
        ORDER BY CreatedAt DESC
        OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`,
      params
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error("list notifications error:", err.message);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// ---------- 404 catch-all (debug) ----------
// Returns JSON instead of Express's default HTML page, and logs the unmatched URL.
app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.originalUrl} from ${req.ip} — no matching route`);
  res.status(404).json({
    error: `No route for ${req.method} ${req.originalUrl}`,
    method: req.method,
    url: req.originalUrl,
  });
});

// ---------- socket.io (live notifications) ----------

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Handshake auth — the SAME Clerk verification as the HTTP routes, so a socket is held
// to the same standard as a request. The token rides in socket.handshake.auth.token.
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Missing token"));
    const claims = await verifyToken(token);
    const mobile = getMobileAccess(claims);
    if (!mobile.enabled) return next(new Error("mobile_access_disabled"));
    socket.data.mobile = mobile;
    next();
  } catch (err) {
    next(new Error("Invalid or expired token"));
  }
});

// Room membership IS the plant scope: a "user" joins only their plant, an "admin"
// joins all six. The poller emits to io.to(plant), so a user never receives another
// plant's event — the same guarantee the HTTP routes give.
// (v1 note: the token is checked only at handshake; a long-lived socket can outlive the
//  ~60s token. Acceptable — payloads are non-sensitive "X is active" strings.)
io.on("connection", (socket) => {
  const mobile = socket.data.mobile;
  if (mobile.role === "user" && mobile.plant) {
    socket.join(mobile.plant);
  } else if (mobile.role === "admin") {
    PLANTS.forEach((p) => socket.join(p));
  }
});

// ---------- startup ----------

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`LeatherFlow SQL API running on port ${PORT}`);
  console.log(`[auth] Verifying Clerk tokens issued by ${ISSUER}`);
  try {
    await getPool();
  } catch (err) {
    console.error("[boot] Failed to warm DB pool:", err.message);
  }
  // Start the poller regardless — it seeds its own cursor and retries every tick, so a
  // transient DB failure at boot must not leave notifications permanently off.
  await startPoller(io);
});