import { useRef } from 'react';
import { useProject } from '../store/useProject';

export const ACCEPT = '.mpp,.mpt,.mpx,.xml,.json';

/** A hidden file input plus an `open()` that shows the picker. */
export function useFilePicker() {
  const ref = useRef<HTMLInputElement>(null);
  const importFile = useProject((s) => s.importFile);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={ACCEPT}
      className="hidden"
      data-testid="file-input"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void importFile(f);
        e.target.value = '';
      }}
    />
  );
  return { open: () => ref.current?.click(), input };
}
