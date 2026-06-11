import { generateHTML } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import {
  PROFICIENCY_LEVELS,
  type Observation,
  type ProficiencyLevel,
  type Rubric,
  type TiptapDoc,
} from '@ops/shared';
import { ComponentTagMark } from './component-tag-mark.js';
import { colorFor } from './component-colors.js';
import { extractTaggedSpansForComponent } from './extract-script-tags.js';

const TIPTAP_EXTENSIONS = [StarterKit, Link, ComponentTagMark];

const PROFICIENCY_LABEL: Record<ProficiencyLevel, string> = {
  developing: 'Developing',
  basic: 'Basic',
  proficient: 'Proficient',
  distinguished: 'Distinguished',
};

export interface RenderPayload {
  observation: Observation;
  rubric: Rubric;
  /**
   * Component IDs active for this observation's role/year combo.
   *
   * - `null`  — no mapping document exists → include every component in the
   *             rubric (fallback for roles that haven't been configured yet).
   * - `string[]` — mapping document exists; render only the listed IDs.
   *               An empty array means the role-year deliberately has no
   *               components assigned, so the PDF renders the empty-state
   *               message instead of the full rubric.
   */
  activeComponentIds: string[] | null;
}

/**
 * Render an observation to a self-contained HTML document for Puppeteer to
 * print. All styling lives inline; Google Fonts are loaded via @import in
 * the <style> block. Puppeteer's `waitUntil: 'networkidle0'` ensures fonts
 * arrive before the PDF snapshot.
 */
