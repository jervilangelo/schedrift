import { useProject, type Compare, type Zoom } from '../../store/useProject';
import { GanttChart } from '../gantt/GanttChart';
import { TaskPanel } from '../simulation/TaskPanel';
import { ImpactStrip } from './ImpactStrip';
import { IconButton, Segmented, Toggle } from '../../components/ui/controls';
import { Sidebar } from '../../components/ui/icons';
import type { GanttMode } from '../../lib/rows';

export function TimelineView() {
  const selection = useProject((s) => s.selection);
  const draft = useProject((s) => s.draft);
  const presenting = useProject((s) => s.presenting);
  const showPanel = selection.length > 0 || (draft.items.length > 0 && !presenting);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!presenting && <ImpactStrip />}
      <GanttToolbar />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <GanttChart />
        </div>
        {showPanel && <TaskPanel />}
      </div>
    </div>
  );
}

export function GanttToolbar() {
  const project = useProject((s) => s.project)!;
  const zoom = useProject((s) => s.zoom);
  const mode = useProject((s) => s.mode);
  const criticalOnly = useProject((s) => s.criticalOnly);
  const compare = useProject((s) => s.compare);
  const listVisible = useProject((s) => s.listVisible);
  const simulated = useProject((s) => s.simulated);
  const collapsed = useProject((s) => s.collapsed);
  const set = useProject.getState();
  const hasBaseline = project.tasks.some((t) => t.baselineStart !== undefined);
  const compareOptions: { value: Compare; label: string; title: string }[] = [
    { value: 'original', label: 'Original', title: 'Dashed bars show the original plan when a simulation moves a task' },
    ...(hasBaseline ? [{ value: 'baseline' as Compare, label: 'Baseline', title: 'Dashed bars show the MS Project baseline' }] : []),
    { value: 'none', label: 'Off', title: 'No comparison bars' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-3 py-2" role="toolbar" aria-label="Timeline options">
      <IconButton label={listVisible ? 'Hide task list' : 'Show task list'} active={listVisible} onClick={() => set.setListVisible(!listVisible)}>
        <Sidebar />
      </IconButton>
      <Segmented<GanttMode>
        label="View detail"
        value={mode}
        onChange={set.setMode}
        options={[
          { value: 'executive', label: 'Executive', title: 'Phases, milestones and Go-Live' },
          { value: 'detailed', label: 'Detailed', title: 'Every task in the outline' },
        ]}
      />
      <Segmented<Zoom>
        label="Zoom"
        value={zoom}
        onChange={set.setZoom}
        options={[
          { value: 'week', label: 'Weeks' },
          { value: 'month', label: 'Months' },
          { value: 'quarter', label: 'Quarters' },
          { value: 'fit', label: 'Fit', title: 'Fit the whole project on screen' },
        ]}
      />
      {mode === 'detailed' && (
        <button type="button" className="h-8 rounded-[6px] px-2 text-[13px] text-ink-2 hover:bg-active hover:text-ink" onClick={() => set.setCollapsedAll(collapsed.length === 0)}>
          {collapsed.length === 0 ? 'Collapse all' : 'Expand all'}
        </button>
      )}
      <Toggle label="Critical path" checked={criticalOnly} onChange={set.setCriticalOnly} title="Fade everything that is not on the critical path" />
      <div className="flex items-center gap-2">
        <span className="hidden text-[12px] text-ink-3 xl:inline">Compare</span>
        <Segmented<Compare> label="Comparison bars" size="sm" value={compare} onChange={set.setCompare} options={compareOptions} />
      </div>
      <Legend simulated={!!simulated} compare={compare} exec={mode === 'executive'} />
    </div>
  );
}

function Legend({ simulated, compare, exec }: { simulated: boolean; compare: Compare; exec: boolean }) {
  const item = 'flex items-center gap-1.5 whitespace-nowrap';
  const swatch = (fill: string, stroke?: string) => (
    <svg width="16" height="10" aria-hidden="true">
      <rect x=".75" y=".75" width="14.5" height="8.5" rx="2" fill={fill} stroke={stroke} strokeWidth={stroke ? 1.5 : 0} />
    </svg>
  );
  const diamond = (fill: string) => <svg width="10" height="10" aria-hidden="true"><path d="M5 0 10 5 5 10 0 5z" fill={fill} /></svg>;
  const showCompare = compare === 'baseline' || (compare === 'original' && simulated);
  return (
    <ul className="ml-auto hidden flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-ink-2 xl:flex" aria-label="Legend">
      {exec ? (
        <>
          <li className={item}>{swatch('var(--color-bar)')}Done</li>
          <li className={item}>{swatch('var(--color-bar-plan)')}Remaining</li>
          <li className={item}>{diamond('var(--color-ink-2)')}Key date</li>
          <li className={item}>{diamond('var(--color-ink)')}Go-Live</li>
        </>
      ) : (
        <>
          <li className={item}>{swatch('var(--color-bar)')}Task</li>
          <li className={item}>{swatch('var(--color-bar)', 'var(--color-crit)')}Critical</li>
          <li className={item}>{diamond('var(--color-ink)')}Milestone</li>
        </>
      )}
      {simulated && <li className={item}>{swatch('var(--color-sim)')}Delayed</li>}
      {simulated && <li className={item}>{swatch('var(--color-late)')}Moved</li>}
      {showCompare && (
        <li className={item}><svg width="16" height="8" aria-hidden="true"><rect x=".5" y=".5" width="15" height="6" rx="1.5" fill="none" stroke="var(--color-ink-2)" strokeDasharray="3 2" /></svg>{compare === 'baseline' ? 'Baseline' : 'Original'}</li>
      )}
    </ul>
  );
}
