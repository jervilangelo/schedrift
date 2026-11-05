import { useState } from 'react';
import { useProject } from '../store/useProject';
import { Button, Dialog, Pill, cx } from '../components/ui/controls';
import { Alert, Check } from '../components/ui/icons';
import { formatDate } from '../scheduling/time';

/** Review of an "Update from Excel master" before it is applied. */
export function MasterUpdateDialog() {
  const preview = useProject((s) => s.masterPreview);
  const project = useProject((s) => s.project);
  const apply = useProject((s) => s.applyMasterPreview);
  const cancel = useProject((s) => s.cancelMaster);
  const [showAll, setShowAll] = useState(false);
  if (!preview || !project) return null;

  const byUid = new Map(preview.project.tasks.map((t) => [t.uid, t]));
  const { table, matched, excelOnly, projectOnly, differences, overdue, goLive } = preview;
  const similar = matched.filter((m) => m.how === 'similar');
  const glTask = goLive ? byUid.get(goLive.uid) : undefined;
  const glRow = goLive ? matched.find((m) => m.uid === goLive.uid)?.row : undefined;
  const glExcel = glRow?.plannedEnd;
  const glMatches = glExcel !== undefined && goLive && Math.floor(goLive.finish) === glExcel;
  const projectOnlyLeaves = projectOnly.filter((u) => !byUid.get(u)?.summary);
  const shownDiffs = showAll ? differences : differences.slice(0, 12);

  return (
    <Dialog open onClose={cancel} title="Update dates from the Excel master" width={860}>
      <p className="text-[13px] leading-[19px] text-ink-2">
        Dependencies stay exactly as in <span className="font-medium text-ink">{project.sourceFileName.replace(/ \+ .*$/, '')}</span>. Dates, durations, actual dates and status come from{' '}
        <span className="font-medium text-ink">{table.fileName}</span> (sheet “{table.sheetName}”, headers on row {table.headerRow}). A task keeps its Excel start unless a predecessor forces it later.
      </p>
      <p className="mt-1 text-[12px] text-ink-3">
        Columns used: {Object.values(table.columns).filter(Boolean).join(' · ')}
      </p>

      {glTask && goLive && (
        <section className={cx('mt-4 rounded-[6px] px-4 py-3', glMatches ? 'bg-ok-soft' : glExcel !== undefined ? 'bg-sim-soft' : 'bg-raised')} data-testid="master-golive">
          <p className="text-[12px] text-ink-2">Go-Live after the update</p>
          <p className="text-[18px] font-semibold">
            {glTask.name}: {formatDate(goLive.finish, { weekday: true })}
          </p>
          {glExcel !== undefined && (
            <p className={cx('flex items-center gap-1.5 text-[13px]', glMatches ? 'text-ok' : 'text-sim-ink')}>
              {glMatches ? <Check size={14} /> : <Alert size={14} />}
              {glMatches ? 'Same as the Excel master.' : `The Excel master says ${formatDate(glExcel, { weekday: true })}. The dependencies below push it later.`}
            </p>
          )}
        </section>
      )}

      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
        <p><span className="num text-[18px] font-semibold">{matched.length}</span> <span className="text-ink-2">of {table.rows.length} Excel rows matched</span></p>
        <p><span className="num text-[18px] font-semibold">{differences.length}</span> <span className="text-ink-2">{differences.length === 1 ? "task" : "tasks"} moved by a dependency</span></p>
        <p><span className="num text-[18px] font-semibold">{excelOnly.length + projectOnlyLeaves.length}</span> <span className="text-ink-2">rows or tasks in only one file</span></p>
      </div>

      {differences.length > 0 && (
        <section className="mt-4" aria-labelledby="diff-h">
          <h3 id="diff-h" className="text-[14px] font-semibold">Excel dates that the dependencies do not allow</h3>
          <p className="text-[12px] text-ink-2">These tasks cannot start on their Excel date because a predecessor in the project file finishes later. Fix the date in Excel or the link in MS Project if the dependency is wrong.</p>
          <table className="mt-2 w-full border-collapse text-[13px]" data-testid="master-differences">
            <thead>
              <tr className="text-left text-[12px] text-ink-3">
                <th className="py-1.5 pr-3 font-normal">Task</th>
                <th className="py-1.5 pr-3 font-normal">Excel</th>
                <th className="py-1.5 pr-3 font-normal">After update</th>
                <th className="py-1.5 font-normal">Why</th>
              </tr>
            </thead>
            <tbody>
              {shownDiffs.map((d) => (
                <tr key={d.uid} className="border-t border-rule align-top">
                  <td className="py-1.5 pr-3 font-medium">{byUid.get(d.uid)?.name}</td>
                  <td className="num whitespace-nowrap py-1.5 pr-3 text-ink-2">{formatDate(d.excelStart)} → {formatDate(d.excelEnd)}</td>
                  <td className="num whitespace-nowrap py-1.5 pr-3 text-late-ink">{formatDate(d.start)} → {formatDate(d.end)}</td>
                  <td className="py-1.5 text-ink-2">{d.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {differences.length > shownDiffs.length && (
            <button type="button" className="mt-1 text-[13px] text-ink-2 underline-offset-2 hover:underline" onClick={() => setShowAll(true)}>
              Show all {differences.length}
            </button>
          )}
        </section>
      )}

      {(excelOnly.length > 0 || projectOnlyLeaves.length > 0 || similar.length > 0 || overdue.length > 0) && (
        <section className="mt-4 grid grid-cols-1 gap-4 text-[13px] sm:grid-cols-2">
          {excelOnly.length > 0 && (
            <div>
              <h3 className="text-[14px] font-semibold">Only in Excel (not updated)</h3>
              <p className="text-[12px] text-ink-2">No task with this name in the project file.</p>
              <ul className="mt-1 max-h-[140px] overflow-auto" data-testid="master-excel-only">
                {excelOnly.map((r) => <li key={r.row} className="py-0.5">Row {r.row}: {r.name}</li>)}
              </ul>
            </div>
          )}
          {projectOnlyLeaves.length > 0 && (
            <div>
              <h3 className="text-[14px] font-semibold">Only in the project file (unchanged)</h3>
              <ul className="mt-1 max-h-[140px] overflow-auto">
                {projectOnlyLeaves.map((u) => <li key={u} className="py-0.5">{byUid.get(u)?.id}. {byUid.get(u)?.name}</li>)}
              </ul>
            </div>
          )}
          {similar.length > 0 && (
            <div>
              <h3 className="text-[14px] font-semibold">Matched by a similar name</h3>
              <ul className="mt-1 max-h-[140px] overflow-auto">
                {similar.map((m) => <li key={m.uid} className="py-0.5">“{m.row.name}” → “{byUid.get(m.uid)?.name}”</li>)}
              </ul>
            </div>
          )}
          {overdue.length > 0 && (
            <div>
              <h3 className="flex items-center gap-2 text-[14px] font-semibold">In progress past their planned end <Pill tone="late">{overdue.length}</Pill></h3>
              <p className="text-[12px] text-ink-2">Their finish is in the past. Update the planned end in Excel to forecast them correctly.</p>
              <ul className="mt-1 max-h-[140px] overflow-auto">
                {overdue.map((u) => <li key={u} className="py-0.5">{byUid.get(u)?.name}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-line pt-3">
        <span className="mr-auto text-[12px] text-ink-3">Your Excel and .mpp files are not changed.</span>
        <Button onClick={cancel}>Cancel</Button>
        <Button variant="primary" onClick={apply} data-testid="apply-master">Apply update</Button>
      </div>
    </Dialog>
  );
}
