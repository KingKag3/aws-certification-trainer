# Changelog

All notable changes to this project are recorded here. Dates are the date the work was done, and
the AWS certification data notes record *when* each fact was verified against an official AWS page —
that matters, because AWS renames, replaces and retires exams on its own schedule.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.6.0] — 2026-08-19

Video coverage sweep: **27 verified videos to 109**, out of 138 topics.

### Changed

- Ran the trusted-channel search across all 111 entries that were on a search-link fallback.
  98 candidates came back; **19 were rejected by hand** before anything was written:
  - *Wrong topic:* AWS Artifact matched a CodePipeline **artifacts** video — a different thing entirely.
  - *Narrow sub-feature rather than an intro:* SQS matched FIFO-queues-only, Athena matched
    "Athena for Apache Spark", MSK matched "MSK Connect", MemoryDB matched Multi-Region, X-Ray
    matched "X-Ray Insights", CDK matched a .NET-specific walkthrough, FSx matched only the NetApp
    ONTAP variant of what is a family of file systems.
  - *Too long or too dated for a first-contact link:* API Gateway (43 min), Encryption
    (re:Invent 2017, 58 min), Infrastructure as code (re:Invent **2014**, 39 min).
  - *Contradicts our own content:* the Well-Architected video says **five** pillars; there are six.
- The surviving 79 all had channel and title confirmed through YouTube's oEmbed endpoint. Zero
  failed verification. A second targeted pass added Polly, X-Ray and MSK, for 82 new in total.
- **Fallbacks now search AWS's own channel** (`youtube.com/@amazonwebservices/search?query=…`)
  rather than all of YouTube, so even an unverified link stays inside the trusted-source rule.
  Label changed from "Search YouTube / No verified video yet" to "Browse AWS's channel for this /
  No single verified video covers it yet".

### Still on a fallback (29)

Mostly cross-cutting concepts that no single video covers — loose coupling, caching strategy,
tagging, service quotas, capex vs opex, the 7 Rs — plus the services listed above where the only
trusted matches were sub-features. A search link is the honest answer for these; a
plausible-but-wrong video would be worse.

---

## [0.5.1] — 2026-08-19

Discoverability and layout fixes for the exam log, from direct feedback: "if I
can't find it, I can't imagine a user being able to find it."

### Added

- **Exams page** (`views/exams.js`, `#/exams`) and a top-level **Exams** nav entry. The exam log was
  previously reachable only by picking a certification first and then finding the sixth card in the
  study-modes row — effectively hidden. The new page shows current certifications, attempts across
  every exam, expiry warnings, and a one-click picker that deep-links into any exam's log with the
  form already open (`?new=1`).
- A prominent **"Sat the real exam?"** button under the readiness ring on each certification
  dashboard, so the entry point exists where someone would look for it.

### Fixed

- **Pass/fail radios rendered broken.** `.field input { width: 100% }` also matched the radio
  buttons, stretching each to the full width of the fieldset and pushing its label to the far right.
  Text inputs are now selected with `:not([type='radio']):not([type='checkbox'])`, and the control
  was rebuilt as a proper two-button segmented toggle.
- **`:has(input:checked)` did not re-invalidate.** The first styling attempt used
  `.radio:has(input:checked)`; changing the selection updated `color` and `font-weight` but left
  `background` and `border-color` frozen on whichever option painted first, so both buttons could
  look selected at once. Rewritten as `input:checked + .radio-face`, a plain adjacent-sibling
  selector. Verified by toggling in both directions and reading computed styles.

---

## [0.5.0] — 2026-08-19

Real exam attempts. Until now everything the app knew was its own estimate; a logged pass or fail is
ground truth, and a fail now changes what you get drilled on.

### Added

- **Exam log** per certification (`views/attempts.js`, `#/cert/<code>/attempts`): date, pass/fail,
  scaled score, free-text notes, and **pitfalls** chosen from that exam's own in-scope services and
  concepts. Attempts are editable and deletable, and sync to the cloud like everything else because
  they go through `store.js`.
- **Pitfalls feed practice.** `statsWithPitfalls()` folds flagged topics into the spaced-repetition
  weighting the generator already used. Measured over 40 quizzes of 30 questions: pitfall topics
  appeared 62 times with the boost against 28 without — **2.2× more likely to be drilled**. They are
  also pinned to the top of Weak spots with a "real exam" tag, even if never missed in practice here.
- **`certified` status**, ranked above the app's own `mastered`. A pass shows a green Certified node
  on the roadmap, a banner on the dashboard, and unlocks the exams that follow — a real pass is
  better evidence than any estimate this app can compute.
- **Three-year expiry tracking.** AWS certifications lapse after three years, so the banner shows the
  expiry date, warns at 90 days out, and marks an expired certification as no longer current (it
  stops counting toward unlocks and the leaderboard).
- **Leaderboard: passes only.** A `certified` count is published and a "Certifications earned" sort
  added. Failed attempts, scores and notes never leave the owner's account.
- Attempt history summary on the Profile page, across all certifications.

### Changed

