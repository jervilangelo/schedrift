# Testing

| Suite | Command | Runs |
|---|---|---|
| Unit + integration | `npm test` | Vitest, Node |
| End-to-end | `npm run test:e2e` | Playwright against the production build on port 5199, saving to a temporary data folder |

The integration tests that read real `.mpp` files need `npm run setup` (MPXJ + Java) and `npm run fixtures`. They are skipped, with a message, when either is missing. The fixtures are synthetic test files from the MPXJ project's public corpus and are not committed.

## Coverage of the acceptance criteria

| # | Criterion | Automated test(s) |
|---|---|---|
| 1 | Launch locally on Windows | Manual check: `Schedrift.cmd` started on a test port (setup, build check, server, `/api/status`, Host/Origin rejection). Not automated. |
| 2 | Import `.mpp` | `mpp.integration.test.ts` (6 real files); e2e *imports a real .mpp file through MPXJ* |
| 3 | Gantt appears automatically | e2e *imports the sample and draws the Gantt chart…* |
| 4 | Expand/collapse phases | e2e *expands and collapses phases…* |
| 5 | View dependencies | e2e (arrows counted), *selecting a task shows its scheduling details* |
| 6 | Add/edit dependencies | e2e *editing dependencies keeps the dates and rejects cycles*; unit cycle tests |
| 7 | Identify critical tasks | unit *critical path & float*; e2e critical bars |
| 8 | Select any task | e2e selection tests |
| 9 | Simulate a delay | unit *delay simulation*; e2e *single-task delay…* |
| 10 | Multiple task delays | unit *does not double count…*, *duration extensions add up*; e2e equivalents |
| 11 | Delays reach dependents | unit *only the excess beyond float reaches Go-Live*, *a gap before a successor absorbs a delay*, *keeps dates that break a link*; e2e changed bars |
| 12 | Critical-path changes | unit *reports a critical-path switch*; e2e *No longer critical* |
| 13 | Original vs simulated | e2e compare bars and drift band |
| 14 | Go-Live impact | importer test *answers the UAT example*; e2e Go-Live strip |
| 15 | Reset | e2e *multiple-task scenario…* (reset step) |
| 16 | Save and reopen | e2e *saves locally and reopens with the scenario* |
| 17 | Presentation mode | e2e *presentation mode* |
| 18 | Executive view and rollout waves | unit `rows.test.ts` |

## Dates match the file

Schedrift draws every task at the Start and Finish stored in the file, so the import's date check (*N of N tasks show the start and finish from the file*) should always be complete. The integration tests confirm this on the MPXJ test corpus (FS/SS/FF/SF links with lags, baselines, constraints, deadlines, progress and calendars).

Tests use only synthetic data: the generated Atlas sample, fixtures built in code, and MPXJ's public test files.
