import { useCallback, useEffect, useRef, useState } from 'react';
import { useFilePicker } from './components/useFilePicker';
import { useProject, type View } from './store/useProject';
import { TimelineView, GanttToolbar } from './features/timeline/TimelineView';
import { ImpactStrip } from './features/timeline/ImpactStrip';
import { SimulationView } from './features/simulation/SimulationView';
import { DataView } from './features/data/DataView';
import { StartScreen } from './features/StartScreen';
import { ImportReportDialog } from './features/ImportReportDialog';
import { MasterUpdateDialog } from './features/MasterUpdateDialog';
import { GanttChart } from './features/gantt/GanttChart';
import { TaskPanel } from './features/simulation/TaskPanel';
import { Button, cx } from './components/ui/controls';
import { Download, Folder, Mark, Maximize, Minimize, Save, Table, Upload } from './components/ui/icons';

export default function App() {
  const project = useProject((s) => s.project);
  const presenting = useProject((s) => s.presenting);
  const init = useProject((s) => s.init);
  const importFile = useProject((s) => s.importFile);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    document.documentElement.dataset.present = String(presenting);
  }, [presenting]);

  // Leave presentation mode when the browser leaves full screen (Esc).
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && useProject.getState().presenting) useProject.getState().setPresenting(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useProject.getState();
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (s.project) void s.save();
      } else if (e.key === 'Escape' && !typing && !document.querySelector('dialog[open]')) {
        if (s.presenting && !document.fullscreenElement) s.setPresenting(false);
        else s.clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Warn before closing with unsaved changes
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useProject.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.relatedTarget) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) void importFile(f);
      }}
    >
      {presenting && project ? <PresentationLayout /> : (
        <>
          <AppBar />
          <Notice />
          {project ? <Workspace /> : <StartScreen />}
        </>
      )}
      <ImportReportDialog />
      <MasterUpdateDialog />
      <Busy />
      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-[8px] border-2 border-dashed border-ink bg-surface/85">
          <p className="text-[16px] font-medium">Drop the project file to import it</p>
        </div>
      )}
    </div>
  );
}

function Workspace() {
  const view = useProject((s) => s.view);
  return (
    <main className="flex min-h-0 flex-1 flex-col" aria-label={view}>
      {view === 'timeline' && <TimelineView />}
      {view === 'simulation' && <SimulationView />}
      {view === 'data' && <DataView />}
    </main>
  );
}

