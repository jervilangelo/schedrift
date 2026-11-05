import { useProject } from '../store/useProject';
import { Button, Dialog, cx } from '../components/ui/controls';
import { Alert, Check, Info } from '../components/ui/icons';

export function ImportReportDialog() {
  const project = useProject((s) => s.project);
  const open = useProject((s) => s.reportOpen);
  const setOpen = useProject((s) => s.setReportOpen);
  const setView = useProject((s) => s.setView);
  if (!project) return null;
  const items = project.importReport.items;
  const check = project.importReport.scheduleCheck;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = items.slice().sort((a, b) => order[a.level] - order[b.level]);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Import report" width={620}>
      <p className="text-[13px] text-ink-2">
        {project.sourceFileName} · {project.tasks.length} tasks · {project.calendars.length} {project.calendars.length === 1 ? 'calendar' : 'calendars'}
      </p>
      {check && (
        <p className={cx('mt-3 flex items-start gap-2 rounded-[6px] px-3 py-2 text-[13px]', check.matched === check.compared ? 'bg-ok-soft text-ok' : 'bg-sim-soft text-sim-ink')}>
          <span className="mt-[2px]">{check.matched === check.compared ? <Check size={14} /> : <Alert size={14} />}</span>
          <span>
            Schedule check: Schedrift recalculates {check.matched} of {check.compared} tasks to the same dates as the file.
            {check.matched !== check.compared && ' Tasks that differ are listed in Project data.'}
          </span>
        </p>
      )}
      {sorted.length === 0 ? (
        <p className="mt-3 text-[13px]">No problems found.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2" data-testid="import-report">
          {sorted.map((i, k) => (
            <li key={k} className="flex items-start gap-2 text-[13px] leading-[19px]">
              <span className={cx('mt-[2px] shrink-0', i.level === 'error' ? 'text-late' : i.level === 'warning' ? 'text-sim-ink' : 'text-ink-3')}>
                {i.level === 'info' ? <Info size={14} /> : <Alert size={14} />}
              </span>
              <span>
                <span className="font-medium capitalize">{i.level}: </span>
                {i.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
        <Button onClick={() => { setOpen(false); setView('data'); }}>Review in Project data</Button>
        <Button variant="primary" onClick={() => setOpen(false)}>Continue to timeline</Button>
      </div>
    </Dialog>
  );
}
