import fs from 'node:fs';
import path from 'node:path';

const FILES = [
  'package.json',
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'src/main.tsx',
  'src/App.tsx',
  'src/vite-env.d.ts',
  'src/styles/index.css',
  'src/types/architecture.ts',
  'src/services/api.ts',
  'src/store/useGraphStore.ts',
  'src/store/useToastStore.ts',
  'src/lib/palette.ts',
  'src/lib/graphAdapter.ts',
  'src/lib/exporters.ts',
  'src/components/AppShell.tsx',
  'src/components/ArchitectureNode.tsx',
  'src/components/Composer.tsx',
  'src/components/DetailCards.tsx',
  'src/components/ErrorAlert.tsx',
  'src/components/GraphCanvas.tsx',
  'src/components/Icons.tsx',
  'src/components/JsonDrawer.tsx',
  'src/components/NodeInspector.tsx',
  'src/components/Toast.tsx',
  'src/components/VerificationPanel.tsx',
  'src/pages/ArchitecturePlanPage.tsx',
  'src/pages/SignalMapPage.tsx',
  'src/pages/FirmwareSurfacePage.tsx',
  'src/pages/ArtifactsPage.tsx',
  'src/pages/NotFoundPage.tsx',
];

let created = 0;
let skipped = 0;

for (const rel of FILES) {
  const target = path.resolve(process.cwd(), rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    skipped += 1;
    console.log('  skip   ' + rel);
    continue;
  }
  fs.writeFileSync(target, '', 'utf8');
  created += 1;
  console.log('  create ' + rel);
}

console.log('\nDone — ' + created + ' created, ' + skipped + ' skipped (already existed).');