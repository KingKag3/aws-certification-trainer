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

/* ------------------------------------------------------------------ */
/* Real exam attempts                                                  */
/* ------------------------------------------------------------------ */

/** AWS certifications are valid for three years from the date you pass. */
export const CERT_VALID_YEARS = 3;

export function attemptsFor(attempts, certCode) {
  return (attempts || [])
    .filter((a) => a.certCode === certCode)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/**
 * A real pass is ground truth, unlike the app's own readiness estimate.
 * Returns the most recent passing attempt plus its expiry, or null.
 */
export function certificationOf(attempts, certCode, now = new Date()) {
  const passed = attemptsFor(attempts, certCode).filter((a) => a.result === 'pass');
  if (!passed.length) return null;
  const latest = passed[0];
  if (!latest.date) return { attempt: latest, expiresOn: null, expired: false, daysLeft: null };
  const [y, m, d] = latest.date.split('-').map(Number);
  const expires = new Date(y + CERT_VALID_YEARS, m - 1, d);
  const daysLeft = Math.round((expires - now) / 86400000);
  return {
    attempt: latest,
    expiresOn: `${expires.getFullYear()}-${String(expires.getMonth() + 1).padStart(2, '0')}-${String(expires.getDate()).padStart(2, '0')}`,
    expired: daysLeft < 0,
    daysLeft,
    expiringSoon: daysLeft >= 0 && daysLeft <= 90,
  };
}

/** Every topic flagged as a pitfall on a real attempt for this certification. */
export function pitfallIds(attempts, certCode) {
  const out = new Set();
  for (const a of attemptsFor(attempts, certCode)) {
    for (const id of a.pitfalls || []) out.add(id);
  }
  return [...out];
}

/**
 * Folds real-exam pitfalls into the spaced-repetition stats the generator uses,
 * so a topic that caught you out in the actual exam comes back in practice —
 * even if you have never missed it in a quiz here.
 */
export function statsWithPitfalls(entityStats, ids, at = Date.now()) {
  if (!ids?.length) return entityStats || {};
  const out = { ...(entityStats || {}) };
  for (const id of ids) {
    const s = out[id] || { seen: 0, missed: 0, lastSeenAt: 0, lastMissedAt: 0 };
    out[id] = {
      ...s,
      seen: s.seen + 2,
      missed: s.missed + 2,
      lastMissedAt: Math.max(s.lastMissedAt || 0, at),
    };
  }
  return out;
}

/**
 * Unlocking is a recommendation, never a hard gate — AWS enforces no
 * prerequisites, so every certification stays startable via `manuallyStarted`.
 */
export function certStatus(cert, progress, masteredCodes, config, certifiedCodes = new Set()) {
  // A real pass outranks any estimate this app could make.
  if (certifiedCodes.has(cert.code)) return 'certified';
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
export function buildProgressionState(certData, progressByCert, attempts = []) {
  const config = certData.readiness;
  const certs = certData.certifications;

  const readiness = {};
  for (const cert of certs) {
    readiness[cert.code] = certReadiness(cert, progressByCert[cert.code] || { domains: {} }, config);
  }

  // Real passes first: they are evidence, not estimate, and they unlock successors.
  const certifications = {};
  const certifiedCodes = new Set();
  for (const cert of certs) {
    const c = certificationOf(attempts, cert.code);
    if (c) {
      certifications[cert.code] = c;
      if (!c.expired) certifiedCodes.add(cert.code);
    }
  }

  // Mastery has to settle before status, because mastery unlocks successors.
  const masteredCodes = new Set();
  for (const cert of certs) {
    const p = progressByCert[cert.code] || {};
    if (isMastered(cert, p, readiness[cert.code], config)) masteredCodes.add(cert.code);
  }

  // A real pass counts as mastery for unlocking purposes.
  const unlockCodes = new Set([...masteredCodes, ...certifiedCodes]);

  const status = {};
  for (const cert of certs) {
    status[cert.code] = certStatus(cert, progressByCert[cert.code] || {}, unlockCodes, config, certifiedCodes);
  }

  return { config, certs, readiness, status, masteredCodes, certifiedCodes, certifications, unlockCodes, attempts };
}

/* ------------------------------------------------------------------ */
/* Member summary — one row of the leaderboard                         */
/* ------------------------------------------------------------------ */

/**
 * Rolls one member's per-certification records plus their profile into the
 * figures the members page ranks on. Pure, so the same function serves the
 * local roster today and a cloud roster later.
 */
export function memberSummary(member, certData, progressByCert, profile, now = new Date(), attempts = []) {
  const state = buildProgressionState(certData, progressByCert, attempts);
  const certs = certData.certifications;

  let answered = 0;
  let correct = 0;
  let lastStudiedAt = 0;
  let started = 0;
  const readinessValues = [];

  for (const cert of certs) {
    const p = progressByCert[cert.code] || {};
    answered += p.answered || 0;
    correct += p.correct || 0;
    if (p.answered) started++;
    if (p.lastStudiedAt && p.lastStudiedAt > lastStudiedAt) lastStudiedAt = p.lastStudiedAt;
    readinessValues.push(state.readiness[cert.code].overall);
  }

  const mastered = state.masteredCodes.size;
  const bestCert = certs
    .map((c) => ({ cert: c, readiness: state.readiness[c.code] }))
    .filter((x) => x.readiness.answered > 0)
    .sort((a, b) => b.readiness.overall - a.readiness.overall)[0] || null;

  return {
    member,
    state,
    answered,
    correct,
    accuracy: answered ? Math.round((correct / answered) * 100) : 0,
    started,
    mastered,
    // Real certifications earned — passes only. Failed attempts stay private.
    certified: state.certifiedCodes.size,
    inProgress: certs.filter((c) => state.status[c.code] === 'in-progress').length,
    // Averaged across every certification, so breadth counts as well as depth.
    avgReadiness: Math.round(readinessValues.reduce((a, b) => a + b, 0) / (certs.length || 1)),
    peakReadiness: Math.max(0, ...readinessValues),
    bestCert,
    streak: currentStreakFrom(profile, now),
    longestStreak: profile.longestStreak || 0,
    daysStudied: Object.keys(profile.days || {}).length,
    lastStudiedAt,
  };
}

/** Local copy of the streak rule so progression.js stays free of store imports. */
function currentStreakFrom(profile, now) {
  if (!profile?.lastStudyDate) return 0;
  const toUtc = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const gap = Math.round((toUtc(today) - toUtc(profile.lastStudyDate)) / 86400000);
  return gap <= 1 ? profile.streak || 0 : 0;
}

export const LEADERBOARD_SORTS = {
  certified: {
    label: 'Certifications earned',
    compare: (a, b) =>
      (b.certified || 0) - (a.certified || 0) || b.mastered - a.mastered || b.answered - a.answered,
    format: (s) =>
      `${s.certified || 0} certified${s.certified ? '' : ' — no exams passed yet'}`,
  },
  mastered: {
    label: 'Certs mastered',
    compare: (a, b) => b.mastered - a.mastered || b.avgReadiness - a.avgReadiness || b.answered - a.answered,
    format: (s) => `${s.mastered} mastered`,
  },
  readiness: {
    label: 'Average readiness',
    compare: (a, b) => b.avgReadiness - a.avgReadiness || b.answered - a.answered,
    format: (s) => `${s.avgReadiness}% avg readiness`,
  },
  answered: {
    label: 'Questions answered',
    compare: (a, b) => b.answered - a.answered || b.accuracy - a.accuracy,
    format: (s) => `${s.answered} answered`,
  },
  accuracy: {
    // Guard against someone topping the board on three lucky answers.
    compare: (a, b) => {
      const qualify = (s) => (s.answered >= 20 ? 1 : 0);
      return qualify(b) - qualify(a) || b.accuracy - a.accuracy || b.answered - a.answered;
    },
    label: 'Accuracy',
    format: (s) => `${s.accuracy}% accuracy${s.answered < 20 ? ' (unranked, under 20 answers)' : ''}`,
  },
  streak: {
    label: 'Current streak',
    compare: (a, b) => b.streak - a.streak || b.longestStreak - a.longestStreak || b.answered - a.answered,
    format: (s) => `${s.streak} day streak`,
  },
};

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
  const { certs, status, readiness, config } = state;
  const unlockCodes = state.unlockCodes || state.masteredCodes;
  const byCode = new Map(certs.map((c) => [c.code, c]));
  const out = [];
  const seen = new Set();

  const add = (code, reason, kind) => {
    if (!code || seen.has(code) || unlockCodes.has(code)) return;
    const cert = byCode.get(code);
    if (!cert) return;
    seen.add(code);
    out.push({ code, cert, reason, kind, readiness: readiness[code] });
  };

  for (const cert of certs) {
    if (!unlockCodes.has(cert.code)) continue;
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

/**
 * Entities you have got wrong, worst first. Drives the weak-spots quiz.
 * Topics flagged as pitfalls on a real exam attempt are included and pinned to
 * the top, even if you have never missed them in practice here.
 */
export function weakEntities(progress, engine, limit = 40, pitfalls = []) {
  const pitfallSet = new Set(pitfalls);
  const stats = progress.entities || {};
  const ids = new Set([...Object.keys(stats).filter((id) => stats[id].missed > 0), ...pitfallSet]);

  const entries = [...ids]
    .map((id) => {
      const s = stats[id] || { seen: 0, missed: 0, lastSeenAt: 0, lastMissedAt: 0 };
      return {
        id,
        name: engine.entityById.get(id)?.name || id,
        ...s,
        missRate: s.seen ? s.missed / s.seen : 1,
        fromExam: pitfallSet.has(id),
      };
    })
    .sort(
      (a, b) =>
        Number(b.fromExam) - Number(a.fromExam) || b.missRate - a.missRate || b.missed - a.missed
    );
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
