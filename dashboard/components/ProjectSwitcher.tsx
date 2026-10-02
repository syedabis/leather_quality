"use client";

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useProject, PROJECTS, ProjectId } from '../contexts/ProjectContext';
import { FiChevronDown, FiCheck, FiLayers, FiActivity, FiRefreshCw } from 'react-icons/fi';

interface ProjectSwitcherProps {
  variant?: 'header' | 'sidebar';
  collapsed?: boolean;
}

export default function ProjectSwitcher({ variant = 'header', collapsed = false }: ProjectSwitcherProps) {
  const { activeProject, projectMeta, switchProject } = useProject();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [dropdownOpen]);

  // Header Segmented Pill Variant
  if (variant === 'header') {
    return (
      <div className="flex items-center gap-1.5 p-1 rounded-xl bg-gray-100 dark:bg-[#1f1f1f] border border-gray-200 dark:border-[#2e2e2e]">
        {(['working-desk', 'dust-plant'] as ProjectId[]).map((id) => {
          const item = PROJECTS[id];
          const isActive = activeProject === id;
          return (
            <button
              key={id}
              onClick={() => switchProject(id)}
              className={`relative flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-semibold transition-all duration-200 select-none ${
                isActive
                  ? 'text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="header-project-pill"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  className={`absolute inset-0 rounded-lg border ${
                    id === 'working-desk'
                      ? 'bg-white dark:bg-[#282828] border-emerald-500/30 dark:border-emerald-500/40 text-emerald-600'
                      : 'bg-white dark:bg-[#282828] border-sky-500/30 dark:border-sky-500/40 text-sky-500'
                  }`}
                />
              )}
              <span className="relative z-10 text-sm leading-none">{item.icon}</span>
              <span className="relative z-10 hidden sm:inline whitespace-nowrap">{item.name}</span>
              {isActive && (
                <span
                  className={`relative z-10 text-[9px] uppercase px-1.5 py-0.5 rounded-full font-bold tracking-wider ${
                    id === 'working-desk'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                  }`}
                >
                  Active
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // Sidebar Variant - Collapsed Mode
  if (collapsed) {
    return (
      <div className="relative flex justify-center mb-3">
        <button
          onClick={() => switchProject(activeProject === 'working-desk' ? 'dust-plant' : 'working-desk')}
          title={`Active: ${projectMeta.name} (Click to switch to ${activeProject === 'working-desk' ? 'Dust Plant' : 'Working Desk'})`}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 border ${
            activeProject === 'working-desk'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20'
              : 'bg-sky-500/10 border-sky-500/30 text-sky-500 hover:bg-sky-500/20'
          }`}
        >
          <span className="text-lg">{projectMeta.icon}</span>
        </button>
      </div>
    );
  }

  // Sidebar Variant - Expanded Mode
  return (
    <div ref={dropdownRef} className="relative mb-3 px-2">
      <div
        onClick={() => setDropdownOpen(!dropdownOpen)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setDropdownOpen(!dropdownOpen);
          }
        }}
        className={`w-full text-left p-2.5 rounded-xl border transition-all duration-200 cursor-pointer ${
          activeProject === 'working-desk'
            ? 'bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/25 dark:border-emerald-500/20'
            : 'bg-sky-500/5 hover:bg-sky-500/10 border-sky-500/25 dark:border-sky-500/20'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${
                activeProject === 'working-desk'
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
              }`}
            >
              {projectMeta.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-bold text-gray-900 dark:text-white truncate">
                  {projectMeta.name}
                </p>
              </div>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                {projectMeta.badge}
              </p>
            </div>
          </div>
          <FiChevronDown
            className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
              dropdownOpen ? 'rotate-180' : ''
            }`}
          />
        </div>

        {/* Quick Segmented mini-bar in sidebar card */}
        <div className="mt-2 pt-2 border-t border-gray-200/60 dark:border-gray-800/80 flex gap-1">
          {(['working-desk', 'dust-plant'] as ProjectId[]).map((id) => {
            const isCur = activeProject === id;
            return (
              <button
                key={id}
                onClick={(e) => {
                  e.stopPropagation();
                  switchProject(id);
                  setDropdownOpen(false);
                }}
                className={`flex-1 py-1 px-1.5 rounded-md text-[10px] font-semibold transition-all select-none text-center ${
                  isCur
                    ? id === 'working-desk'
                      ? 'bg-emerald-500 text-white shadow-xs'
                      : 'bg-sky-500 text-white shadow-xs'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                {id === 'working-desk' ? 'Desk' : 'Plant'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {dropdownOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute left-2 right-2 top-full mt-1.5 z-50 rounded-xl bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2e2e2e] shadow-xl p-1.5 space-y-1"
          >
            <div className="px-2 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              Switch Project Workspace
            </div>
            {(['working-desk', 'dust-plant'] as ProjectId[]).map((id) => {
              const item = PROJECTS[id];
              const isSelected = activeProject === id;
              return (
                <button
                  key={id}
                  onClick={() => {
                    switchProject(id);
                    setDropdownOpen(false);
                  }}
                  className={`w-full flex items-start gap-2.5 p-2 rounded-lg text-left transition-all ${
                    isSelected
                      ? id === 'working-desk'
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'
                        : 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20'
                      : 'hover:bg-gray-100 dark:hover:bg-[#252525] text-gray-700 dark:text-gray-300 border border-transparent'
                  }`}
                >
                  <span className="text-base mt-0.5">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">{item.name}</span>
                      {isSelected && <FiCheck className="w-3.5 h-3.5" />}
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-1">
                      {item.tagline}
                    </p>
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