- `firestore.rules` — `certified` added to the leaderboard's allowed-field list and range-checked.
  **The rules must be re-published in the Firebase console**, otherwise `hasOnly()` rejects the new
  field and leaderboard writes fail silently.
- `buildProgressionState()` now takes attempts and exposes `certifiedCodes`, `certifications` and
  `unlockCodes`. Unlocking uses mastered ∪ certified.

### Fixed

- Typing in the pitfall search box re-rendered the entire attempt form, wiping the date, result and
  score already entered, and stealing focus mid-keystroke. The search input is now rendered once and
  only the results and chips below it redraw. Caught by filling the form before searching, which is
  the natural order and the one that lost data.

---

## [0.4.0] — 2026-08-19

Cloud accounts. People on their own devices can now sign up and appear on a shared leaderboard,
which local profiles could never do.

### Added

- **`cloud.js`** — Firebase Authentication (email/password) plus a Firestore-backed storage adapter
  implementing the same `get/set/remove/keys` contract as the localStorage adapter.
- **`firebase-config.js`** — project config for `aws-cert-trainer-202be`, with an `FIREBASE_ENABLED`
  switch that disables cloud entirely and falls back to local profiles.
- **`firestore.rules`** — the file that actually protects the data. Progress documents are private to
  their owner; the leaderboard is a separate summary document readable by any signed-in user and
  writable only by its subject, with field and range validation so nobody can post a large or
  malformed blob into a shared collection. Anonymous access is denied everywhere.
- **Sign in / create account / password reset / sign out** on the Members page, with Firebase error
  codes translated into readable sentences.
- **Shared leaderboard** across every signed-in user, using the same sort options as the local board.
- **"Bring local progress with you"** — after signing in, any local profile with study history can be
  copied into the account. Cloud progress that is already further along is never overwritten.
- `store.setAdapter()` — the runtime seam the architecture was built around. Signing in swaps the
  backend and nothing else in the app changes; an account simply becomes the member.

### Design decisions

- **The SDK is lazy-loaded.** `firebase-app`, `firebase-auth` and `firebase-firestore` are imported
  from Google's CDN only when someone signs in or a previous session is restored. Verified: a visitor
  on the Members page who does not sign in triggers **zero** external requests, so the offline and
  strict-CSP behaviour of the local path is unchanged. This preserves the project's no-dependencies
  invariant for everyone not using cloud.
- **One read per session, not one per key.** Signing in fetches the user's entire `users/{uid}/data`
  collection once and serves all later reads from memory. Firestore's free tier bills per document
  read, and the app reads all 11 certification records on every route render — per-key round trips
  would have burned quota for nothing.
- **Only a summary is shared.** What you answered, got wrong and how ready you are stays private;
  the leaderboard document carries display name, colour, totals, accuracy, mastered count and streak.
- **Device preferences stay local.** Theme is per-device even when signed in.
- Leaderboard writes are fingerprinted and skipped when unchanged, rather than written per answer.

### Notes

- The Firebase web config is committed deliberately. It identifies the project; it does not grant
  access, and it is designed to ship in client code. `firestore.rules` and the authorised-domain list
  are what enforce access. This is not the same thing as a service-account key, which is a secret.
- Two console steps are required before cloud sign-in works on the deployed site: publishing
  `firestore.rules`, and adding the deployment domain under Authentication → Settings → Authorised
  domains. Firebase seeds that list with `localhost` and the `*.firebaseapp.com` / `*.web.app`
  domains only.
- Connectivity was verified without creating an account, by confirming that a deliberately incorrect
  sign-in returns `auth/invalid-credential` — which proves the config resolves and the
  Email/Password provider is enabled, since a disabled provider returns `auth/operation-not-allowed`.

---

## [0.3.0] — 2026-08-18

A teaching layer. The app previously only tested knowledge; it now explains each topic the first
time someone meets it, assuming no cloud background at all.

### Added — content

- **`beginner` field on all 138 entries** (115 services, 23 concepts) in `services.json`: a two-to-four
  sentence plain-English explanation built around an everyday analogy, with no jargon. Deliberately
  separate from `facts`, which remain the deeper follow-up layer.
- **Video fields on every entry**: `videoUrl`, `videoTitle`, `videoChannel`, `videoIsSearchFallback`.
- **Per-certification `startHereVideo`** for a full free course.
- `beginnerLayer` metadata block in both data files recording the verification rule and date.
- `beginnerLayerTodo` on all nine stub certifications, noting that they currently share the CLF/SAA
  explanations and still need their own pass.

### Added — UI

- **Concepts page** (`views/concepts.js`, `#/cert/<code>/concepts`): a glossary readable start to
  finish, grouped by the exam's real domains and then by service category, with a sticky domain
  contents bar and a "drill this domain" link per section. Linked as the first study mode from each
  certification dashboard.
- **Flashcards**: the beginner explanation and video link now sit at the top of the card back, above
  a divider, with the technical gotchas below.
- **Quiz answer screens**: a collapsed-by-default "Explain this like I'm new" section.
- `learn.js` — shared rendering so all three surfaces present the layer identically.

### Video verification — and why it was not skipped

