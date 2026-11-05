# Schedrift — Master Blueprint

> **Visualize Timelines. Understand the Impact.**
>
> Permanent reference document. Update it when a decision changes.

---

## 1. Vision

Microsoft Project stays the planning tool. Schedrift is the **presentation and what-if layer**:
it turns an `.mpp` schedule into a clean Gantt chart that stakeholders can read in about 30 seconds,
and it answers one question with real calculations:

> *"If this task slips, what happens to Go-Live?"*

**Defining workflow**

```
Import .mpp → Gantt appears → select task(s) → enter delay → run simulation
→ engine recalculates the network → changed tasks, critical-path changes and Go-Live impact shown → reset
```

Everything in the product supports that workflow. Anything that does not is out of scope.

## 2. Scope

### In scope
| Area | Contents |
|---|---|
| Import | `.mpp` (MS Project 98–2024 via MPXJ), `.mpx`, MSPDI `.xml`; validation report |
| Timeline view | Custom Gantt: hierarchy, collapse/expand, milestones, dependency arrows, critical path, today line, baseline bars, week/month/quarter zoom, Executive/Detailed modes |
| Simulation | Multi-task scenario: start delay and/or duration extension in working days; non-destructive; Go-Live variance; changed tasks; float and critical-path changes; driving chain explanation |
| Project data | Editable task table, dependency add/edit/remove, validation errors |
| Presentation | Full-screen, large rows, collapsible task list, Go-Live summary strip |
| Storage | Local `.schedrift.json` project files (plan + scenario) |
| Launch | `Schedrift.cmd` one-click launcher on Windows |

### Out of scope (deliberately)
Resource management, costs, leveling, timesheets, multi-user, cloud, authentication, writing back to `.mpp`,
drag-to-reschedule, earned value, portfolio views.

## 3. Architecture

```
┌──────────────────────── Browser (React + TS) ────────────────────────┐
│  features/timeline   features/simulation   features/data   presentation │
│            │                 │                    │                     │
│            └──────── store (zustand) ─────────────┘                     │
│                         │  calls (never inside components)              │
│        scheduling/ (pure TS engine)     importer/ (MSPDI → model)        │
└─────────────────────────┬────────────────────────────────────────────┘
                          │ HTTP (127.0.0.1 only)
┌─────────────────────────▼──────────── Local Node server ──────────────┐
│  /api/import  → temp copy → java MpxjConvert → MSPDI XML → response     │
│  /api/projects → data/projects/*.schedrift.json                         │
│  static dist/ (production)                                              │
└─────────────────────────┬────────────────────────────────────────────┘
                          │ child process
              vendor/jre (portable Temurin 21) + vendor/mpxj/lib/*.jar
```

Principles
- **The scheduling engine is a pure TypeScript module** (`src/scheduling`) with no React or DOM imports. It is fully unit-tested.
- **UI renders engine output only.** No date math in components except formatting.
- **Plan and scenario are separate objects.** A simulation never mutates the plan.
- **Local only.** Server binds to `127.0.0.1`, rejects foreign `Host`/`Origin` headers (DNS-rebinding/CSRF guard), no telemetry, no external calls at runtime. Network is only used once by `setup` to download the JRE and MPXJ.

## 4. Technology decisions

| Concern | Decision | Why |
|---|---|---|
| UI | React 19, TypeScript (strict), Vite | Requested; fast dev loop |
| Styling | Tailwind CSS v4 + small hand-written primitives in `src/components/ui` (shadcn-style API: Button, Input, Select, Dialog…) | shadcn's look without pulling in a large Radix tree for ~6 components |
| State | zustand | Tiny, testable, actions outside components |
| Gantt | **Custom SVG renderer** | Evaluated SVAR React Gantt (MIT core), DHTMLX Gantt (MIT community), Frappe Gantt (MIT), gantt-task-react (MIT, archived). None includes baselines **and** critical path in the free edition (SVAR/DHTMLX put both in PRO). A focused SVG renderer gives exact control over baseline/simulated bars, critical styling and arrows, with no license risk. |
| `.mpp` parsing | **MPXJ 16.10.0** (LGPL-2.1) run on a **portable Temurin 21 JRE** | The only mature open-source MPP reader. Runs fully offline. Used unmodified as a separate process (LGPL-compliant). |
| Exchange format | MPXJ `MpxjConvert` → **MSPDI XML** | MSPDI is Microsoft's documented XML schema for Project. One parser handles `.mpp`, `.mpx` and `.xml` exported from MS Project. |
| XML parsing | `fast-xml-parser` | Works in browser and Node tests |
| Server | Plain `node:http` (no framework) | One file, few dependencies |
| Storage | JSON project files in `data/projects/` (gitignored) + download/upload `.schedrift.json` | Human-inspectable, no native SQLite build on Windows |
| Tests | Vitest (engine, importer, store), Playwright (E2E) | |

