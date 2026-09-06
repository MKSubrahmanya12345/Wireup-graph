/**
 * ControlsPanel.tsx — Blender-style properties panel for the selected part.
 *
 * Sliders, press-and-hold buttons, toggles, key grids and text fields bound
 * through controlBindings — the same cells the 3D gestures and the 2D bench
 * tiles write. The header shows the true outline + mass so scale is always
 * auditable, and the footer shows the live readout the firmware would see.
 */

import { useCallback } from 'react';
import type { ArchitectureNode } from '../types/architecture';
import { identifyPart } from './partIdentity';
import { defForKey } from './sensorDefs';
import type { PartControl } from './sensorDefs';
import { LOG_STEPS, logSliderToValue, logValueToSlider, pressEnd, pressStart, readControl, tapKey, writeControl } from './controlBindings';
import { footprintLabel } from './dimensions';
import { dimForKey } from './dimensions';
import { resetIcState } from '../sim/circuitSim';
import { useSim3D } from './simStore';

function fmtValue(v: number, decimals?: number): string {
  return decimals !== undefined ? v.toFixed(decimals) : String(Math.round(v * 100) / 100);
}

function SliderRow({
  partKey,
  nodeId,
  control,
}: {
  partKey: string;
  nodeId: string;
  control: Extract<PartControl, { kind: 'slider' }>;
}) {
  // Subscribe to the whole store: the panel is small, correctness first.
  useSim3D();
  const raw = readControl(partKey, nodeId, control);
  const value = typeof raw === 'number' ? raw : control.def;
  const pos = control.log ? logValueToSlider(value, control.min, control.max) : value;

  const onPos = useCallback(
    (p: number) => {
      const v = control.log ? logSliderToValue(p, control.min, control.max) : p;
      writeControl(partKey, nodeId, control, v);
    },
    [partKey, nodeId, control],
  );

  return (
    <label className="ctl-row">
      <span className="ctl-name">
        {control.label}
        <em>
          {fmtValue(value, control.decimals)} {control.unit}
        </em>
      </span>
      <input
        type="range"
        min={control.log ? 0 : control.min}
        max={control.log ? LOG_STEPS : control.max}
        step={control.log ? 1 : control.step}
        value={pos}
        onChange={(e) => onPos(Number(e.target.value))}
        aria-label={control.label}
      />
    </label>
  );
}

function PressRow({ partKey, nodeId, control }: { partKey: string; nodeId: string; control: Extract<PartControl, { kind: 'press' }> }) {
  const active = useSim3D((s) => s.pressed[nodeId] === true);
  return (
    <div className="ctl-row">
      <button
        type="button"
        className={`ctl-press${active ? ' active' : ''}`}
        onPointerDown={() => pressStart(partKey, nodeId)}
        onPointerUp={() => pressEnd(partKey, nodeId)}
        onPointerLeave={() => pressEnd(partKey, nodeId)}
        title={control.hint ?? control.label}
      >
        {active ? '● ' : ''}
        {control.label}
      </button>
      {control.hint ? <span className="tiny muted">{control.hint}</span> : null}
    </div>
  );
}

function ToggleRow({ partKey, nodeId, control }: { partKey: string; nodeId: string; control: Extract<PartControl, { kind: 'toggle' }> }) {
  useSim3D();
  const raw = readControl(partKey, nodeId, control);
  const on = raw === true;
  return (
    <label className="ctl-row inline">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`ctl-switch${on ? ' on' : ''}`}
        onClick={() => writeControl(partKey, nodeId, control, !on)}
      >
        <span className="knob" />
      </button>
      <span className="ctl-name">{control.label}</span>
    </label>
  );
}

