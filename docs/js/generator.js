/**
 * Procedural question generator.
 *
 * This module is deliberately free of DOM and network calls so it can be
 * imported and exercised directly from Node (see tools/test-generator.mjs).
 * Everything it needs arrives as plain data through buildEngine().
 */

/* ------------------------------------------------------------------ */
/* Deterministic RNG                                                    */
/* ------------------------------------------------------------------ */

/** mulberry32 — small, fast, seedable. Same seed always yields the same quiz. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Weighted pick. `weightOf` returns a non-negative number for each item. */
function pickWeighted(rng, items, weightOf) {
  let total = 0;
  const weights = items.map((it) => {
    const w = Math.max(0, weightOf(it));
    total += w;
    return w;
  });
  if (total <= 0) return pick(rng, items);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function sentence(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ */
/* Engine construction                                                  */
/* ------------------------------------------------------------------ */

/**
 * @param {object} data { services, certifications, templates } — the three parsed JSON files.
 */
export function buildEngine(data) {
  const { services: svcFile, certifications: certFile, templates: tplFile } = data;

  const categories = svcFile.categories;
  const services = svcFile.services.map((s) => ({ ...s, kind: 'service' }));
  const concepts = (svcFile.concepts || []).map((c) => ({ ...c, kind: 'concept' }));
  const entities = [...services, ...concepts];
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const certByCode = new Map(certFile.certifications.map((c) => [c.code, c]));

  const scenarioGroups = svcFile.scenarioGroups || [];
  const sharedResponsibility = svcFile.sharedResponsibility || [];
  const templates = tplFile.templates;
  const responsibilityOptions = tplFile.responsibilityOptions;

  /** Every entity a given certification can draw on. */
  function scopeFor(certCode) {
    const cert = certByCode.get(certCode);
    if (!cert) return [];
    const scopeIds = new Set(cert.scope || []);
    const domainTags = new Set(cert.domains.flatMap((d) => d.tags));
    const inScope = [];
    for (const e of entities) {
      if (e.kind === 'service') {
        if (scopeIds.has(e.id)) inScope.push(e);
      } else if ((e.tags || []).some((t) => domainTags.has(t))) {
        inScope.push(e);
      }
    }
    return inScope;
  }

  /**
   * Map an entity onto one of the certification's domains.
   * Domains that share a tag with the entity win; ties break on domain weight.
   */
  function domainFor(certCode, entity, rng) {
    const cert = certByCode.get(certCode);
    const tags = new Set(entity.tags || []);
    const matches = cert.domains.filter((d) => d.tags.some((t) => tags.has(t)));
    const pool = matches.length ? matches : cert.domains;
    return pickWeighted(rng, pool, (d) => d.weight);
  }

  function entitiesForDomain(certCode, domainId) {
    const cert = certByCode.get(certCode);
    const domain = cert.domains.find((d) => d.id === domainId);
    if (!domain) return scopeFor(certCode);
    const wanted = new Set(domain.tags);
    return scopeFor(certCode).filter((e) => (e.tags || []).some((t) => wanted.has(t)));
  }

  /* ---------------------------------------------------------------- */
  /* Per-kind question builders                                        */
  /* Each returns a question, or null when the entity lacks the data.  */
  /* ---------------------------------------------------------------- */

  function distractorServices(rng, entity, pool, n) {
    const others = pool.filter((e) => e.id !== entity.id && e.kind === 'service');
    const sameCat = others.filter((e) => e.category === entity.category);
    const chosen = [];
    const takeFrom = (list) => {
      for (const c of shuffle(rng, list)) {
        if (chosen.length >= n) break;
        if (!chosen.some((x) => x.id === c.id)) chosen.push(c);
      }
    };
    // Same-category distractors make the question discriminate; fill the rest broadly.
    takeFrom(sameCat);
    takeFrom(others);
    return chosen;
  }

  function makeChoice(rng, stem, correctText, distractorTexts, explanation, extra) {
    const options = shuffle(rng, [
      { text: correctText, correct: true },
      ...distractorTexts.map((t) => ({ text: t, correct: false })),
    ]).map((o, i) => ({ ...o, id: `o${i}` }));
    return {
      stem,
      options,
      correctIndex: options.findIndex((o) => o.correct),
      explanation,
      ...extra,
    };
  }

  const builders = {
    'service-purpose'(rng, entity, tpl, pool) {
      if (entity.kind !== 'service' || !entity.purpose) return null;
      const d = distractorServices(rng, entity, pool, 3);
      if (d.length < 3) return null;
      const stem = pick(rng, tpl.stems).replace('{purpose}', entity.purpose);
      const explanation = `${sentence(tpl.explanationLead.replace('{name}', entity.name).replace('{purpose}', entity.purpose))}${gotcha(rng, entity)}`;
      return makeChoice(rng, stem, entity.name, d.map((x) => x.name), explanation);
    },

    'service-usecase'(rng, entity, tpl, pool) {
      if (entity.kind !== 'service' || !entity.useCases?.length) return null;
      const d = distractorServices(rng, entity, pool, 3);
      if (d.length < 3) return null;
      const useCase = pick(rng, entity.useCases);
      const stem = pick(rng, tpl.stems).replace('{useCase}', useCase);
      const explanation = `${sentence(entity.name + ' ' + entity.purpose)}.${gotcha(rng, entity)}`;
      return makeChoice(rng, stem, entity.name, d.map((x) => x.name), explanation, { variant: useCase });
    },

    'service-category'(rng, entity, tpl, pool) {
      if (entity.kind !== 'service') return null;
      const correct = categories[entity.category];
      if (!correct) return null;
      const otherKeys = Object.keys(categories).filter((k) => k !== entity.category && k !== 'concept');
      if (otherKeys.length < 3) return null;
      const d = shuffle(rng, otherKeys).slice(0, 3).map((k) => categories[k].label);
      const stem = pick(rng, tpl.stems).replace('{name}', entity.name);
      const explanation = sentence(
        tpl.explanationLead
          .replace('{name}', entity.name)
          .replace('{categoryLabel}', correct.label)
          .replace('{purpose}', entity.purpose || '')
      );
      return makeChoice(rng, stem, correct.label, d, explanation);
    },

    'true-false'(rng, entity, tpl) {
      const facts = entity.facts || [];
      const myths = entity.myths || [];
      const useTrue = facts.length && (!myths.length || rng() < 0.5);
      const source = useTrue ? facts : myths;
      if (!source.length) return null;
      const raw = pick(rng, source);
      // A myth is stored as "<false claim> — <correction>". Only the claim is asserted.
      const claim = useTrue ? raw : raw.split(' — ')[0];
      const correction = useTrue ? '' : ` ${sentence(raw.split(' — ')[1] || '')}`;
      const stem = pick(rng, tpl.stems).replace('{statement}', claim);
      const explanation = `${tpl.explanationLead.replace('{name}', entity.name)} ${useTrue ? claim : 'that claim is false.' + correction}`;
      return makeChoice(rng, stem, useTrue ? 'True' : 'False', [useTrue ? 'False' : 'True'], explanation.trim(), {
        variant: claim,
      });
    },

    'odd-statement'(rng, entity, tpl) {
      const facts = entity.facts || [];
      const myths = entity.myths || [];
      if (facts.length < 3 || !myths.length) return null;
      const raw = pick(rng, myths);
      const falseClaim = raw.split(' — ')[0];
      const correction = raw.split(' — ')[1] || '';
      const trueOnes = shuffle(rng, facts).slice(0, 3);
      const stem = pick(rng, tpl.stems).replace('{name}', entity.name);
      const explanation = `${tpl.explanationLead.replace('{name}', entity.name)} ${sentence(correction)}`;
      return makeChoice(rng, stem, falseClaim, trueOnes, explanation.trim(), { variant: falseClaim });
    },

    scenario(rng, entity, tpl, pool, ctx) {
      const group = ctx.group;
      if (!group) return null;
      const member = ctx.member;
      const need = ctx.need;
      const others = group.members.filter((m) => m.service !== member.service);
      if (others.length < 3) return null;
      const distractors = shuffle(rng, others)
        .slice(0, 3)
        .map((m) => entityById.get(m.service))
        .filter(Boolean);
      if (distractors.length < 3) return null;
      const stem = pick(rng, tpl.stems).replace('{need}', need);
      const explanation = `${sentence(entity.name + ' ' + entity.purpose)}.${gotcha(rng, entity)}`;
      return makeChoice(rng, stem, entity.name, distractors.map((x) => x.name), explanation, { variant: need });
    },

    'shared-responsibility'(rng, entity, tpl, pool, ctx) {
      const row = ctx.row;
      if (!row) return null;
      const correct = responsibilityOptions.find((o) => o.value === row.owner);
      const d = responsibilityOptions.filter((o) => o.value !== row.owner).map((o) => o.label);
      const stem = pick(rng, tpl.stems).replace('{item}', lowerFirst(row.item));
      const explanation = `${tpl.explanationLead} ${sentence(row.item)} falls to ${correct.label.toLowerCase()}.`;
      return makeChoice(rng, stem, correct.label, d, explanation, { variant: row.item });
    },

    pricing(rng, entity, tpl, pool) {
      if (entity.kind !== 'service' || !entity.pricing?.length) return null;
      const correct = entity.pricing.join('; ');
      const others = pool.filter(
        (e) => e.kind === 'service' && e.id !== entity.id && e.pricing?.length && e.pricing.join(';') !== entity.pricing.join(';')
      );
      if (others.length < 3) return null;
      const d = shuffle(rng, others).slice(0, 3).map((e) => e.pricing.join('; '));
      const stem = pick(rng, tpl.stems).replace('{name}', entity.name);
      const explanation = `${tpl.explanationLead.replace('{name}', entity.name)} ${correct}.${gotcha(rng, entity)}`;
      return makeChoice(rng, stem, correct, d, explanation);
    },

    'concept-definition'(rng, entity, tpl, pool) {
      if (entity.kind !== 'concept' || !entity.purpose) return null;
      const others = pool.filter((e) => e.kind === 'concept' && e.id !== entity.id);
      if (others.length < 3) return null;
      const d = shuffle(rng, others).slice(0, 3).map((e) => e.name);
      const stem = pick(rng, tpl.stems).replace('{purpose}', entity.purpose);
      const explanation = `${sentence(entity.name + ' ' + entity.purpose)}.${gotcha(rng, entity)}`;
      return makeChoice(rng, stem, entity.name, d, explanation);
    },

    'category-odd-one-out'(rng, entity, tpl, pool) {
      if (entity.kind !== 'service') return null;
      const sameCat = pool.filter((e) => e.kind === 'service' && e.category === entity.category && e.id !== entity.id);
      const otherCat = pool.filter((e) => e.kind === 'service' && e.category !== entity.category);
      if (sameCat.length < 3 || !otherCat.length) return null;
      const odd = pick(rng, otherCat);
      const label = categories[entity.category].label;
      const stem = pick(rng, tpl.stems).replace('{categoryLabel}', label);
      const three = shuffle(rng, sameCat).slice(0, 3);
      const explanation = `${odd.name} is a ${categories[odd.category].label} service; ${three
        .map((s) => s.name)
        .join(', ')} are all ${label} services.`;
      return makeChoice(rng, stem, odd.name, three.map((s) => s.name), explanation, {
        entityOverride: odd.id,
        variant: `${entity.category}:${odd.id}`,
      });
    },
  };

  function lowerFirst(s) {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  function gotcha(rng, entity) {
    const facts = entity.facts || [];
    if (!facts.length) return '';
    return ` ${pick(rng, facts)}`;
  }

  /* ---------------------------------------------------------------- */
  /* Public generation API                                             */
  /* ---------------------------------------------------------------- */

  /**
   * @param {object} opts
   *   certCode   required
   *   count      how many questions (default 10)
   *   domainId   restrict to one exam domain
   *   entityIds  restrict to these entities (weak-spot review)
   *   stats      { [entityId]: { seen, missed } } for spaced-repetition weighting
   *   seed       number, for reproducible quizzes
   */
  function generateQuiz(opts) {
    const {
      certCode,
      count = 10,
      domainId = null,
      entityIds = null,
      stats = {},
      seed = randomSeed(),
    } = opts;

    const cert = certByCode.get(certCode);
    if (!cert) throw new Error(`Unknown certification: ${certCode}`);

    const rng = makeRng(seed);
    const tier = cert.tier;
    const tierTemplates = templates.filter((t) => t.tiers.includes(tier));
    const fullScope = scopeFor(certCode);

    // Restrict the whole run when the caller asked for one domain or for a
    // specific set of entities (weak-spot review).
    const restrictTo = entityIds?.length ? new Set(entityIds) : null;
    const applyRestriction = (list) => {
      if (!restrictTo) return list;
      const kept = list.filter((e) => restrictTo.has(e.id));
      return kept.length ? kept : list;
    };

    const activeDomains = (domainId ? cert.domains.filter((d) => d.id === domainId) : cert.domains)
      .map((d) => ({ domain: d, pool: applyRestriction(entitiesForDomain(certCode, d.id)) }))
      .filter((d) => d.pool.length);

    const globalPool = applyRestriction(domainId ? entitiesForDomain(certCode, domainId) : fullScope);
    if (!globalPool.length) return { certCode, domainId, seed, questions: [], exhausted: true };

    // Kinds that need three plausible same-shape distractors from the pool.
    const needsDistractorPool = new Set(['service-purpose', 'service-usecase', 'pricing', 'category-odd-one-out']);

    const sharedRows = fullScope.some((e) => e.id === 'shared-responsibility-model') ? sharedResponsibility : [];

    const questions = [];
    const usedKeys = new Set();
    const usedStems = new Set();
    let attempts = 0;
    const maxAttempts = count * 80;

    while (questions.length < count && attempts < maxAttempts) {
      attempts++;

      // Pick the exam domain FIRST, weighted by AWS's published weighting, so a
      // long quiz mirrors the real exam's balance instead of the data's balance.
      const slot = activeDomains.length
        ? pickWeighted(rng, activeDomains, (d) => d.domain.weight)
        : { domain: cert.domains[0], pool: globalPool };
      const pool = slot.pool;
      const services = pool.filter((e) => e.kind === 'service');

      const eligible = tierTemplates.filter((t) => !(needsDistractorPool.has(t.kind) && services.length < 4));
      if (!eligible.length) continue;
      const tpl = pickWeighted(rng, eligible, (t) => t.weight);

      let entity = null;
      const ctx = {};

      if (tpl.kind === 'scenario') {
        const ids = new Set(pool.map((e) => e.id));
        const groups = scenarioGroups
          .filter((g) => !g.tiers || g.tiers.includes(tier))
          .map((g) => ({ ...g, members: g.members.filter((m) => ids.has(m.service)) }))
          .filter((g) => g.members.length >= 4);
        if (!groups.length) continue;
        const group = pick(rng, groups);
        const member = pickWeighted(rng, group.members, (m) => entityWeight(m.service, stats));
        entity = entityById.get(member.service);
        Object.assign(ctx, { group, member, need: pick(rng, member.needs) });
      } else if (tpl.kind === 'shared-responsibility') {
        if (!sharedRows.length) continue;
        entity = entityById.get('shared-responsibility-model');
        if (!pool.some((e) => e.id === entity?.id)) continue;
        ctx.row = pick(rng, sharedRows);
      } else {
        entity = pickWeighted(rng, pool, (e) => entityWeight(e.id, stats));
      }
      if (!entity) continue;

      const build = builders[tpl.kind];
      if (!build) continue;
      const built = build(rng, entity, tpl, tpl.kind === 'scenario' ? fullScope : pool, ctx);
      if (!built) continue;

      const entityId = built.entityOverride || entity.id;
      const key = `${tpl.id}:${entityId}:${built.variant || ''}`;
      if (usedKeys.has(key)) continue;
      if (usedStems.has(built.stem)) continue;
      usedKeys.add(key);
      usedStems.add(built.stem);

      const domain = slot.domain;

      questions.push({
        id: `q${questions.length + 1}-${seed}-${attempts}`,
        certCode,
        templateId: tpl.id,
        kind: tpl.kind,
        kindLabel: tpl.label,
        entityId,
        entityName: entityById.get(entityId)?.name || entity.name,
        domainId: domain.id,
        domainName: domain.name,
        domainNumber: domain.number,
        stem: built.stem,
        options: built.options.map((o) => ({ id: o.id, text: o.text })),
        correctIndex: built.correctIndex,
        explanation: built.explanation,
        tags: entity.tags || [],
      });
    }

    return {
      certCode,
      domainId,
      seed,
      questions,
      exhausted: questions.length < count,
    };
  }

  /**
   * Spaced repetition: an entity you have missed comes back more often, and one
   * you have never seen outranks one you answered correctly five times.
   */
  function entityWeight(entityId, stats) {
    const s = stats[entityId];
    if (!s || !s.seen) return 2.5; // unseen material is worth showing
    const missRate = s.missed / s.seen;
    const recencyBoost = s.lastMissedAt && s.lastMissedAt >= (s.lastSeenAt || 0) ? 1 : 0;
    return 1 + missRate * 4 + recencyBoost;
  }

  return {
    categories,
    entities,
    entityById,
    certByCode,
    certifications: certFile.certifications,
    certMeta: certFile,
    scopeFor,
    entitiesForDomain,
    domainFor,
    generateQuiz,
    entityWeight,
  };
}