Alternatives rejected for MPP: Aspose.Tasks (commercial), Python `mpxj` (needs JPype + JVM anyway), MPXJ.Net via IKVM (needs .NET SDK, not installed), pure-JS readers (none credible).

Reference study: **TMailletFR/ProjectEngine** (GPL-3.0, Excel VBA). Studied for concepts only (TEST vs SCENARIO separation, driving logic, cycle detection). **No code copied.**

## 5. Data model (`src/model/types.ts`)

Time is an **Instant**: fractional days since 1970-01-01 in wall-clock time (treated as UTC, so DST cannot shift dates).
`08:00 on 2027-03-11` = `dayNumber + 8/24`. The display layer converts to `Date` only for formatting.

```ts
Project {
  schemaVersion: 1; id; name; sourceFileName; importedAt
  projectStart: Instant; statusDate?: Instant
  defaultCalendarUid; calendars: Calendar[]
  dayStartHours (e.g. 8); dayEndHours (e.g. 17); criticalSlackLimit (working days)
  tasks: Task[]            // file order (outline order); uid is the stable key
  goLiveUid?: number       // user-selectable; auto-detected on import
  importReport: ImportReport
}
Task {
  uid (stable); id (display, row number); wbs; name; outlineLevel; parentUid | null
  summary; milestone; manual; active
  start; finish            // as imported (MS Project's own dates)
  duration                 // working days, fractional allowed
  calendarUid | null
  constraint { type: ASAP|ALAP|SNET|SNLT|FNET|FNLT|MSO|MFO; date? }
  deadline?
  percentComplete; actualStart?; actualFinish?
  baselineStart?; baselineFinish?
  predecessors: Link[]     // { predUid, type: FS|SS|FF|SF, lag, lagUnit: 'wd'|'ed' }
}
Calendar { uid; name; baseUid?; workWeek: boolean[7]; exceptions: { day, working }[] }
Scenario { id; name; items: { uid; startDelay; durationDelta }[] }   // working days
```

Phase = name of the task's top-level summary ancestor. Status is derived: Complete, In progress, or Not started.
`uid` (MS Project Unique ID) is the only identity used in links, selection, scenarios and storage. Row order never affects links.

## 6. `.mpp` import

1. Browser uploads bytes → `POST /api/import?name=…`.
2. Server writes a **temp copy** (the original file is never touched), runs
   `java -cp vendor/mpxj/lib/* org.mpxj.sample.MpxjConvert in.mpp out.xml` (120 s timeout), returns the XML, and deletes the temp files.
3. `.xml` (MSPDI) files skip step 2 and are parsed in the browser.
4. `importer/mspdi.ts` normalizes the XML into the model:
   - durations `PT#H#M#S` → working days using `MinutesPerDay`
   - `LinkLag` (tenths of minutes) and `LagFormat` → working days or elapsed days. Percent lag is converted to working days using the predecessor's duration.
   - calendars: weekdays, exceptions and base-calendar inheritance (resource calendars ignored)
   - constraints, deadlines, actuals, `Baseline` number 0
   - `IsNull`, external tasks and the project summary task (UID 0) are dropped **with a report entry**
5. `importer/validate.ts` produces an `ImportReport` with `error | warning | info` items:
   invalid dates, missing predecessors, links to self, duplicate UIDs, circular dependencies (cycle members listed, offending links excluded from calculation and flagged), unsupported features (resource-driven/effort scheduling, split tasks, ALAP, elapsed durations, inactive tasks, manual tasks, subprojects, intra-day calendars), invalid constraints, missing durations.
