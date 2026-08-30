import { useState } from 'react';
import { toast } from '../store/useToastStore';

/** A minimal read-only code/file viewer with copy-to-clipboard. */
export default function CodeBlock({
  path,
  content,
  defaultOpen = false,
}: {
  path: string;
  content: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ext = path.split('.').pop() ?? '';
  const lang =
    ext === 'ts' || ext === 'tsx'
      ? 'typescript'
      : ext === 'ino' || ext === 'cpp' || ext === 'h' || ext === 'c'
        ? 'cpp'
        : ext === 'json'
          ? 'json'
          : ext === 'md'
            ? 'markdown'
            : 'text';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast('Copied to clipboard.');
    } catch {
      toast('Copy failed — select the text manually.');
    }
  };

  return (
    <div className="code-file">
      <div className="code-file-head">
        <span className="code-file-path">{path}</span>
        <div className="code-file-actions">
          <span className="code-lang">{lang}</span>
          <button type="button" className="linkish" onClick={() => void copy()}>
            copy
          </button>
          <button
            type="button"
            className="linkish"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'hide' : 'view'}
          </button>
        </div>
      </div>
      {open && (
        <pre className="code-pre">
          <code>{content}</code>
        </pre>
      )}
    </div>
  );
}
