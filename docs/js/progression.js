/**
 * Progression model: readiness scoring, unlock state and the roadmap graph.
 *
 * Pure functions over data — no DOM, no storage. The visuals in
 * views/roadmap.js consume whatever this produces.
 */

/* ------------------------------------------------------------------ */
/* Readiness                                                           */
/* ------------------------------------------------------------------ */

/**
 * Per-domain accuracy is discounted by how much evidence there is behind it, so
 * that "3 out of 3 correct" does not read as exam-ready. Once a domain has
 * `confidentSample` answers, accuracy counts at full value. Readiness is then
 * those domain scores weighted by AWS's own published domain weightings.
 */
export function certReadiness(cert, progress, config) {
  const sample = config.confidentSample ?? 12;
  const domains = cert.domains.map((d) => {
    const rec = progress.domains?.[d.id] || { answered: 0, correct: 0 };
    const accuracy = rec.answered ? rec.correct / rec.answered : 0;
    const coverage = Math.min(1, rec.answered / sample);
    const confident = accuracy * coverage;
    return {
      id: d.id,
      number: d.number,
      name: d.name,
      weight: d.weight,
      answered: rec.answered,
      correct: rec.correct,
      accuracy: Math.round(accuracy * 100),
      confidence: Math.round(confident * 100),
      thin: rec.answered < (config.minQuestionsPerDomain ?? 5),
    };
  });

  const overall = Math.round(domains.reduce((sum, d) => sum + (d.weight / 100) * (d.confidence / 100) * 100, 0));
  const accuracy = progress.answered ? Math.round((progress.correct / progress.answered) * 100) : 0;

  return {
    code: cert.code,
    overall,
    accuracy,
    answered: progress.answered || 0,
    correct: progress.correct || 0,
    domains,
    weakestDomain: domains.filter((d) => d.answered).sort((a, b) => a.accuracy - b.accuracy)[0] || null,
    strongestDomain: domains.filter((d) => d.answered).sort((a, b) => b.accuracy - a.accuracy)[0] || null,
  };
}

export function isMastered(cert, progress, readiness, config) {
  if (!progress.answered) return false;
  if (progress.answered < (config.minQuestionsForMastery ?? 40)) return false;
  if (readiness.domains.some((d) => d.thin)) return false;
  return readiness.overall >= (config.masteryThreshold ?? 85);
}

/**
 * Unlocking is a recommendation, never a hard gate — AWS enforces no
 * prerequisites, so every certification stays startable via `manuallyStarted`.
 */
export function certStatus(cert, progress, masteredCodes, config) {
  if (masteredCodes.has(cert.code)) return 'mastered';
  if (progress.answered > 0) return 'in-progress';
  // Foundational exams are the entry point — they never sit behind anything.
  if (cert.tier === 'foundational') return 'available';
  const prereqs = cert.recommendedBefore || [];
  if (!prereqs.length) return 'available';
  if (prereqs.some((p) => masteredCodes.has(p))) return 'available';
  if (progress.manuallyStarted) return 'available';
  return 'locked';
}

/** One pass over every certification, producing everything the views need. */
export function buildProgressionState(certData, progressByCert) {
  const config = certData.readiness;
  const certs = certData.certifications;

  const readiness = {};
  for (const cert of certs) {
    readiness[cert.code] = certReadiness(cert, progressByCert[cert.code] || { domains: {} }, config);
  }

  // Mastery has to settle before status, because mastery unlocks successors.
  const masteredCodes = new Set();
  for (const cert of certs) {
    const p = progressByCert[cert.code] || {};
    if (isMastered(cert, p, readiness[cert.code], config)) masteredCodes.add(cert.code);
  }

  const status = {};
  for (const cert of certs) {
    status[cert.code] = certStatus(cert, progressByCert[cert.code] || {}, masteredCodes, config);
  }

  return { config, certs, readiness, status, masteredCodes };
}

/* ------------------------------------------------------------------ */
/* Recommendations                                                     */
/* ------------------------------------------------------------------ */

/**
 * What to study next, in priority order:
 *   1. certifications unlocked by something you have mastered
 *   2. certifications already in progress and close to the line
 *   3. the foundational starting point when nothing has begun
 */