function AppBar() {
  const project = useProject((s) => s.project);
  const view = useProject((s) => s.view);
  const setView = useProject((s) => s.setView);
  const dirty = useProject((s) => s.dirty);
  const savedAt = useProject((s) => s.savedAt);
  const save = useProject((s) => s.save);
  const exportFile = useProject((s) => s.exportFile);
  const setPresenting = useProject((s) => s.setPresenting);
  const closeProject = useProject((s) => s.closeProject);
  const simulated = useProject((s) => s.simulated);
  const setReportOpen = useProject((s) => s.setReportOpen);
  const picker = useFilePicker();
  const masterInput = useRef<HTMLInputElement>(null);

  const present = useCallback(async () => {
    setPresenting(true);
    useProject.getState().setZoom('fit'); // whole project on screen for the audience
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* full screen refused (e.g. embedded); the presentation layout still applies */
    }
  }, [setPresenting]);

  const tabs: { id: View; label: string }[] = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'simulation', label: 'Simulation' },
    { id: 'data', label: 'Project data' },
  ];

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
      <button type="button" className="flex items-center gap-2 rounded-[6px] px-1 py-1 hover:bg-active" onClick={() => (!dirty || confirm('Close this project? Unsaved changes will be lost.')) && closeProject()} title="Schedrift — close project">
        <Mark />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Schedrift</span>
      </button>
      {project && (
        <>
          <span className="h-5 w-px bg-line" aria-hidden="true" />
          <div className="flex min-w-0 max-w-[300px] flex-col leading-[16px]">
            <span className="truncate text-[14px] font-medium" data-testid="project-name" title={project.name}>{project.name}</span>
            <button type="button" className="truncate text-left text-[12px] text-ink-3 hover:text-ink" onClick={() => setReportOpen(true)} title="Show import report">
              {project.sourceFileName}
              {dirty ? ' · unsaved changes' : savedAt ? ' · saved' : ''}
            </button>
          </div>
          <nav className="ml-2 flex shrink-0 items-center gap-0.5 rounded-[8px] bg-raised p-0.5" aria-label="Views">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setView(t.id)}
                aria-current={view === t.id ? 'page' : undefined}
                className={cx('h-7 rounded-[6px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors', view === t.id ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.04)]' : 'text-ink-2 hover:text-ink')}
              >
                {t.label}
                {t.id === 'simulation' && simulated && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-sim align-middle" aria-label="active" />}
              </button>
            ))}
          </nav>
        </>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {picker.input}
        <Button variant="ghost" icon={<Upload />} onClick={picker.open} data-testid="import-button" aria-label="Import" title="Import an .mpp or MS Project XML file"><span className="hidden xl:inline">Import</span></Button>
        {project && (
          <>
            <input
              ref={masterInput}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              data-testid="master-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void useProject.getState().loadMaster(f);
                e.target.value = '';
              }}
            />
            <Button variant="ghost" icon={<Table />} onClick={() => masterInput.current?.click()} data-testid="master-button" aria-label="Update from Excel" title="Take dates, durations and status from an Excel master sheet; keep this file's dependencies">
              <span className="hidden xl:inline">Update from Excel</span>
            </Button>
          </>
        )}
        {project && (
          <>
            <Button variant="ghost" icon={<Download />} onClick={exportFile} aria-label="Export" title="Download a .schedrift.json copy"><span className="hidden xl:inline">Export</span></Button>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
            <Button icon={<Save />} onClick={() => void save()} data-testid="save-button" title="Save locally (Ctrl+S)">Save</Button>
            <Button variant="primary" icon={<Maximize />} onClick={() => void present()} data-testid="present-button">Present</Button>
          </>
        )}
        {!project && <span className="hidden text-[12px] text-ink-3 md:inline"><Folder size={14} className="mr-1 inline" />Local only — nothing leaves this computer</span>}
      </div>
    </header>
  );
}

function PresentationLayout() {
  const project = useProject((s) => s.project)!;
  const setPresenting = useProject((s) => s.setPresenting);
  const selection = useProject((s) => s.selection);
  const exit = async () => {
    setPresenting(false);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
  };
  return (
    <div className="flex h-full flex-col" data-testid="presentation">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <Mark size={20} />
        <h1 className="truncate text-[17px] font-semibold">{project.name}</h1>
        <Button className="ml-auto" icon={<Minimize />} onClick={() => void exit()} data-testid="exit-present">Exit presentation</Button>
      </header>
      <ImpactStrip compact />
      <GanttToolbar />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1"><GanttChart /></div>
        {selection.length > 0 && <TaskPanel />}
      </div>
    </div>
  );
}

function Notice() {
  const notice = useProject((s) => s.notice);
  const setNotice = useProject((s) => s.setNotice);
  useEffect(() => {
    if (notice?.kind === 'success') {
      const t = setTimeout(() => setNotice(null), 3500);
      return () => clearTimeout(t);
    }
  }, [notice, setNotice]);
  if (!notice) return null;
  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={cx(
        'fixed bottom-5 left-1/2 z-50 flex w-max max-w-[min(640px,calc(100vw-32px))] -translate-x-1/2 items-center gap-4 rounded-[8px] border px-4 py-2.5 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.12)]',
        notice.kind === 'error' ? 'border-[#f1c9c1] bg-late-soft text-late-ink' : notice.kind === 'success' ? 'border-[#cfe6d8] bg-ok-soft text-ok' : 'border-line bg-surface text-ink',
      )}
      data-testid="notice"
    >
      <span className="min-w-0 flex-1">{notice.text}</span>
      <button type="button" className="shrink-0 text-[12px] font-medium underline-offset-2 hover:underline" onClick={() => setNotice(null)}>Dismiss</button>
    </div>
  );
}

function Busy() {
  const busy = useProject((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center" role="status" aria-live="polite">
      <div className="rounded-[6px] bg-ink px-4 py-2 text-[13px] text-white shadow-[0_6px_18px_rgba(0,0,0,0.18)]">{busy}</div>
    </div>
  );
}
