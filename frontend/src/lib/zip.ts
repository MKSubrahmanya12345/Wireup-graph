import JSZip from 'jszip';
import type { BuildFile } from '../types/build';

/** Download a list of { path, content } files as a single zip archive. */
export async function downloadZip(
  files: BuildFile[],
  archiveName: string,
): Promise<void> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.path, file.content);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = archiveName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
