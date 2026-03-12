'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type DashboardSearchContextType = {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
};

const DashboardSearchContext = createContext<DashboardSearchContextType | null>(null);

export function DashboardSearchProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState('');
  const setQuery = useCallback((q: string) => setSearchQuery(q ?? ''), []);
  return (
    <DashboardSearchContext.Provider value={{ searchQuery, setSearchQuery: setQuery }}>
      {children}
    </DashboardSearchContext.Provider>
  );
}

export function useDashboardSearch() {
  const ctx = useContext(DashboardSearchContext);
  if (!ctx) throw new Error('useDashboardSearch must be used within DashboardSearchProvider');
  return ctx;
}
