# AWS Certification Trainer

A static study app for **every currently active AWS certification**, with a progression roadmap that
moves you from Foundational → Associate → Professional/Specialty as you demonstrate mastery.

Questions are **procedurally generated** from a structured knowledge base rather than drawn from a
fixed question bank, so no two quiz sets are the same and there is nothing to memorise by position.
Everything runs in the browser — no server, no build step, no dependencies.

---

## Table of contents

- [What it does](#what-it-does)
- [Where the content comes from](#where-the-content-comes-from)
- [Running it locally](#running-it-locally)
- [Project layout](#project-layout)
- [How the question engine works](#how-the-question-engine-works)
- [How the progression engine works](#how-the-progression-engine-works)
- [Adding or editing a certification](#adding-or-editing-a-certification)
- [Adding a service, concept or question template](#adding-a-service-concept-or-question-template)
- [Storage and the optional sync layer](#storage-and-the-optional-sync-layer)
- [Deploying to GitHub Pages](#deploying-to-github-pages)
- [Certification data as of 18 August 2026](#certification-data-as-of-18-august-2026)
- [Licence and disclaimer](#licence-and-disclaimer)

---

## What it does

**Roadmap** — all eleven active certifications laid out as a skill tree, banded by tier, with the
common progression paths drawn between them. Nodes show locked / ready / in-progress / mastered
state, current readiness and accuracy. Mastering a certification lights up the paths leading out of
it and surfaces a "suggested next" card explaining *why* that exam follows on.

**Per-certification dashboard** — readiness ring, a radar chart and bar breakdown of accuracy
**by AWS's real published exam domains and weightings** (not invented categories), weak-spot list,
official exam facts, and links to the official exam page and exam guide.

**Study modes**

| Mode | What it does |
| --- | --- |
| Quiz | 10 (or 20) generated questions, domain-weighted to match the real exam split |
| Flashcards | Every in-scope service and concept: purpose, use cases, gotchas, commonly-confused points, billing basis |
| Weak spots | A quiz built only from topics you have previously missed |
| Domain drill | Pick one exam domain and quiz only that |

**Members** — several people can share one browser. Each member keeps their own progress, weak
spots, streak and roadmap state; switching member switches the whole app. A leaderboard ranks
everyone by certifications mastered, average readiness, questions answered, accuracy or current
streak, with a podium for the top three. Members are created, renamed, recoloured and removed from
the Members page, and the header chip shows who the app is currently recording for.

Accuracy ranking ignores anyone with fewer than 20 answers — a 3-for-3 start is not a 100% record.

**Profile** — study streak, activity heatmap, per-certification table, and JSON export/import so you
can move progress between browsers. Export covers every member on the device.

Also: dark mode (saved, defaults to your OS setting), full keyboard support in quiz and flashcard
modes, and a layout that works from 375 px up.

---

## Where the content comes from

This project deliberately uses **only legitimate public sources**:

- **Official AWS exam guides** on `docs.aws.amazon.com/aws-certification` — the source for every
  exam code, domain name, domain weighting, question count, passing score and duration in
  `certifications.json`.
- **Per-certification pages** on `aws.amazon.com/certification` — prices, durations, retirement notices.
- **AWS service overview pages and service FAQs** — the source for plain-English service
  descriptions and the "commonly confused" points, since AWS writes FAQs specifically to address
  misconceptions.
- **The AWS Well-Architected Framework** whitepaper — pillars, resilience and cost concepts.
- **AWS's own official sample-question PDFs** were consulted only to model the *style* of stem
  phrasing (scenario-first, one best answer). No sample text or scenario was copied.

**No exam-dump content is used anywhere in this project.** Sites that republish reported live exam
questions violate the AWS certification agreement candidates sign, and building a question bank from
them would defeat the point of a generator — it optimises for recognising memorised items rather
than understanding the material. If you contribute, do not paste content from such sites.

Where a value could not be confirmed from an official page it is `null` in the data and rendered as
`—` in the UI, rather than guessed. (Currently: duration and price for AIP-C01.)

---

## Running it locally

The app is plain ES modules, so it must be served over HTTP — opening `index.html` from the file
system will make the browser block the `data/*.json` fetches.

```bash
python -m http.server 8766 --directory docs
```

Then open <http://localhost:8766>. Any static server works equally well:

```bash
npx serve docs
```

### Testing the question engine without a browser

`docs/js/generator.js` has no DOM or network dependencies, so it can be exercised straight from Node:

```bash
node tools/test-generator.mjs
```

That prints ten generated questions for every certification with the correct answer marked, checks
each one for malformed output (empty stem, duplicate options, missing explanation), and reports the
domain spread over a 60-question sample against each exam's real weighting. Pass a code and a count
to focus on one exam:

```bash
node tools/test-generator.mjs SAA-C03 25
```

---

## Project layout

```
.
├── docs/                     ← everything GitHub Pages serves
│   ├── index.html
│   ├── css/styles.css
│   ├── data/                 ← hand-editable; the engine never hardcodes content
│   │   ├── certifications.json   exam metadata, domains + weightings, in-scope services, paths
│   │   ├── services.json         services, concepts, scenario groups, shared-responsibility rows
│   │   └── templates.json        question templates and their stems
│   └── js/
│       ├── app.js            bootstrap, data loading, theme, route dispatch
│       ├── router.js         hash router
│       ├── store.js          progressStore + member roster — the ONLY module that touches storage
│       ├── generator.js      the question engine (pure, Node-testable)
│       ├── progression.js    readiness, unlock state, roadmap graph layout (pure)
│       ├── charts.js         hand-rolled SVG radar / bars / ring / heatmap
│       ├── icons.js          inline SVG icon set
│       └── views/            roadmap, cert, quiz, flashcards, members, profile
├── tools/test-generator.mjs  standalone engine smoke test
└── README.md
```

Data and logic are strictly separated: you can rewrite every JSON file without touching a line of
engine code, and the engine takes all three files as plain objects.

---

## How the question engine works

`buildEngine({ services, certifications, templates })` returns an object whose main method is
`generateQuiz({ certCode, count, domainId, entityIds, stats, seed })`.

**Entities.** Services (`services.json → services`) and core concepts (`→ concepts`) are merged into
one pool of *entities*. Each carries `tags` (`security`, `cost`, `resilience`, …), a `purpose`
phrased as a verb clause, `useCases`, `facts` (true statements) and `myths` (a false claim, an em
dash, then the correction). Splitting true from false statements explicitly is what makes
true/false and "which is NOT true" questions safe to generate — nothing is inferred.

**Scope.** A certification lists its in-scope service ids in `scope`. Concepts are pulled in
automatically when their tags overlap any of that certification's domain tags.

**Domain-first selection.** For each question the engine picks an **exam domain first**, weighted by
AWS's published percentage, then picks an entity from the entities tagged for that domain. A long
quiz therefore mirrors the real exam's balance rather than the balance of the data.

**Templates.** `templates.json` declares template kinds, which tiers they suit, their relative
weight, and several interchangeable stems. The engine implements one builder per kind:

| Kind | Shape |
| --- | --- |
| `service-purpose` | "Which AWS service …?" — distractors preferentially same-category |
| `service-usecase` | "A company wants to …. Which service?" |
| `service-category` | Category identification |
| `true-false` | Asserts a `fact` (True) or a `myth`'s false half (False) |
| `odd-statement` | Three `facts` plus one `myth`; the myth is the answer |
| `scenario` | Driven by `scenarioGroups` — a need maps to one member, siblings become distractors |
| `shared-responsibility` | AWS / customer / shared, from `sharedResponsibility` |
| `pricing` | Billing basis, distractors from other services' billing bases |
| `concept-definition` | Concept identification |
| `category-odd-one-out` | Three services from one category plus one outsider |

Template kinds that need three plausible same-shape distractors are skipped automatically when a
domain's pool is too small, so thin domains still produce true/false and odd-statement questions.

**No repeats within a set.** Every generated question is keyed by
`template + entity + variant`; duplicate keys and duplicate stems are rejected and re-rolled.

**Spaced repetition.** `entityWeight()` scores each entity from stored stats:

```
unseen                       → 2.5
seen, never missed           → 1.0
seen, missed                 → 1 + missRate × 4 (+1 if the most recent attempt was a miss)
```

Those weights bias entity selection, so material you get wrong comes back sooner and material you
have never seen outranks material you have already answered correctly five times.

**Determinism.** Generation uses a seeded mulberry32 RNG. The same `seed` produces the same quiz,
which is what makes the Node test reproducible.

---

## How the progression engine works

**Readiness** (`certReadiness`) scores each domain as `accuracy × coverage`, where
`coverage = min(1, answered / confidentSample)` and `confidentSample` is 12. Those domain scores are
then combined using AWS's real domain weightings:

```
readiness = Σ (domainWeight / 100) × accuracy_d × coverage_d
```

The coverage factor is why three-out-of-three correct does not read as exam-ready: with 3 answers a
domain contributes at most a quarter of its weight.

**Mastery** requires all three of:

- readiness ≥ `masteryThreshold` (85)
- at least `minQuestionsForMastery` (40) questions answered for that certification
- no domain below `minQuestionsPerDomain` (5) answers

All four numbers live in `certifications.json → readiness`, so you can tune the bar without touching
code.

**Unlocking is a recommendation, never a gate.** AWS enforces no prerequisites, so neither does this
app: foundational exams are always available, any certification becomes `available` once one of its
`recommendedBefore` entries is mastered, and any certification can be started regardless via the
`manuallyStarted` flag. `locked` is purely a visual hint about the suggested order.

**Suggestions** (`suggestNext`) prioritise (1) certifications unlocked by something you just
mastered, using the `whyNext` copy authored per edge, (2) in-progress certifications near the line,
naming your weakest domain, then (3) the foundational entry points.

**The roadmap graph** (`buildGraph`) lays certifications out in tier bands, centres each row, and
emits cubic-bezier edge paths from every `unlocks` relationship. Below 900 px the view swaps to a
tier-grouped card stack with textual path hints.

---

## Adding or editing a certification

Everything lives in `docs/data/certifications.json`. Add an object to `certifications` with:

| Field | Notes |
| --- | --- |
| `code`, `name`, `shortName`, `tier` | `tier` must be a key of the top-level `tiers` object |
| `dataStatus` | `"full"` or `"stub"` — `stub` renders a "draft pool" badge |
| `url`, `examGuideUrl` | Official AWS pages, shown on the dashboard |
| `tagline`, `targetCandidate` | One-liners for the dashboard header |
| `exam` | `minutes`, `questions`, `scoredQuestions`, `passingScore`, `scoreRange`, `priceUsd` — use `null` for anything you cannot confirm officially |
| `recommendedBefore` | Codes that should ideally come first (soft) |
| `unlocks` | Codes this one leads to — these become the roadmap edges |
| `whyNext` | `{ targetCode: "one sentence on why that follows" }` |
| `domains` | `id`, `number`, `name`, `weight`, `tags` — **copy the names and weights from the official exam guide** |
| `scope` | Array of ids from `services.json → services` |

`tags` on each domain are the join to the content: an entity appears in a domain when they share a
tag. Concepts are pulled in by tag automatically; services must also be listed in `scope`.

Nothing else needs changing — the roadmap, dashboards, drills and quizzes are all derived. If you
cannot confirm the domain weightings from an official guide, mark the certification
`"dataStatus": "stub"` rather than inventing numbers.

## Adding a service, concept or question template

**A service** — add to `docs/data/services.json → services`:

```json
{
  "id": "kebab-case-id",
  "name": "Amazon Example",
  "category": "compute",
  "tags": ["compute", "cost"],
  "purpose": "runs something useful without you managing servers",
  "useCases": ["do the obvious thing", "do the other thing"],
  "facts": ["A true statement people get wrong."],
  "myths": ["A false claim people believe — and the correction after an em dash."],
  "pricing": ["Per request", "Per GB-second"]
}
```

Rules that matter: `purpose` must read as a verb clause (it is spliced into "Which AWS service
*{purpose}*?"), `facts` must be **true**, and each `myths` entry must be
`false claim` + ` — ` + `correction` — the generator splits on that em dash to build both the
question and its explanation.

Then add the id to the `scope` array of every certification that covers it.

**A concept** — same shape, into `concepts`, with `"category": "concept"` and no `scope` entry
needed; tag overlap alone puts it in play.

**A scenario group** — into `scenarioGroups`. Each member maps a service to a list of `needs`; the
generator turns a need into the stem and the other members into distractors. A group needs at least
four in-scope members to be used.

**A template** — into `docs/data/templates.json`. Reusing an existing `kind` with new `stems` needs
no code. A genuinely new `kind` also needs a builder function in the `builders` map in
`generator.js`; it receives `(rng, entity, template, pool, ctx)` and returns
`{ stem, options, correctIndex, explanation }` or `null` when the entity lacks the data.

After any data edit, run `node tools/test-generator.mjs` — it will catch duplicate options, empty
stems and domains that can no longer produce questions.

---

## Storage and the optional sync layer

All state — per-certification progress, weak spots, streaks, theme — is in `localStorage` under the
`awsstudy:v1:` prefix, namespaced per **member** and then per certification:

```
awsstudy:v1:members                     roster + which member is active
awsstudy:v1:u:<memberId>:cert:SAA-C03   that member's progress on one exam
awsstudy:v1:u:<memberId>:profile        that member's streak, totals and day counts
awsstudy:v1:prefs                       device level (theme)
```

`store.ensureRoster()` handles two cases automatically: a fresh install gets a default member named
"You", and an install predating the members feature has its `awsstudy:v1:cert:*` and
`awsstudy:v1:profile` keys migrated into that first member rather than orphaned.

**Every read and write goes through `docs/js/store.js`.** Its methods are async on purpose, even
though localStorage is synchronous, so a network-backed adapter is a drop-in. The bottom of that
file is a single line:

```js
export const progressStore = createProgressStore(new LocalStorageAdapter());
```

To add cross-device sync later, write an adapter exposing `get`, `set`, `remove` and `keys`, and
change that one line. Nothing else in the app touches storage. The members layer is deliberately
shaped like an account system — a roster of identities, progress keyed by identity id, and a
`memberSummary()` that is a pure function — so cloud accounts replace the roster rather than
requiring the rest of the app to change. Reasonable free-tier options:

- **Firebase (Firestore + Auth)** — easiest bolt-on to a static site; client SDK via a script tag, no server.
- **Supabase** — Postgres-backed with a client SDK; more setup, nicer if you later want relational data.
- **Cloudflare Workers + KV or D1** — best if you want a little server-side logic, such as a leaderboard.

None of these are implemented; the architecture just does not preclude them. Until then, Profile →
Export/Import moves progress between browsers as a JSON file.

---

## Deploying to GitHub Pages

The app is served from **`/docs` on the `main` branch** — the repository root stays clean for the
README and tooling.

```bash
git init
git add .
git commit -m "AWS Certification Trainer: procedural quiz engine and progression roadmap"
git branch -M main
```

Create the repository on GitHub (either through the web UI at <https://github.com/new>, or with the
GitHub CLI):

```bash
gh repo create aws-certification-trainer --public --source=. --remote=origin --push
```

If you created it through the web UI instead, add the remote and push by hand:

```bash
git remote add origin https://github.com/<your-username>/aws-certification-trainer.git
git push -u origin main
```

Then enable Pages:

1. Open the repository on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Set **Branch** to `main` and the folder to **`/docs`**. Click **Save**.
4. Wait for the green tick on the Pages settings screen (usually under a minute), then visit
   `https://<your-username>.github.io/aws-certification-trainer/`.

No build step, no workflow file and no `.nojekyll` file are needed — there are no underscore-prefixed
paths for Jekyll to skip. Subsequent pushes to `main` redeploy automatically.

---

## Working across machines

The repository is <https://github.com/KingKag3/aws-certification-trainer>, deployed from `main`
`/docs`. `CHANGELOG.md` records what was built and when each AWS certification fact was verified;
`CLAUDE.md` carries the project invariants so an agent picks up the same constraints on any machine.

**First time on a new PC:**

```bash
git clone https://github.com/KingKag3/aws-certification-trainer.git
```

Then serve it and run the engine test to confirm the checkout is sound:

```bash
python -m http.server 8766 --directory docs
```

```bash
node tools/test-generator.mjs
```

**Every session after that — pull before you start:**

```bash
git pull --rebase
```

**Push when you finish:**

```bash
git add -A && git commit -m "your message" && git push
```

`--rebase` keeps history linear, which matters when the same project is edited from two machines:
without it, pulling after committing locally creates a merge bubble every single time.

If you edited on both machines and the pull stops with a conflict, resolve the files, then:

```bash
git add -A && git rebase --continue
```

Progress data (members, streaks, accuracy, weak spots) is **not** in the repository — it lives in
each browser's `localStorage`. To carry it between machines, use Profile → **Export all members** on
one and **Import progress** on the other, or add one of the sync backends described above.

---

## Certification data as of 18 August 2026

Verified against the official AWS exam guides on the date shown. **Re-check before booking** — AWS
renames, replaces and retires exams regularly.

| Tier | Certification | Code | Domains |
| --- | --- | --- | --- |
| Foundational | Cloud Practitioner | CLF-C02 | 24 / 30 / 34 / 12 |
| Foundational | AI Practitioner | AIF-C01 | 20 / 24 / 28 / 14 / 14 |
| Associate | Solutions Architect | SAA-C03 | 30 / 26 / 24 / 20 |
| Associate | Developer | DVA-C02 | 32 / 26 / 24 / 18 |
| Associate | CloudOps Engineer | SOA-C03 | 22 / 22 / 22 / 16 / 18 |
| Associate | Data Engineer | DEA-C01 | 34 / 26 / 22 / 18 |
| Associate | Machine Learning Engineer | MLA-C01 | 28 / 26 / 22 / 24 |
| Professional | Solutions Architect | SAP-C02 | 26 / 29 / 25 / 20 |
| Professional | DevOps Engineer | DOP-C02 | 22 / 17 / 15 / 15 / 14 / 17 |
| Professional | Generative AI Developer | AIP-C01 | 31 / 26 / 20 / 12 / 11 |
| Specialty | Security | SCS-C03 | 16 / 14 / 18 / 20 / 18 / 14 |

Recent changes reflected in the data:

- **SysOps Administrator – Associate was renamed CloudOps Engineer – Associate** (SOA-C02 → SOA-C03).
- **Security – Specialty SCS-C02 retired on 1 December 2025**, replaced by SCS-C03, whose domain 6 is
  now "Security Foundations and Governance".
- **Machine Learning – Specialty (MLS-C01) retired on 31 March 2026**, replaced in the AI path by
  MLA-C01 and the new AIP-C01.
- **Generative AI Developer – Professional (AIP-C01)** is new; its duration and price were not
  published on the pages read, so they show as `—`.
- **Advanced Networking – Specialty (ANS-C01) has a final exam date of 25 August 2026** and is
  therefore **omitted** from this roadmap. Its record is kept in the `retired` array in
  `certifications.json` if you want to add it back.
- **MLA-C02** has been announced (registration from 1 September 2026, MLA-C01 English available
  through 28 September 2026). The app still carries MLA-C01.

---

## Licence and disclaimer

Not affiliated with, endorsed by, or sponsored by Amazon Web Services. AWS, Amazon Web Services and
the names of AWS services and certifications are trademarks of Amazon.com, Inc. or its affiliates.

The "readiness" and "mastered" states are this application's own estimates, computed from generated
practice questions. They are **not** a prediction that you will pass the real exam. Always study
against AWS's official exam guide for your certification.