export function renderObservationHtml(payload: RenderPayload): string {
  const { observation, rubric, activeComponentIds } = payload;
  // null  → no mapping doc → include all components (unconfigured role-year).
  // []    → mapping exists, nothing assigned → allow is an empty Set so all
  //         components are filtered out and the empty-state message renders.
  // [...] → include only the listed component IDs.
  const allow = activeComponentIds !== null ? new Set(activeComponentIds) : null;
  const observationDate = formatDate(observation.observationDate);
  const finalizedDate = observation.finalizedAt ? formatDate(observation.finalizedAt) : '';

  const yearLabel =
    observation.observedYear < 4
      ? `Year ${String(observation.observedYear)}`
      : `P${String(observation.observedYear - 3)}`;

  const componentSections = rubric.domains
    .flatMap((domain) =>
      domain.components
        .filter((c) => !allow || allow.has(c.id))
        .map((component) => {
          const entry = observation.observationData[component.id];
          const notes = observation.componentNotes[component.id];
          const proficiency = entry?.proficiency ?? null;
          const lookFors = component.lookFors.filter((lf) =>
            entry?.selectedLookForIds.includes(lf.id),
          );
          const scriptSpans = extractTaggedSpansForComponent(observation.scriptDoc, component.id);
          const fallbackColor = colorFor(component);
          return `
            <section class="component">
              <header class="component-header">
                <p class="domain-label">Domain ${escapeHtml(domain.id)}: ${escapeHtml(domain.name)}</p>
                <h3>
                  <span class="component-id">${escapeHtml(component.id)}</span>
                  ${escapeHtml(component.title)}
                </h3>
              </header>
              <div class="proficiency-grid">
                ${PROFICIENCY_LEVELS.map((level) => {
                  const checked = proficiency === level;
                  return `
                    <div class="proficiency-cell ${checked ? 'is-checked' : ''}">
                      <p class="proficiency-label">${escapeHtml(PROFICIENCY_LABEL[level])}</p>
                      <p class="proficiency-text">${escapeHtml(
                        component.proficiencyLevels[level] || '—',
                      )}</p>
                    </div>
                  `;
                }).join('')}
              </div>
              ${
                lookFors.length > 0
                  ? `<div class="lookfors">
                      <h4>Look-fors observed</h4>
                      <ul>
                        ${lookFors.map((lf) => `<li>${escapeHtml(lf.text)}</li>`).join('')}
                      </ul>
                    </div>`
                  : ''
              }
              ${
                scriptSpans.length > 0
                  ? `<div class="notes-from-script">
                      <h4>From script</h4>
                      <ul>
                        ${scriptSpans
                          .map((span) => {
                            const bg = span.bg ?? fallbackColor.bg;
                            const fg = span.fg ?? fallbackColor.fg;
                            return `<li><mark style="background-color:${escapeHtml(bg)};color:${escapeHtml(fg)}">${escapeHtml(span.text)}</mark></li>`;
                          })
                          .join('')}
                      </ul>
                    </div>`
                  : ''
              }
              ${
                notes
                  ? `<div class="notes">
                      <h4>Notes</h4>
                      <div class="notes-body">${tiptapToHtml(notes)}</div>
                    </div>`
                  : ''
              }
            </section>
          `;
        }),
    )
    .join('');

  const scriptSection = observation.scriptDoc
    ? `<section class="script-section">
        <h2>Observation Script</h2>
        <div class="script-body">${tiptapToHtml(observation.scriptDoc)}</div>
      </section>`
    : '';

  const transcriptsSection =
    Object.keys(observation.transcripts).length > 0
      ? `<section class="transcripts-section">
          <h2>Audio Transcripts</h2>
          ${observation.audioDriveFileIds
            .map((id, i) => {
              const text = observation.transcripts[id];
              if (!text) return '';
              return `<div class="transcript">
                <h4>Recording ${String(i + 1)}</h4>
                <p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>
              </div>`;
            })
            .join('')}
        </section>`
      : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Peer Observation — ${escapeHtml(observation.observedName)}</title>
    <style>
      ${styles()}
    </style>
  </head>
  <body>
    <header class="cover">
      <p class="brand-mark">Orono Peer Observations</p>
      <h1>${escapeHtml(observation.observedName)}</h1>
      <dl class="meta">
        <dt>Role</dt><dd>${escapeHtml(observation.observedRole)} (${escapeHtml(yearLabel)})</dd>
        <dt>Buildings</dt><dd>${escapeHtml(observation.observedBuildings.join(', ') || '—')}</dd>
        <dt>Observer</dt><dd>${escapeHtml(observation.observerEmail)}</dd>
        <dt>Type</dt><dd>${escapeHtml(observation.type)}</dd>
        <dt>Observation date</dt><dd>${escapeHtml(observationDate)}</dd>
        ${finalizedDate ? `<dt>Finalized</dt><dd>${escapeHtml(finalizedDate)}</dd>` : ''}
        ${
          observation.observationName
            ? `<dt>Name</dt><dd>${escapeHtml(observation.observationName)}</dd>`
            : ''
        }
      </dl>
    </header>

    <main>
      ${componentSections || '<p class="empty">No components are assigned for this role/year combination.</p>'}
      ${scriptSection}
      ${transcriptsSection}
    </main>

    <footer>
      <p>Orono Public Schools · Peer Observations · Generated ${escapeHtml(formatDate(new Date()))}</p>
    </footer>
  </body>
</html>`;
}

function tiptapToHtml(doc: TiptapDoc): string {
  try {
    // Our schema uses `unknown[]` for content (opaque blob); Tiptap's
    // generateHTML wants the structural JSONContent shape. Runtime is
    // identical — cast at the boundary.
    return generateHTML(doc as Parameters<typeof generateHTML>[0], TIPTAP_EXTENSIONS);
  } catch {
    return '<p class="empty">—</p>';
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Date shapes the renderer may receive: real `Date`s (in-process callers),
 * ISO strings (the normalized JSON payload from finalizeObservation),
 * live Firestore Timestamps (`{toDate()}`), or the `{_seconds,_nanoseconds}`
 * / `{seconds,nanoseconds}` blobs an Admin SDK Timestamp degrades to when an
 * un-normalized payload is JSON-serialized over HTTP.
 */
type DateLike =
  | Date
  | string
  | { toDate: () => Date }
  | { _seconds: number; _nanoseconds?: number }
  | { seconds: number; nanoseconds?: number };

function coerceDate(value: DateLike | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  if ('toDate' in value) return value.toDate();
  if ('_seconds' in value) {
    return new Date(value._seconds * 1000 + Math.floor((value._nanoseconds ?? 0) / 1e6));
  }
  if ('seconds' in value) {
    return new Date(value.seconds * 1000 + Math.floor((value.nanoseconds ?? 0) / 1e6));
  }
  return null;
}

function formatDate(value: DateLike | null | undefined): string {
  const date = coerceDate(value);
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function styles(): string {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&family=Roboto:wght@300;400;500;700&display=swap');
    :root {
      --ops-blue-dark: #1d2a5d;
      --ops-blue: #2d3f89;
      --ops-blue-light: #4356a0;
      --ops-blue-lighter: #eaecf5;
      --ops-red: #ad2122;
      --ops-red-light: #c13435;
      --ops-red-lighter: #e5c7c7;
      --ops-gray-dark: #333333;
      --ops-gray: #666666;
      --ops-gray-lighter: #cccccc;
      --ops-gray-lightest: #f3f3f3;
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Roboto', Arial, sans-serif;
      color: var(--ops-gray-dark);
      font-size: 11pt;
      line-height: 1.45;
      margin: 0;
    }
    h1, h2, h3, h4 { font-family: 'Lexend', Arial, sans-serif; font-weight: 600; margin: 0; }
    h1 { font-size: 26pt; color: var(--ops-blue-dark); margin-bottom: 0.5em; }
    h2 { font-size: 18pt; color: var(--ops-blue-dark); margin-top: 1.2em; padding-bottom: 0.3em; border-bottom: 2px solid var(--ops-blue); }
    h3 { font-size: 14pt; color: var(--ops-blue-dark); }
    h4 { font-size: 11pt; color: var(--ops-red-light); margin-top: 1em; margin-bottom: 0.3em; text-transform: uppercase; letter-spacing: 0.05em; }
    p { margin: 0.4em 0; }
    .brand-mark {
      font-family: 'Lexend', sans-serif; font-weight: 700; font-size: 10pt;
      letter-spacing: 0.15em; text-transform: uppercase;
      color: var(--ops-red); margin-bottom: 0.5em;
    }
    .cover {
      padding: 1em 0 1.5em;
      border-bottom: 3px solid var(--ops-blue-dark);
      margin-bottom: 1em;
    }
    .meta { display: grid; grid-template-columns: max-content 1fr; gap: 0.3em 1em; margin-top: 1em; font-size: 10pt; }
    .meta dt { color: var(--ops-gray); font-weight: 500; }
    .meta dd { margin: 0; }
    .component {
      page-break-inside: avoid;
      margin: 1.5em 0;
      padding: 0.8em 1em;
      border: 1px solid var(--ops-gray-lighter);
      border-radius: 4px;
    }
    .component-header { margin-bottom: 0.5em; }
    .domain-label { font-size: 9pt; color: var(--ops-gray); text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
    .component-id { font-family: 'Roboto Mono', monospace; color: var(--ops-blue); margin-right: 0.4em; }
    .proficiency-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.4em;
      margin: 0.6em 0;
    }
    .proficiency-cell {
      padding: 0.5em 0.7em;
      border: 1px solid var(--ops-gray-lighter);
      border-radius: 3px;
      background: white;
    }
    .proficiency-cell.is-checked {
      background: var(--ops-blue-lighter);
      border-color: var(--ops-blue);
      border-width: 2px;
      padding: calc(0.5em - 1px) calc(0.7em - 1px);
    }
    .proficiency-label { font-weight: 600; font-size: 10pt; margin: 0 0 0.2em; color: var(--ops-blue-dark); }
    .proficiency-text { font-size: 9.5pt; color: var(--ops-gray-dark); margin: 0; }
    .lookfors ul { padding-left: 1.2em; margin: 0.3em 0; }
    .lookfors li { margin: 0.15em 0; font-size: 10pt; }
    .notes-body { font-size: 10pt; }
    .notes-body p { margin: 0.3em 0; }
    .notes-body ul, .notes-body ol { padding-left: 1.2em; margin: 0.3em 0; }
    .notes-body blockquote {
      border-left: 3px solid var(--ops-blue);
      padding-left: 0.8em;
      color: var(--ops-gray);
      margin: 0.4em 0;
    }
    mark[data-component-tag] {
      background: var(--ops-blue-lighter);
      color: var(--ops-blue-dark);
      padding: 0 2px;
      border-radius: 2px;
    }
    .notes-from-script { margin-top: 0.6em; }
    .notes-from-script h4 { margin: 0.2em 0 0.3em; font-size: 10pt; color: var(--ops-gray-dark); }
    .notes-from-script ul { list-style: none; padding: 0; margin: 0; }
    .notes-from-script li {
      margin: 0.2em 0;
      font-size: 10pt;
      line-height: 1.4;
    }
    .notes-from-script li mark {
      padding: 0.1em 0.3em;
      border-radius: 2px;
    }
    .script-section, .transcripts-section { margin-top: 2em; page-break-inside: auto; }
    .script-body { font-size: 10pt; }
    .transcript { margin: 0.8em 0; padding: 0.5em 0.8em; background: var(--ops-gray-lightest); border-radius: 3px; }
    .transcript h4 { margin-top: 0; }
    footer {
      margin-top: 2em;
      padding-top: 0.8em;
      border-top: 1px solid var(--ops-gray-lighter);
      font-size: 9pt;
      color: var(--ops-gray);
      text-align: center;
    }
    .empty { color: var(--ops-gray-light); font-style: italic; }
  `;
}
