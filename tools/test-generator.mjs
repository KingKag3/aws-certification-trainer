/**
 * Standalone smoke test for the question engine — no browser required.
 *
 *   node tools/test-generator.mjs            # 10 questions for every certification
 *   node tools/test-generator.mjs SAA-C03    # 10 questions for one certification
 *   node tools/test-generator.mjs SAA-C03 25 # 25 questions
 *
 * Exits non-zero if any certification cannot fill a 10-question quiz or if any
 * generated question is malformed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildEngine } from '../docs/js/generator.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'docs', 'data');
const read = (f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));

const engine = buildEngine({
  services: read('services.json'),
  certifications: read('certifications.json'),
  templates: read('templates.json'),
});

const only = process.argv[2];
const count = Number(process.argv[3]) || 10;
const certs = engine.certifications.filter((c) => !only || c.code === only);
if (!certs.length) {
  console.error(`No certification matches "${only}".`);
  process.exit(1);
}

let failures = 0;

for (const cert of certs) {
  const scope = engine.scopeFor(cert.code);
  const quiz = engine.generateQuiz({ certCode: cert.code, count, seed: 20260818 });

  console.log('\n' + '='.repeat(78));
  console.log(`${cert.code}  ${cert.name}`);
  console.log(`tier: ${cert.tier}   data: ${cert.dataStatus}   in-scope entities: ${scope.length}`);
  console.log('='.repeat(78));

  if (quiz.questions.length < count) {
    console.log(`!! only produced ${quiz.questions.length}/${count} questions`);
    failures++;
  }

  quiz.questions.forEach((q, i) => {
    const problems = [];
    if (!q.stem) problems.push('empty stem');
    if (q.options.length < 2) problems.push('too few options');
    if (q.correctIndex < 0) problems.push('no correct option');
    if (new Set(q.options.map((o) => o.text)).size !== q.options.length) problems.push('duplicate options');
    if (!q.explanation) problems.push('no explanation');
    if (problems.length) {
      failures++;
      console.log(`\n!! Q${i + 1} MALFORMED: ${problems.join(', ')}`);
    }

    console.log(`\nQ${i + 1}. [D${q.domainNumber} ${q.domainName}] (${q.kindLabel})`);
    console.log(`    ${q.stem}`);
    q.options.forEach((o, oi) => {
      console.log(`      ${oi === q.correctIndex ? '>' : ' '} ${String.fromCharCode(65 + oi)}. ${o.text}`);
    });
    console.log(`    -> ${q.explanation}`);
  });

  // Domain coverage sanity check on a larger sample.
  const big = engine.generateQuiz({ certCode: cert.code, count: 60, seed: 7 });
  const perDomain = {};
  for (const q of big.questions) perDomain[q.domainId] = (perDomain[q.domainId] || 0) + 1;
  const coverage = cert.domains
    .map((d) => `D${d.number} ${perDomain[d.id] || 0}/${big.questions.length} (target ${d.weight}%)`)
    .join('  |  ');
  console.log(`\n    domain spread over 60: ${coverage}`);
  const uncovered = cert.domains.filter((d) => !perDomain[d.id]);
  if (uncovered.length) {
    console.log(`    !! no questions generated for: ${uncovered.map((d) => d.name).join(', ')}`);
  }
}

console.log('\n' + (failures ? `FAILED with ${failures} problem(s)` : 'All certifications generated clean quizzes.'));
process.exit(failures ? 1 : 0);
