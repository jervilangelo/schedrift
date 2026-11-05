import { useMemo } from 'react';
import { useProject } from '../../store/useProject';
import { formatDate, formatDays } from '../../scheduling/time';
import { cx } from '../../components/ui/controls';

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
  const milestones = project.tasks.filter((t) => !t.summary && t.milestone).map((t) => ({ uid: t.uid, name: t.name }));
  // Any task can be Go-Live (MS Project files often hold it as a 1-day task, not a milestone).
  const others = project.tasks.filter((t) => !t.summary && !t.milestone).map((t) => ({ uid: t.uid, name: `${t.id}. ${t.name}` }));
  const variance = impact?.goLive?.variance ?? 0;
  const late = simulated && variance > 0;
  const constrained = impact?.goLive?.constrainedLogicDate !== undefined;

  return (
    <div className={cx('flex items-stretch gap-0 border-b border-line bg-surface', compact ? 'px-3' : 'px-4')} data-testid="impact-strip">
      <Metric label="Go-Live" wide>
        {milestones.length + others.length > 0 ? (
          <select
            aria-label="Go-Live milestone"
            value={project.goLiveUid ?? ''}
            onChange={(e) => setGoLive(Number(e.target.value))}
            className="max-w-[220px] cursor-pointer truncate rounded-[4px] bg-transparent py-0.5 pr-1 text-[14px] font-medium hover:bg-raised"
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
        ) : (
          <span className="text-[14px] font-medium">{goLive?.name ?? 'Project finish'}</span>
        )}
      </Metric>
      <Metric label="Original date">
        <span className="num text-[20px] leading-[26px] font-semibold" data-testid="golive-original">{o ? formatDate(o.ef, { weekday: true }) : '—'}</span>
      </Metric>
      <Metric label="Simulated date">
        <span className={cx('num text-[20px] leading-[26px] font-semibold', late ? 'text-late' : simulated ? 'text-ink' : 'text-ink-3')} data-testid="golive-simulated">
          {simulated && impact?.goLive ? formatDate(impact.goLive.simulated, { weekday: true }) : '—'}
        </span>
      </Metric>
      <Metric label="Variance">
        <span className={cx('num text-[20px] leading-[26px] font-semibold', late ? 'text-late' : 'text-ink-3')} data-testid="golive-variance">
          {!simulated ? '—' : variance === 0 ? '0 days' : `${variance > 0 ? '+' : ''}${formatDays(variance)}`}
        </span>
      </Metric>
      {!compact && (
        <>
          <Metric label="Critical tasks">
            <span className="num text-[20px] leading-[26px] font-semibold">{criticalCount}</span>
            <span className="num ml-1 text-[13px] text-ink-3">of {leafCount}</span>
          </Metric>
          <Metric label="Complete">
            <span className="num text-[20px] leading-[26px] font-semibold">{done}</span>
            <span className="num ml-1 text-[13px] text-ink-3">of {leafCount}</span>
          </Metric>
        </>
      )}
      <div className="flex min-w-0 flex-1 items-center py-2 pl-5">
        <p className={cx('line-clamp-2 text-[13px] leading-[18px]', late ? 'text-late-ink' : 'text-ink-2')} data-testid="impact-summary">
          {impact ? impact.summary : constrained ? '' : 'Select a task in the chart and simulate a delay to see its effect on Go-Live.'}
        </p>
      </div>
    </div>
  );
}

function Metric({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cx('flex shrink-0 flex-col justify-center border-r border-rule py-2 pr-5 pl-0 [&:not(:first-child)]:pl-5', wide && 'min-w-[150px]')}>
      <span className="text-[12px] text-ink-3">{label}</span>
      <span className="flex items-baseline">{children}</span>
    </div>
  );
}
