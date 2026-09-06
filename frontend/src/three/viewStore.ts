/**
 * viewStore.ts — view-only 3D viewport state (never sent to the server).
 *
 * Camera presets are delivered as a monotonically-increasing command so the
 * Canvas-side rig can react without remounting the whole scene.
 */

import { create } from 'zustand';

export type CamPreset = 'iso' | 'top' | 'front' | 'reset';

interface View3DState {
  autoRotate: boolean;
  showGrid: boolean;
  showWires: boolean;
  showLabels: boolean;
  camCmd: { kind: CamPreset; n: number };
  toggleAutoRotate: () => void;
  toggleGrid: () => void;
  toggleWires: () => void;
  toggleLabels: () => void;
  sendCam: (kind: CamPreset) => void;
}

export const useView3D = create<View3DState>()((set) => ({
  autoRotate: false,
  showGrid: true,
  showWires: true,
  showLabels: true,
  camCmd: { kind: 'iso', n: 0 },
  toggleAutoRotate: () => set((s) => ({ autoRotate: !s.autoRotate })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleWires: () => set((s) => ({ showWires: !s.showWires })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  sendCam: (kind) => set((s) => ({ camCmd: { kind, n: s.camCmd.n + 1 } })),
}));
