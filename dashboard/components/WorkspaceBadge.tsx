"use client";

import React from 'react';
import Link from 'next/link';
import { ProjectId, PROJECTS } from '../contexts/ProjectContext';
import { FiArrowRight } from 'react-icons/fi';

interface WorkspaceBadgeProps {
  project: ProjectId;
  subtitle?: string;
  showAlternateLink?: boolean;
}

export default function WorkspaceBadge({
  project,
  subtitle,
  showAlternateLink = true,
}: WorkspaceBadgeProps) {
  const meta = PROJECTS[project];
  const altId: ProjectId = project === 'working-desk' ? 'dust-plant' : 'working-desk';
  const altMeta = PROJECTS[altId];

  const isDesk = project === 'working-desk';

  return (
    <div
      className={`inline-flex items-center gap-3 px-3 py-1.5 rounded-xl border text-xs mb-3 shadow-xs ${
        isDesk
          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-800 dark:text-emerald-300'
          : 'bg-sky-500/10 border-sky-500/25 text-sky-800 dark:text-sky-300'
      }`}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        <span className="text-sm">{meta.icon}</span>
        <span className="font-bold">{meta.name}</span>
        <span className="opacity-50">•</span>
        <span className="font-normal opacity-90">
          {subtitle || (isDesk ? 'Overhead Camera Leather Grading Station' : 'Conveyor Belt In-Line Cut Detection')}
        </span>
      </div>

      {showAlternateLink && (
        <Link
          href={altMeta.defaultHref}
          className={`flex items-center gap-1 pl-2 border-l text-[11px] font-semibold underline-offset-2 hover:underline transition-colors ${
            isDesk
              ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:text-emerald-900'
              : 'border-sky-500/30 text-sky-700 dark:text-sky-400 hover:text-sky-900'
          }`}
        >
          <span>Switch to {altMeta.name}</span>
          <FiArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}
