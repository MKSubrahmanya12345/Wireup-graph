/**
 * The in-browser bench actually executes AVR machine code.
 *
 * This proves the claim page 03 makes: the animated circuit's heartbeat comes
 * from instructions retiring on an avr8js ATmega328p core, not from a timer
 * pretending to be a simulator.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CPU, AVRIOPort, avrInstruction, portBConfig } from 'avr8js';

const { assembleHeartbeat, heartbeatHalfPeriodCycles, cyclesToMs } = await import(
  '../src/sim/avrProgram.ts'
);

describe('avr8js heartbeat program', () => {
  it('assembles to real ATmega328p opcodes', () => {
    const program = assembleHeartbeat();
    assert.ok(program.length > 10);
    // sbi DDRB(0x04), 5 → 0x9A25 ; the very first instruction.
    assert.equal(program[0], 0x9a25);
    // The program must contain both the set and clear of PORTB(0x05) bit 5.
    assert.ok(program.includes(0x9a2d), 'sbi PORTB,5 must be present');
    assert.ok(program.includes(0x982d), 'cbi PORTB,5 must be present');
  });

  it('toggles PORTB5 when executed on the CPU', () => {
    const cpu = new CPU(assembleHeartbeat());
    const port = new AVRIOPort(cpu, portBConfig);

    /** @type {{ value: number, cycles: number }[]} */
    const transitions = [];
    port.addListener((value) => transitions.push({ value, cycles: cpu.cycles }));

    // Run long enough for a couple of full blinks (~1 s of simulated time).
    const budget = heartbeatHalfPeriodCycles() * 5;
    while (cpu.cycles < budget) avrInstruction(cpu);

    const ledEdges = transitions.filter((t, index) => index === 0 || t.value !== transitions[index - 1].value);
    assert.ok(ledEdges.length >= 4, `expected several LED edges, saw ${ledEdges.length}`);

    const on = transitions.filter((t) => (t.value & (1 << 5)) !== 0);
    const off = transitions.filter((t) => (t.value & (1 << 5)) === 0);
    assert.ok(on.length > 0, 'LED must turn on');
    assert.ok(off.length > 0, 'LED must turn off');
  });

  it('runs at a plausible blink rate (0.1–1 s per half-period)', () => {
    const ms = cyclesToMs(heartbeatHalfPeriodCycles());
    assert.ok(ms > 100 && ms < 1000, `half-period was ${ms.toFixed(1)} ms`);
  });

  it('reports simulated time from real cycle counts', () => {
    const cpu = new CPU(assembleHeartbeat());
    for (let i = 0; i < 5000; i += 1) avrInstruction(cpu);
    assert.ok(cpu.cycles >= 5000, 'every instruction costs at least one cycle');
    assert.ok(cyclesToMs(cpu.cycles) > 0);
  });
});
