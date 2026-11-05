import { useMemo } from 'react';
import { useProject } from '../../store/useProject';
import { phaseOf, statusOf, successorsOf } from '../../model/edit';
import { formatDate, formatDays } from '../../scheduling/time';
import { Button, DayStepper, IconButton, Pill, cx } from '../../components/ui/controls';
import { Close } from '../../components/ui/icons';
import type { Link, Task } from '../../model/types';
import type { TaskSchedule } from '../../scheduling/engine';

const LINK_NAMES: Record<Link['type'], string> = { FS: 'Finish → Start', SS: 'Start → Start', FF: 'Finish → Finish', SF: 'Start → Finish' };

function lagText(l: Link) {
  if (!l.lag) return '';
  const v = Math.round(Math.abs(l.lag) * 100) / 100;
  return ` ${l.lag > 0 ? '+' : '−'}${v}${l.lagUnit === 'ed' ? ' calendar' : ''} d`;
}

export function TaskPanel() {
  const project = useProject((s) => s.project)!;
  const original = useProject((s) => s.original)!;
  const simulated = useProject((s) => s.simulated);
  const selection = useProject((s) => s.selection);
  const draft = useProject((s) => s.draft);
  const applied = useProject((s) => s.applied);
  const setDraftItem = useProject((s) => s.setDraftItem);
  const removeDraftItem = useProject((s) => s.removeDraftItem);
  const run = useProject((s) => s.runSimulation);
  const reset = useProject((s) => s.resetSimulation);
  const clear = useProject((s) => s.clearSelection);
  const select = useProject((s) => s.select);

  const byUid = useMemo(() => new Map(project.tasks.map((t) => [t.uid, t])), [project]);
  const primary = byUid.get(selection[selection.length - 1] ?? -1);

  // Tasks in the scenario: everything selected plus anything already given a delay.
  const scenarioUids = useMemo(() => {
    const out: number[] = [];
    for (const u of [...draft.items.map((i) => i.uid), ...selection]) if (!out.includes(u)) out.push(u);
    return out.filter((u) => byUid.has(u) && !byUid.get(u)!.summary);
  }, [draft, selection, byUid]);

  const draftKey = JSON.stringify(draft.items.filter((i) => i.startDelay || i.durationDelta));
  const appliedKey = JSON.stringify(applied?.items ?? []);
  const pending = draftKey !== appliedKey;
  const hasDelay = draft.items.some((i) => i.startDelay > 0 || i.durationDelta > 0);

  return (
    <aside className="panel-in flex h-full w-[348px] shrink-0 flex-col border-l border-line bg-surface" aria-label="Task details and delay simulation" data-testid="task-panel">
      {primary ? (
        <TaskDetails task={primary} o={original.byUid.get(primary.uid)!} s={simulated?.byUid.get(primary.uid)} onClose={clear} onJump={(u) => select(u)} />
      ) : (
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold">Delay simulation</h2>
          <IconButton label="Close panel" onClick={clear}><Close /></IconButton>
        </div>
      )}

      <section className="flex min-h-0 flex-1 flex-col border-t border-line" aria-labelledby="sim-heading">
        <div className="px-4 pt-3 pb-2">
          <h3 id="sim-heading" className="text-[14px] font-semibold">Simulate a delay</h3>
          <p className="mt-0.5 text-[12px] leading-[17px] text-ink-2">
            Working days. A start delay is measured from the original planned start, so overlapping delays are not added twice. Ctrl+click tasks to add them.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4">
          {scenarioUids.length === 0 && <p className="py-3 text-[13px] text-ink-2">Select a task in the chart to give it a delay.</p>}
          <ul className="flex flex-col gap-2 pb-3">
            {scenarioUids.map((uid) => {
              const t = byUid.get(uid)!;
              const item = draft.items.find((i) => i.uid === uid);
              const status = statusOf(t);
              const startLocked = status !== 'Not started';
              const durLocked = status === 'Complete' || (t.milestone && t.duration === 0);
              return (
                <li key={uid} className={cx('rounded-[6px] border p-2.5', item && (item.startDelay || item.durationDelta) ? 'border-sim bg-sim-soft/40' : 'border-line')} data-testid={`scenario-${uid}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] leading-[18px] font-medium">{t.name}</span>
                    {item && (
                      <button type="button" className="text-[12px] text-ink-3 hover:text-ink" onClick={() => removeDraftItem(uid)} aria-label={`Remove ${t.name} from scenario`}>
                        Remove
                      </button>
                    )}
                  </div>
                  {status === 'Complete' ? (
                    <p className="mt-1 text-[12px] text-ink-2">Completed — actual dates are kept and cannot be delayed.</p>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                        Delay start
                        <DayStepper label={`Start delay for ${t.name}`} value={item?.startDelay ?? 0} disabled={startLocked} onChange={(v) => setDraftItem(uid, { startDelay: v })} />
                      </label>
                      <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                        Extend duration
                        <DayStepper label={`Duration extension for ${t.name}`} value={item?.durationDelta ?? 0} disabled={durLocked} onChange={(v) => setDraftItem(uid, { durationDelta: v })} />
                      </label>
                      {startLocked && <p className="col-span-2 text-[12px] text-ink-3">Already started — extend the duration instead.</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <Button variant="primary" onClick={run} disabled={!hasDelay} data-testid="run-simulation" className="flex-1">
            {applied && !pending ? 'Simulation is current' : 'Run simulation'}
          </Button>
          <Button onClick={reset} disabled={!applied && !draft.items.length} data-testid="reset-simulation">Reset</Button>
        </div>
      </section>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[5px]">
      <dt className="text-[12px] text-ink-2">{label}</dt>
      <dd className="num text-right text-[13px]">{children}</dd>
    </div>
  );
}

function TaskDetails({ task, o, s, onClose, onJump }: { task: Task; o: TaskSchedule; s?: TaskSchedule; onClose: () => void; onJump: (uid: number) => void }) {
  const project = useProject((st) => st.project)!;
  const original = useProject((st) => st.original)!;
  const phase = phaseOf(project, task.uid);
  const succ = successorsOf(project, task.uid);
  const status = statusOf(task);
  const nameOf = (uid: number) => project.tasks.find((t) => t.uid === uid);
  const moved = s && (Math.abs(s.es - o.es) > 1e-6 || Math.abs(s.ef - o.ef) > 1e-6);
  const floatText = (f: number | null) => (f === null ? '—' : formatDays(f));

  return (
    <div className="max-h-[52%] overflow-auto" data-testid="task-details">
      <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-2">
        <div className="min-w-0">
          <p className="text-[12px] text-ink-3">{[task.wbs && `WBS ${task.wbs}`, phase && phase.uid !== task.uid ? phase.name : null].filter(Boolean).join(' · ')}</p>
          <h2 className="text-[16px] leading-[22px] font-semibold">{task.name}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Pill tone={status === 'Complete' ? 'ok' : 'neutral'}>{status}{status === 'In progress' ? ` · ${Math.round(task.percentComplete)}%` : ''}</Pill>
            {(s ?? o).critical && <Pill tone="critical">Critical</Pill>}
            {moved && <Pill tone="late">Dates changed</Pill>}
            {task.milestone && <Pill>Milestone</Pill>}
            {task.manual && <Pill title="Manually scheduled in MS Project">Manual</Pill>}
          </div>
        </div>
        <IconButton label="Close panel" onClick={onClose}><Close /></IconButton>
      </div>
      <dl className="px-4">
        <Field label="Start">{formatDate(o.es, { weekday: true })}</Field>
        {moved && <Field label="Simulated start"><span className="font-medium text-late-ink">{formatDate(s!.es, { weekday: true })}</span></Field>}
        <Field label="Finish">{formatDate(o.ef, { weekday: true })}</Field>
        {moved && <Field label="Simulated finish"><span className="font-medium text-late-ink">{formatDate(s!.ef, { weekday: true })}</span></Field>}
        {!task.summary && <Field label="Duration">{formatDays(o.duration)}</Field>}
        <Field label="Total float">
          {floatText(o.totalFloat)}
          {s && s.totalFloat !== o.totalFloat && <span className="text-late-ink"> → {floatText(s.totalFloat)}</span>}
        </Field>
        {o.conflict && <Field label="Conflict"><span className="text-late-ink">{o.conflict.reason}</span></Field>}
      </dl>
      {!task.summary && (
        <div className="grid grid-cols-1 gap-2 px-4 pt-2 pb-3">
          <LinkList title="Predecessors" empty="None — starts with the project" items={task.predecessors.map((l) => ({ uid: l.predUid, task: nameOf(l.predUid), text: `${LINK_NAMES[l.type]}${lagText(l)}`, crit: original.byUid.get(l.predUid)?.critical }))} onJump={onJump} />
          <LinkList title="Successors" empty="None" items={succ.map(({ task: t, link }) => ({ uid: t.uid, task: t, text: `${LINK_NAMES[link.type]}${lagText(link)}`, crit: original.byUid.get(t.uid)?.critical }))} onJump={onJump} />
        </div>
      )}
    </div>
  );
}

function LinkList({ title, items, empty, onJump }: { title: string; empty: string; items: { uid: number; task?: Task; text: string; crit?: boolean }[]; onJump: (uid: number) => void }) {
  return (
    <div>
      <h3 className="pb-1 text-[12px] text-ink-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-[13px] text-ink-3">{empty}</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((i) => (
            <li key={i.uid}>
              <button type="button" onClick={() => onJump(i.uid)} className="flex w-full items-baseline justify-between gap-2 rounded-[4px] px-1 py-[3px] text-left hover:bg-raised">
                <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
                  {i.crit && <span className="h-3 w-[3px] shrink-0 rounded-[1px] bg-crit" aria-label="Critical" />}
                  <span className="truncate">{i.task?.name ?? `Missing task ${i.uid}`}</span>
                </span>
                <span className="shrink-0 text-[12px] text-ink-3">{i.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