6. **Schedule check:** the engine recalculates the imported plan and compares each task's start/finish with MS Project's. Matches and mismatches are shown in the report. This is how users can trust the simulation.

## 7. Scheduling engine (`src/scheduling`)

### 7.1 Calendar math
Each calendar maps an Instant to a **working ordinal**: the number of working days before that day, plus the fraction of the working day elapsed.
The end of a working day and the start of the next working day share the same ordinal, so FS links land on the next working morning.
`fromOrdinal(o, 'start' | 'finish')` converts back: the start form puts a whole number at the morning of that working day, and the finish form puts it at the evening of the previous working day.
Working-day prefix tables are built lazily and extend in both directions.

### 7.2 Network
- Nodes = all tasks. Leaf tasks carry duration. Summary tasks roll up (start = min of children, finish = max of children).
- A link **into a summary** applies to every leaf descendant. A link **out of a summary** uses the summary's rolled-up dates.
- Edges child → parent give a single topological order (Kahn). Cycles are detected (Tarjan SCC) and reported before scheduling.

### 7.3 Forward pass (early dates), in the successor's calendar
| Type | Candidate |
|---|---|
| FS | ES ≥ ord(pred.EF) + lag |
| SS | ES ≥ ord(pred.ES) + lag |
| FF | EF ≥ ord(pred.EF) + lag → ES ≥ … − dur |
| SF | EF ≥ ord(pred.ES) + lag → ES ≥ … − dur |

ES = max(project start, all link candidates, SNET/FNET floor, simulation floor). EF = ES + duration.
MSO/MFO fix the date (honor-constraints semantics). If logic demands a later date, a **conflict** is recorded (`logicStart`) and negative float appears.
The predecessor that wins the max is stored as the **driving link**.

Progress:
- **Completed** tasks (100% or actual finish) keep their actual dates and are never moved.
- **In-progress** tasks keep their actual start. Their finish is actualStart + duration, and it can still be pushed by FF/SF links.
- **Manual** tasks are pinned to their entered start, like MS Project. A simulation delay applied directly to them still moves them.

### 7.4 Backward pass (late dates)
LF = min(project finish, successor constraints (inverse of the table above), FNLT/MFO/deadline). SNLT/MSO limit LS.
Summaries inherit their outgoing-link limits down to their children.
**Total float** = min(LS − ES, LF − EF) in working days of the task's calendar.
**Critical** = not complete and total float ≤ `criticalSlackLimit` (default 0). Negative float counts as critical.
Summary tasks are critical when any child is.

### 7.5 Results
`ScheduleResult { byUid: { es, ef, ls, lf, totalFloat, critical, drivingPredUid, conflict } , projectFinish }`

## 8. Delay simulation

Semantics, shown in the UI:
- **Delay start by X working days.** The task cannot start before *original calculated start + X*. This is a floor, not an extra lag. If an upstream delay already pushes the task further, the two do **not** add up. That is how overlapping paths avoid double counting.
- **Extend duration by X working days.** Duration becomes original + X.
- Completed tasks cannot be simulated. In-progress tasks allow duration extension only.

Steps:
1. Original schedule = `schedule(plan)`, cached until the plan changes.
2. Simulated schedule = `schedule(plan, scenario)`, using the same engine and a modified copy.
3. `compare(original, simulated)` gives:
   changed tasks (|Δstart| or |Δfinish| > ε), float before/after, critical added/removed, Go-Live original/simulated/variance (working days), and the **driving chain** traced back from Go-Live through driving links to a scenario task.
4. Explanation text is generated only from those numbers. Example: *"UAT slips 10 working days; 4 days are absorbed by float; Go-Live moves 6 working days to 18 Mar 2027 via UAT → Cutover Rehearsal → Go-Live."*
   If Go-Live does not move: *"The delay is absorbed: UAT had 12 working days of total float."*

Go-Live task: first milestone whose name matches `/go[\s-]?live/i`. Otherwise the latest-finishing milestone, otherwise the latest-finishing task. The user can change it.

## 9. UI/UX specification

