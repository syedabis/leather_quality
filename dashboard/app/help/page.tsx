"use client";
import { motion } from 'framer-motion';
import {
  FiBookOpen, FiList, FiVideo, FiMap, FiFileText, FiSliders,
} from 'react-icons/fi';

// ── Small shared bits (same inline-card convention as every other page) ────

function Card({ icon: Icon, title, children, delay = 0 }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-6 shadow-sm"
    >
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-[#2AAA8A]" />
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">{title}</p>
      </div>
      {children}
    </motion.div>
  );
}

function Term({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold text-gray-900 dark:text-white">{term}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{children}</p>
    </div>
  );
}

function ShapeRow({ shape, mode }: { shape: string; mode: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-[#111111] rounded-xl">
      <span className="text-xs font-bold text-gray-900 dark:text-white w-20 flex-shrink-0">{shape}</span>
      <span className="text-gray-300 dark:text-gray-600">&rarr;</span>
      <span className="text-xs font-semibold text-[#2AAA8A]">{mode}</span>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────

export default function Help() {
  return (
    <div className="min-h-screen bg-background p-6">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h1 className="text-2xl font-bold font-[family-name:var(--font-inter-tight)] tracking-tight text-gray-900 dark:text-white">
          Help &amp; Reference
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">Quick reference for terms, configuration, and what each page shows</p>
      </motion.div>

      <div className="mt-6 max-w-3xl space-y-4">

        {/* ── Definitions ── */}
        <Card icon={FiBookOpen} title="Definitions" delay={0.05}>
          <div className="space-y-3">
            <Term term="Active">A piece or shape was detected in the camera&apos;s zone within the last 30 seconds.</Term>
            <Term term="Idle">Nothing detected in the zone for 30+ seconds straight.</Term>
            <Term term="IDLE TIME (row)">Idle time with no session running at all &mdash; a gap between sessions.</Term>
            <Term term="Session Idle (column)">Idle time that happened during an active session, subtracted from its Active Time.</Term>
            <Term term="Accounted session">A LOT assigned via the mobile app &mdash; has Party / Order / Colour / Article / Expected Pieces.</Term>
            <Term term="Unaccounted session">Pieces detected with no LOT assigned. Auto-starts after several pieces in a row with nothing else running.</Term>
            <Term term="Mode session (WASHING / COLOR MATCHING / MAINTENANCE)">Triggered by a shape card, not tied to a LOT.</Term>
          </div>
        </Card>

        {/* ── Shape cards ── */}
        <Card icon={FiList} title="Shape Cards" delay={0.08}>
          <div className="space-y-2">
            <ShapeRow shape="Star"     mode="WASHING" />
            <ShapeRow shape="Plus"     mode="COLOR MATCHING" />
            <ShapeRow shape="Triangle" mode="MAINTENANCE" />
            <ShapeRow shape="Arrow"    mode="Ends MAINTENANCE" />
          </div>
          <p className="text-[11px] text-gray-400 mt-3">
            A new LOT starting, or break time starting, now also force-ends any active mode &mdash; not just Arrow.
          </p>

          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-[#2c2c2c] space-y-2.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1">How Each Mode Ends</p>
            <Term term="WASHING">20 min idle, or 10 pieces within 50s, or Arrow, or new LOT, or break starts.</Term>
            <Term term="COLOR MATCHING">10 pieces within 50s, or Arrow, or new LOT, or break starts.</Term>
            <Term term="MAINTENANCE">Arrow, or new LOT, or break starts.</Term>
          </div>
        </Card>

        {/* ── Settings ── */}
        <Card icon={FiSliders} title="Settings (Admin Only) — What Each One Does" delay={0.11}>
          <div className="space-y-3">
            <Term term="Idle Timeout (default 30s)">No pieces for this long &rarr; Idle. Needs an inference restart to apply.</Term>
            <Term term="Downtime Threshold (default 300s)">Idle longer than this counts as a Downtime event in reports.</Term>
            <Term term="Shift Hours">Idle/downtime is only tracked inside this window.</Term>
            <Term term="Break Times (Weekday / Friday separate)">Excluded from idle accumulation. Picked up automatically within minutes &mdash; no restart needed.</Term>
            <Term term="Weekly Off Days">Entire days treated as off, nothing counted. Floor View shows &ldquo;Offline &middot; Day Off&rdquo;. Only evaluated once at inference startup.</Term>
            <Term term="Holidays">Same as weekly off, for specific dates. Checked periodically &mdash; no restart needed.</Term>
            <Term term="Plant Targets">Daily piece target per plant or &ldquo;All Plants&rdquo;, used for Reports&apos; Achievement %.</Term>
            <Term term="Database Management">Permanently wipes all counts / sessions / idle data. Cannot be undone.</Term>
          </div>
        </Card>

        {/* ── Floor View ── */}
        <Card icon={FiMap} title="Floor View" delay={0.14}>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Per-plant live card: current LOT/mode, Party / Order / Colour / Article, Current vs. Expected pieces,
            session timer, live camera thumbnail, status (Running / Idle / Offline / Break / Holiday / Weekly Off).
            Keeps showing real numbers during a database outage instead of going blank.
          </p>
        </Card>

        {/* ── Reports ── */}
        <Card icon={FiFileText} title="Reports" delay={0.17}>
          <div className="space-y-3">
            <Term term="Daily Summary">Plant utilization % and pieces vs. daily target, for one day.</Term>
            <Term term="Daily Detail">Full session timeline per plant &mdash; each row&apos;s duration split into Active Time and Session Idle.</Term>
            <Term term="Plant Wise">Run time / idle time / pieces across a date range, per plant.</Term>
          </div>
        </Card>

        {/* ── Sessions ── */}
        <Card icon={FiVideo} title="Sessions" delay={0.2}>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            A flat, searchable/filterable log of every session ever recorded, all plants, all types &mdash;
            Lot, Party / Order / Article / Colour, Start / End, Duration, Pieces, Status.
          </p>
        </Card>

      </div>
    </div>
  );
}
