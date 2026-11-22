# TaskFlow performance observations (PR #47)

TaskFlow already has read-only hourly production smoke probes. PR #47 extends those
probes with **three bounded synthetic GET samples** each for the public
frontend HTML, API liveness, and API database readiness endpoints. Reports
include the sample count, median and nearest-rank p95/max latency in the
GitHub Actions step summary; the smoke probe still validates expected
HTTP status and security checks.

The report stores only endpoint *category* and numeric timing aggregates.
It never makes authenticated requests, never reads task or user records,
never submits a task, and never logs URL query parameters, IPs, credentials,
task titles, response bodies, or account data. Only the three explicitly
allowlisted read-only paths can be sampled.

**Interpretation:** These are small synthetic samples from GitHub-hosted
runners, *not* Core Web Vitals or representative real-user latencies.
Three samples do not justify strict p95 performance SLAs; runner region,
provider cold starts, and caching may shift results. A single slow sample
is a clue to investigate, not proof of regression. Availability/status
failures still fail the smoke workflow. For meaningful trends, compare
several hourly runs and include provider logs before changing thresholds.

**Rendering optimization:** Productivity insights' category/due-state
breakdown is now computed only after the expandable insights section
opens. The result is memoized while task data remains unchanged. The
dashboard's verified task counts and all views preserve their existing
behavior; no task data or database schema is modified.

Future extension: opt-in privacy-reviewed real-user Web Vitals sampling,
performance budgets informed by multiple weeks of synthetic baselines,
and large-workspace browser benchmarks. Do not turn on user analytics
without a separate privacy and consent review.