**Layout** (1366×768 and up): a 48 px app bar (wordmark, project name, file name, view tabs, Import / Save / Present), a 44 px impact strip (Original Go-Live · Simulated Go-Live · Variance · Critical tasks count), then the workspace.
The Gantt takes 75–80% of the area. A 340 px side panel opens on selection.

**Colors** (CSS tokens, light theme):
| Token | Use |
|---|---|
| `--bg #f6f6f4`, `--surface #ffffff`, `--line #e3e3df` | neutral canvas |
| `--ink #23262b`, `--ink-2 #5c6168` | charcoal text |
| `--bar #3e8a7e` (teal) | normal task |
| `--bar-summary #2f3a40` | summary bracket |
| `--sim #d89a2b` (amber) | task selected into the scenario |
| `--late #c2412d` (red) | task whose calculated dates changed |
| `--crit #1f2a44` outline + "critical" tag | critical path (distinct from red; fill encodes simulation state) |
| dashed `--ink-2` outline | baseline / original bars |

**Type:** Inter (system fallback), 13 px base, tabular numerals for dates.
**Motion:** 120 ms bar transitions and 160 ms panel slide only. Disabled under `prefers-reduced-motion`.
**Gantt:** 30 px rows (40 px in presentation), sticky timeline header, sticky task list, a "Critical path" focus toggle that dims non-critical rows, a today line, and Go-Live lines (original dashed, simulated solid red).
**Executive mode** shows phases (top-level summaries with progress fill), milestones and Go-Live, plus only the links between visible rows.
**Detailed mode** shows the full hierarchy.
**Selection:** click to select, Ctrl/⌘-click to add or remove, Esc to clear. Rows and bars are keyboard-focusable (Enter selects).

## 10. Technical challenges and mitigations
| Challenge | Mitigation |
|---|---|
| Engine dates differ from MS Project | Schedule check in import report; documented approximations |
| No Java on target machine | `setup` downloads a portable JRE into `vendor/` (no admin rights) |
| Large schedules (1000+ rows) | Row virtualization in the Gantt; engine is O(V+E) |
| Summary-task links | Expansion rules in 7.2 |
| Intra-day calendars / split tasks | Day-level model with linear hours; flagged as a warning |

## 11. Development phases
1. Blueprint (this document)
2. PoC: MPXJ → MSPDI on sample `.mpp` files ✔ (≈1 s per file)
3. Project setup: Vite/React/TS/Tailwind, Vitest, Playwright, server, launcher
4. Scheduling engine + tests
5. Importer + validation + tests
6. Gantt dashboard (Executive/Detailed, zoom, hierarchy, arrows, critical, baseline)
7. Delay simulation (panel, scenario, impact strip, Simulation view)
8. Project data editing
9. Presentation mode
10. E2E testing, refinement, docs, push

## 12. Testing strategy
- **Unit (Vitest):** calendar ordinals, weekends and holidays; FS/SS/FF/SF with positive/negative lag; multiple predecessors; summary links; constraints; completed/in-progress tasks; float and critical path on known networks; float absorbing a delay; multi-task non-double-counting; cycle detection; MSPDI parsing of synthetic fixtures; validation rules.
- **Integration:** real `.mpp` files from the MPXJ test corpus (downloaded by `npm run fixtures`, not committed) converted through Java, then parsed and scheduled. The test is skipped with a message when Java is unavailable.
- **E2E (Playwright, Chromium):** import sample and `.mpp`, Gantt visible, collapse/expand, zoom, select, single and multi simulation, Go-Live text, reset, edit dependency, cycle rejection, save and reopen, presentation mode, invalid file.

## 13. Acceptance criteria
The 17 criteria from the brief: launch on Windows; import `.mpp`; automatic Gantt; expand/collapse; view dependencies; add/edit dependencies; identify critical tasks; select any task; simulate a delay; simulate multiple delays; recalculate dependents; see critical-path changes; compare original vs simulated; Go-Live impact; reset; save and reopen; presentation mode. Each one maps to at least one automated test (see `docs/TESTING.md`).

## 14. Security and data hygiene
`.gitignore` excludes `data/`, `vendor/`, `*.mpp`, `*.mpx`, `tests/fixtures/mpxj/` and `.env*`. Only synthetic samples (`samples/`) are committed. No credentials anywhere in the repo.
