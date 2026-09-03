import { create } from 'zustand';
import type { AgenticEvent, ErrorContext, StageProgress, ConnectionHealth } from '../types/build';

interface DebugState {
  isConsoleOpen: boolean;
  events: AgenticEvent[];
  errorContexts: ErrorContext[];
  
  // Actions
  toggleConsole: () => void;
  addEvent: (event: AgenticEvent) => void;
  clearEvents: () => void;
  exportLogs: () => string;
}

const MAX_EVENTS = 2000;

export const useDebugStore = create<DebugState>((set, get) => ({
  isConsoleOpen: localStorage.getItem('debug-console-open') === 'true',
  events: [],
  errorContexts: [],

  toggleConsole: () => {
    set((state) => {
      const newState = !state.isConsoleOpen;
      localStorage.setItem('debug-console-open', String(newState));
      return { isConsoleOpen: newState };
    });
  },

  addEvent: (event: AgenticEvent) => {
    set((state) => {
      const newEvents = [...state.events, { ...event, debugTimestamp: Date.now() }];
      
      // Keep only the latest events to prevent memory issues
      const trimmedEvents = newEvents.length > MAX_EVENTS 
        ? newEvents.slice(-MAX_EVENTS) 
        : newEvents;

      // Extract error contexts
      let newErrorContexts = [...state.errorContexts];
      if (event.type === 'error_context') {
        newErrorContexts.push(event.context);
        // Keep only latest 100 error contexts
        if (newErrorContexts.length > 100) {
          newErrorContexts = newErrorContexts.slice(-100);
        }
      }

      return { 
        events: trimmedEvents,
        errorContexts: newErrorContexts
      };
    });
  },

  clearEvents: () => {
    set({ events: [], errorContexts: [] });
  },

  exportLogs: () => {
    const state = get();
    const exportData = {
      timestamp: new Date().toISOString(),
      totalEvents: state.events.length,
      totalErrors: state.errorContexts.length,
      events: state.events,
      errorContexts: state.errorContexts,
    };
    return JSON.stringify(exportData, null, 2);
  },
}));