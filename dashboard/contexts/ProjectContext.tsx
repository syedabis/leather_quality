"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { IconType } from 'react-icons';
import { FiGrid, FiLayers, FiMap, FiVideo, FiList, FiFileText, FiBell, FiUsers, FiTable } from 'react-icons/fi';

export type ProjectId = 'working-desk' | 'dust-plant';

export interface NavRoute {
  href: string;
  label: string;
  icon: IconType;
  adminOnly?: boolean;
  badge?: string;
  description?: string;
}

export interface ProjectMeta {
  id: ProjectId;
  name: string;
  shortName: string;
  tagline: string;
  badge: string;
  icon: string; // emoji or identifier
  accentColor: string;
  defaultHref: string;
  routes: NavRoute[];
}

export const PROJECTS: Record<ProjectId, ProjectMeta> = {
  'working-desk': {
    id: 'working-desk',
    name: 'Working Desk',
    shortName: 'Desk Station',
    tagline: 'Overhead 12.3MP Leather Grading & Defect Catalog',
    badge: 'Grading Bed',
    icon: '🖥️',
    accentColor: '#2AAA8A',
    defaultHref: '/overview',
    routes: [
      {
        href: '/overview',
        label: 'Desk Overview',
        icon: FiGrid,
        description: 'Throughput, quality Pareto & desk telemetry',
      },
      {
        href: '/piece-view',
        label: 'Piece View',
        icon: FiLayers,
        badge: 'Grading',
        description: 'Mindhive FinishSelect 16-code scan & contours',
      },
      {
        href: '/piece-log',
        label: 'Inspection Log',
        icon: FiTable,
        badge: 'Data Table',
        description: 'Complete tabular audit trail of all scanned hides & defects',
      },
      {
        href: '/desk-monitoring',
        label: 'Live Monitoring',
        icon: FiVideo,
        badge: 'Live',
        description: 'Overhead 12.3MP optical inspection feeds — Desks 01 to 06',
      },
      {
        href: '/sessions',
        label: 'Desk Lots',
        icon: FiList,
        description: 'Inspection lots & accounted batch records',
      },
    ],
  },
  'dust-plant': {
    id: 'dust-plant',
    name: 'Dust Plant',
    shortName: 'Dust Conveyor',
    tagline: 'Continuous Conveyor Belt Cut & Tear Detection',
    badge: 'Conveyor Lines',
    icon: '🏭',
    accentColor: '#0ea5e9',
    defaultHref: '/dust-overview',
    routes: [
      {
        href: '/dust-overview',
        label: 'Plant Overview',
        icon: FiGrid,
        description: 'Conveyor telemetry, throughput & line efficiency',
      },
      {
        href: '/floor-view',
        label: 'Floor View',
        icon: FiMap,
        description: 'Plant lines SP-01 & SP-02 status cards & live cuts',
      },
      {
        href: '/monitoring',
        label: 'Live Monitoring',
        icon: FiVideo,
        adminOnly: true,
        badge: 'Live',
        description: 'Multi-camera conveyor video streams',
      },
      {
        href: '/sessions',
        label: 'Line Sessions',
        icon: FiList,
        description: 'Belt run sessions, idle tracking & modes',
      },
    ],
  },
};

export const SYSTEM_ROUTES: NavRoute[] = [
  { href: '/reports', label: 'Reports', icon: FiFileText, description: 'Shift reports & Excel exports' },
  { href: '/notifications', label: 'Notifications', icon: FiBell, description: 'System health & camera alerts' },
  { href: '/users', label: 'Users', icon: FiUsers, adminOnly: true, description: 'Operator & admin access' },
];

interface ProjectContextValue {
  activeProject: ProjectId;
  projectMeta: ProjectMeta;
  setProject: (id: ProjectId) => void;
  switchProject: (id: ProjectId) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = 'dada_selected_project_v1';

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // Determine initial project based on current URL if possible
  const getProjectFromPath = useCallback((path: string): ProjectId | null => {
    if (path.startsWith('/overview') || path.startsWith('/piece-view') || path.startsWith('/piece-log') || path.startsWith('/desk-monitoring')) {
      return 'working-desk';
    }
    if (path.startsWith('/floor-view') || path.startsWith('/monitoring') || path.startsWith('/dust-overview')) {
      return 'dust-plant';
    }
    return null;
  }, []);

  const [activeProject, setActiveProject] = useState<ProjectId>('working-desk');

  // Load from localStorage on mount or auto-detect from path
  useEffect(() => {
    const fromPath = getProjectFromPath(pathname);
    if (fromPath) {
      setActiveProject(fromPath);
      try {
        localStorage.setItem(STORAGE_KEY, fromPath);
      } catch {}
      return;
    }

    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ProjectId;
      if (saved && (saved === 'working-desk' || saved === 'dust-plant')) {
        setActiveProject(saved);
      }
    } catch {}
  }, [pathname, getProjectFromPath]);

  // Keep project in sync when user navigates directly
  useEffect(() => {
    const fromPath = getProjectFromPath(pathname);
    if (fromPath && fromPath !== activeProject) {
      setActiveProject(fromPath);
      try {
        localStorage.setItem(STORAGE_KEY, fromPath);
      } catch {}
    }
  }, [pathname, activeProject, getProjectFromPath]);

  const setProject = useCallback((id: ProjectId) => {
    setActiveProject(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
  }, []);

  const switchProject = useCallback((targetId: ProjectId) => {
    setProject(targetId);
    const targetMeta = PROJECTS[targetId];

    // If currently on a project-specific route of the other project, route to target default
    const isDeskRoute = pathname.startsWith('/overview') || pathname.startsWith('/piece-view') || pathname.startsWith('/piece-log');
    const isPlantRoute = pathname.startsWith('/floor-view') || pathname.startsWith('/monitoring') || pathname.startsWith('/dust-overview');

    if (targetId === 'working-desk' && isPlantRoute) {
      router.push(targetMeta.defaultHref);
    } else if (targetId === 'dust-plant' && isDeskRoute) {
      router.push(targetMeta.defaultHref);
    }
  }, [pathname, router, setProject]);

  const projectMeta = useMemo(() => PROJECTS[activeProject], [activeProject]);

  return (
    <ProjectContext.Provider value={{ activeProject, projectMeta, setProject, switchProject }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return ctx;
}
