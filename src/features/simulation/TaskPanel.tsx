import { useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '../../store/useProject';
import { phaseOf, statusOf, successorsOf } from '../../model/edit';
import { formatDate, formatDays } from '../../scheduling/time';
import { Button, IconButton, Pill, cx } from '../../components/ui/controls';
import { Close } from '../../components/ui/icons';
import type { Link, Task } from '../../model/types';
import type { TaskSchedule } from '../../scheduling/engine';

const LINK_NAMES: Record<Link['type'], string> = { FS: 'Finish → Start', SS: 'Start → Start', FF: 'Finish → Finish', SF: 'Start → Finish' };
const EPS = 1e-6;

function lagText(l: Link) {
  if (!l.lag) return '';
  const v = Math.round(Math.abs(l.lag) * 100) / 100;
  return ` ${l.lag > 0 ? '+' : '−'}${v}${l.lagUnit === 'ed' ? ' calendar' : ''} d`;
}

const movedOf = (o?: TaskSchedule, s?: TaskSchedule) => !!o && !!s && (Math.abs(s.es - o.es) > EPS || Math.abs(s.ef - o.ef) > EPS);
const range = (a: number, b: number, year = false) => `${formatDate(a, { year: false })} – ${formatDate(b, { year })}`;

type Tab = 'simulate' | 'details';

export function TaskPanel() {
  const project = useProject((s) => s.project)!;
  const original = useProject((s) => s.original)!;
  const simulated = useProject((s) => s.simulated);
  const selection = useProject((s) => s.selection);
  const draft = useProject((s) => s.draft);
  const applied = useProject((s) => s.applied);
  const setDraftItem = useProject((s) => s.setDraftItem);
  const removeDraftItem = useProject((s) => s.removeDraftItem);
  const reset = useProject((s) => s.resetSimulation);
  const clear = useProject((s) => s.clearSelection);
  const select = useProject((s) => s.select);
  const setView = useProject((s) => s.setView);

  const byUid = useMemo(() => new Map(project.tasks.map((t) => [t.uid, t])), [project]);
  const primary = byUid.get(selection[selection.length - 1] ?? -1);
  const [tab, setTab] = useState<Tab>('simulate');

  // Ctrl+click adds tasks to the scenario: show the sliders.
  const prevCount = useRef(selection.length);
  useEffect(() => {
    if (selection.length > prevCount.current && selection.length > 1) setTab('simulate');
    prevCount.current = selection.length;
  }, [selection.length]);

  // Tasks in the scenario: everything selected plus anything already given a delay.
  const scenarioUids = useMemo(() => {
    const out: number[] = [];
    for (const u of [...draft.items.map((i) => i.uid), ...selection]) if (!out.includes(u)) out.push(u);
    return out.filter((u) => byUid.has(u) && !byUid.get(u)!.summary);
  }, [draft, selection, byUid]);

  const hasDelay = draft.items.some((i) => i.startDelay > 0 || i.durationDelta > 0);
  const delayedCount = draft.items.filter((i) => i.startDelay > 0 || i.durationDelta > 0).length;
  const showTab: Tab = primary ? tab : 'simulate';

  return (
    <aside className="panel-in flex h-full w-[348px] shrink-0 flex-col border-l border-line bg-surface" aria-label="Task details and delay simulation" data-testid="task-panel">
      {primary ? (
        <Header task={primary} o={original.byUid.get(primary.uid)!} s={simulated?.byUid.get(primary.uid)} onClose={clear} />
      ) : (
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h2 className="text-[15px] font-semibold">Delay simulation</h2>
          <IconButton label="Close panel" onClick={clear}><Close /></IconButton>
        </div>
      )}

      {primary && (
        <div className="flex gap-4 border-b border-line px-4" role="tablist" aria-label="Panel view">
          <TabButton active={showTab === 'simulate'} onClick={() => setTab('simulate')} id="tab-simulate">
            Simulate{delayedCount > 0 && <span className="num ml-1.5 rounded-[4px] bg-sim-soft px-1 text-[11px] text-sim-ink">{delayedCount}</span>}
          </TabButton>
          <TabButton active={showTab === 'details'} onClick={() => setTab('details')} id="tab-details">Details</TabButton>
        </div>
      )}

      {showTab === 'details' && primary ? (
        <div key="details" className="view-in min-h-0 flex-1 overflow-auto" role="tabpanel" aria-labelledby="tab-details">
          <TaskDetails task={primary} o={original.byUid.get(primary.uid)!} s={simulated?.byUid.get(primary.uid)} onJump={(u) => select(u)} />
        </div>
      ) : (
        <section key="simulate" className="view-in flex min-h-0 flex-1 flex-col" role="tabpanel" aria-labelledby={primary ? 'tab-simulate' : undefined} aria-label={primary ? undefined : 'Simulate a delay'}>
          <p className="px-4 pt-2.5 pb-1.5 text-[12px] leading-[16px] text-ink-3">
            Working days · Ctrl+click tasks to add them · <span className="inline-block h-2 w-[2px] translate-y-[1px] rounded-[1px] bg-ok" aria-hidden="true" /> marks the float a delay can use without moving others
          </p>
          <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
            {scenarioUids.length === 0 && <p className="px-1 py-3 text-[13px] text-ink-2">Select a task in the chart to give it a delay.</p>}
            <ul className="flex flex-col gap-2">
              {scenarioUids.map((uid) => {
                const t = byUid.get(uid)!;
                const item = draft.items.find((i) => i.uid === uid);
                const status = statusOf(t);
                const startLocked = status !== 'Not started';
                const durLocked = status === 'Complete' || (t.milestone && t.duration === 0);
                const o = original.byUid.get(uid);
                const sm = simulated?.byUid.get(uid);
                const float = o?.totalFloat ?? null;
                const moved = movedOf(o, sm);
                const active = !!item && (item.startDelay > 0 || item.durationDelta > 0);
                return (
                  <li key={uid} className={cx('rounded-[6px] border px-3 py-2', active ? 'border-sim/70 bg-sim-soft/30' : 'border-line')} data-testid={`scenario-${uid}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <button type="button" onClick={() => select(uid)} className="min-w-0 truncate text-left text-[13px] font-medium hover:underline" title={t.name}>{t.name}</button>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {float !== null && (
                          <span className={cx('num text-[11px]', float <= 0 ? 'font-medium text-ink' : 'text-ok')} title="Total float">
                            {float <= 0 ? 'Critical' : `Float ${formatDays(float)}`}
                          </span>
                        )}
                        {item && (
                          <IconButton label={`Remove ${t.name} from scenario`} onClick={() => removeDraftItem(uid)}><Close size={12} /></IconButton>
                        )}
                      </span>
                    </div>
                    {o && (
                      <p className="num text-[12px] leading-[16px] text-ink-2">
                        {moved ? (
                          <><span className="text-ink-3 line-through decoration-1">{range(o.es, o.ef)}</span> <span className="text-late-ink">{range(sm!.es, sm!.ef)}</span></>
                        ) : range(o.es, o.ef, true)}
                      </p>
                    )}
                    {status === 'Complete' ? (
                      <p className="mt-1 text-[12px] text-ink-3">Completed — dates are kept.</p>
                    ) : (
                      <div className="mt-1.5 flex flex-col gap-1">
                        <DelayRow label="Start" aria={`Start delay for ${t.name}`} value={item?.startDelay ?? 0} float={float} disabled={startLocked} title={startLocked ? 'Already started — extend the duration instead' : undefined} onChange={(v) => setDraftItem(uid, { startDelay: v })} />
                        <DelayRow label="Duration" aria={`Duration extension for ${t.name}`} value={item?.durationDelta ?? 0} float={float} disabled={durLocked} onChange={(v) => setDraftItem(uid, { durationDelta: v })} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
            <Button variant="primary" size="sm" onClick={() => setView('simulation')} disabled={!hasDelay} data-testid="open-impact" className="flex-1">
              See full impact
            </Button>
            <Button size="sm" onClick={reset} disabled={!applied && !draft.items.length} data-testid="reset-simulation">Reset</Button>
          </div>
        </section>
      )}
    </aside>
  );
}

function TabButton({ active, onClick, id, children }: { active: boolean; onClick: () => void; id: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      onClick={onClick}
      className={cx('-mb-px flex h-9 items-center border-b-2 text-[13px] font-medium transition-colors duration-150', active ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink')}
    >
      {children}
    </button>
  );
}

/** Task name, status and its dates in one compact block; always visible. */
function Header({ task, o, s, onClose }: { task: Task; o: TaskSchedule; s?: TaskSchedule; onClose: () => void }) {
  const project = useProject((st) => st.project)!;
  const phase = phaseOf(project, task.uid);
  const status = statusOf(task);
  const moved = movedOf(o, s);
  return (
    <div className="px-4 pt-3 pb-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] text-ink-3">{[task.wbs && `WBS ${task.wbs}`, phase && phase.uid !== task.uid ? phase.name : null].filter(Boolean).join(' · ')}</p>
          <h2 className="text-[15px] leading-[20px] font-semibold">{task.name}</h2>
        </div>
        <IconButton label="Close panel" onClick={onClose}><Close /></IconButton>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Pill tone={status === 'Complete' ? 'ok' : 'neutral'}>{status}{status === 'In progress' ? ` · ${Math.round(task.percentComplete)}%` : ''}</Pill>
        {(s ?? o).critical && <Pill tone="critical">Critical</Pill>}
        {moved && <Pill tone="late">Dates changed</Pill>}
        {task.milestone && <Pill>Milestone</Pill>}
      </div>
      <p className="num mt-1.5 text-[13px] text-ink-2">
        {moved ? (
          <><span className="text-ink-3 line-through decoration-1">{range(o.es, o.ef)}</span> <span className="font-medium text-late-ink">{range(s!.es, s!.ef, true)}</span></>
        ) : (
          <span className="text-ink">{range(o.es, o.ef, true)}</span>
        )}
        {!task.summary && <span className="text-ink-3"> · {formatDays(o.duration)}</span>}
      </p>
    </div>
  );
}

/** One line per delay: label, slider (with a float tick) and an exact number box. */
function DelayRow({ label, aria, value, float, disabled, title, onChange }: { label: string; aria: string; value: number; float: number | null; disabled?: boolean; title?: string; onChange: (v: number) => void }) {
  const max = Math.max(30, Math.ceil(Math.max(value * 1.5, (float ?? 0) + 10) / 10) * 10);
  const f = float !== null && float > 0 && float < max ? float : null;
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const n = Number(raw.replace(',', '.'));
    if (Number.isFinite(n)) onChange(Math.max(0, Math.min(2000, Math.round(n * 2) / 2)));
    else setText(String(value));
  };
  return (
    <div className={cx('grid grid-cols-[58px_minmax(0,1fr)_52px] items-center gap-2', disabled && 'opacity-45')} title={title}>
      <span className="text-[12px] text-ink-2">{label}</span>
      <div className="relative flex h-6 items-center">
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={Math.min(value, max)}
          disabled={disabled}
          aria-label={`${aria} slider`}
          onChange={(e) => onChange(Number(e.target.value))}
          className="delay-range h-6 w-full cursor-pointer disabled:cursor-not-allowed"
          style={{ '--pct': `${(Math.min(value, max) / max) * 100}%` } as React.CSSProperties}
        />
        {f !== null && (
          <span
            className="pointer-events-none absolute top-[6px] h-[12px] w-[2px] -translate-x-1/2 rounded-[1px] bg-ok"
            style={{ left: `calc(7px + (100% - 14px) * ${f / max})` }}
            aria-hidden="true"
          />
        )}
      </div>
      <label className={cx('flex h-7 items-center rounded-[5px] border bg-surface pr-1.5 focus-within:border-ink', value > 0 ? 'border-sim' : 'border-control')}>
        <input
          aria-label={aria}
          inputMode="decimal"
          disabled={disabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            if (e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(2000, value + 1)); }
            if (e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(0, value - 1)); }
          }}
          className="num w-full min-w-0 bg-transparent text-right text-[13px] outline-none"
        />
        <span className="pl-0.5 text-[11px] text-ink-3">d</span>
      </label>
    </div>
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

function TaskDetails({ task, o, s, onJump }: { task: Task; o: TaskSchedule; s?: TaskSchedule; onJump: (uid: number) => void }) {
  const project = useProject((st) => st.project)!;
  const original = useProject((st) => st.original)!;
  const succ = successorsOf(project, task.uid);
  const nameOf = (uid: number) => project.tasks.find((t) => t.uid === uid);
  const moved = movedOf(o, s);
  const floatText = (f: number | null) => (f === null ? '—' : formatDays(f));

  return (
    <div className="px-4 py-3" data-testid="task-details">
      <p className="sr-only">{task.name}</p>
      <div className="grid grid-cols-2 gap-2">
        <DateBox label="Start" planned={o.es} simulated={moved ? s!.es : undefined} />
        <DateBox label="Finish" planned={o.ef} simulated={moved ? s!.ef : undefined} />
      </div>
      <dl className="mt-2">
        {!task.summary && <Field label="Duration">{formatDays(o.duration)}</Field>}
        <Field label="Total float">
          {floatText(o.totalFloat)}
          {s && s.totalFloat !== o.totalFloat && <span className="text-late-ink"> → {floatText(s.totalFloat)}</span>}
        </Field>
        {task.manual && <Field label="In MS Project">Manually scheduled</Field>}
      </dl>
      {!task.summary && (
        <div className="mt-3 flex flex-col gap-3">
          <LinkList title="Predecessors" empty="None" items={task.predecessors.map((l) => ({ uid: l.predUid, task: nameOf(l.predUid), text: `${LINK_NAMES[l.type]}${lagText(l)}`, crit: original.byUid.get(l.predUid)?.critical }))} onJump={onJump} />
          <LinkList title="Successors" empty="None" items={succ.map(({ task: t, link }) => ({ uid: t.uid, task: t, text: `${LINK_NAMES[link.type]}${lagText(link)}`, crit: original.byUid.get(t.uid)?.critical }))} onJump={onJump} />
        </div>
      )}
    </div>
  );
}

function DateBox({ label, planned, simulated }: { label: string; planned: number; simulated?: number }) {
  return (
    <div className="rounded-[6px] bg-raised px-2.5 py-2">
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className={cx('num text-[13px] font-medium', simulated !== undefined && 'text-ink-3 line-through decoration-1 font-normal')}>{formatDate(planned, { weekday: true })}</p>
      {simulated !== undefined && <p className="num text-[13px] font-medium text-late-ink">{formatDate(simulated, { weekday: true })}</p>}
    </div>
  );
}

function LinkList({ title, items, empty, onJump }: { title: string; empty: string; items: { uid: number; task?: Task; text: string; crit?: boolean }[]; onJump: (uid: number) => void }) {
  return (
    <div>
      <h3 className="pb-1 text-[12px] text-ink-2">{title} <span className="text-ink-3">· {items.length}</span></h3>
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
