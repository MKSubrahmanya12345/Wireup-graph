/**
 * React hook that runs the avr8js core in the browser and exposes its state.
 *
 * The loop executes a fixed slice of simulated time per animation frame, so
 * the LED phase you see on screen is the phase of PORTB5 on the simulated
 * core — the UI reads the CPU, it does not drive it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AVRIOPort, CPU, avrInstruction, portBConfig } from 'avr8js';

import { CPU_HZ, assembleHeartbeat, cyclesToMs } from './avrProgram';

const LED_BIT = 5;
/** Simulated milliseconds executed per animation frame (~1× real time). */
const MS_PER_FRAME = 16;

export interface AvrHeartbeat {
  /** PORTB5 state on the simulated core. */
  ledOn: boolean;
  /** Simulated milliseconds since reset. */
  simMs: number;
  /** Instruction cycles retired. */
  cycles: number;
  /** Number of LED edges observed — proof the program is progressing. */
  edges: number;
  running: boolean;
  setRunning: (running: boolean) => void;
  reset: () => void;
}

export function useAvrHeartbeat(enabled = true): AvrHeartbeat {
  const [ledOn, setLedOn] = useState(false);
  const [simMs, setSimMs] = useState(0);
  const [cycles, setCycles] = useState(0);
  const [edges, setEdges] = useState(0);
  const [running, setRunning] = useState(enabled);
  const [generation, setGeneration] = useState(0);

  const frameRef = useRef<number | null>(null);

  const reset = useCallback(() => {
    setGeneration((value) => value + 1);
    setSimMs(0);
    setCycles(0);
    setEdges(0);
    setLedOn(false);
  }, []);

  useEffect(() => {
    if (!running) return undefined;

    const cpu = new CPU(assembleHeartbeat());
    const port = new AVRIOPort(cpu, portBConfig);
    let last = false;
    let edgeCount = 0;
    let stopped = false;

    port.addListener((value) => {
      const next = (value & (1 << LED_BIT)) !== 0;
      if (next !== last) {
        last = next;
        edgeCount += 1;
      }
    });

    const cyclesPerFrame = Math.round((CPU_HZ * MS_PER_FRAME) / 1000);

    const step = () => {
      if (stopped) return;
      const target = cpu.cycles + cyclesPerFrame;
      while (cpu.cycles < target) avrInstruction(cpu);
      setLedOn(last);
      setEdges(edgeCount);
      setCycles(cpu.cycles);
      setSimMs(cyclesToMs(cpu.cycles));
      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      stopped = true;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [running, generation]);

  return { ledOn, simMs, cycles, edges, running, setRunning, reset };
}
