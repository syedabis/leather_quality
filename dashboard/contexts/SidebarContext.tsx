"use client";
import { createContext, useContext } from 'react';

interface SidebarContextValue {
  collapsed: boolean;
  hidden: boolean;
}

export const SidebarContext = createContext<SidebarContextValue>({ collapsed: false, hidden: false });
export const useSidebar = () => useContext(SidebarContext);
