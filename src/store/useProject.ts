import { create } from 'zustand';
import type { Project, Scenario, ScenarioItem } from '../model/types';
import { applyTaskEdit, type TaskPatch } from '../model/edit';
import { schedule, type ScheduleResult } from '../scheduling/engine';
import { analyzeImpact, type ImpactReport } from '../scheduling/impact';
import { importMspdi, ImportError } from '../importer';
import * as api from '../storage/api';
import { downloadFile, parseSavedFile, toSavedFile } from '../storage/projectFile';
import type { GanttMode } from '../lib/rows';

export type View = 'timeline' | 'simulation' | 'data';
export type Zoom = 'week' | 'month' | 'quarter' | 'fit';
/** What the dashed comparison bars show. */
export type Compare = 'original' | 'baseline' | 'none';

export interface Notice {
  kind: 'error' | 'info' | 'success';
  text: string;
}

interface State {
  project: Project | null;
  original: ScheduleResult | null;
  /** Scenario being edited in the panel. */
  draft: Scenario;
  /** Scenario of the current results (null = no simulation shown). */
  applied: Scenario | null;
  simulated: ScheduleResult | null;
  impact: ImpactReport | null;

  selection: number[];
  view: View;
  zoom: Zoom;
  mode: GanttMode;
  collapsed: number[];
  criticalOnly: boolean;
  compare: Compare;
  listVisible: boolean;
  presenting: boolean;
  reportOpen: boolean;

  savedAt: string | null;
  dirty: boolean;
  busy: string | null;
  notice: Notice | null;
  server: api.ServerStatus | null;

  // actions
  init(): Promise<void>;
  importFile(file: File): Promise<void>;
  openSample(): Promise<void>;
  loadSaved(id: string): Promise<void>;
  setProject(project: Project, scenario?: Scenario, savedAt?: string | null): void;
  closeProject(): void;
  save(): Promise<void>;
  exportFile(): void;

  select(uid: number, additive?: boolean): void;
  clearSelection(): void;
  setDraftItem(uid: number, patch: Partial<Omit<ScenarioItem, 'uid'>>): void;
  removeDraftItem(uid: number): void;
  runSimulation(): void;
  resetSimulation(): void;

  editTask(uid: number, patch: TaskPatch): boolean;
  setGoLive(uid: number): void;

  setView(v: View): void;
  setZoom(z: Zoom): void;
  setMode(m: GanttMode): void;
  toggleCollapsed(uid: number): void;
  setCollapsedAll(collapsed: boolean): void;
  setCriticalOnly(v: boolean): void;
  setCompare(c: Compare): void;
  setListVisible(v: boolean): void;
  setPresenting(v: boolean): void;
  setReportOpen(v: boolean): void;
  setNotice(n: Notice | null): void;
}

const emptyScenario = (): Scenario => ({ items: [] });

function compute(project: Project, applied: Scenario | null) {
  const original = schedule(project);
  if (!applied || !applied.items.length) return { original, simulated: null, impact: null };
  const simulated = schedule(project, applied, original);
  const impact = analyzeImpact(project, original, simulated, applied, project.goLiveUid);
  return { original, simulated, impact };
}

function cleanScenario(project: Project, s: Scenario): Scenario {
  const uids = new Set(project.tasks.map((t) => t.uid));
  return { items: s.items.filter((i) => uids.has(i.uid) && (i.startDelay > 0 || i.durationDelta !== 0)) };
}

