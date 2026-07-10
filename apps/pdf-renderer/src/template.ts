import { generateHTML } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import {
  OBSERVATION_TYPES,
  PROFICIENCY_LEVELS,
  workProductAnswerHasText,
  type Observation,
  type ProficiencyLevel,
  type Rubric,
  type TiptapDoc,
  type WorkProductAnswer,
  type WorkProductQuestion,
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

/** Branding bits threaded from appSettings.branding so the archived PDF
 *  matches the web app and email look. Any field omitted/null falls back to
 *  the packaged OPS default — the PDF always renders something sensible
 *  even if branding has never been configured. */
export interface RenderBranding {
  appName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
}

export interface RenderPayload {
  observation: Observation;
  rubric: Rubric;
  /** Component IDs active for this observation's role/year combo. If empty,
   *  every component in the rubric is included. */
  activeComponentIds: string[];
  /** Question bank for Work Product / Instructional Round observations, in
   *  display order. The observation's `workProductAnswers` are matched to
   *  these by questionId. Absent/empty for Standard observations. */
  workProductQuestions?: Pick<WorkProductQuestion, 'questionId' | 'text'>[];
  /** appSettings.branding, forwarded verbatim by finalizeObservation. Omit
   *  to get the built-in OPS look (used by any caller that hasn't been
   *  updated, and by the small handful of Puppeteer smoke tests). */
  branding?: RenderBranding;
}

const DEFAULT_APP_NAME = 'Orono Peer Observations';
const DEFAULT_PRIMARY_COLOR = '#2d3f89';
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Resolve branding against OPS defaults — never trust caller-provided
 *  fields blindly (a malformed/empty string must not break page rendering). */
function resolveBranding(branding: RenderBranding | undefined): {
  appName: string;
  logoUrl: string | null;
  primaryColor: string;
} {
  const appName = (branding?.appName?.trim() ?? '') || DEFAULT_APP_NAME;
  const logoUrl = (branding?.logoUrl?.trim() ?? '') || null;
  const primaryColor =
    branding?.primaryColor && HEX_COLOR_RE.test(branding.primaryColor)
      ? branding.primaryColor
      : DEFAULT_PRIMARY_COLOR;
  return { appName, logoUrl, primaryColor };
}

/** Mix a hex color toward white (amount 0-1) or black (negative amount) —
 *  used to derive the lighter/darker shades the template's CSS variables
 *  expect from a single admin-configured primary color. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const mix = (channel: number): number => {
    const target = amount >= 0 ? 255 : 0;
    const v = Math.round(channel + (target - channel) * Math.abs(amount));
    return Math.max(0, Math.min(255, v));
  };
  const toHex = (v: number): string => v.toString(16).padStart(2, '0');
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

/**
 * Render an observation to a self-contained HTML document for Puppeteer to
 * print. All styling lives inline; Google Fonts are loaded via @import in
 * the <style> block. Puppeteer's `waitUntil: 'networkidle0'` ensures fonts
 * arrive before the PDF snapshot.
 */
export function renderObservationHtml(payload: RenderPayload): string {
  const { observation, rubric, activeComponentIds } = payload;
  const brand = resolveBranding(payload.branding);
  const allow = activeComponentIds.length > 0 ? new Set(activeComponentIds) : null;
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

  const isQuestionType =
    observation.type === OBSERVATION_TYPES.workProduct ||
    observation.type === OBSERVATION_TYPES.instructionalRound;
  const responsesSection = isQuestionType
    ? renderResponsesSection(observation, payload.workProductQuestions ?? [])
    : '';

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
      ${styles(brand.primaryColor)}
    </style>
  </head>
  <body>
    <header class="cover">
      ${
        brand.logoUrl
          ? `<img class="brand-logo" src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.appName)}" />`
          : `<p class="brand-mark">${escapeHtml(brand.appName)}</p>`
      }
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
      ${responsesSection}
      ${componentSections || (isQuestionType ? '' : '<p class="empty">No components are assigned for this role/year combination.</p>')}
      ${scriptSection}
      ${transcriptsSection}
    </main>

    <footer>
      <p>Orono Public Schools · ${escapeHtml(brand.appName)} · Generated ${escapeHtml(formatDate(new Date()))}</p>
    </footer>
  </body>
</html>`;
}

/**
 * Q&A section for Work Product / Instructional Round observations. Renders
 * every provided question in order (answered or not), then any leftover
 * answers whose question no longer exists in the question bank — the PDF is
 * the permanent record, so recorded answers must never be dropped silently.
 */
function renderResponsesSection(
  observation: Observation,
  questions: Pick<WorkProductQuestion, 'questionId' | 'text'>[],
): string {
  const answerMap = new Map<string, WorkProductAnswer['answer']>();
  for (const a of observation.workProductAnswers ?? []) {
    answerMap.set(a.questionId, a.answer);
  }
  const knownIds = new Set(questions.map((q) => q.questionId));
  const orphanedAnswers = (observation.workProductAnswers ?? []).filter(
    (a) => !knownIds.has(a.questionId) && workProductAnswerHasText(a.answer),
  );

  const items = [
    ...questions.map((q, i) =>
      renderResponse(`${String(i + 1)}. ${q.text}`, answerMap.get(q.questionId)),
    ),
    ...orphanedAnswers.map((a, i) =>
      renderResponse(
        `${String(questions.length + i + 1)}. (Question no longer in the question bank)`,
        a.answer,
      ),
    ),
  ].join('');

  const heading =
    observation.type === OBSERVATION_TYPES.workProduct
      ? 'Work Product Responses'
      : 'Instructional Round Responses';

  return `<section class="responses-section">
      <h2>${escapeHtml(heading)}</h2>
      ${items || '<p class="empty">No responses recorded.</p>'}
    </section>`;
}

function renderResponse(question: string, answer: WorkProductAnswer['answer'] | undefined): string {
  const body =
    answer != null && workProductAnswerHasText(answer)
      ? `<div class="response-answer">${renderAnswerHtml(answer)}</div>`
      : '<p class="response-answer is-empty">Not answered</p>';
  return `<div class="response">
      <p class="response-question">${escapeHtml(question)}</p>
      ${body}
    </div>`;
}

/** Renders a work product answer, which is either a legacy plain string
 *  (pre-Tiptap-upgrade answers) or a Tiptap JSON document. */
function renderAnswerHtml(answer: string | TiptapDoc): string {
  if (typeof answer === 'string') {
    return escapeHtml(answer).replace(/\n/g, '<br>');
  }
  return tiptapToHtml(answer);
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

function formatDate(value: Date | { toDate: () => Date } | string | undefined): string {
  if (!value) return '—';
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'string') date = new Date(value);
  else if (typeof value === 'object' && 'toDate' in value) date = value.toDate();
  else return '—';
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * `primaryColor` is the only color appSettings.branding exposes today, so it
 * drives every "blue" shade the template uses (dark/light/lighter are
 * derived by mixing toward black/white). The red accent and grays stay the
 * fixed OPS palette — there's no admin-configurable accent color yet.
 */
function styles(primaryColor: string): string {
  const blue = primaryColor;
  const blueDark = shade(primaryColor, -0.35);
  const blueLight = shade(primaryColor, 0.2);
  const blueLighter = shade(primaryColor, 0.88);
  return `
    @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&family=Roboto:wght@300;400;500;700&display=swap');
    :root {
      --ops-blue-dark: ${blueDark};
      --ops-blue: ${blue};
      --ops-blue-light: ${blueLight};
      --ops-blue-lighter: ${blueLighter};
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
    .brand-logo {
      display: block;
      max-height: 40px;
      max-width: 260px;
      width: auto;
      margin-bottom: 0.6em;
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
    .responses-section { margin-top: 1.5em; }
    .response {
      page-break-inside: avoid;
      margin: 1em 0;
    }
    .response-question {
      font-family: 'Lexend', Arial, sans-serif;
      font-weight: 600;
      color: var(--ops-blue-dark);
      margin: 0 0 0.3em;
    }
    .response-answer {
      background: var(--ops-gray-lightest);
      border-radius: 3px;
      padding: 0.5em 0.8em;
      font-size: 10pt;
      margin: 0;
    }
    .response-answer.is-empty { color: var(--ops-gray); font-style: italic; background: none; padding: 0; }
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
