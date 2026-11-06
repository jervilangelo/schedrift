import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useProject } from '../../store/useProject';
import { visibleAncestor, visibleRows, type Row } from '../../lib/rows';
import { buildScale, type Scale } from '../../lib/scale';
import type { TaskSchedule } from '../../scheduling/engine';
import { formatDate, formatDays, todayInstant } from '../../scheduling/time';
import { ChevronDown, ChevronRight } from '../../components/ui/icons';
import { cx } from '../../components/ui/controls';
import type { Link, Project, Task } from '../../model/types';

const HEADER_H = 46;

interface Geometry {
  rowH: number;
  barH: number;
  barY: number;
  cmpY: number;
  cmpH: number;
}

function geometry(present: boolean, exec: boolean): Geometry {
  if (exec) {
    return present
      ? { rowH: 48, barH: 24, barY: 9, cmpY: 37, cmpH: 5 }
      : { rowH: 40, barH: 20, barY: 7, cmpY: 31, cmpH: 5 };
  }
  return present
    ? { rowH: 40, barH: 18, barY: 7, cmpY: 28, cmpH: 6 }
    : { rowH: 30, barH: 13, barY: 6, cmpY: 21, cmpH: 5 };
}

/** Start and finish of a rollout wave from its top-level tasks. */
function waveSpan(members: number[], result: { byUid: Map<number, TaskSchedule> }): { es: number; ef: number } | null {
  const sched = members.map((u) => result.byUid.get(u)).filter((x): x is TaskSchedule => !!x && Number.isFinite(x.es));
  if (!sched.length) return null;
  return { es: Math.min(...sched.map((x) => x.es)), ef: Math.max(...sched.map((x) => x.ef)) };
}

type BarState = 'normal' | 'scenario' | 'changed';

function shortDate(t: number) {
  return formatDate(t, { year: false });
}

