import { useMemo, useState, type KeyboardEvent } from 'react';
import { useProject } from '../../store/useProject';
import { formatPredecessors, parsePredecessors, phaseOf, statusOf } from '../../model/edit';
import { formatDate, formatInstantISO, parseInstant } from '../../scheduling/time';
import { validateProject } from '../../scheduling/validate';
import { buildNetwork } from '../../scheduling/engine';
import { Button, Dialog, Pill, cx } from '../../components/ui/controls';
import { Alert, Info, Plus, Trash } from '../../components/ui/icons';
import { ImpactStrip } from '../timeline/ImpactStrip';
import type { Link, LinkType, ReportItem, Task } from '../../model/types';

export function DataView() {
  const project = useProject((s) => s.project)!;
  const original = useProject((s) => s.original)!;
  const editTask = useProject((s) => s.editTask);
  const [editing, setEditing] = useState<number | null>(null);
  const [filter, setFilter] = useState('');

  const issues = useMemo(() => {
    const live = validateProject(project).filter((i) => i.code !== 'cycle' || !project.excludedLinks?.length);
    const imported = project.importReport.items.filter((i) => !['missing-predecessor', 'self-link', 'duplicate-uid', 'finish-before-start', 'invalid-duration', 'constraint-no-date'].includes(i.code));
    const out: ReportItem[] = [...live];
    for (const i of imported) if (!out.some((o) => o.code === i.code && o.message === i.message)) out.push(i);
    return out;
  }, [project]);
  const issueUids = useMemo(() => {
    const m = new Map<number, ReportItem['level']>();
    for (const i of issues) for (const u of i.taskUids ?? []) if (i.level !== 'info' && m.get(u) !== 'error') m.set(u, i.level);
    return m;
  }, [issues]);

  const tasks = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? project.tasks.filter((t) => t.name.toLowerCase().includes(q) || String(t.id) === q || t.wbs === q) : project.tasks;
  }, [project, filter]);
  const editingTask = editing !== null ? project.tasks.find((t) => t.uid === editing) : undefined;
  const check = project.importReport.scheduleCheck;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ImpactStrip />
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <h1 className="text-[18px] font-semibold">Project data</h1>
        <span className="num text-[13px] text-ink-3">{project.tasks.length} tasks</span>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find by name, ID or WBS"
          aria-label="Filter tasks"
          className="ml-auto h-8 w-[280px] rounded-[6px] border border-control bg-surface px-2.5 text-[13px] placeholder:text-ink-3"
        />
      </div>

      <ValidationPanel issues={issues} check={check} />
      {check && check.mismatchedUids.length > 0 && <ScheduleCheckDetails uids={check.mismatchedUids} onFind={(id) => setFilter(String(id))} />}

      <div className="min-h-0 flex-1 overflow-auto bg-surface">
        <table className="w-full min-w-[1360px] border-collapse text-[13px]" data-testid="data-table">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="text-left text-[12px] text-ink-3 shadow-[inset_0_-1px_0_var(--color-line)]">
              <th className="w-[52px] px-2 py-2 text-right font-normal">ID</th>
              <th className="w-[60px] px-2 py-2 text-right font-normal">UID</th>
              <th className="min-w-[240px] px-2 py-2 font-normal">Task name</th>
              <th className="px-2 py-2 font-normal">Phase</th>
              <th className="w-[118px] px-2 py-2 font-normal">Planned start</th>
              <th className="w-[118px] px-2 py-2 font-normal">Planned finish</th>
              <th className="w-[76px] px-2 py-2 text-right font-normal">Duration</th>
              <th className="min-w-[150px] px-2 py-2 font-normal">Predecessors</th>
              <th className="w-[64px] px-2 py-2 font-normal">Type</th>
              <th className="w-[70px] px-2 py-2 text-right font-normal">Lag</th>
              <th className="w-[96px] px-2 py-2 font-normal">Status</th>
              <th className="w-[64px] px-2 py-2 text-right font-normal">% done</th>
              <th className="w-[72px] px-2 py-2 font-normal">Milestone</th>
              <th className="w-[70px] px-2 py-2 font-normal">Critical</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const s = original.byUid.get(t.uid);
              const issue = issueUids.get(t.uid);
              const single = t.predecessors.length === 1 ? t.predecessors[0]! : null;
              return (
                <tr key={t.uid} className={cx('border-b border-rule align-middle hover:bg-raised', t.summary && 'font-medium')} data-uid={t.uid}>
                  <td className="num px-2 py-1 text-right text-ink-3">
                    <span className="inline-flex items-center gap-1">
                      {issue && <span title={issue === 'error' ? 'Has a validation error' : 'Has a warning'} className={issue === 'error' ? 'text-late' : 'text-sim-ink'}><Alert size={13} /></span>}
                      {t.id}
                    </span>
                  </td>
                  <td className="num px-2 py-1 text-right text-ink-3">{t.uid}</td>
                  <td className="px-2 py-1" style={{ paddingLeft: 8 + (t.outlineLevel - 1) * 14 }}>
                    <EditText value={t.name} label={`Name of task ${t.id}`} onCommit={(v) => editTask(t.uid, { name: v })} />
                  </td>
                  <td className="px-2 py-1 text-ink-2">{t.outlineLevel === 1 ? '—' : phaseOf(project, t.uid)?.name ?? '—'}</td>
                  <td className="px-2 py-1">
                    {t.summary || !s ? <span className="num text-ink-2">{s ? formatDate(s.es) : '—'}</span> : (
                      <EditDate value={s.es} label={`Start of ${t.name}`} title={t.manual ? 'Moves the manually scheduled task' : 'Sets a "Start No Earlier Than" constraint, as MS Project does'} onCommit={(day) => editTask(t.uid, { start: day + project.dayStartHours / 24 })} />
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {t.summary || !s ? <span className="num text-ink-2">{s ? formatDate(s.ef) : '—'}</span> : (
                      <EditDate value={s.ef} label={`Finish of ${t.name}`} title="Changes the duration to fit" onCommit={(day) => editTask(t.uid, { finish: { value: day, currentStart: s.es } })} />
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {t.summary ? <span className="num text-ink-2">{s ? `${Math.round(s.duration * 10) / 10}d` : '—'}</span> : (
                      <EditNumber value={t.duration} suffix="d" label={`Duration of ${t.name}`} onCommit={(v) => editTask(t.uid, { duration: v })} />
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1">
                      <EditText
                        value={formatPredecessors(t, project)}
                        label={`Predecessors of ${t.name}`}
                        placeholder="—"
                        mono
                        onCommit={(v) => {
                          const r = parsePredecessors(v, project, t.uid);
                          if ('error' in r) {
                            useProject.getState().setNotice({ kind: 'error', text: r.error });
                            return false;
                          }
                          return editTask(t.uid, { predecessors: r.links });
                        }}
                      />
                      <button type="button" className="shrink-0 rounded-[4px] px-1.5 py-0.5 text-[12px] text-ink-2 hover:bg-active hover:text-ink" onClick={() => setEditing(t.uid)} aria-label={`Edit dependencies of ${t.name}`}>
                        Edit
                      </button>
                    </div>
                  </td>
                  <td className="px-2 py-1 text-ink-2">{single ? single.type : t.predecessors.length > 1 ? 'Mixed' : '—'}</td>
                  <td className="num px-2 py-1 text-right text-ink-2">{single ? lagLabel(single) : t.predecessors.length > 1 ? '…' : '—'}</td>
                  <td className="px-2 py-1">
                    {t.summary || !s ? <StatusPill t={t} /> : (
                      <select
                        aria-label={`Status of ${t.name}`}
                        value={statusOf(t)}
                        onChange={(e) => editTask(t.uid, { status: { value: e.target.value as ReturnType<typeof statusOf>, start: s.es, finish: s.ef } })}
                        className={cx('h-7 rounded-[4px] border border-transparent bg-transparent px-1 text-[12px] font-medium hover:border-control', statusOf(t) === 'Complete' ? 'text-ok' : 'text-ink-2')}
                      >
                        <option>Not started</option>
                        <option>In progress</option>
                        <option>Complete</option>
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {t.summary ? <span className="num text-ink-2">{Math.round(t.percentComplete)}%</span> : (
                      <EditNumber value={t.percentComplete} suffix="%" label={`Percent complete of ${t.name}`} onCommit={(v) => editTask(t.uid, { percentComplete: v })} />
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {!t.summary && (
                      <input type="checkbox" checked={t.milestone} aria-label={`${t.name} is a milestone`} onChange={(e) => editTask(t.uid, { milestone: e.target.checked })} className="h-4 w-4 accent-[#1f2226]" />
                    )}
                  </td>
                  <td className="px-2 py-1">{s?.critical ? <Pill tone="critical">Critical</Pill> : <span className="text-ink-3">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingTask && <DependencyDialog task={editingTask} onClose={() => setEditing(null)} />}
    </div>
  );
}

function lagLabel(l: Link) {
  if (!l.lag) return '0';
  return `${l.lag > 0 ? '+' : '−'}${Math.round(Math.abs(l.lag) * 100) / 100}${l.lagUnit === 'ed' ? 'ed' : 'd'}`;
}

function StatusPill({ t }: { t: Task }) {
  const s = statusOf(t);
  return <Pill tone={s === 'Complete' ? 'ok' : 'neutral'}>{s}</Pill>;
}

/**
 * Tasks whose recalculated dates differ from the dates stored in the file, with what drives
 * each one in Schedrift and the most likely reason for the difference.
 */
function ScheduleCheckDetails({ uids, onFind }: { uids: number[]; onFind: (id: number) => void }) {
  const project = useProject((s) => s.project)!;
  const original = useProject((s) => s.original)!;
  const byUid = new Map(project.tasks.map((t) => [t.uid, t]));
  const net = useMemo(() => buildNetwork(project), [project]);
  const rows = uids.map((uid) => byUid.get(uid)).filter((t): t is Task => !!t);
  if (!rows.length) return null;

  const wd = (t: Task, a: number, b: number) => {
    const cal = (t.calendarUid !== null && net.calendars.get(t.calendarUid)) || net.defaultCal;
    const d = Math.round((cal.toOrd(b) - cal.toOrd(a)) * 10) / 10;
    return d === 0 ? '0' : `${d > 0 ? '+' : '−'}${Math.abs(d)}d`;
  };
  const driverText = (t: Task) => {
    const s = original.byUid.get(t.uid);
    if (!s) return '—';
    const d = s.driver;
    if (d.kind === 'link') return `Right after “${byUid.get(d.predUid)?.name ?? d.predUid}” (${d.type})`;
    if (d.kind === 'constraint') return `${t.constraint.type} constraint${t.constraint.date !== undefined ? ` on ${formatDate(t.constraint.date)}` : ''}`;
    if (d.kind === 'file') return 'Dates from the project file';
    if (d.kind === 'actual') return 'Actual dates / progress';
    if (d.kind === 'manual') return 'Manually scheduled (pinned)';
    return d.kind;
  };
  const causes = (t: Task): string[] => {
    const out: string[] = [];
    if (t.levelingDelay) out.push(`resource-leveling delay of ${t.levelingDelay} d in MS Project (not applied here)`);
    if (t.manual) out.push('manually scheduled task');
    if (t.calendarUid !== null) out.push(`uses its own calendar “${project.calendars.find((c) => c.uid === t.calendarUid)?.name ?? t.calendarUid}”`);
    if (t.constraint.type === 'ALAP') out.push('“As Late As Possible” is scheduled as soon as possible');
    if (t.predecessors.some((l) => l.lagUnit === 'ed')) out.push('elapsed-day lag');
    if (t.actualStart !== undefined && t.percentComplete < 100) out.push('in progress: MS Project may have rescheduled remaining work');
    if (project.importReport.items.some((i) => i.code === 'split-tasks' && i.taskUids?.includes(t.uid))) out.push('split task');
    if (!out.length) out.push('none detected. MS Project may not have recalculated before saving, or the task uses a feature Schedrift does not model (e.g. resource-driven duration).');
    return out;
  };

  return (
    <section className="border-b border-line bg-surface px-4 py-3" aria-labelledby="check-h" data-testid="schedule-check-details">
      <h2 id="check-h" className="text-[14px] font-semibold">Tasks whose dates differ from the file</h2>
      <p className="text-[12px] text-ink-2">
        Simulations start from Schedrift’s dates. If a task below feeds Go-Live, its difference carries into the Go-Live date.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-3">
              <th className="py-1.5 pr-3 font-normal">Task</th>
              <th className="py-1.5 pr-3 font-normal">In the file</th>
              <th className="py-1.5 pr-3 font-normal">Schedrift</th>
              <th className="py-1.5 pr-3 text-right font-normal">Start Δ</th>
              <th className="py-1.5 pr-3 text-right font-normal">Finish Δ</th>
              <th className="py-1.5 pr-3 font-normal">Schedrift schedules it by</th>
              <th className="py-1.5 font-normal">Likely cause</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const s = original.byUid.get(t.uid)!;
              return (
                <tr key={t.uid} className="border-t border-rule align-top">
                  <td className="py-1.5 pr-3">
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => onFind(t.id)} title="Show this task in the table">
                      {t.id}. {t.name}
                    </button>
                    {s.critical && <span className="ml-2"><Pill tone="critical">Critical</Pill></span>}
                  </td>
                  <td className="num whitespace-nowrap py-1.5 pr-3 text-ink-2">{formatDate(t.start)} → {formatDate(t.finish)}</td>
                  <td className="num whitespace-nowrap py-1.5 pr-3">{formatDate(s.es)} → {formatDate(s.ef)}</td>
                  <td className="num whitespace-nowrap py-1.5 pr-3 text-right">{wd(t, t.start, s.es)}</td>
                  <td className="num whitespace-nowrap py-1.5 pr-3 text-right">{wd(t, t.finish, s.ef)}</td>
                  <td className="py-1.5 pr-3 text-ink-2">{driverText(t)}</td>
                  <td className="py-1.5 text-ink-2">{causes(t).join('; ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ValidationPanel({ issues, check }: { issues: ReportItem[]; check?: { compared: number; matched: number } }) {
  const [open, setOpen] = useState(true);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;
  return (
    <section className="border-b border-line bg-raised px-4 py-2" aria-labelledby="validation-h" data-testid="validation-panel">
      <div className="flex items-center gap-3">
        <h2 id="validation-h" className="text-[14px] font-semibold">Validation</h2>
        <span className={cx('text-[13px]', errors ? 'text-late-ink' : 'text-ink-2')}>{errors} {errors === 1 ? 'error' : 'errors'}</span>
        <span className={cx('text-[13px]', warnings ? 'text-sim-ink' : 'text-ink-2')}>{warnings} {warnings === 1 ? 'warning' : 'warnings'}</span>
        {check && (
          <span className="num text-[13px] text-ink-2" title="Tasks that show the same dates as the imported file">
            Schedule check: {check.matched} of {check.compared} tasks match the file
          </span>
        )}
        {issues.length > 0 && (
          <button type="button" className="ml-auto text-[13px] text-ink-2 hover:text-ink" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide details' : 'Show details'}
          </button>
        )}
      </div>
      {open && issues.length > 0 && (
        <ul className="mt-1.5 flex max-h-[148px] flex-col gap-1 overflow-auto pb-1">
          {issues.map((i, k) => (
            <li key={k} className="flex items-start gap-2 text-[13px] leading-[18px]">
              <span className={cx('mt-[1px] shrink-0', i.level === 'error' ? 'text-late' : i.level === 'warning' ? 'text-sim-ink' : 'text-ink-3')}>
                {i.level === 'info' ? <Info size={14} /> : <Alert size={14} />}
              </span>
              <span className={i.level === 'error' ? 'text-late-ink' : 'text-ink'}>{i.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- editable cells ----------

function useCellEditor(commit: (raw: string) => boolean | void, initial: string) {
  const [draft, setDraft] = useState<string | null>(null);
  const start = () => setDraft(initial);
  const finish = (save: boolean) => {
    if (save && draft !== null && draft !== initial) {
      const ok = commit(draft);
      if (ok === false) return; // keep editing so the user can fix it
    }
    setDraft(null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };
  return { draft, setDraft, start, finish, onKey };
}

const cellBtn = 'w-full truncate rounded-[4px] px-1.5 py-1 text-left hover:bg-active focus-visible:bg-active';
const cellInput = 'h-7 w-full rounded-[4px] border border-ink bg-surface px-1.5 text-[13px] outline-none';

function EditText({ value, onCommit, label, placeholder, mono }: { value: string; onCommit: (v: string) => boolean | void; label: string; placeholder?: string; mono?: boolean }) {
  const ed = useCellEditor(onCommit, value);
  if (ed.draft !== null) {
    return <input autoFocus aria-label={label} className={cx(cellInput, mono && 'num')} value={ed.draft} onChange={(e) => ed.setDraft(e.target.value)} onBlur={() => ed.finish(true)} onKeyDown={ed.onKey} />;
  }
  return (
    <button type="button" className={cx(cellBtn, mono && 'num', !value && 'text-ink-3')} onClick={ed.start} aria-label={`${label}: ${value || 'none'}. Click to edit`}>
      {value || placeholder || ''}
    </button>
  );
}

function EditNumber({ value, onCommit, label, suffix }: { value: number; onCommit: (v: number) => boolean | void; label: string; suffix: string }) {
  const shown = String(Math.round(value * 100) / 100);
  const ed = useCellEditor((raw) => {
    const n = Number(raw.replace(',', '.'));
    if (!Number.isFinite(n)) return false;
    return onCommit(n);
  }, shown);
  if (ed.draft !== null) {
    return <input autoFocus inputMode="decimal" aria-label={label} className={cx(cellInput, 'num text-right')} value={ed.draft} onChange={(e) => ed.setDraft(e.target.value)} onBlur={() => ed.finish(true)} onKeyDown={ed.onKey} />;
  }
  return <button type="button" className={cx(cellBtn, 'num text-right')} onClick={ed.start} aria-label={`${label}: ${shown}. Click to edit`}>{shown}{suffix}</button>;
}

function EditDate({ value, onCommit, label, title }: { value: number; onCommit: (day: number) => void; label: string; title: string }) {
  const iso = formatInstantISO(value, false);
  const ed = useCellEditor((raw) => {
    const t = parseInstant(raw);
    if (t === null) return false;
    onCommit(t);
  }, iso);
  if (ed.draft !== null) {
    return <input autoFocus type="date" aria-label={label} className={cx(cellInput, 'num')} value={ed.draft} onChange={(e) => ed.setDraft(e.target.value)} onBlur={() => ed.finish(true)} onKeyDown={ed.onKey} />;
  }
  return <button type="button" title={title} className={cx(cellBtn, 'num')} onClick={ed.start} aria-label={`${label}: ${formatDate(value)}. Click to edit`}>{formatDate(value)}</button>;
}

// ---------- dependency dialog ----------

function DependencyDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const project = useProject((s) => s.project)!;
  const editTask = useProject((s) => s.editTask);
  const [links, setLinks] = useState<Link[]>(() => task.predecessors.map((l) => ({ ...l })));
  const [error, setError] = useState<string | null>(null);
  const candidates = project.tasks.filter((t) => t.uid !== task.uid);

  const update = (i: number, patch: Partial<Link>) => setLinks((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const save = () => {
    const ok = editTask(task.uid, { predecessors: links });
    if (ok) onClose();
    else setError(useProject.getState().notice?.text ?? 'The change could not be applied.');
  };

  return (
    <Dialog open onClose={onClose} title={`Dependencies of “${task.name}”`} width={640}>
      <p className="text-[13px] text-ink-2">Each predecessor controls when this task can start or finish. Lag is in working days; use a negative value for a lead.</p>
      <table className="mt-3 w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-[12px] text-ink-3">
            <th className="py-1.5 font-normal">Predecessor</th>
            <th className="w-[150px] py-1.5 font-normal">Type</th>
            <th className="w-[92px] py-1.5 font-normal">Lag</th>
            <th className="w-[40px]" />
          </tr>
        </thead>
        <tbody>
          {links.map((l, i) => (
            <tr key={i} className="border-t border-rule">
              <td className="py-1.5 pr-2">
                <select aria-label="Predecessor task" value={l.predUid} onChange={(e) => update(i, { predUid: Number(e.target.value) })} className="h-8 w-full rounded-[6px] border border-control bg-surface px-1.5">
                  {candidates.map((c) => <option key={c.uid} value={c.uid}>{c.id}. {c.name}</option>)}
                </select>
              </td>
              <td className="py-1.5 pr-2">
                <select aria-label="Dependency type" value={l.type} onChange={(e) => update(i, { type: e.target.value as LinkType })} className="h-8 w-full rounded-[6px] border border-control bg-surface px-1.5">
                  <option value="FS">Finish-to-Start</option>
                  <option value="SS">Start-to-Start</option>
                  <option value="FF">Finish-to-Finish</option>
                  <option value="SF">Start-to-Finish</option>
                </select>
              </td>
              <td className="py-1.5 pr-2">
                <input aria-label="Lag in working days" type="number" step="0.5" value={l.lag} onChange={(e) => update(i, { lag: Number(e.target.value), lagUnit: 'wd' })} className="num h-8 w-full rounded-[6px] border border-control bg-surface px-1.5 text-right" />
              </td>
              <td className="py-1.5 text-right">
                <button type="button" aria-label="Remove dependency" className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-ink-2 hover:bg-late-soft hover:text-late-ink" onClick={() => setLinks((ls) => ls.filter((_, k) => k !== i))}>
                  <Trash />
                </button>
              </td>
            </tr>
          ))}
          {links.length === 0 && <tr><td colSpan={4} className="border-t border-rule py-3 text-ink-3">No predecessors. The task starts with the project.</td></tr>}
        </tbody>
      </table>
      <Button className="mt-2" size="sm" icon={<Plus size={14} />} disabled={!candidates.length} onClick={() => {
        const used = new Set(links.map((l) => l.predUid));
        const next = candidates.find((c) => !used.has(c.uid) && c.id < task.id) ?? candidates.find((c) => !used.has(c.uid));
        if (next) setLinks((ls) => [...ls, { predUid: next.uid, type: 'FS', lag: 0, lagUnit: 'wd' }]);
      }}>Add predecessor</Button>
      {error && <p className="mt-3 rounded-[6px] bg-late-soft px-3 py-2 text-[13px] text-late-ink" role="alert">{error}</p>}
      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} data-testid="save-dependencies">Apply</Button>
      </div>
    </Dialog>
  );
}
