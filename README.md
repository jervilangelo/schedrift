# Schedrift

**Visualize Timelines. Understand the Impact.**

Schedrift turns a Microsoft Project schedule into a clean, presentation-ready Gantt chart and answers one question with real Critical Path calculations:

> *If this task slips, what happens to Go-Live?*

Import an `.mpp` file → the Gantt chart appears → select one or more tasks → enter a delay in working days → run the simulation. Schedrift recalculates the dependency network and shows:

- which tasks move;
- how float and the critical path change;
- the chain of tasks that carries the delay to Go-Live;
- the new Go-Live date, and its variance in working days.

Schedrift does not replace Microsoft Project. It runs entirely on your computer: no cloud, no account, no telemetry. Your `.mpp` file is never modified.

## Start it (Windows)

1. Install **Node.js 20 or newer** from <https://nodejs.org> (one time).
2. Double-click **`Schedrift.cmd`**.

The first start installs dependencies and downloads two pinned, checksum-verified runtimes into `vendor/` (about 80 MB, no admin rights needed):
- **MPXJ 16.10.0**, the open-source library that reads `.mpp` files;
- a portable **Eclipse Temurin 21 JRE**, but only if Java 11+ is not already installed.

Your browser then opens at <http://localhost:5178>. Keep the console window open while you use Schedrift, and close it to stop.

Later starts take a few seconds. Set `SCHEDRIFT_PORT` to use a different port.

### Manual start / development

```bash
npm ci
npm run setup      # MPXJ + Java runtime for .mpp import
npm run build && npm start      # production server on http://localhost:5178
npm run dev                     # Vite dev server with the same local API
```

## Using Schedrift

| You want to… | Do this |
|---|---|
| Import a schedule | **Import**, drag a file onto the window, or use the start screen. `.mpp`, `.mpx`, MS Project XML (`.xml`) and saved `.schedrift.json` files are accepted. |
| Read the timeline | **Timeline** view. Teal = task, dark outline = critical, ◆ = milestone, the vertical line = today. Switch between **Executive** (phases, milestones, Go-Live) and **Detailed**. Zoom with **Weeks / Months / Quarters / Fit**. |
| Expand or collapse phases | Use the chevrons in the task list, or **Collapse all**. Arrow keys move between rows; ←/→ collapse and expand. |
| Focus on the critical path | Turn on **Critical path** to fade everything else. |
| Simulate a delay | Click a task (Ctrl+click to add more). In the side panel, set **Delay start** and/or **Extend duration** in working days, then **Run simulation**. |
| See the impact | The strip at the top shows the original Go-Live, the simulated Go-Live and the variance, with an explanation. In the chart, amber marks tasks in the scenario and red marks tasks whose dates changed. Dashed outlines show the original plan, and the red band shows the Go-Live drift. The **Simulation** view lists every changed task, float before → after, critical-path changes and the driving chain. |
| Undo a simulation | **Reset**. The imported plan is never changed by a simulation. |
| Edit the plan | **Project data**. Edit names, dates, durations, % complete and milestones. Edit predecessors as text (`12`, `12FS+2d`, `7SS-1d`, `9FF`) or with **Edit**. Changes are validated: a change that would create a circular dependency is rejected. |
| Use an Excel master for dates | After importing the `.mpp`, click **Update from Excel** and choose your `.xlsx` or `.csv`. Schedrift keeps the `.mpp`'s dependencies and takes dates, durations, actual dates and status from the sheet. It finds the header row with **Planned Start / Planned End** (plus *Status*, *Actual Start / Actual End* if present), matches rows to tasks by name in outline order, and shows a review before applying: the resulting Go-Live, Excel dates a dependency does not allow (and why), and rows found in only one file. |
| Choose the Go-Live milestone | Use the **Go-Live** selector in the top strip. Any task can be chosen. On import, Schedrift picks the next upcoming task named “Go-Live” (useful when each phase has one). |
| Present to stakeholders | **Present** opens full screen with larger rows and the whole project fitted to the screen. Use the sidebar button to hide the task list. Simulation still works. Press Esc to exit. |
| Save and reopen | **Save** (Ctrl+S) stores the project and its scenario in `data/projects/`. Saved projects appear on the start screen. **Export** downloads a portable `.schedrift.json`. |