export function GanttChart() {
  const project = useProject((s) => s.project)!;
  const original = useProject((s) => s.original)!;
  const simulated = useProject((s) => s.simulated);
  const impact = useProject((s) => s.impact);
  const draft = useProject((s) => s.draft);
  const applied = useProject((s) => s.applied);
  const selection = useProject((s) => s.selection);
  const zoom = useProject((s) => s.zoom);
  const mode = useProject((s) => s.mode);
  const collapsedList = useProject((s) => s.collapsed);
  const criticalOnly = useProject((s) => s.criticalOnly);
  const compare = useProject((s) => s.compare);
  const listVisible = useProject((s) => s.listVisible);
  const presenting = useProject((s) => s.presenting);
  const select = useProject((s) => s.select);
  const toggleCollapsed = useProject((s) => s.toggleCollapsed);

  const exec = mode === 'executive';
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800, width: 1200 });
  const collapsedSet = useMemo(() => new Set(collapsedList), [collapsedList]);
  const rowsForFit = useMemo(() => visibleRows(project, collapsedSet, mode), [project, collapsedSet, mode]);
  const g = useMemo(() => {
    const base = geometry(presenting, exec);
    if (!exec || !rowsForFit.length) return base;
    // Executive: size rows so the whole plan fits on one screen (within readable limits).
    const rowH = Math.max(30, Math.min(base.rowH, Math.floor((viewport.height - HEADER_H - 2) / rowsForFit.length)));
    const barH = Math.round(rowH * 0.5);
    const barY = Math.round((rowH - barH) / 2) - 1;
    return { rowH, barH, barY, cmpY: barY + barH + 2, cmpH: 4 };
  }, [presenting, exec, rowsForFit.length, viewport.height]);
  const collapsed = collapsedSet;
  const rows = rowsForFit;
  const result = simulated ?? original;

  const scenarioUids = useMemo(() => new Set([...(applied?.items ?? []), ...draft.items].map((i) => i.uid)), [applied, draft]);
  const changedUids = useMemo(() => new Set((impact?.changed ?? []).map((c) => c.uid)), [impact]);
  const chainUids = useMemo(() => new Set(impact?.drivingChain ?? []), [impact]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const today = todayInstant();

  const listW = !listVisible ? 0 : exec ? (presenting ? 460 : 440) : presenting ? 320 : 440;
  const bodyH = rows.length * g.rowH;

  // ----- virtualization -----
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (el) setViewport({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
  }, []);
  const fitWidth = Math.max(300, viewport.width - listW);

  const scale = useMemo(() => {
    let from = original.projectStart;
    let to = Math.max(original.projectFinish, simulated?.projectFinish ?? -Infinity);
    for (const t of project.tasks) {
      if (t.baselineStart !== undefined) from = Math.min(from, t.baselineStart);
      if (t.baselineFinish !== undefined) to = Math.max(to, t.baselineFinish);
    }
    const cal = project.calendars.find((c) => c.uid === project.defaultCalendarUid);
    return buildScale(from, to, zoom, cal?.workWeek, zoom === 'fit' ? fitWidth : undefined);
  }, [project, original, simulated, zoom, zoom === 'fit' ? fitWidth : 0]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    onScroll();
    return () => ro.disconnect();
  }, [onScroll]);
  const first = Math.max(0, Math.floor((viewport.top - HEADER_H) / g.rowH) - 8);
  const last = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / g.rowH) + 8);
  const slice = rows.slice(first, last);

  // Scroll horizontally to "now" (or the project start) when a project or zoom changes.
  const scrolledFor = useRef('');
  useEffect(() => {
    const key = `${project.id}:${zoom}`;
    const el = scroller.current;
    if (!el || scrolledFor.current === key) return;
    scrolledFor.current = key;
    const chartW = el.clientWidth - listW;
    const anchor = today > scale.start && today < scale.end ? today : original.projectStart;
    let left = scale.x(anchor) - chartW * 0.2;
    const gl = project.goLiveUid !== undefined ? original.byUid.get(project.goLiveUid)?.ef : undefined;
    if (gl !== undefined && scale.x(gl) + 140 > left + chartW) left = scale.x(gl) + 140 - chartW;
    el.scrollLeft = Math.max(0, left);
  }, [project.id, project.goLiveUid, zoom, scale, today, original, listW]);

  // Bring the selected row into view when selection changes from elsewhere.
  useEffect(() => {
    const el = scroller.current;
    const uid = selection[selection.length - 1];
    if (!el || uid === undefined) return;
    const i = rows.findIndex((r) => r.uid === uid);
    if (i < 0) return;
    const y = HEADER_H + i * g.rowH;
    if (y < el.scrollTop + HEADER_H || y + g.rowH > el.scrollTop + el.clientHeight) el.scrollTop = y - el.clientHeight / 2;
  }, [selection, rows, g.rowH]);

  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.uid, i])), [rows]);

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, row: Row, i: number) => {
    const focusRow = (j: number) => {
      const target = scroller.current?.querySelector<HTMLElement>(`[data-row="${j}"]`);
      if (target) target.focus();
      else if (scroller.current) {
        scroller.current.scrollTop = HEADER_H + j * g.rowH - scroller.current.clientHeight / 2;
        requestAnimationFrame(() => scroller.current?.querySelector<HTMLElement>(`[data-row="${j}"]`)?.focus());
      }
    };
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(Math.min(rows.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(Math.max(0, i - 1)); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(row.uid, e.ctrlKey || e.metaKey || e.shiftKey); }
    if (e.key === 'ArrowRight' && row.hasChildren && row.collapsed) toggleCollapsed(row.uid);
    if (e.key === 'ArrowLeft' && row.hasChildren && !row.collapsed) toggleCollapsed(row.uid);
  };

  const goLive = project.goLiveUid !== undefined ? project.tasks.find((t) => t.uid === project.goLiveUid) : undefined;
  const glOrig = goLive ? original.byUid.get(goLive.uid)?.ef : undefined;
  const glSim = goLive && simulated ? simulated.byUid.get(goLive.uid)?.ef : undefined;
  const drift = glOrig !== undefined && glSim !== undefined && Math.abs(glSim - glOrig) > 1e-6;

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="relative h-full overflow-auto bg-surface"
      style={{ fontSize: 'var(--gantt-font)' }}
      data-testid="gantt"
    >
      <div style={{ width: listW + scale.width, height: HEADER_H + bodyH }} className="relative">
        {/* Header */}
        <div className="sticky top-0 z-20 flex" style={{ height: HEADER_H }}>
          {listVisible && (
            <div className="sticky left-0 z-30 flex shrink-0 items-end border-r border-b border-line bg-surface text-[12px] text-ink-3" style={{ width: listW, height: HEADER_H }}>
              <ListHeader presenting={presenting} exec={exec} />
            </div>
          )}
          <TimelineHeader scale={scale} today={today} goLive={glSim ?? glOrig} />
        </div>

        {/* Body */}
        <div className="flex">
          {listVisible && (
            <div role="treegrid" aria-label="Tasks" aria-rowcount={rows.length} className="sticky left-0 z-10 shrink-0 border-r border-line bg-surface" style={{ width: listW, height: bodyH }}>
              {slice.map((row, k) => {
                const i = first + k;
                if (row.wave) {
                  const span = waveSpan(row.wave.members, result);
                  return (
                    <div key={row.uid} role="row" aria-level={1} data-wave={row.wave.label} className="absolute left-0 flex w-full items-center gap-2 border-b border-line bg-raised px-3" style={{ top: i * g.rowH, height: g.rowH }}>
                      <span className="text-[11px] font-semibold tracking-[0.06em] text-ink uppercase">{row.wave.label}</span>
                      {span && <span className="num text-[12px] text-ink-3">{formatDate(span.es, { year: false })} – {formatDate(span.ef)}</span>}
                    </div>
                  );
                }
                return (
                  <ListRow
                    key={row.uid}
                    row={row}
                    index={i}
                    top={i * g.rowH}
                    height={g.rowH}
                    s={result.byUid.get(row.uid)}
                    o={original.byUid.get(row.uid)}
                    simulatedActive={!!simulated}
                    changed={changedUids.has(row.uid)}
                    selected={selected.has(row.uid)}
                    dim={criticalOnly && !result.byUid.get(row.uid)?.critical}
                    presenting={presenting}
                    exec={exec}
                    isGoLive={row.uid === project.goLiveUid}
                    onSelect={(additive) => select(row.uid, additive)}
                    onToggle={() => toggleCollapsed(row.uid)}
                    onKey={(e) => onRowKey(e, row, i)}
                  />
                );
              })}
            </div>
          )}

          <svg width={scale.width} height={bodyH} className="block shrink-0" role="img" aria-label="Gantt chart">
            <defs>
              <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 8 4 0 8z" fill="var(--color-link)" />
              </marker>
              <marker id="arrow-crit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 8 4 0 8z" fill="var(--color-crit)" />
              </marker>
              <marker id="arrow-late" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 8 4 0 8z" fill="var(--color-late)" />
              </marker>
            </defs>
            {/* weekends & period lines */}
            {scale.weekends.map((w) => <rect key={w.x} x={w.x} y={0} width={w.width} height={bodyH} fill="var(--color-weekend)" />)}
            {scale.lines.map((x) => <line key={x} x1={x} x2={x} y1={0} y2={bodyH} stroke="var(--color-rule)" />)}
            {/* selection bands */}
            {slice.map((row, k) => selected.has(row.uid) && (
              <rect key={`sel-${row.uid}`} x={0} y={(first + k) * g.rowH} width={scale.width} height={g.rowH} fill="var(--color-active)" opacity={0.7} />
            ))}
            {/* drift band between original and simulated Go-Live */}
            {drift && (
              <rect x={Math.min(scale.x(glOrig!), scale.x(glSim!))} y={0} width={Math.abs(scale.x(glSim!) - scale.x(glOrig!))} height={bodyH} fill="var(--color-late)" opacity={0.07} data-testid="drift-band" />
            )}
            {glOrig !== undefined && (
              <line x1={scale.x(glOrig)} x2={scale.x(glOrig)} y1={0} y2={bodyH} stroke="var(--color-ink)" strokeDasharray="4 3" strokeWidth={1} opacity={0.55} />
            )}
            {drift && <line x1={scale.x(glSim!)} x2={scale.x(glSim!)} y1={0} y2={bodyH} stroke="var(--color-late)" strokeWidth={1.5} />}
            {today > scale.start && today < scale.end && (
              <line x1={scale.x(today)} x2={scale.x(today)} y1={0} y2={bodyH} stroke="var(--color-bar-done)" strokeWidth={1} />
            )}

            {exec && slice.map((row, k) => {
              if (!row.wave) return null;
              const span = waveSpan(row.wave.members, result);
              const y = (first + k) * g.rowH;
              return (
                <g key={row.uid} aria-hidden="true">
                  <rect x={0} y={y} width={scale.width} height={g.rowH} fill="var(--color-raised)" />
                  <line x1={0} x2={scale.width} y1={y + g.rowH - 0.5} y2={y + g.rowH - 0.5} stroke="var(--color-line)" />
                  {span && (
                    <g>
                      <path d={`M${scale.x(span.es)} ${y + g.rowH - 10} V${y + g.rowH / 2} H${scale.x(span.ef)} V${y + g.rowH - 10}`} fill="none" stroke="var(--color-ink-3)" strokeWidth={1} />
                      <text x={scale.x(span.es) + 6} y={y + g.rowH / 2 - 5} fontSize={11} fontWeight={600} fill="var(--color-ink-2)" letterSpacing="0.06em">{row.wave.label.toUpperCase()}</text>
                    </g>
                  )}
                </g>
              );
            })}

            {!exec && <Links
              project={project}
              rows={rows}
              rowIndex={rowIndex}
              first={first}
              last={last}
              result={result}
              scale={scale}
              g={g}
              collapsed={collapsed}
              chain={chainUids}
              criticalOnly={criticalOnly}
            />}

            {slice.map((row, k) => {
              const i = first + k;
              const s = result.byUid.get(row.uid);
              if (!s || row.wave) return null;
              const state: BarState = scenarioUids.has(row.uid) ? 'scenario' : changedUids.has(row.uid) ? 'changed' : 'normal';
              const o = original.byUid.get(row.uid)!;
              let cmp: { a: number; b: number } | null = null;
              if (compare === 'original' && simulated && (Math.abs(o.es - s.es) > 1e-6 || Math.abs(o.ef - s.ef) > 1e-6)) cmp = { a: o.es, b: o.ef };
              if (compare === 'baseline' && row.task.baselineStart !== undefined && row.task.baselineFinish !== undefined) cmp = { a: row.task.baselineStart, b: row.task.baselineFinish };
              return (
                <Bar
                  key={row.uid}
                  task={row.task}
                  s={s}
                  y={i * g.rowH}
                  g={g}
                  scale={scale}
                  state={state}
                  selected={selected.has(row.uid)}
                  dim={criticalOnly && !s.critical}
                  cmp={cmp}
                  isGoLive={row.uid === project.goLiveUid}
                  exec={exec}
                  keyDate={exec && row.depth > 0}
                  showName={!listVisible}
                  onSelect={(e) => select(row.uid, e.ctrlKey || e.metaKey || e.shiftKey)}
                />
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

function ListHeader({ presenting, exec }: { presenting: boolean; exec: boolean }) {
  if (exec) {
    return (
      <div className="flex w-full items-center px-3 pb-2" role="row">
        <span className="flex-1" role="columnheader">Phase / key date</span>
        <span className="w-[76px] text-right" role="columnheader">Start</span>
        <span className="w-[76px] text-right" role="columnheader">Finish</span>
        <span className="w-[84px] pl-3" role="columnheader">Progress</span>
      </div>
    );
  }
  return (
    <div className="flex w-full items-center px-3 pb-2" role="row">
      <span className="flex-1" role="columnheader">Task</span>
      {!presenting && <span className="w-[88px] text-right" role="columnheader">Start</span>}
      <span className="w-[88px] text-right" role="columnheader">Finish</span>
      {!presenting && <span className="w-[52px] text-right" role="columnheader">Float</span>}
    </div>
  );
}

const ListRow = memo(function ListRow({ row, index, top, height, s, o, simulatedActive, selected, dim, presenting, exec, isGoLive, onSelect, onToggle, onKey }: {
  row: Row; index: number; top: number; height: number; s?: TaskSchedule; o?: TaskSchedule;
  simulatedActive: boolean; changed: boolean; selected: boolean; dim: boolean; presenting: boolean; exec: boolean; isGoLive: boolean;
  onSelect: (additive: boolean) => void; onToggle: () => void; onKey: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const t = row.task;
  const finishMoved = simulatedActive && s && o && Math.abs(s.ef - o.ef) > 1e-6;
  if (exec) {
    const keyDate = row.depth > 0;
    const pct = Math.round(Math.min(100, Math.max(0, t.percentComplete)));
    return (
      <div
        role="row"
        aria-selected={selected}
        aria-level={row.depth + 1}
        tabIndex={0}
        data-row={index}
        data-uid={row.uid}
        onClick={(e) => onSelect(e.ctrlKey || e.metaKey || e.shiftKey)}
        onKeyDown={onKey}
        className={cx(
          'absolute left-0 flex w-full cursor-default items-center border-b border-rule px-3 outline-none focus-visible:bg-raised focus-visible:shadow-[inset_2px_0_0_var(--color-ink)]',
          selected ? 'bg-active' : 'hover:bg-raised',
        )}
        style={{ top, height }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: keyDate ? 18 : 0 }}>
          {keyDate ? (
            <span className={cx('h-2 w-2 shrink-0 rotate-45', isGoLive ? 'bg-ink' : 'bg-ink-3')} aria-hidden="true" />
          ) : (
            <span className={cx('h-3 w-1 shrink-0 rounded-[1px]', pct >= 100 ? 'bg-bar-done' : 'bg-bar')} aria-hidden="true" />
          )}
          <span className={cx('truncate', keyDate ? (isGoLive ? 'font-semibold' : 'text-ink-2') : 'font-semibold')} title={t.name}>{t.name}</span>
        </div>
        <span className="num w-[76px] shrink-0 text-right text-ink-2">{keyDate ? '' : s ? formatDate(s.es, { year: false }) : '—'}</span>
        <span className={cx('num w-[76px] shrink-0 text-right', finishMoved ? 'font-medium text-late-ink' : keyDate && isGoLive ? 'font-semibold text-ink' : 'text-ink-2')}>
          {s ? formatDate(s.ef, { year: false }) : '—'}
        </span>
        <span className="flex w-[84px] shrink-0 items-center gap-1.5 pl-3">
          {keyDate ? (
            <span className={cx('text-[12px]', pct >= 100 ? 'text-ok' : 'text-ink-3')}>{pct >= 100 ? 'Done' : ''}</span>
          ) : (
            <>
              <span className="h-1.5 w-9 overflow-hidden rounded-full bg-active" aria-hidden="true">
                <span className="block h-full rounded-full bg-bar" style={{ width: `${pct}%` }} />
              </span>
              <span className="num text-[12px] text-ink-2">{pct}%</span>
            </>
          )}
        </span>
      </div>
    );
  }
  return (
    <div
      role="row"
      aria-selected={selected}
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? !row.collapsed : undefined}
      tabIndex={0}
      data-row={index}
      data-uid={row.uid}
      onClick={(e) => onSelect(e.ctrlKey || e.metaKey || e.shiftKey)}
      onKeyDown={onKey}
      className={cx(
        'absolute left-0 flex w-full cursor-default items-center border-b border-rule px-3 outline-none focus-visible:bg-raised focus-visible:shadow-[inset_2px_0_0_var(--color-ink)]',
        selected ? 'bg-active' : 'hover:bg-raised',
        dim && 'opacity-40',
      )}
      style={{ top, height }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1" style={{ paddingLeft: row.depth * 16 }}>
        {row.hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={row.collapsed ? `Expand ${t.name}` : `Collapse ${t.name}`}
            className="-ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-ink-2 hover:bg-active"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            {row.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        {s?.critical && <span className="h-3 w-[3px] shrink-0 rounded-[1px] bg-crit" title="Critical path" aria-label="Critical" />}
        <span className={cx('truncate', t.summary && 'font-semibold', isGoLive && 'font-semibold')} title={t.name}>
          {t.name}
        </span>
      </div>
      {!presenting && <span className="num w-[88px] shrink-0 text-right text-ink-2">{s ? formatDate(s.es, { year: false }) : '—'}</span>}
      <span className={cx('num w-[88px] shrink-0 text-right', finishMoved ? 'font-medium text-late-ink' : 'text-ink-2')}>
        {s ? formatDate(s.ef, { year: false }) : '—'}
      </span>
      {!presenting && (
        <span className="num w-[52px] shrink-0 text-right text-ink-3" title="Total float (working days)">
          {s?.totalFloat === null || s?.totalFloat === undefined || t.summary ? '—' : `${Math.round(s.totalFloat * 10) / 10}d`}
        </span>
      )}
    </div>
  );
});

function TimelineHeader({ scale, today, goLive }: { scale: Scale; today: number; goLive?: number }) {
  return (
    <svg width={scale.width} height={HEADER_H} className="block shrink-0 border-b border-line bg-surface" aria-hidden="true">
      <rect width={scale.width} height={HEADER_H} fill="var(--color-surface)" />
      {scale.top.map((t) => (
        <g key={`t${t.x}`}>
          <line x1={t.x} x2={t.x} y1={0} y2={22} stroke="var(--color-line)" />
          <text x={t.x + 8} y={15} fontSize={12} fontWeight={500} fill="var(--color-ink)">{t.width > 50 ? t.label : ''}</text>
        </g>
      ))}
      <line x1={0} x2={scale.width} y1={22.5} y2={22.5} stroke="var(--color-rule)" />
      {scale.bottom.map((t) => (
        <g key={`b${t.x}`}>
          <line x1={t.x} x2={t.x} y1={23} y2={HEADER_H} stroke="var(--color-rule)" />
          <text x={t.x + 5} y={38} fontSize={12} fill="var(--color-ink-3)" className="num">{t.width > 18 ? t.label : ''}</text>
        </g>
      ))}
      {today > scale.start && today < scale.end && (
        <g>
          <rect x={scale.x(today) - 21} y={25} width={42} height={17} rx={3} fill="var(--color-bar-done)" />
          <text x={scale.x(today)} y={37.5} fontSize={11} fontWeight={600} fill="#fff" textAnchor="middle">Today</text>
        </g>
      )}
      {goLive !== undefined && goLive > scale.start && goLive < scale.end && Math.abs(scale.x(goLive) - scale.x(today)) > 50 && (
        <g data-testid="golive-tag">
          <rect x={scale.x(goLive) - 25} y={25} width={50} height={17} rx={3} fill="var(--color-ink)" />
          <text x={scale.x(goLive)} y={37.5} fontSize={11} fontWeight={600} fill="#fff" textAnchor="middle">Go-Live</text>
        </g>
      )}
    </svg>
  );
}

const Bar = memo(function Bar({ task, s, y, g, scale, state, selected, dim, cmp, isGoLive, exec, keyDate, showName, onSelect }: {
  task: Task; s: TaskSchedule; y: number; g: Geometry; scale: Scale; state: BarState; selected: boolean; dim: boolean;
  cmp: { a: number; b: number } | null; isGoLive: boolean; exec: boolean; keyDate: boolean; showName: boolean; onSelect: (e: MouseEvent) => void;
}) {
  if (exec) return <ExecBar task={task} s={s} y={y} g={g} scale={scale} state={state} selected={selected} cmp={cmp} isGoLive={isGoLive} keyDate={keyDate} showName={showName} onSelect={onSelect} />;
  const x1 = scale.x(s.es);
  const x2 = scale.x(s.ef);
  const w = Math.max(2, x2 - x1);
  const fill = state === 'scenario' ? 'var(--color-sim)' : state === 'changed' ? 'var(--color-late)' : 'var(--color-bar)';
  const title = `${task.name}\n${formatDate(s.es, { weekday: true })} → ${formatDate(s.ef, { weekday: true })}${task.summary || s.totalFloat === null ? '' : `\nTotal float: ${formatDays(s.totalFloat)}`}${s.critical ? '\nCritical path' : ''}`;
  const isMilestone = !task.summary && s.duration === 0;
  const mid = y + g.barY + g.barH / 2;

  let shape: React.ReactNode;
  if (task.summary) {
    const h = Math.max(5, Math.round(g.barH * 0.45));
    const top = mid - h / 2;
    const color = state === 'changed' ? 'var(--color-late)' : 'var(--color-summary)';
    shape = (
      <g className="bar-move">
        <rect x={x1} y={top} width={w} height={h} fill={color} rx={1} />
        <path d={`M${x1} ${top + h} l0 4 l5 -4z M${x1 + w} ${top + h} l0 4 l-5 -4z`} fill={color} />
        {task.percentComplete > 0 && <rect x={x1} y={top + h - 2} width={(w * Math.min(100, task.percentComplete)) / 100} height={2} fill="var(--color-bar-soft)" />}
      </g>
    );
  } else if (isMilestone) {
    const r = isGoLive ? g.barH * 0.62 : g.barH * 0.5;
    const color = state === 'scenario' ? 'var(--color-sim)' : state === 'changed' ? 'var(--color-late)' : 'var(--color-ink)';
    shape = <path d={`M${x1} ${mid - r} L${x1 + r} ${mid} L${x1} ${mid + r} L${x1 - r} ${mid}z`} fill={color} stroke={selected ? 'var(--color-ink)' : 'var(--color-surface)'} strokeWidth={1.5} />;
  } else {
    const done = Math.min(100, Math.max(0, task.percentComplete));
    shape = (
      <g>
        <rect className="bar-move" x={x1} y={y + g.barY} width={w} height={g.barH} rx={3} fill={fill} />
        {done > 0 && state === 'normal' && <rect x={x1} y={y + g.barY} width={(w * done) / 100} height={g.barH} rx={3} fill="var(--color-bar-done)" />}
        {s.critical && <rect x={x1 + 0.75} y={y + g.barY + 0.75} width={Math.max(0, w - 1.5)} height={g.barH - 1.5} rx={2.5} fill="none" stroke="var(--color-crit)" strokeWidth={1.5} />}
        {selected && <rect x={x1 - 2.5} y={y + g.barY - 2.5} width={w + 5} height={g.barH + 5} rx={4.5} fill="none" stroke="var(--color-ink)" strokeWidth={1} />}
      </g>
    );
  }

  const labelX = isMilestone ? x1 + g.barH * 0.75 + 4 : x1 + w + 6;
  return (
    <g data-uid={task.uid} data-state={state} data-critical={s.critical || undefined} opacity={dim ? 0.25 : 1} onClick={onSelect} style={{ cursor: 'pointer' }}>
      <title>{title}</title>
      {cmp && isMilestone && (
        <path
          d={`M${scale.x(cmp.b)} ${mid - g.barH * 0.5} l${g.barH * 0.5} ${g.barH * 0.5} l${-g.barH * 0.5} ${g.barH * 0.5} l${-g.barH * 0.5} ${-g.barH * 0.5}z`}
          fill="none"
          stroke="var(--color-ink-2)"
          strokeDasharray="2 2"
          data-testid="compare-bar"
        />
      )}
      {cmp && !isMilestone && (
        <rect
          x={scale.x(cmp.a)}
          y={y + g.cmpY}
          width={Math.max(2, scale.x(cmp.b) - scale.x(cmp.a))}
          height={g.cmpH}
          rx={1.5}
          fill="none"
          stroke="var(--color-ink-2)"
          strokeWidth={1}
          strokeDasharray="3 2"
          data-testid="compare-bar"
        />
      )}
      {/* generous hit area */}
      <rect x={Math.min(x1, x2) - 6} y={y + 2} width={w + 12} height={g.rowH - 4} fill="transparent" />
      {shape}
      {(isMilestone || showName) && (
        <text x={labelX} y={mid + 4} fontSize={isMilestone && !showName ? 12 : 'var(--gantt-font)'} fill={state === 'changed' ? 'var(--color-late-ink)' : 'var(--color-ink-2)'} fontWeight={isGoLive ? 600 : 400} className="num" style={{ pointerEvents: 'none' }}>
          {showName ? `${task.name}  ` : ''}
          {isMilestone ? shortDate(s.ef) : ''}
        </text>
      )}
    </g>
  );
});

/** Executive view: phases as solid labelled bars, key dates as diamonds at their finish. */
function ExecBar({ task, s, y, g, scale, state, selected, cmp, isGoLive, keyDate, showName, onSelect }: {
  task: Task; s: TaskSchedule; y: number; g: Geometry; scale: Scale; state: BarState; selected: boolean;
  cmp: { a: number; b: number } | null; isGoLive: boolean; keyDate: boolean; showName: boolean; onSelect: (e: MouseEvent) => void;
}) {
  const x1 = scale.x(s.es);
  const x2 = scale.x(s.ef);
  const w = Math.max(3, x2 - x1);
  const mid = y + g.barY + g.barH / 2;
  const title = `${task.name}\n${formatDate(s.es, { weekday: true })} → ${formatDate(s.ef, { weekday: true })}`;
  const tone = state === 'scenario' ? 'var(--color-sim)' : state === 'changed' ? 'var(--color-late)' : null;

  if (keyDate) {
    const x = x2;
    const r = isGoLive ? g.barH * 0.55 : g.barH * 0.42;
    const label = `${showName ? `${task.name} · ` : ''}${shortDate(s.ef)}`;
    return (
      <g data-uid={task.uid} data-state={state} onClick={onSelect} style={{ cursor: 'pointer' }}>
        <title>{title}</title>
        <rect x={x - 12} y={y + 2} width={24 + label.length * 7} height={g.rowH - 4} fill="transparent" />
        {cmp && <path d={`M${scale.x(cmp.b)} ${mid - r} l${r} ${r} l${-r} ${r} l${-r} ${-r}z`} fill="none" stroke="var(--color-ink-2)" strokeDasharray="2 2" data-testid="compare-bar" />}
        <path d={`M${x} ${mid - r} L${x + r} ${mid} L${x} ${mid + r} L${x - r} ${mid}z`} fill={tone ?? (isGoLive ? 'var(--color-ink)' : 'var(--color-ink-2)')} stroke={selected ? 'var(--color-ink)' : 'var(--color-surface)'} strokeWidth={1.5} />
        <text x={x + r + 6} y={mid + 4} fontSize={12} fontWeight={isGoLive ? 600 : 500} fill={state === 'changed' ? 'var(--color-late-ink)' : isGoLive ? 'var(--color-ink)' : 'var(--color-ink-2)'} className="num" style={{ pointerEvents: 'none' }}>
          {label}
        </text>
      </g>
    );
  }

  const done = Math.min(100, Math.max(0, task.percentComplete));
  const range = `${shortDate(s.es)} – ${shortDate(s.ef)}`;
  const inside = range.length * 6.6 + 16 < w;
  const outside = `${showName ? `${task.name}  ` : ''}${inside ? '' : range}`;
  return (
    <g data-uid={task.uid} data-state={state} onClick={onSelect} style={{ cursor: 'pointer' }}>
      <title>{title}</title>
      <rect x={x1 - 6} y={y + 2} width={w + 12} height={g.rowH - 4} fill="transparent" />
      {cmp && <rect x={scale.x(cmp.a)} y={y + g.cmpY} width={Math.max(2, scale.x(cmp.b) - scale.x(cmp.a))} height={g.cmpH} rx={1.5} fill="none" stroke="var(--color-ink-2)" strokeDasharray="3 2" data-testid="compare-bar" />}
      <rect className="bar-move" x={x1} y={y + g.barY} width={w} height={g.barH} rx={4} fill={tone ?? 'var(--color-bar-plan)'} />
      {!tone && done > 0 && <rect x={x1} y={y + g.barY} width={(w * done) / 100} height={g.barH} rx={4} fill="var(--color-bar)" />}
      {!tone && done > 0 && done < 100 && <rect x={x1 + (w * done) / 100 - 4} y={y + g.barY} width={4} height={g.barH} fill="var(--color-bar)" />}
      {selected && <rect x={x1 - 2.5} y={y + g.barY - 2.5} width={w + 5} height={g.barH + 5} rx={5.5} fill="none" stroke="var(--color-ink)" strokeWidth={1} />}
      {inside && (
        <g className="num" fontSize={12} fontWeight={500} style={{ pointerEvents: 'none' }}>
          {/* dark text over the remaining part, white over the completed part */}
          <text x={x1 + 8} y={mid + 4} fill={tone ? '#fff' : 'var(--color-bar-done)'}>{range}</text>
          {!tone && done > 0 && (
            <>
              <clipPath id={`done-${task.uid}`}><rect x={x1} y={y} width={(w * done) / 100} height={g.rowH} /></clipPath>
              <text x={x1 + 8} y={mid + 4} fill="#fff" clipPath={`url(#done-${task.uid})`}>{range}</text>
            </>
          )}
        </g>
      )}
      {outside && (
        <text x={x1 + w + 8} y={mid + 4} fontSize={12} fill="var(--color-ink-2)" className="num" style={{ pointerEvents: 'none' }}>
          {outside}
        </text>
      )}
    </g>
  );
}

function Links({ project, rows, rowIndex, first, last, result, scale, g, collapsed, chain, criticalOnly }: {
  project: Project; rows: Row[]; rowIndex: Map<number, number>; first: number; last: number;
  result: { byUid: Map<number, TaskSchedule> }; scale: Scale; g: Geometry; collapsed: Set<number>; chain: Set<number>; criticalOnly: boolean;
}) {
  const visible = useMemo(() => new Set(rows.map((r) => r.uid)), [rows]);
  const paths: React.ReactNode[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const si = rowIndex.get(row.uid)!;
    for (const link of row.task.predecessors) {
      let pu = link.predUid;
      if (!visible.has(pu)) {
        if (collapsed.size === 0) continue;
        const anc = visibleAncestor(project, pu, visible);
        if (anc === undefined || anc === row.uid) continue;
        pu = anc;
      }
      const pi = rowIndex.get(pu);
      if (pi === undefined || pi === si) continue;
      if (Math.max(pi, si) < first || Math.min(pi, si) > last) continue;
      const key = `${pu}>${row.uid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = result.byUid.get(pu);
      const s = result.byUid.get(row.uid);
      if (!p || !s) continue;
      const critical = !!p.critical && !!s.critical && s.driver.kind === 'link' && s.driver.predUid === link.predUid;
      const late = chain.has(pu) && chain.has(row.uid);
      paths.push(
        <path
          key={key}
          d={linkPath(link, p, s, pi, si, scale, g)}
          fill="none"
          stroke={late ? 'var(--color-late)' : critical ? 'var(--color-crit)' : 'var(--color-link)'}
          strokeWidth={late || critical ? 1.5 : 1}
          markerEnd={`url(#${late ? 'arrow-late' : critical ? 'arrow-crit' : 'arrow'})`}
          opacity={criticalOnly && !critical && !late ? 0.2 : 1}
          data-link={key}
        />,
      );
    }
  }
  return <g>{paths}</g>;
}

function linkPath(link: Link, p: TaskSchedule, s: TaskSchedule, pi: number, si: number, scale: Scale, g: Geometry): string {
  const fromEnd = link.type === 'FS' || link.type === 'FF';
  const toStart = link.type === 'FS' || link.type === 'SS';
  const y1 = pi * g.rowH + g.barY + g.barH / 2;
  const y2 = si * g.rowH + g.barY + g.barH / 2;
  const milestoneOffset = (t: TaskSchedule) => (t.duration === 0 ? g.barH * 0.5 : 0);
  const x1 = scale.x(fromEnd ? p.ef : p.es) + (fromEnd ? milestoneOffset(p) : -milestoneOffset(p));
  const x2 = scale.x(toStart ? s.es : s.ef) + (toStart ? -milestoneOffset(s) - 1 : milestoneOffset(s) + 1);
  const out = x1 + (fromEnd ? 6 : -6);
  const inn = x2 + (toStart ? -8 : 8);
  const ymid = y1 + (y2 > y1 ? 1 : -1) * (g.rowH / 2);
  if (toStart && fromEnd) {
    if (out <= x2 - 3) return `M${x1} ${y1}H${out}V${y2}H${x2}`;
    return `M${x1} ${y1}H${out}V${ymid}H${inn}V${y2}H${x2}`;
  }
  if (!toStart && fromEnd) {
    const x = Math.max(out, inn);
    return `M${x1} ${y1}H${x}V${y2}H${x2}`;
  }
  if (toStart && !fromEnd) {
    const x = Math.min(out, inn);
    return `M${x1} ${y1}H${x}V${y2}H${x2}`;
  }
  return `M${x1} ${y1}H${out}V${ymid}H${inn}V${y2}H${x2}`;
}
