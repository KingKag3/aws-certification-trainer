/**
 * Shared rendering for the beginner ("explain like I'm new") layer.
 *
 * Used by flashcards, quiz explanations and the Concepts page so all three
 * present the same content the same way.
 */
import { icon } from './icons.js';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * A link to a video. Two visually distinct cases:
 *   confirmed  — channel and title were verified before being written to the data
 *   fallback   — a YouTube search, because no trusted-channel video was confirmed
 */
export function videoLink(entry, { compact = false } = {}) {
  if (!entry?.videoUrl) return '';
  const fallback = entry.videoIsSearchFallback;
  return `<a class="video-link${fallback ? ' fallback' : ''}${compact ? ' compact' : ''}"
    href="${esc(entry.videoUrl)}" target="_blank" rel="noopener">
    ${icon(fallback ? 'search' : 'play', { size: 15 })}
    <span class="video-text">
      ${fallback
        ? `<strong>Search YouTube</strong><span class="video-sub">No verified video yet for this topic</span>`
        : `<strong>Watch: ${esc(entry.videoTitle)}</strong><span class="video-sub">${esc(entry.videoChannel)}</span>`}
    </span>
    ${icon('external', { size: 13, className: 'video-ext' })}
  </a>`;
}

/** The plain-English explanation block. */
export function beginnerBlock(entry, { heading = 'In plain English' } = {}) {
  if (!entry?.beginner) return '';
  return `<div class="beginner-block">
    <h4>${icon('sparkles', { size: 15 })} ${esc(heading)}</h4>
    <p>${esc(entry.beginner)}</p>
    ${videoLink(entry)}
  </div>`;
}

/** Collapsed-by-default variant, for quiz answer screens. */
export function beginnerDetails(entry, { open = false } = {}) {
  if (!entry?.beginner) return '';
  return `<details class="beginner-details"${open ? ' open' : ''}>
    <summary>${icon('sparkles', { size: 15 })} Explain this like I'm new</summary>
    <div class="beginner-details-body">
      <p>${esc(entry.beginner)}</p>
      ${videoLink(entry)}
    </div>
  </details>`;
}

/** The deeper technical layer, shown after the beginner text. */
export function gotchaBlock(entry, { collapsed = false } = {}) {
  const facts = entry.facts || [];
  const myths = entry.myths || [];
  if (!facts.length && !myths.length) return '';
  const body = `
    ${facts.length
      ? `<div class="flash-block"><h4>Gotchas worth remembering</h4><ul>${facts
          .map((f) => `<li>${esc(f)}</li>`)
          .join('')}</ul></div>`
      : ''}
    ${myths.length
      ? `<div class="flash-block myths"><h4>Commonly confused</h4><ul>${myths
          .map((m) => `<li>${esc(m)}</li>`)
          .join('')}</ul></div>`
      : ''}
    ${entry.pricing?.length
      ? `<div class="flash-block"><h4>Billed on</h4><p>${esc(entry.pricing.join(' · '))}</p></div>`
      : ''}`;

  if (!collapsed) return `<div class="gotcha-layer">${body}</div>`;
  return `<details class="gotcha-layer collapsed">
    <summary>The technical detail (${facts.length + myths.length} points)</summary>
    ${body}
  </details>`;
}

/**
 * Assigns an entity to exactly one exam domain for the Concepts page.
 * Deterministic: the heaviest-weighted domain sharing a tag wins, so the
 * glossary reads the same on every visit.
 */
export function primaryDomain(cert, entity) {
  const tags = new Set(entity.tags || []);
  const matches = cert.domains.filter((d) => d.tags.some((t) => tags.has(t)));
  const pool = matches.length ? matches : cert.domains;
  return pool.slice().sort((a, b) => b.weight - a.weight || a.number - b.number)[0];
}

/**
 * Groups a certification's in-scope entities by exam domain, in exam order,
 * then by service category within each domain.
 *
 * The sub-grouping matters: on Cloud Practitioner, domain 3 is literally
 * "Cloud Technology and Services", so almost every service lands there. Left
 * flat that is a hundred-item wall; split by category it reads as a contents page.
 */
export function groupByDomain(cert, entities, categories = {}) {
  const groups = new Map(cert.domains.map((d) => [d.id, { domain: d, entries: [] }]));
  for (const e of entities) {
    groups.get(primaryDomain(cert, e).id).entries.push(e);
  }

  return [...groups.values()]
    .filter((g) => g.entries.length)
    .sort((a, b) => a.domain.number - b.domain.number)
    .map((g) => {
      const byCat = new Map();
      for (const e of g.entries) {
        if (!byCat.has(e.category)) byCat.set(e.category, []);
        byCat.get(e.category).push(e);
      }
      const sections = [...byCat.entries()]
        .map(([key, entries]) => ({
          key,
          label: categories[key]?.label || key,
          icon: categories[key]?.icon || 'book',
          entries: entries.sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label));
      return { ...g, entries: g.entries.sort((a, b) => a.name.localeCompare(b.name)), sections };
    });
}