export const useProject = create<State>((set, get) => ({
  project: null,
  original: null,
  draft: emptyScenario(),
  applied: null,
  simulated: null,
  impact: null,
  selection: [],
  view: 'timeline',
  zoom: 'month',
  mode: 'detailed',
  collapsed: [],
  criticalOnly: false,
  compare: 'original',
  listVisible: true,
  presenting: false,
  reportOpen: false,
  savedAt: null,
  dirty: false,
  busy: null,
  notice: null,
  server: null,

  async init() {
    set({ server: await api.getStatus() });
  },

  async importFile(file) {
    set({ busy: `Reading ${file.name}…`, notice: null });
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.json')) {
        const saved = parseSavedFile(await file.text());
        get().setProject(saved.project, saved.scenario, null);
        set({ dirty: true, notice: { kind: 'success', text: `Opened ${file.name}.` } });
        return;
      }
      const xml = lower.endsWith('.xml') ? await file.text() : await api.convertFile(file);
      const project = importMspdi(xml, file.name);
      get().setProject(project);
      const errors = project.importReport.items.filter((i) => i.level === 'error').length;
      const warnings = project.importReport.items.filter((i) => i.level === 'warning').length;
      set({
        dirty: true,
        reportOpen: errors + warnings > 0,
        notice: { kind: errors ? 'error' : 'success', text: `Imported ${project.tasks.length} tasks from ${file.name}${errors || warnings ? ` with ${errors} error(s) and ${warnings} warning(s)` : ''}.` },
      });
    } catch (e) {
      const msg = e instanceof ImportError || e instanceof Error ? e.message : String(e);
      set({ notice: { kind: 'error', text: `Could not import ${file.name}: ${msg}` } });
    } finally {
      set({ busy: null });
    }
  },

  async openSample() {
    set({ busy: 'Opening sample…' });
    try {
      const res = await fetch('/samples/atlas-erp-rollout.xml');
      if (!res.ok) throw new Error('Sample not found.');
      const project = importMspdi(await res.text(), 'atlas-erp-rollout.xml');
      get().setProject(project);
      set({ dirty: true });
    } catch (e) {
      set({ notice: { kind: 'error', text: (e as Error).message } });
    } finally {
      set({ busy: null });
    }
  },

  async loadSaved(id) {
    set({ busy: 'Opening project…' });
    try {
      const f = await api.loadProject(id);
      get().setProject(f.project, f.scenario, f.savedAt);
    } catch (e) {
      set({ notice: { kind: 'error', text: (e as Error).message } });
    } finally {
      set({ busy: null });
    }
  },

  setProject(project, scenario, savedAt = null) {
    const draft = cleanScenario(project, scenario ?? emptyScenario());
    const applied = draft.items.length ? draft : null;
    const results = compute(project, applied);
    set({
      project,
      ...results,
      draft,
      applied,
      selection: [],
      collapsed: [],
      view: 'timeline',
      savedAt,
      dirty: false,
      reportOpen: false,
      notice: null,
    });
  },

  closeProject() {
    set({ project: null, original: null, simulated: null, impact: null, applied: null, draft: emptyScenario(), selection: [], savedAt: null, dirty: false, reportOpen: false });
  },

  async save() {
    const { project, draft } = get();
    if (!project) return;
    set({ busy: 'Saving…' });
    try {
      const file = toSavedFile(project, draft);
      await api.saveProject(file);
      set({ savedAt: file.savedAt, dirty: false, notice: { kind: 'success', text: 'Project saved locally.' } });
    } catch (e) {
      set({ notice: { kind: 'error', text: `Could not save: ${(e as Error).message}` } });
    } finally {
      set({ busy: null });
    }
  },

  exportFile() {
    const { project, draft } = get();
    if (!project) return;
    const safe = project.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
    downloadFile(`${safe}.schedrift.json`, JSON.stringify(toSavedFile(project, draft), null, 2));
  },

  select(uid, additive = false) {
    const { selection } = get();
    if (additive) {
      set({ selection: selection.includes(uid) ? selection.filter((u) => u !== uid) : [...selection, uid] });
    } else {
      set({ selection: selection.length === 1 && selection[0] === uid ? [] : [uid] });
    }
  },

  clearSelection() {
    set({ selection: [] });
  },

  setDraftItem(uid, patch) {
    const items = get().draft.items.slice();
    const i = items.findIndex((x) => x.uid === uid);
    const base: ScenarioItem = i >= 0 ? items[i]! : { uid, startDelay: 0, durationDelta: 0 };
    const next: ScenarioItem = { ...base, ...patch };
    next.startDelay = Math.max(0, Math.min(2000, Number.isFinite(next.startDelay) ? next.startDelay : 0));
    next.durationDelta = Math.max(0, Math.min(2000, Number.isFinite(next.durationDelta) ? next.durationDelta : 0));
    if (i >= 0) items[i] = next;
    else items.push(next);
    set({ draft: { items }, dirty: true });
  },

  removeDraftItem(uid) {
    set({ draft: { items: get().draft.items.filter((x) => x.uid !== uid) }, dirty: true });
  },

  runSimulation() {
    const { project, draft } = get();
    if (!project) return;
    const applied = cleanScenario(project, draft);
    if (!applied.items.length) {
      set({ notice: { kind: 'info', text: 'Enter a delay for at least one task, then run the simulation.' } });
      return;
    }
    set({ ...compute(project, applied), applied, draft: applied, compare: 'original', dirty: true });
  },

  resetSimulation() {
    const { project } = get();
    if (!project) return;
    set({ ...compute(project, null), applied: null, draft: emptyScenario(), dirty: true });
  },

  editTask(uid, patch) {
    const { project, applied } = get();
    if (!project) return false;
    const r = applyTaskEdit(project, uid, patch);
    if (!r.ok) {
      set({ notice: { kind: 'error', text: r.error } });
      return false;
    }
    set({ project: r.project, ...compute(r.project, applied), dirty: true, notice: null });
    return true;
  },

  setGoLive(uid) {
    const { project, applied } = get();
    if (!project) return;
    const next = { ...project, goLiveUid: uid };
    set({ project: next, ...compute(next, applied), dirty: true });
  },

  setView(view) { set({ view }); },
  setZoom(zoom) { set({ zoom }); },
  setMode(mode) { set({ mode }); },
  toggleCollapsed(uid) {
    const c = get().collapsed;
    set({ collapsed: c.includes(uid) ? c.filter((u) => u !== uid) : [...c, uid] });
  },
  setCollapsedAll(collapsed) {
    const p = get().project;
    set({ collapsed: collapsed && p ? p.tasks.filter((t) => t.summary).map((t) => t.uid) : [] });
  },
  setCriticalOnly(criticalOnly) { set({ criticalOnly }); },
  setCompare(compare) { set({ compare }); },
  setListVisible(listVisible) { set({ listVisible }); },
  setPresenting(presenting) { set({ presenting }); },
  setReportOpen(reportOpen) { set({ reportOpen }); },
  setNotice(notice) { set({ notice }); },
}));
