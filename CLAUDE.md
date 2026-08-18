# AWS Certification Trainer — project notes

Static study app for every currently active AWS certification. Procedurally generated quizzes,
flashcards, and a progression roadmap. No build step, no runtime dependencies, no external network
requests. Deployed to GitHub Pages from `main` `/docs`.

Read `CHANGELOG.md` for the full history and for the dated AWS certification findings.

## Commands

```bash
# Local dev server (or use the "aws-study-guide" config in .claude/launch.json)
python -m http.server 8766 --directory docs

# Engine smoke test — run this after ANY edit to the data files or generator
node tools/test-generator.mjs

# One certification, more questions
node tools/test-generator.mjs SAA-C03 25
```

The app must be served over HTTP. Opening `docs/index.html` from the file system makes the browser
block the `data/*.json` fetches, and `app.js` shows an explanatory error when that happens.

## Layout

```
docs/            everything GitHub Pages serves
  data/          certifications.json, services.json, templates.json — hand-editable content
  js/
    generator.js   question engine (pure: no DOM, no network — this is why Node can test it)
    progression.js readiness, unlock state, roadmap graph (pure)
    store.js       progressStore — the ONLY module that touches storage
    charts.js      hand-rolled SVG radar / bars / ring / heatmap
    views/         roadmap, cert, quiz, flashcards, profile
tools/test-generator.mjs
```

## Invariants — do not break these

**Never use exam-dump content.** No ExamTopics, no braindump sites, no reported live exam questions.
It violates the AWS certification agreement and defeats the purpose of a generator. Sources are
AWS's official exam guides, service overview pages, service FAQs, and the Well-Architected
Framework whitepaper.

**Never invent exam metadata.** Domain names, weightings, question counts, passing scores, durations
and prices come from the official exam guide for that exam. If a value cannot be confirmed, use
`null` (renders as `—`) and mark the certification `"dataStatus": "stub"`. AIP-C01's duration and
price are `null` for exactly this reason.

**Data shape rules in `services.json`:**
- `purpose` must read as a verb clause — it is spliced into "Which AWS service *{purpose}*?"
- `facts` entries must be **true** statements.
- `myths` entries must be `false claim` + ` — ` (space em-dash space) + `correction`. The generator
  splits on that em dash to build both the question and its explanation. A malformed entry produces
  a broken question.

**`generator.js` and `progression.js` stay pure.** No DOM, no `fetch`, no storage access. The Node
test depends on this.

**All storage goes through `store.js`.** Its async API is deliberate so a cloud adapter can be
dropped in by changing one line at the bottom of that file. Do not call `localStorage` elsewhere.

**Charts stay hand-rolled SVG.** No Chart.js, no CDN — the app is intended to work offline and with
a strict CSP.

## Adding content

Adding a certification, a service, a concept, a scenario group or a question template is documented
in detail in `README.md`. Short version:

- New certification → object in `certifications.json`. Domain `tags` are the join to content;
  services must also be listed in that certification's `scope`, while concepts are pulled in by tag
  overlap alone.
- New service → object in `services.json → services`, then add its `id` to each covering
  certification's `scope`.
- New template stem for an existing `kind` → no code change.
- Genuinely new template `kind` → also needs a builder in the `builders` map in `generator.js`,
  signature `(rng, entity, template, pool, ctx)`, returning `{ stem, options, correctIndex,
  explanation }` or `null` when the entity lacks the data.

Always run `node tools/test-generator.mjs` afterwards — it catches duplicate options, empty stems,
and domains that can no longer produce questions.

## Gotcha when developing

`python -m http.server` sends no cache-control headers, so browsers aggressively cache ES modules.
If an edit does not appear, it is almost certainly the module cache, not the code. Restart the
server on a different port, or hard-reload with the network cache disabled.
