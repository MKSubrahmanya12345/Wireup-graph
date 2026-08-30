import { useState } from 'react';
import type { DeviceControl } from '../lib/deviceSpec';
import { api } from '../api/client';

interface Props {
  controls: DeviceControl[];
  onSent: (message: string) => void;
}

export default function ControlPanel({ controls, onSent }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const send = async (control: DeviceControl, payload: unknown) => {
    setBusy(control.id);
    try {
      await api.control(control.id, payload);
      onSent(`Command "${control.label}" sent to device.`);
    } catch (error) {
      onSent(error instanceof Error ? error.message : 'Command failed.');
    } finally {
      setBusy(null);
    }
  };

  if (controls.length === 0) {
    return (
      <div className="card">
        <h3>Controls</h3>
        <p className="muted">This device exposes no controls.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Controls</h3>
      <div className="control-grid">
        {controls.map((control) => {
          if (control.kind === 'toggle') {
            return (
              <button
                key={control.id}
                className="btn"
                disabled={busy === control.id}
                onClick={() => void send(control, control.command)}
              >
                {control.label}
              </button>
            );
          }
          if (control.kind === 'select' && control.options) {
            return (
              <div key={control.id} className="control-select">
                <label>{control.label}</label>
                <select
                  disabled={busy === control.id}
                  onChange={(event) => void send(control, { ...control.command, value: event.target.value })}
                >
                  {control.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          return (
            <button
              key={control.id}
              className="btn btn-accent"
              disabled={busy === control.id}
              onClick={() => void send(control, control.command)}
            >
              {control.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
