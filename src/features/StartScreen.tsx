import { useEffect, useState } from 'react';
import { useProject } from '../store/useProject';
import { listProjects, deleteProject, type SavedProjectSummary } from '../storage/api';
import { useFilePicker } from '../components/useFilePicker';
import { Button } from '../components/ui/controls';
import { GitHub, Upload } from '../components/ui/icons';
import { REPO_URL } from './WelcomeCard';

export function StartScreen() {
  const server = useProject((s) => s.server);
  const openSample = useProject((s) => s.openSample);
  const loadSaved = useProject((s) => s.loadSaved);
  const picker = useFilePicker();
  const [recent, setRecent] = useState<SavedProjectSummary[] | null>(null);

  useEffect(() => {
    void listProjects().then(setRecent);
  }, []);

  return (
    <main className="view-in flex flex-1 justify-center overflow-auto px-4 py-12 md:py-16">
      <div className="grid w-full max-w-[980px] grid-cols-1 gap-4 self-start md:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-2 pb-4 md:col-span-2" data-testid="brand">
          <img src="/branding/svg/schedrift-logo-horizontal.svg" alt="Schedrift" width={160} height={50} className="h-[50px] w-auto self-start" />
          <p className="text-[15px] leading-[22px] text-ink-2">
            Visualize timelines. Understand the impact. <span className="text-ink-3">Turn a Microsoft Project file into a Gantt chart you can present.</span>
          </p>
        </div>
        <section className="rounded-[10px] border border-line bg-surface p-6 shadow-[0_1px_2px_rgb(31_34_38/0.04)]" aria-labelledby="start-h">
          <h1 id="start-h" className="text-[24px] leading-[30px] font-semibold tracking-[-0.01em]">Open a Microsoft Project schedule</h1>
          <p className="mt-2 max-w-[56ch] text-[14px] leading-[22px] text-ink-2">
            Import an .mpp file and Schedrift draws its Gantt chart, then shows what any delay does to its dependencies, the critical path and Go-Live. The original file is never changed.
          </p>
          {picker.input}
          <button
            type="button"
            onClick={picker.open}
            className="group mt-5 flex w-full flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed border-control bg-raised px-6 py-10 text-center transition-colors duration-150 hover:border-ink hover:bg-active"
            data-testid="drop-zone"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink-2 transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:text-ink">
              <Upload size={18} />
            </span>
            <span className="text-[15px] font-medium">Choose a file or drop it here</span>
            <span className="text-[13px] text-ink-2">.mpp · .mpx · Microsoft Project XML (.xml) · Schedrift project (.schedrift.json)</span>
          </button>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={picker.open}>Import file</Button>
            <Button onClick={() => void openSample()} data-testid="open-sample">Open the sample project</Button>
            <ServerLine server={server} />
          </div>
        </section>

        <section className="self-start rounded-[10px] border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(31_34_38/0.04)]" aria-labelledby="recent-h">
          <h2 id="recent-h" className="text-[15px] font-semibold">Saved projects</h2>
          {recent === null && <p className="mt-2 text-[13px] text-ink-3">Loading…</p>}
          {recent?.length === 0 && <p className="mt-2 text-[13px] leading-[19px] text-ink-2">Nothing saved yet. Saved projects keep their simulation and are stored in this computer's Schedrift data folder.</p>}
          <ul className="mt-2 flex flex-col" data-testid="recent-list">
            {recent?.map((p) => (
              <li key={p.id} className="group flex items-center gap-2 border-t border-rule py-2 first:border-t-0">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void loadSaved(p.id)}>
                  <span className="block truncate text-[14px] font-medium group-hover:underline">{p.name}</span>
                  <span className="block truncate text-[12px] text-ink-3">
                    {p.sourceFileName} · {new Date(p.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    {p.scenarioItems ? ` · ${p.scenarioItems} simulated ${p.scenarioItems === 1 ? 'delay' : 'delays'}` : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className="rounded-[4px] px-1.5 py-0.5 text-[12px] text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-late-soft hover:text-late-ink focus-visible:opacity-100"
                  onClick={async () => {
                    if (!confirm(`Delete the saved copy of “${p.name}”? The original schedule file is not affected.`)) return;
                    await deleteProject(p.id);
                    setRecent(await listProjects());
                  }}
                  aria-label={`Delete saved project ${p.name}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>

        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-[12px] text-ink-3 md:col-span-2">
          <span>Schedrift is free and open source.</span>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-ink-2 underline-offset-2 hover:text-ink hover:underline" data-testid="start-github">
            <GitHub size={13} /> View on GitHub
          </a>
          <span aria-hidden="true">·</span>
          <span>Your files never leave this computer.</span>
        </footer>
      </div>
    </main>
  );
}

function ServerLine({ server }: { server: ReturnType<typeof useProject.getState>['server'] }) {
  if (!server) return <span className="text-[12px] text-late-ink">Local server not reachable: .mpp import and saving are unavailable.</span>;
  if (!server.mpp) return <span className="text-[12px] text-sim-ink">.mpp import needs setup: run Schedrift.cmd or “npm run setup”. XML files work now.</span>;
  return <span className="text-[12px] text-ink-3">.mpp import ready · MPXJ on Java {server.java?.major}</span>;
}
