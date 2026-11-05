/**
 * Schedrift internal project model.
 *
 * Time is represented as an `Instant`: fractional days since 1970-01-01 in
 * wall-clock time (interpreted as UTC so daylight-saving never shifts dates).
 * Example: 08:00 on a day = dayNumber + 8/24.
 */
export type Instant = number;

export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';
/** wd = working days (task calendar), ed = elapsed calendar days */
export type LagUnit = 'wd' | 'ed';

export interface Link {
  predUid: number;
  type: LinkType;
  /** Lag in `lagUnit`; negative = lead. */
  lag: number;
  lagUnit: LagUnit;
}

export type ConstraintType = 'ASAP' | 'ALAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';

export interface Constraint {
  type: ConstraintType;
  date?: Instant;
}

export interface Task {
  /** MS Project Unique ID — the stable identity used everywhere. */
  uid: number;
  /** MS Project row ID (display only). */
  id: number;
  wbs: string;
  name: string;
  outlineLevel: number;
  parentUid: number | null;
  summary: boolean;
  milestone: boolean;
  /** Manually scheduled in MS Project (pinned to its start date). */
  manual: boolean;
  active: boolean;
  /** Dates as stored in the source file. */
  start: Instant;
  finish: Instant;
  /** Working days (fractional allowed). Ignored for summary tasks. */
  duration: number;
  calendarUid: number | null;
  constraint: Constraint;
  deadline?: Instant;
  percentComplete: number;
  actualStart?: Instant;
  actualFinish?: Instant;
  baselineStart?: Instant;
  baselineFinish?: Instant;
  predecessors: Link[];
}

export interface CalendarException {
  /** Day number (days since epoch). */
  day: number;
  working: boolean;
}

export interface Calendar {
  uid: number;
  name: string;
  /** Index 0 = Sunday … 6 = Saturday. */
  workWeek: boolean[];
  exceptions: CalendarException[];
}

export type ReportLevel = 'error' | 'warning' | 'info';

export interface ReportItem {
  level: ReportLevel;
  code: string;
  message: string;
  taskUids?: number[];
}

export interface ImportReport {
  items: ReportItem[];
  /** Number of leaf tasks whose engine dates match MS Project's dates. */
  scheduleCheck?: { compared: number; matched: number; mismatchedUids: number[] };
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  sourceFileName: string;
  importedAt: string;
  projectStart: Instant;
  statusDate?: Instant;
  defaultCalendarUid: number;
  calendars: Calendar[];
  /** Working hours used to map time-of-day onto a working-day fraction. */
  dayStartHours: number;
  dayEndHours: number;
  /** Tasks with total float <= this (working days) are critical. */
  criticalSlackLimit: number;
  /** Tasks in outline (file) order. */
  tasks: Task[];
  goLiveUid?: number;
  /** Links excluded from calculation because they form a cycle (pred→succ uids). */
  excludedLinks?: { predUid: number; succUid: number }[];
  importReport: ImportReport;
}

export interface ScenarioItem {
  uid: number;
  /** Start may not be earlier than original calculated start + startDelay (working days). */
  startDelay: number;
  /** Working days added to the duration. */
  durationDelta: number;
}

export interface Scenario {
  items: ScenarioItem[];
}

export interface SavedProjectFile {
  format: 'schedrift-project';
  version: 1;
  savedAt: string;
  project: Project;
  scenario: Scenario;
}
