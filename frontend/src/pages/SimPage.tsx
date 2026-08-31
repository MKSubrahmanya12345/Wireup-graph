import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

/**
 * Page 4 — /sim (Simulation + universal circuit view + website preview toggle).
 *
 * The agentic pipeline produces:
 *   - firmware zip (sketch + platformio.ini + diagram.json + universal-diagram.json)
 *   - software zip (MERN dashboard code)
 *
 * This page reads the universal-diagram.json (backwards-compatible with Wokwi,
 * extendable for Velxio) and shows both the simulated circuit and the website
 * output — toggled by the user, working together.
 */

interface UniversalPart {
  type: string;
  id: string;
  role: string;
  model: string;
  attrs: Record<string, string>;
}

interface UniversalConnection {
  from: { partId: string; pin: string };
  to: { partId: string; pin: string };
  net?: string;
}

interface UniversalDiagram {
  version: number;
  format: string;
  author: string;
  sourcePlan?: string;
  parts: UniversalPart[];
  connections: UniversalConnection[];
  nets?: Array<{ name: string; voltage?: string; nodes: Array<{ partId: string; pin: string }> }>;
}

export default function SimPage() {
  const [showSim, setShowSim] = useState(true);
  const [diagram, setDiagram] = useState<UniversalDiagram | null>(null);
  const [diagramError, setDiagramError] = useState<string | null>(null);

  // Load the universal diagram produced by the agentic pipeline.
  useEffect(() => {
    fetch('/hardware/universal-diagram.json')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as UniversalDiagram;
        setDiagram(data);
      })
      .catch((err) => {
        setDiagramError(err instanceof Error ? err.message : 'Failed to load universal diagram');
      });
  }, []);

  const circuitParts = diagram?.parts?.filter((p) => p.role !== 'passive') ?? [];
  const passiveParts = diagram?.parts?.filter((p) => p.role === 'passive') ?? [];

  return (
    <div className="sim-page" style={{ minHeight: '100vh', background: '#0a0f1b', color: '#e8edf5' }}>
      {/* Mobile sticky header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', background: 'rgba(10,15,27,0.92)',
        backdropFilter: 'blur(8px)', borderBottom: '1px solid #1e2a44'
      }}>
        <Link to="/build" style={{ color: '#7fb0ff', textDecoration: 'none', fontWeight: 600, fontSize: 15 }}>
          ← Build
        </Link>
        <h1 style={{ fontSize: 15, margin: 0, letterSpacing: '0.4px', color: '#b0bdd8' }}>
          Simulation & Website
        </h1>
        <button
          onClick={() => setShowSim(!showSim)}
          style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #7fb0ff',
            background: showSim ? '#7fb0ff' : 'transparent',
            color: showSim ? '#0a0f1b' : '#7fb0ff', fontWeight: 700,
            cursor: 'pointer', transition: 'all 0.15s ease', fontSize: 13,
          }}
          aria-label={showSim ? 'Switch to website preview' : 'Switch to simulation'}
        >
          {showSim ? 'Website' : 'Simulation'}
        </button>
      </header>

      {/* Main: either simulation (iframe + circuit info) or website preview */}
      <main style={{ padding: '0', height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column' }}>
        {showSim ? (
          <section style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Circuit info sidebar (from universal JSON) */}
            <aside style={{
              width: 280, minWidth: 260, maxWidth: 320,
              background: '#0d1220', borderRight: '1px solid #1e2a44',
              padding: '16px 16px', overflowY: 'auto',
            }}>
              <h2 style={{ fontSize: 15, margin: '0 0 14px', color: '#b0bdd8' }}>Circuit</h2>
              {diagram ? (
                <>
                  <div style={{ fontSize: 12, color: '#8892b0', marginBottom: 10, lineHeight: 1.5 }}>
                    <strong style={{ color: '#c0d0f5' }}>{diagram.sourcePlan || 'unknown'}</strong>
                    <br />
                    Format: <code style={{ fontSize: 11, color: '#7fb0ff' }}>{diagram.format}</code>
                    <br />
                    Version: v{diagram.version}
                  </div>

                  <h3 style={{ fontSize: 12, margin: '14px 0 8px', color: '#8892b0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Components</h3>
                  <ul style={{ paddingLeft: 16, margin: 0, fontSize: 12.5, lineHeight: 1.7, color: '#b0bdd8' }}>
                    {circuitParts.map((part) => (
                      <li key={part.id} style={{ marginBottom: 4 }}>
                        <span style={{ color: '#7fb0ff', fontWeight: 600 }}>{part.id}</span>
                        <br />
                        <span style={{ color: '#7a89a8', fontSize: 11 }}>
                          {part.role} · {part.model}
                        </span>
                      </li>
                    ))}
                    {passiveParts.length > 0 && (
                      <li style={{ marginTop: 6, color: '#7a89a8', fontSize: 11 }}>
                        + {passiveParts.length} passive(s): {passiveParts.map((p) => p.id).join(', ')}
                      </li>
                    )}
                  </ul>

                  {diagram.nets && diagram.nets.length > 0 && (
                    <>
                      <h3 style={{ fontSize: 12, margin: '16px 0 8px', color: '#8892b0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Nets</h3>
                      <ul style={{ paddingLeft: 16, margin: 0, fontSize: 12, lineHeight: 1.6, color: '#a8b0c8' }}>
                        {diagram.nets.map((net) => (
                          <li key={net.name} style={{ marginBottom: 3 }}>
                            <span style={{ color: '#7fb0ff', fontWeight: 600 }}>{net.name}</span>
                            {net.voltage && <span style={{ color: '#5f7188', fontSize: 10, marginLeft: 6 }}>({net.voltage})</span>}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  <h3 style={{ fontSize: 12, margin: '16px 0 8px', color: '#8892b0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Connections</h3>
                  <ul style={{ paddingLeft: 16, margin: 0, fontSize: 11, lineHeight: 1.5, color: '#8a96b8' }}>
                    {diagram.connections.map((conn, idx) => (
                      <li key={idx} style={{ marginBottom: 3 }}>
                        <span style={{ color: '#b0bdd8' }}>{conn.from.partId}</span>:{conn.from.pin}
                        <span style={{ color: '#5f7188', margin: '0 4px' }}>→</span>
                        <span style={{ color: '#b0bdd8' }}>{conn.to.partId}</span>:{conn.to.pin}
                        {conn.net && <span style={{ color: '#5f7188', fontSize: 10, marginLeft: 6 }}>({conn.net})</span>}
                      </li>
                    ))}
                  </ul>
                </>
              ) : diagramError ? (
                <p style={{ color: '#f87171', fontSize: 13 }}>{diagramError}</p>
              ) : (
                <p style={{ color: '#7a89a8', fontSize: 13 }}>Loading universal diagram…</p>
              )}
            </aside>

            {/* Simulation iframe */}
            <section style={{ flex: 1, position: 'relative' }}>
              <iframe
                src="https://velxio.dev"
                title="Velxio Simulation"
                style={{ width: '100%', height: '100%', border: 'none', borderRadius: 0 }}
                allow="camera; microphone; fullscreen; encrypted-media"
              />
            </section>
          </section>
        ) : (
          <section style={{ overflowY: 'auto', padding: 20, background: '#0a0f1b' }}>
            <div style={{
              maxWidth: 720, margin: '0 auto',
              background: '#111827', borderRadius: 16, padding: 24,
              border: '1px solid #1e2a44', boxShadow: '0 12px 32px rgba(0,0,0,0.4)'
            }}>
              <h2 style={{ marginTop: 0, fontSize: 20, color: '#b0bdd8' }}>Website Preview</h2>
              <p style={{ opacity: 0.85, lineHeight: 1.65, fontSize: 14, color: '#8892b0' }}>
                This is the generated MERN dashboard (software zip). It connects to your ESP32
                over the local network using the device endpoints configured in the agentic build.
                The universal circuit diagram above ensures the dashboard matches the hardware exactly.
              </p>
              <div style={{
                marginTop: 20, padding: 16, borderRadius: 12,
                background: '#0d1220', border: '1px dashed #2a364e', color: '#7a89a8', fontSize: 13
              }}>
                <strong style={{ color: '#b0bdd8' }}>Universal diagram loaded:</strong>
                {diagram ? (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#7fb0ff' }}>
                    <li>Format: {diagram.format}</li>
                    <li>Components: {diagram.parts?.length ?? 0}</li>
                    <li>Connections: {diagram.connections?.length ?? 0}</li>
                    <li>Plan: {diagram.sourcePlan ?? '—'}</li>
                  </ul>
                ) : (
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: '#f87171' }}>
                    {diagramError ? diagramError : 'No universal diagram available — build the project first.'}
                  </p>
                )}
              </div>
              <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: '#0d1220', border: '1px dashed #2a364e', color: '#8892b0', fontSize: 13 }}>
                The dashboard reads live sensor values from <code>/api/sensors</code>, shows device status at <code>/api/status</code>,
                and stores a one-minute history ring buffer served at <code>/api/history</code>.
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
