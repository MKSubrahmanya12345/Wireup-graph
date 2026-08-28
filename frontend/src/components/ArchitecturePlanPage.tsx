import Composer from '../components/Composer';
import ConfirmBar from '../components/ConfirmBar';
import ErrorAlert from '../components/ErrorAlert';
import GraphCanvas from '../components/GraphCanvas';
import IntakePanel from '../components/IntakePanel';
import IssuesPanel from '../components/IssuesPanel';
import JsonDrawer from '../components/JsonDrawer';
import NodeInspector from '../components/NodeInspector';
import VerificationPanel from '../components/VerificationPanel';
import { ConnectionMatrix, DependencyChain, SoftwareSurface } from '../components/DetailCards';
import { useDesignSession } from '../store/useDesignSession';
import { useGraphStore } from '../store/useGraphStore';

export default function ArchitecturePlanPage() {
  const graph = useGraphStore((state) => state.graph);
  const lastUpdated = useGraphStore((state) => state.lastUpdated);
  const stage = useDesignSession((state) => state.stage);
  const requirements = useDesignSession((state) => state.requirements);

  const hasDraft = graph.nodes.length > 0;

  return (
    <>
      <section className="heading-row">
        <div>
          <div className="eyebrow">Architecture workspace / 01</div>
          <h1>System architecture</h1>
          <p className="heading-sub">
            {requirements?.intent ||
              graph.summary ||
              'Describe it, I decide what I can, then you look at it.'}
          </p>
        </div>
        <div className="header-meta">
          <span>{lastUpdated ? 'UPDATED JUST NOW' : 'NOT GENERATED YET'}</span>
          <span className="meta-sep">·</span>
          <span>{String(graph.nodes.length).padStart(2, '0')} NODES</span>
          <span className="meta-sep">·</span>
          <span>{String(graph.connections.length).padStart(2, '0')} LINKS</span>
        </div>
      </section>

      <Composer />
      <ErrorAlert />

      {stage === 'questioning' && <IntakePanel />}

      {hasDraft && (
        <>
          <div className="workspace-grid">
            <GraphCanvas />
            <NodeInspector />
          </div>

          <IssuesPanel />
          <VerificationPanel />
          <ConfirmBar />

          <section className="details-grid">
            <ConnectionMatrix />
            <DependencyChain />
            <SoftwareSurface />
          </section>

          <JsonDrawer />
        </>
      )}
    </>
  );
}