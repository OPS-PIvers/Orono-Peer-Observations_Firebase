import { PROFICIENCY_LEVELS, type Rubric } from '@ops/shared';
import { PROFICIENCY_LABELS } from './proficiencyLabels';

export type PrintScope = 'assigned' | 'full';

export interface RubricPrintOptions {
  rubric: Rubric;
  /** Components assigned for the role/year. Drives the "assigned" filter
   *  and the Assigned tag on rows when printing the full rubric. */
  assignedComponentIds: ReadonlySet<string>;
  scope: PrintScope;
  /** Heading line, e.g. "Classroom Teacher · Year 2". */
  title: string;
  /** Optional second line, e.g. the observed teacher's name. */
  subtitle?: string;
  appName: string;
  primaryColor: string;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Standalone, print-ready HTML for a rubric: one table per domain, one row
 * per component, the four proficiency descriptors as columns, and the
 * component's look-fors beneath. Laid out for landscape Letter paper.
 * Pure — no DOM access — so it is unit-testable.
 */
export function buildRubricPrintHtml(opts: RubricPrintOptions): string {
  const { rubric, assignedComponentIds, scope } = opts;
  const primary = HEX_COLOR_RE.test(opts.primaryColor) ? opts.primaryColor : '#2d3f89';
  const markAssigned = scope === 'full' && assignedComponentIds.size > 0;

  const domains = rubric.domains
    .map((d) => ({
      ...d,
      components:
        scope === 'full'
          ? d.components
          : d.components.filter((c) => assignedComponentIds.has(c.id)),
    }))
    .filter((d) => d.components.length > 0);

  const headerCells = PROFICIENCY_LEVELS.map(
    (lvl) => `<th class="lvl lvl-${lvl}">${escapeHtml(PROFICIENCY_LABELS[lvl])}</th>`,
  ).join('');

  const domainSections = domains
    .map((d) => {
      const rows = d.components
        .map((c) => {
          const assigned = markAssigned && assignedComponentIds.has(c.id);
          const descriptorCells = PROFICIENCY_LEVELS.map(
            (lvl) => `<td>${escapeHtml(c.proficiencyLevels[lvl] || '—')}</td>`,
          ).join('');
          const lookFors =
            c.lookFors.length > 0
              ? `<tr class="lookfors"><td colspan="5"><span class="lf-label">Look-fors</span><ul>${c.lookFors
                  .map((lf) => `<li>${escapeHtml(lf.text)}</li>`)
                  .join('')}</ul></td></tr>`
              : '';
          return `<tbody class="component">
            <tr>
              <th scope="row" class="comp">
                <span class="comp-id">${escapeHtml(c.id)}</span>
                <span class="comp-title">${escapeHtml(c.title)}</span>
                ${assigned ? '<span class="tag">Assigned</span>' : ''}
              </th>
              ${descriptorCells}
            </tr>
            ${lookFors}
          </tbody>`;
        })
        .join('');
      return `<section class="domain">
        <h2>Domain ${escapeHtml(d.id)}: ${escapeHtml(d.name)}</h2>
        <table>
          <colgroup><col class="c-comp" /><col /><col /><col /><col /></colgroup>
          <thead><tr><th class="comp-head">Component</th>${headerCells}</tr></thead>
          ${rows}
        </table>
      </section>`;
    })
    .join('');

  const scopeLabel = scope === 'full' ? 'Full rubric' : 'Assigned components';
  const printed = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const docTitle = `${rubric.displayName} — ${opts.title}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(docTitle)}</title>
<style>
  @page { size: letter landscape; margin: 0.5in; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Roboto', 'Helvetica Neue', Arial, sans-serif;
    font-size: 8.5pt; line-height: 1.35; color: #1f2937;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  header.doc {
    display: flex; justify-content: space-between; align-items: flex-end;
    border-bottom: 3px solid ${primary}; padding-bottom: 6pt; margin-bottom: 10pt;
  }
  .brand { font-size: 8pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${primary}; margin: 0 0 2pt; }
  h1 { font-family: 'Lexend', 'Helvetica Neue', Arial, sans-serif; font-size: 16pt; margin: 0; color: #111827; }
  .sub { margin: 2pt 0 0; font-size: 10pt; color: #374151; }
  .meta { text-align: right; font-size: 8pt; color: #6b7280; }
  .meta strong { display: block; font-size: 9pt; color: ${primary}; }
  section.domain { margin-bottom: 12pt; }
  /* Full rubric: one domain per page. Assigned-only prints run on so a
     handful of components doesn't spread across mostly-blank pages. */
  body.full section.domain + section.domain { break-before: page; }
  h2 {
    font-family: 'Lexend', 'Helvetica Neue', Arial, sans-serif; font-size: 11.5pt;
    color: #fff; background: ${primary}; margin: 0; padding: 4pt 8pt;
    border-radius: 3pt 3pt 0 0; break-after: avoid;
  }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  col.c-comp { width: 16%; }
  thead { display: table-header-group; }
  thead th {
    font-size: 8pt; text-transform: uppercase; letter-spacing: 0.05em; text-align: left;
    padding: 4pt 6pt; background: #f3f4f6; border: 1px solid #d1d5db; color: #374151;
  }
  tbody.component { break-inside: avoid; }
  td, th.comp { border: 1px solid #d1d5db; padding: 5pt 6pt; vertical-align: top; text-align: left; }
  th.comp { background: #f9fafb; font-weight: 400; }
  .comp-id { display: block; font-weight: 700; color: ${primary}; font-size: 9pt; }
  .comp-title { display: block; font-weight: 600; color: #111827; }
  .tag {
    display: inline-block; margin-top: 4pt; padding: 1pt 5pt; border-radius: 8pt;
    font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    color: #fff; background: ${primary};
  }
  tr.lookfors td { background: #fcfcfd; font-size: 8pt; color: #374151; }
  .lf-label { font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 7pt; color: #6b7280; }
  tr.lookfors ul { margin: 2pt 0 0; padding-left: 12pt; columns: 2; column-gap: 18pt; }
  tr.lookfors li { break-inside: avoid; }
  .empty { padding: 24pt; text-align: center; color: #6b7280; font-size: 10pt; }
  footer.doc { margin-top: 8pt; font-size: 7pt; color: #9ca3af; text-align: center; }
</style>
</head>
<body class="${scope}">
  <header class="doc">
    <div>
      <p class="brand">${escapeHtml(opts.appName)}</p>
      <h1>${escapeHtml(opts.title)}</h1>
      ${opts.subtitle ? `<p class="sub">${escapeHtml(opts.subtitle)}</p>` : ''}
    </div>
    <div class="meta">
      <strong>${escapeHtml(rubric.displayName)}</strong>
      ${escapeHtml(scopeLabel)} · Printed ${escapeHtml(printed)}
    </div>
  </header>
  ${domainSections || '<p class="empty">No components are assigned for this role/year combination.</p>'}
  <footer class="doc">Orono Public Schools · ${escapeHtml(opts.appName)}</footer>
</body>
</html>`;
}

/**
 * Print a standalone HTML document without navigating away: load it into a
 * hidden iframe, open the browser print dialog on it, and remove the frame
 * afterwards. Avoids popup blockers that a `window.open` approach hits.
 */
export function printHtmlDocument(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';

  const cleanup = () => {
    // Deferred so Safari finishes spooling before the frame disappears.
    setTimeout(() => iframe.remove(), 1000);
  };

  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.addEventListener('afterprint', cleanup, { once: true });
    win.focus();
    win.print();
  };
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}
