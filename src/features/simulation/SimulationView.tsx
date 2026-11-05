import { useMemo } from 'react';
import { useProject } from '../../store/useProject';
import { phaseOf } from '../../model/edit';
import { formatDate, formatDays } from '../../scheduling/time';
import { Button, Pill, cx } from '../../components/ui/controls';
import { ImpactStrip } from '../timeline/ImpactStrip';

const signed = (n: number) => (n === 0 ? '0' : `${n > 0 ? '+' : '−'}${Math.round(Math.abs(n) * 10) / 10}`);
const floatTxt = (f: number | null) => (f === null ? '—' : `${Math.round(f * 10) / 10}`);

export function SimulationView() {
  const project = useProject((s) => s.project)!;
  const original = useProject((s) => s.original)!;
  const simulated = useProject((s) => s.simulated);
  const impact = useProject((s) => s.impact);
  const applied = useProject((s) => s.applied);
  const setView = useProject((s) => s.setView);
  const select = useProject((s) => s.select);
  const reset = useProject((s) => s.resetSimulation);
  const byUid = useMemo(() => new Map(project.tasks.map((t) => [t.uid, t])), [project]);

  if (!simulated || !impact || !applied) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ImpactStrip />
        <div className="flex flex-1 items-start justify-center overflow-auto p-10">
          <section className="w-full max-w-[640px] rounded-[8px] border border-line bg-surface p-6" aria-labelledby="no-sim">
            <h1 id="no-sim" className="text-[20px] font-semibold">No simulation yet</h1>
            <p className="mt-2 text-[14px] leading-[22px] text-ink-2">
              Open the timeline, select one or more tasks, enter a delay in working days and run the simulation. This page then lists every task whose dates move, how float and the critical path change, and the chain of tasks that carries the delay to Go-Live.
            </p>
            <Button variant="primary" className="mt-4" onClick={() => setView('timeline')}>Go to timeline</Button>
          </section>
        </div>
      </div>
    );
  }

  const goTo = (uid: number) => {
    setView('timeline');
    select(uid);
  };
  const changed = impact.changed.slice().sort((a, b) => (original.byUid.get(a.uid)!.es - original.byUid.get(b.uid)!.es));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ImpactStrip />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto grid max-w-[1320px] grid-cols-1 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="rounded-[8px] border border-line bg-surface" aria-labelledby="impact-h">
            <div className="border-b border-line px-5 py-4">
              <h1 id="impact-h" className="text-[20px] font-semibold">Impact on Go-Live</h1>
              <p className={cx('mt-1 text-[15px] leading-[22px]', impact.goLive && impact.goLive.variance > 0 ? 'text-late-ink' : 'text-ink')} data-testid="sim-summary">
                {impact.summary}
              </p>
              <ul className="mt-2 flex flex-col gap-0.5 text-[13px] leading-[19px] text-ink-2">
                {impact.details.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </div>

            <div className="px-5 pt-4 pb-2">
              <h2 className="text-[15px] font-semibold">Tasks whose dates change</h2>
              <p className="text-[12px] text-ink-3">{changed.length} of {project.tasks.filter((t) => !t.summary).length} tasks · working days · float before → after</p>
            </div>
            <div className="overflow-x-auto px-2 pb-3">
              <table className="w-full min-w-[820px] border-collapse text-[13px]" data-testid="changed-table">
                <thead>
                  <tr className="text-left text-[12px] text-ink-3">
                    <th className="px-3 py-2 font-normal">Task</th>
                    <th className="px-3 py-2 font-normal">Phase</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-normal">Original finish</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-normal">Simulated finish</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-normal">Start Δ</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-normal">Finish Δ</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-normal">Float</th>
                    <th className="px-3 py-2 font-normal">Critical</th>
                  </tr>
                </thead>
                <tbody>
                  {changed.map((c) => {
                    const t = byUid.get(c.uid)!;
                    const o = original.byUid.get(c.uid)!;
                    const s = simulated.byUid.get(c.uid)!;
                    const inScenario = applied.items.some((i) => i.uid === c.uid);
                    return (
                      <tr key={c.uid} className="border-t border-rule hover:bg-raised">
                        <td className="px-3 py-2">
                          <button type="button" className="text-left font-medium hover:underline" onClick={() => goTo(c.uid)}>{t.name}</button>
                          {inScenario && <span className="ml-2"><Pill tone="sim">In scenario</Pill></span>}
                          {impact.drivingChain.includes(c.uid) && <span className="ml-1"><Pill tone="late">Drives Go-Live</Pill></span>}
                        </td>
                        <td className="px-3 py-2 text-ink-2">{phaseOf(project, c.uid)?.name ?? '—'}</td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right text-ink-2">{formatDate(o.ef)}</td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-late-ink">{formatDate(s.ef)}</td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right">{signed(c.startDelta)}</td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right font-medium">{signed(c.finishDelta)}</td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right text-ink-2">{floatTxt(c.floatBefore)} → <span className={cx(c.floatAfter !== null && c.floatBefore !== null && c.floatAfter < c.floatBefore && 'text-late-ink')}>{floatTxt(c.floatAfter)}</span></td>
                        <td className="px-3 py-2 text-[12px] text-ink-2">
                          {c.criticalBefore === c.criticalAfter ? (c.criticalAfter ? 'Yes' : 'No') : c.criticalAfter ? <span className="font-medium text-ink">Becomes critical</span> : 'No longer critical'}
                        </td>
                      </tr>
                    );
                  })}
                  {changed.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-2">No task dates change.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="flex flex-col gap-4">
            <section className="rounded-[8px] border border-line bg-surface px-5 py-4" aria-labelledby="scenario-h">
              <div className="flex items-center justify-between">
                <h2 id="scenario-h" className="text-[15px] font-semibold">Scenario</h2>
                <Button size="sm" onClick={reset}>Reset simulation</Button>
              </div>
              <ul className="mt-2 flex flex-col">
                {impact.outcomes.map((o) => {
                  const item = applied.items.find((i) => i.uid === o.uid)!;
                  return (
                    <li key={o.uid} className="border-t border-rule py-2 first:border-t-0">
                      <button type="button" className="text-left text-[13px] font-medium hover:underline" onClick={() => goTo(o.uid)}>{o.name}</button>
                      <p className="num text-[12px] text-ink-2">
                        {[item.startDelay ? `start +${item.startDelay} d` : '', item.durationDelta ? `duration +${item.durationDelta} d` : ''].filter(Boolean).join(', ')}
                        {' · '}float was {o.floatBefore === null ? '—' : formatDays(o.floatBefore)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="rounded-[8px] border border-line bg-surface px-5 py-4" aria-labelledby="chain-h">
              <h2 id="chain-h" className="text-[15px] font-semibold">Driving chain to Go-Live</h2>
              {impact.drivingChain.length === 0 ? (
                <p className="mt-1 text-[13px] leading-[19px] text-ink-2">No delay reaches Go-Live, so there is no driving chain.</p>
              ) : (
                <ol className="mt-2 flex flex-col" data-testid="driving-chain">
                  {impact.drivingChain.map((uid, i) => {
                    const o = original.byUid.get(uid)!;
                    const s = simulated.byUid.get(uid)!;
                    return (
                      <li key={uid} className="relative flex gap-3 pb-3 last:pb-0">
                        <span className="relative flex w-3 justify-center" aria-hidden="true">
                          <span className="mt-1.5 h-2 w-2 rounded-full bg-late" />
                          {i < impact.drivingChain.length - 1 && <span className="absolute top-4 bottom-[-6px] w-px bg-late/50" />}
                        </span>
                        <div className="min-w-0">
                          <button type="button" className="text-left text-[13px] font-medium hover:underline" onClick={() => goTo(uid)}>{byUid.get(uid)?.name}</button>
                          <p className="num text-[12px] text-ink-2">{formatDate(o.ef, { year: false })} → <span className="text-late-ink">{formatDate(s.ef, { year: false })}</span></p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            <section className="rounded-[8px] border border-line bg-surface px-5 py-4" aria-labelledby="crit-h">
              <h2 id="crit-h" className="text-[15px] font-semibold">Critical path changes</h2>
              {impact.becameCritical.length + impact.noLongerCritical.length === 0 ? (
                <p className="mt-1 text-[13px] text-ink-2">The critical path is unchanged.</p>
              ) : (
                <div className="mt-1 flex flex-col gap-2 text-[13px]">
                  {impact.becameCritical.length > 0 && (
                    <div><p className="text-[12px] text-ink-3">Becomes critical</p><p>{impact.becameCritical.map((u) => byUid.get(u)?.name).join(', ')}</p></div>
                  )}
                  {impact.noLongerCritical.length > 0 && (
                    <div><p className="text-[12px] text-ink-3">No longer critical</p><p>{impact.noLongerCritical.map((u) => byUid.get(u)?.name).join(', ')}</p></div>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