function KeysRow({ partKey, nodeId, control }: { partKey: string; nodeId: string; control: Extract<PartControl, { kind: 'keys' }> }) {
  const last = useSim3D((s) => s.lastKey[nodeId]);
  const dip = useSim3D((s) => s.dip[nodeId]);
  return (
    <div className="ctl-row">
      <span className="ctl-name">{control.label}</span>
      <div className="ctl-keys">
        {control.keys.map((k) => {
          const active =
            partKey === 'dip-switch-8' ? (dip ?? [])[Number(k) - 1] === 1 : last === k;
          return (
            <button
              key={k}
              type="button"
              className={`ctl-key${active ? ' active' : ''}`}
              onClick={() => tapKey(partKey, nodeId, k)}
            >
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TextRow({ partKey, nodeId, control }: { partKey: string; nodeId: string; control: Extract<PartControl, { kind: 'text' }> }) {
  useSim3D();
  const raw = readControl(partKey, nodeId, control);
  const value = typeof raw === 'string' ? raw : control.def;
  return (
    <label className="ctl-row">
      <span className="ctl-name">{control.label}</span>
      <textarea
        rows={control.rows ?? 2}
        value={value}
        onChange={(e) => writeControl(partKey, nodeId, control, e.target.value)}
        spellCheck={false}
      />
    </label>
  );
}

/** What the firmware would read right now — the honest readout. */
function LiveReadout({ nodeId }: { nodeId: string }) {
  const st = useSim3D();
  const bits: string[] = [];
  const sn = st.sensors[nodeId];
  if (sn) {
    for (const [k, v] of Object.entries(sn)) {
      if (typeof v === 'boolean') {
        if (v) bits.push(k);
      } else {
        bits.push(`${k}=${Math.round(v * 100) / 100}`);
      }
    }
  }
  if (st.pressed[nodeId]) bits.push('PRESSED');
  if (st.analog[nodeId] !== undefined) {
    const v = st.analog[nodeId];
    bits.push(`wiper=${v} (${((v / 1023) * 5).toFixed(2)}V@5V/${((v / 1023) * 3.3).toFixed(2)}V@3V3)`);
  }
  if (st.servo[nodeId] !== undefined) bits.push(`angle=${st.servo[nodeId]}°`);
  if (st.switchOn[nodeId] !== undefined) bits.push(st.switchOn[nodeId] ? 'CLOSED' : 'OPEN');
  if (st.lastKey[nodeId]) bits.push(`key=${st.lastKey[nodeId]}`);
  if (bits.length === 0) return null;
  return (
    <div className="ctl-readout">
      <span className="eyebrow">Live — what firmware reads</span>
      <code>{bits.join(' · ')}</code>
    </div>
  );
}

export default function ControlsPanel({ node }: { node: ArchitectureNode }) {
  const identity = identifyPart({ name: node.name, partNumber: node.partNumber, type: node.type });
  const def = defForKey(identity.key);
  const dims = dimForKey(identity.key);
  const running = useSim3D((s) => s.running);
  const setRunning = useSim3D((s) => s.setRunning);
  const resetPart = useSim3D((s) => s.resetPart);
  const supply = node.properties?.find((p) => p.label.toLowerCase() === 'supply')?.value;

  return (
    <div className="controls-panel">
      <div className="ctl-head">
        <div>
          <strong>{node.name}</strong>
          <span className="tiny muted">
            {identity.label} · {footprintLabel(identity.key)}
            {dims.mass > 0 ? ` · ${dims.mass} g` : ''}
            {supply ? ` · ${supply}` : ''}
          </span>
        </div>
        <div className="ctl-transport">
          <button type="button" onClick={() => setRunning(!running)} title={running ? 'Pause the bench' : 'Run the bench'}>
            {running ? '❚❚' : '▶'}
          </button>
          <button type="button" onClick={() => resetPart(node.id)} title="Reset this part's live state">
            ↺
          </button>
        </div>
      </div>

      <p className="tiny muted ctl-blurb">{def.blurb}</p>

      {def.controls.length === 0 ? (
        <p className="tiny muted">No live controls — this part is structural (dims above are still true-scale).</p>
      ) : (
        <div className="ctl-grid">
          {def.controls.map((control) => {
            switch (control.kind) {
              case 'slider':
                return <SliderRow key={control.key} partKey={identity.key} nodeId={node.id} control={control} />;
              case 'press':
                return <PressRow key={control.key} partKey={identity.key} nodeId={node.id} control={control} />;
              case 'toggle':
                return <ToggleRow key={control.key} partKey={identity.key} nodeId={node.id} control={control} />;
              case 'keys':
                return <KeysRow key={control.key} partKey={identity.key} nodeId={node.id} control={control} />;
              case 'text':
                return <TextRow key={control.key} partKey={identity.key} nodeId={node.id} control={control} />;
              default:
                return null;
            }
          })}
        </div>
      )}

      <LiveReadout nodeId={node.id} />
    </div>
  );
}