Videos come only from four channels: Amazon Web Services, freeCodeCamp.org, Stephane Maarek and
ExamPro. **Every specific video URL had its channel and title confirmed via YouTube's oEmbed endpoint
before being written to the data.** 27 entries carry a verified video; the remaining 111 carry a
labelled YouTube search link and are styled differently.

This was not ceremony. The first candidate a web search returned for "Stephane Maarek S3" was
`Ns3KyQnSeVQ`, which on verification proved to be published by "Learn With Udemy Course" — a
re-upload on an untrusted channel — and covered **CLF-C01**, the retired exam version. Two further
candidates were rejected the same way. Note also that `WebFetch` cannot verify YouTube at all (the
page is JS-rendered and returns only the footer), so verification has to happen in a real browser.

One video was rejected for accuracy rather than provenance: AWS's own "The Five Pillars of the AWS
Well-Architected Framework" contradicts the app's own content, which correctly says six — Sustainability
was added in 2021. That entry uses a search link instead.

The seeded course video for Cloud Practitioner was also changed. The originally supplied
`3hLmDS179YE` verified as genuine freeCodeCamp, but is the **2020** course, i.e. CLF-C01 era. It was
replaced with `NhDYbskXRgc`, freeCodeCamp's CLF-C02 course, verified the same way. The SAA-C03 seed
`c3Cn4xYfxJY` verified correctly and was kept.

### Fixed

- Concepts page overflowed horizontally at 375 px: the non-wrapping video title forced the grid track
  wider than the viewport. Fixed with `minmax(0, 1fr)` tracks, `min-width: 0` on the entry, and
  ellipsis on the video subtitle.

---

## [0.2.0] — 2026-08-18

Members and a leaderboard. Several people can now share one browser, each keeping their own
progress, with a ranked board across them. Still entirely local — this is the first half of a
two-step plan, with cloud accounts to follow once a Firebase project exists.

### Added

- **Member roster** in `store.js`. Storage keys are now namespaced per member:
  `awsstudy:v1:u:<memberId>:cert:<CODE>` and `awsstudy:v1:u:<memberId>:profile`, with the roster and
  active member in `awsstudy:v1:members`. Device-level preferences (theme) stay global.
  - `ensureRoster()` creates a default member named "You" on a fresh install, and **migrates**
    pre-members keys (`awsstudy:v1:cert:*`, `awsstudy:v1:profile`) into that first member so
    existing progress is adopted rather than orphaned.
  - Added `addMember`, `renameMember`, `setMemberColor`, `removeMember`, `setActiveMember`,
    `getCertFor`, `allCertsFor`, `getProfileFor` and `clearMemberProgress`. Removing a member
    deletes every key belonging to them; the last remaining member cannot be removed.
- **Members page** (`views/members.js`): roster with add / rename / recolour / remove / switch, and
  a leaderboard sortable by certifications mastered, average readiness, questions answered,
  accuracy or current streak, with a three-place podium.
  - Accuracy ranking excludes members with fewer than 20 answers, so a 3-for-3 start cannot top the
    board. They are still listed, labelled "unranked".
- **`memberSummary()` and `LEADERBOARD_SORTS`** in `progression.js` — pure, so the same code will
  serve a cloud roster later.
- Header now carries a **member chip** showing who progress is being recorded for, linking to the
  members page, plus a Members nav entry.
- Profile page is titled with the active member's name, and gained a "Reset this member" action
  distinct from "Clear everything". Export now explicitly covers every member on the device.

### Fixed

- Header overflowed horizontally at 375 px once the Members link and member chip were added. Added
  staged breakpoints at 820 / 640 / 430 px that shed the brand subtitle, then the chip's name text,
  then the brand wordmark. Verified no horizontal scroll on any page at 375, 768 and desktop widths.

### Notes

- Members are local to one browser. Progress still does not sync between devices; Profile →
  Export/Import remains the way to move it. The roster is shaped deliberately like an account system
  so that cloud accounts replace it without touching the rest of the app.
- Free-tier costs were checked before choosing this path: Firebase Spark (50k reads / 20k writes per
  day, no card required, stops rather than bills on quota) and Supabase Free (500 MB, 50k MAU, no
  card) are both effectively free at this scale. Supabase pauses a project after 7 days of database
  inactivity, which suits a burst-used study app poorly — Firebase is the intended target when the
  cloud step happens.

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

[0.6.0]: https://github.com/KingKag3/aws-certification-trainer/releases/tag/v0.6.0
[0.5.1]: https://github.com/KingKag3/aws-certification-trainer/releases/tag/v0.5.1
[0.5.0]: https://github.com/KingKag3/aws-certification-trainer/releases/tag/v0.5.0
[0.4.0]: https://github.com/KingKag3/aws-certification-trainer/releases/tag/v0.4.0
[0.3.0]: https://github.com/KingKag3/aws-certification-trainer/releases/tag/v0.3.0
[0.2.0]: https://github.com/KingKag3/aws-certification-trainer/releases/tag/v0.2.0
[0.1.0]: https://github.com/KingKag3/aws-certification-trainer/releases/tag/v0.1.0
