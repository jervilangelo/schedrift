import { useMemo } from 'react';
import { useProject } from '../../store/useProject';
import { formatDate, formatDays, todayInstant } from '../../scheduling/time';
import { cx } from '../../components/ui/controls';
import { ChevronDown } from '../../components/ui/icons';

/** Go-Live summary: the answer to "where does Go-Live land?" — read first on every screen. */
export function ImpactStrip({ compact = false }: { compact?: boolean }) {
  const project = useProject((s) => s.project)!;
  const original = useProject((s) => s.original)!;
  const simulated = useProject((s) => s.simulated);
  const impact = useProject((s) => s.impact);
  const setGoLive = useProject((s) => s.setGoLive);

  const goLive = project.tasks.find((t) => t.uid === project.goLiveUid);
  const o = goLive ? original.byUid.get(goLive.uid) : undefined;
  const result = simulated ?? original;
  const criticalCount = useMemo(
    () => project.tasks.filter((t) => !t.summary && result.byUid.get(t.uid)?.critical).length,
    [project, result],
  );
  const leafCount = project.tasks.filter((t) => !t.summary).length;
  const done = project.tasks.filter((t) => !t.summary && (t.percentComplete >= 100 || t.actualFinish !== undefined)).length;
  const donePct = leafCount ? Math.round((done / leafCount) * 100) : 0;
  const milestones = project.tasks.filter((t) => !t.summary && t.milestone).map((t) => ({ uid: t.uid, name: t.name }));
  // Any task can be Go-Live (MS Project files often hold it as a 1-day task, not a milestone).
  const others = project.tasks.filter((t) => !t.summary && !t.milestone).map((t) => ({ uid: t.uid, name: `${t.id}. ${t.name}` }));
  const variance = impact?.goLive?.variance ?? 0;
  const late = !!simulated && variance > 0;
  const early = !!simulated && variance < 0;
  const constrained = impact?.goLive?.constrainedLogicDate !== undefined;

  return (
    <div className={cx('flex items-stretch border-b border-line bg-surface', compact ? 'px-4' : 'px-4')} data-testid="impact-strip">
      {/* Go-Live: which task, planned date, and the simulated date when a simulation runs */}
      <div className="flex shrink-0 items-center gap-6 py-2.5 pr-6">
        <div className="flex min-w-0 flex-col">
          <span className="text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">Go-Live</span>
          {milestones.length + others.length > 0 ? (
            <label className="relative -ml-1 flex max-w-[230px] items-center rounded-[4px] hover:bg-raised">
              <select
                aria-label="Go-Live milestone"
                value={project.goLiveUid ?? ''}
                onChange={(e) => setGoLive(Number(e.target.value))}
                className="w-full cursor-pointer appearance-none truncate bg-transparent py-0.5 pr-5 pl-1 text-[13px] font-medium text-ink-2"
              >
                {milestones.length > 0 && (
                  <optgroup label="Milestones">
                    {milestones.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
                  </optgroup>
                )}
                <optgroup label="Other tasks">
                  {others.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
                </optgroup>
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-1 text-ink-3" />
            </label>
          ) : (
            <span className="text-[13px] font-medium text-ink-2">{goLive?.name ?? 'Project finish'}</span>
          )}
        </div>

        <div className="flex flex-col">
          <span className="text-[11px] text-ink-3">{simulated ? 'Planned' : 'Planned date'}</span>
          <span
            className={cx('num font-semibold tracking-[-0.01em]', simulated ? 'text-[16px] leading-[24px] text-ink-3' : 'text-[22px] leading-[28px] text-ink')}
            data-testid="golive-original"
          >
            {o ? formatDate(o.ef, { weekday: true }) : '—'}
          </span>
        </div>

        {simulated ? (
          <div className="flex flex-col">
            <span className="text-[11px] text-ink-3">Simulated</span>
            <span className="flex items-center gap-2">
              <span className={cx('num text-[22px] leading-[28px] font-semibold tracking-[-0.01em]', late ? 'text-late' : early ? 'text-ok' : 'text-ink')} data-testid="golive-simulated">
                {impact?.goLive ? formatDate(impact.goLive.simulated, { weekday: true }) : '—'}
              </span>
              <span
                className={cx('num rounded-full px-2 py-0.5 text-[12px] font-semibold', late ? 'bg-late-soft text-late-ink' : early ? 'bg-ok-soft text-ok' : 'bg-active text-ink-2')}
                data-testid="golive-variance"
              >
                {variance === 0 ? '0 days' : `${variance > 0 ? '+' : ''}${formatDays(variance)}`}
              </span>
            </span>
          </div>
        ) : (
          <div className="flex flex-col">
            <span className="text-[11px] text-ink-3">Time to Go-Live</span>
            <span className="num text-[16px] leading-[24px] font-semibold text-ink-2">{o ? untilText(o.ef) : '—'}</span>
          </div>
        )}
      </div>

      {/* Project health */}
      <div className="flex shrink-0 items-center gap-5 border-l border-rule py-2.5 pr-6 pl-6">
        {!compact && (
          <div className="flex flex-col">
            <span className="text-[11px] text-ink-3">Critical tasks</span>
            <span className="num text-[16px] leading-[24px] font-semibold">
              {criticalCount}
              <span className="ml-1 text-[12px] font-normal text-ink-3">of {leafCount}</span>
            </span>
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-[11px] text-ink-3">Tasks complete</span>
          <span className="flex items-center gap-2">
            <span className="num text-[16px] leading-[24px] font-semibold">{donePct}%</span>
            <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-active xl:block" aria-hidden="true">
              <span className="block h-full rounded-full bg-bar" style={{ width: `${donePct}%` }} />
            </span>
            <span className="num hidden text-[12px] text-ink-3 xl:inline">{done} of {leafCount}</span>
          </span>
        </div>
      </div>

      <div className="flex min-w-[220px] flex-1 items-center border-l border-rule py-2 pl-6">
        <p className={cx('line-clamp-2 text-[13px] leading-[18px]', late ? 'text-late-ink' : 'text-ink-2')} data-testid="impact-summary">
          {impact ? impact.summary : constrained || compact ? '' : (
            <span className="text-ink-3">Select a task and drag its delay slider to see the effect on Go-Live.</span>
          )}
        </p>
      </div>
    </div>
  );
}

/** "18 weeks", "5 days", or "Passed" — calendar time from today to a date. */
function untilText(t: number): string {
  const days = Math.round(t - todayInstant());
  if (days < 0) return 'Passed';
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 120) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30.44)} months`;
}
