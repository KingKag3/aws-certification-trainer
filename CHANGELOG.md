# Changelog

All notable changes to this project are recorded here. Dates are the date the work was done, and
the AWS certification data notes record *when* each fact was verified against an official AWS page —
that matters, because AWS renames, replaces and retires exams on its own schedule.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.1.0] — 2026-08-18

First working version. Static, dependency-free study app covering all currently active AWS
certifications, with a procedural question generator and a progression roadmap.

### Added — application

- **Question engine** (`docs/js/generator.js`). Generates quizzes from a structured knowledge base
  rather than a fixed bank. Ten template kinds (service identification, use case, category,
  true/false, "which is NOT true", scenario, shared responsibility, pricing, concept definition,
  odd one out). Seeded mulberry32 RNG for reproducibility. Pure module — no DOM, no network — so it
  runs under Node.
  - Domain-**first** selection: an exam domain is chosen weighted by AWS's published percentage,
    then material is chosen from that domain. A long quiz mirrors the real exam split rather than
    the shape of the data.
  - Template kinds needing three same-shape distractors are skipped automatically when a domain's
    pool is too small, so thin domains still yield true/false and odd-statement questions.
  - Spaced repetition: unseen material scores 2.5, correctly-answered material 1.0, missed material
    `1 + missRate × 4` with a further +1 when the most recent attempt was a miss.
  - No repeats within a set — questions are keyed on `template + entity + variant`, and duplicate
    stems are rejected and re-rolled.
- **Progression engine** (`docs/js/progression.js`). Readiness, mastery, soft unlock state,
  suggestions and roadmap graph layout. All pure functions.
  - Readiness = `Σ (domainWeight / 100) × accuracy_d × coverage_d`, where
    `coverage = min(1, answered / 12)`.
  - Mastery requires readiness ≥ 85, ≥ 40 questions answered, and no domain below 5 answers.
  - Unlocking is a recommendation, never a gate — AWS enforces no prerequisites, so foundational
    exams are always available and any certification can be started regardless.
- **Storage abstraction** (`docs/js/store.js`). `progressStore` with an async API over a
  `LocalStorageAdapter`, namespaced `awsstudy:v1:*` and per certification. Swapping in Firebase,
  Supabase or Cloudflare Workers later means one new adapter and one changed line.
- **Views**: roadmap skill tree (SVG bezier edges, tier bands, hover path highlighting, stacked
  card fallback below 900 px), per-certification dashboard, quiz, flashcards, weak-spot review,
  domain drill, profile with streak heatmap and JSON export/import.
- **Charts** (`docs/js/charts.js`): hand-rolled SVG radar, domain bars, progress ring and calendar
  heatmap. No Chart.js, no CDN — the app has zero external requests.
- **Icons** (`docs/js/icons.js`): inline SVG set. AWS's own icon assets are deliberately not
  hotlinked.
- Dark mode following the OS by default, overridable and persisted. Keyboard support in quiz
  (`1`–`5`, `Enter`) and flashcards (`←`/`→`, `Space`). Mobile-first layout verified clean at 375 px.

### Added — data

- `docs/data/certifications.json` — 11 certifications with exam codes, real domain names and
  weightings, exam facts, in-scope service lists and progression edges with per-edge "why this
  next" copy. Plus a `retired` array recording exams deliberately excluded.
- `docs/data/services.json` — ~85 AWS services, 24 core concepts, 9 scenario groups and 16
  shared-responsibility rows. Each entity carries `purpose`, `useCases`, `facts` (true statements)
  and `myths` (`false claim — correction`).
- `docs/data/templates.json` — question templates, tier eligibility, weights and interchangeable
  stems.
- CLF-C02 and SAA-C03 are populated for real quiz variety (`dataStatus: "full"`). The other nine
  certifications carry real metadata and real domain weightings but draw on the same shared pool,
  and are marked `dataStatus: "stub"`, which renders a "draft pool" badge.

### Added — tooling and docs

- `tools/test-generator.mjs` — standalone Node smoke test. Prints ten questions per certification
  with the answer marked, checks for malformed output (empty stem, duplicate options, missing
  explanation), and reports domain spread over a 60-question sample against each exam's real
  weighting.
- `README.md` — engine internals, data-editing guide, storage/sync architecture, GitHub Pages
  deployment steps.
- `.claude/launch.json` — local dev server on port 8766 serving `docs/`.

### AWS certification data — verified 2026-08-18

Read from the official exam guides on `docs.aws.amazon.com/aws-certification` and the
per-certification pages on `aws.amazon.com/certification`. Several details differed from what
general knowledge would suggest, which is why the lookup was done rather than assumed:

- **SysOps Administrator – Associate has been renamed CloudOps Engineer – Associate**, SOA-C02 →
  **SOA-C03**. Its exam guide still lives under the old `sysops-administrator-associate-03` URL.
- **Security – Specialty SCS-C02 retired 2025-12-01**, replaced by **SCS-C03**, whose domain 6 was
  renamed "Security Foundations and Governance".
- **Machine Learning – Specialty (MLS-C01) retired 2026-03-31**, replaced in the AI path by MLA-C01
  and the new AIP-C01.
- **AWS Certified Generative AI Developer – Professional (AIP-C01)** is new and sits in the
  Professional tier, not Specialty. Its duration and price were not published on the pages read, so
  they are `null` in the data and render as `—` rather than being invented.
- **Advanced Networking – Specialty (ANS-C01) has a final exam date of 2026-08-25** and is
  **omitted** from the roadmap by choice. Its record is retained in the `retired` array so it can be
  added back. This leaves Security as the only active Specialty exam.
- **MLA-C02** has been announced: registration opens 2026-09-01, and the MLA-C01 English exam is
  available through 2026-09-28. The app still carries MLA-C01, with a note on its dashboard.

### Content sourcing policy

No exam-dump material is used anywhere in this project. Sites republishing reported live exam
questions violate the AWS certification agreement candidates sign, and a bank built from them would
defeat the point of a generator — it optimises for recognising memorised items instead of
understanding. Sources used are AWS's own exam guides, service overview pages, service FAQs and the
Well-Architected Framework whitepaper. AWS's official sample-question PDFs were consulted only to
model stem *style*; no sample text or scenario was copied.

### Known gaps

- The nine `stub` certifications share the CLF/SAA content pool and are thin in places. MLA-C01
  domain 2 ("ML Model Development", 26%) is the worst case: only SageMaker and Bedrock are tagged
  `ml` within its scope, so it falls back to true/false and odd-statement questions there. Closing
  this is data authoring, not engine work — see "Adding a service, concept or question template" in
  the README.
- Cross-device sync is not implemented. Progress lives in one browser's `localStorage`; Profile →
  Export/Import moves it as a JSON file in the meantime.

---

[0.1.0]: https://github.com/KingKag3/aws-certification-trainer/releases/tag/v0.1.0
