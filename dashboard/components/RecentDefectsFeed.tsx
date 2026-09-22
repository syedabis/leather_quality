"use client";
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { API_URL } from '../lib/constants';

interface DefectLog {
  id: number;
  hide_id: string;
  plant_id: string;
  defect_type: string;
  confidence: number;
  bbox: number[];
  severity: string;
  timestamp: string;
  grade: string;
}

export default function RecentDefectsFeed() {
  const [defects, setDefects] = useState<DefectLog[]>([]);

  useEffect(() => {
    const fetchDefects = async () => {
      try {
        const res = await fetch(`${API_URL}/api/quality/defects?limit=10`);
        if (res.ok) {
          const data = await res.json();
          setDefects(data);
        }
      } catch (err) {
        // Fallback
        setDefects([
          {
            id: 1,
            hide_id: "HIDE-1042",
            plant_id: "SP-01",
            defect_type: "CUT",
            confidence: 0.94,
            bbox: [120, 180, 45, 12],
            severity: "HIGH",
            timestamp: new Date().toISOString(),
            grade: "REJECT",
          },
          {
            id: 2,
            hide_id: "HIDE-1039",
            plant_id: "SP-01",
            defect_type: "HOLE",
            confidence: 0.88,
            bbox: [310, 220, 25, 25],
            severity: "MEDIUM",
            timestamp: new Date().toISOString(),
            grade: "REJECT",
          },
        ]);
      }
    };

    fetchDefects();
    const interval = setInterval(fetchDefects, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-4 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
          Recent Defect Detections
        </h3>
        <span className="text-[10px] bg-rose-500/10 text-rose-500 px-2 py-0.5 rounded-full font-semibold">
          Live Audit
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[220px]">
        {defects.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">
            No defects logged recently
          </div>
        ) : (
          defects.map((d) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center justify-between bg-gray-50 dark:bg-[#111111] border border-gray-100 dark:border-[#2a2a2a] p-2.5 rounded-xl text-xs"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    d.defect_type === 'CUT'
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {d.defect_type}
                </span>
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {d.hide_id} <span className="text-gray-400 text-[10px]">({d.plant_id})</span>
                  </p>
                  <p className="text-[10px] text-gray-400">
                    Conf: {(d.confidence * 100).toFixed(0)}% | BBox: [{d.bbox.join(', ')}]
                  </p>
                </div>
              </div>

              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500 text-white">
                REJECT
              </span>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