export function suggestNext(state, certData) {
  const { certs, status, readiness, masteredCodes, config } = state;
  const byCode = new Map(certs.map((c) => [c.code, c]));
  const out = [];
  const seen = new Set();

  const add = (code, reason, kind) => {
    if (!code || seen.has(code) || masteredCodes.has(code)) return;
    const cert = byCode.get(code);
    if (!cert) return;
    seen.add(code);
    out.push({ code, cert, reason, kind, readiness: readiness[code] });
  };

  for (const cert of certs) {
    if (!masteredCodes.has(cert.code)) continue;
    for (const nextCode of cert.unlocks || []) {
      const why = cert.whyNext?.[nextCode] || `${byCode.get(nextCode)?.name} builds on ${cert.shortName}.`;
      add(nextCode, why, 'unlocked');
    }
  }

  for (const cert of certs) {
    if (status[cert.code] !== 'in-progress') continue;
    const r = readiness[cert.code];
    const gap = (config.masteryThreshold ?? 85) - r.overall;
    const reason =
      gap <= 15
        ? `You are ${gap <= 0 ? 'at' : gap + ' points from'} the readiness threshold. ${r.weakestDomain ? `Weakest domain: ${r.weakestDomain.name} (${r.weakestDomain.accuracy}%).` : ''}`
        : `In progress at ${r.overall}% readiness. ${r.weakestDomain ? `Focus on ${r.weakestDomain.name}.` : 'Answer more questions to build a reliable estimate.'}`;
    add(cert.code, reason.trim(), 'continue');
  }

  if (!out.length) {
    const foundational = certs.filter((c) => c.tier === 'foundational');
    for (const c of foundational) {
      add(c.code, `${c.tagline} It assumes no prior AWS experience, so it is the usual entry point.`, 'start');
    }
  }

  return out.slice(0, 4);
}

/* ------------------------------------------------------------------ */
/* Weak spots                                                          */
/* ------------------------------------------------------------------ */

/** Entities you have got wrong, worst first. Drives the weak-spots quiz. */
export function weakEntities(progress, engine, limit = 40) {
  const entries = Object.entries(progress.entities || {})
    .map(([id, s]) => ({
      id,
      name: engine.entityById.get(id)?.name || id,
      ...s,
      missRate: s.seen ? s.missed / s.seen : 0,
    }))
    .filter((e) => e.missed > 0)
    .sort((a, b) => b.missRate - a.missRate || b.missed - a.missed);
  return entries.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Roadmap graph layout                                                */
/* ------------------------------------------------------------------ */

/**
 * Lays the certifications out as a tier-banded skill tree.
 * Returns node boxes and cubic-bezier edge paths in an SVG coordinate space;
 * the view scales that space to the viewport.
 */
export function buildGraph(certData, state, opts = {}) {
  const nodeW = opts.nodeW ?? 210;
  const nodeH = opts.nodeH ?? 96;
  const gapX = opts.gapX ?? 34;
  const gapY = opts.gapY ?? 118;
  const padX = opts.padX ?? 24;
  const padY = opts.padY ?? 56;

  const tiers = Object.entries(certData.tiers)
    .map(([id, t]) => ({ id, ...t }))
    .sort((a, b) => a.order - b.order);

  const rows = tiers.map((tier) => ({
    tier,
    certs: certData.certifications.filter((c) => c.tier === tier.id),
  }));

  const widest = Math.max(...rows.map((r) => r.certs.length), 1);
  const width = padX * 2 + widest * nodeW + (widest - 1) * gapX;

  const nodes = [];
  rows.forEach((row, rowIndex) => {
    const n = row.certs.length;
    const rowWidth = n * nodeW + (n - 1) * gapX;
    const startX = (width - rowWidth) / 2;
    const y = padY + rowIndex * (nodeH + gapY);
    row.certs.forEach((cert, i) => {
      nodes.push({
        cert,
        code: cert.code,
        tier: row.tier,
        x: startX + i * (nodeW + gapX),
        y,
        w: nodeW,
        h: nodeH,
        status: state.status[cert.code],
        readiness: state.readiness[cert.code],
      });
    });
  });

  const byCode = new Map(nodes.map((n) => [n.code, n]));
  const edges = [];
  for (const node of nodes) {
    for (const target of node.cert.unlocks || []) {
      const to = byCode.get(target);
      if (!to) continue;
      const x1 = node.x + node.w / 2;
      const y1 = node.y + node.h;
      const x2 = to.x + to.w / 2;
      const y2 = to.y;
      const mid = (y1 + y2) / 2;
      edges.push({
        from: node.code,
        to: to.code,
        d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,
        active: state.masteredCodes.has(node.code),
      });
    }
  }

  const height = padY * 2 + rows.length * nodeH + (rows.length - 1) * gapY;
  return { nodes, edges, rows, width, height, nodeW, nodeH, gapY, padY };
}