### How delays are interpreted

- **Delay start by X working days.** The task may not start before its *original calculated start + X*. This is a floor, not an extra lag. If an upstream delay already pushes the task later, the two do not add up, so overlapping delays are never double counted.
- **Extend duration by X working days.** The task takes X more working days.
- Completed tasks keep their actual dates and cannot be delayed. Tasks already in progress can only be extended.
- A delay only reaches Go-Live when it exceeds the float on its path. Schedrift reports exactly how much is absorbed and why.

## Architecture

```
React UI (src/features) ──► zustand store (src/store) ──► scheduling engine (src/scheduling, pure TypeScript)
        │                                         └────► importer (src/importer: MSPDI XML → model)
        └── fetch /api ──► local Node server (server/) ──► Java + MPXJ: .mpp → MSPDI XML (temp copy)
                                              └────────► data/projects/*.schedrift.json
```

- **Scheduling engine.** CPM forward and backward passes over a dependency graph. It supports FS/SS/FF/SF links, lags and leads (working or elapsed days), per-task working calendars with holidays, constraints (SNET, FNET, SNLT, FNLT, MSO, MFO, deadlines), actual dates, links on summary tasks, total float and the critical path. It has no UI dependencies and is unit-tested.
- **Import.** MPXJ converts `.mpp` into MSPDI (Microsoft's documented XML schema), which a single TypeScript importer normalizes.
  - Every import gets a validation report: cycles, missing predecessors, duplicate IDs, invalid dates, unsupported features.
  - Every import also gets a **schedule check**, which recalculates the plan and compares it with the dates in the file, so you can see whether the engine agrees with MS Project.
- **Gantt.** A custom SVG renderer with row virtualization. No open-source Gantt library offers baseline bars and critical-path display in its free edition, so Schedrift draws its own.
- **Server.** Plain `node:http`, bound to `127.0.0.1`. It rejects non-local `Host`/`Origin` headers.

The full design, including the data model, algorithms and decisions, is in [docs/SCHEDRIFT_MASTER_BLUEPRINT.md](docs/SCHEDRIFT_MASTER_BLUEPRINT.md).

## Tests

```bash
npm test               # unit + integration (Vitest): engine, calendars, importer, real .mpp via MPXJ
npm run fixtures       # downloads MPXJ's public synthetic .mpp test files (not committed)
npm run test:e2e       # Playwright end-to-end, using the installed Google Chrome
```

See [docs/TESTING.md](docs/TESTING.md) for what each test covers.

## Known limitations

- Scheduling is at **working-day granularity**. Hours inside a day are mapped linearly (no lunch-break modelling), so a half-day task may finish at 12:30 rather than 12:00.
- **Not modelled:** resource leveling, effort-driven or resource-driven durations, task splits, recurring calendar exceptions (only dated ones), alternate work weeks, inserted subprojects, and "As Late As Possible". Each one present in a file is flagged in the import report.
- Manually scheduled tasks stay pinned, as in MS Project. A delay upstream does not move them, and the conflict is shown.
- Schedrift cannot write `.mpp` files. Edits and simulations are stored in Schedrift's own project file.
- The automatic Java download is configured for Windows x64. Elsewhere, install Java 11+ or set `SCHEDRIFT_JAVA`.

## Licences

Schedrift is MIT-licensed (see [LICENSE](LICENSE)). It downloads MPXJ (LGPL-2.1) and Eclipse Temurin (GPLv2 with Classpath Exception) unmodified, at setup time, and runs them as a separate process. Both are kept out of this repository. IBM Plex Sans is bundled under the SIL Open Font License. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The sample schedule `public/samples/atlas-erp-rollout.xml` is synthetic. Its names and dates are fictitious.
