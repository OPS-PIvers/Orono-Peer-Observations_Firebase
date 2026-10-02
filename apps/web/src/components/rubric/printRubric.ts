import { PROFICIENCY_LEVELS, type Rubric } from '@ops/shared';
import qrcode from 'qrcode-generator';
import { PROFICIENCY_LABELS } from './proficiencyLabels';

export type PrintScope = 'assigned' | 'full';

/** Choices an observer makes in the print dialog. Teachers printing their
 *  own rubric get {@link VIEW_PRINT_CONTENT}: what they see on screen. */
export interface RubricPrintContent {
  /** Show each component's look-fors as a checklist. */
  lookFors: boolean;
  /** Ruled space under each component for handwritten notes. */
  componentNotes: boolean;
  /** Ruled page section at the end for overall comments. */
  overallNotes: boolean;
}

export const VIEW_PRINT_CONTENT: RubricPrintContent = {
  lookFors: true,
  componentNotes: false,
  overallNotes: false,
};

export interface RubricPrintOptions {
  rubric: Rubric;
  /** Components assigned for the role/year. Drives the "assigned" filter
   *  and the Assigned marker on component cells. */
  assignedComponentIds: ReadonlySet<string>;
  scope: PrintScope;
  content?: RubricPrintContent;
  /** Heading line, e.g. "Classroom Teacher · Year 2". */
  title: string;
  /** Optional second line, e.g. the observed teacher's name. */
  subtitle?: string;
  appName: string;
  /** Brand blue (ops-blue). */
  primaryColor: string;
  /**
   * Observation id for an observer's printout. Makes the page scan-ready
   * for a later scan-and-import: corner registration marks and a QR code
   * identifying the observation on every page, and a rating bubble in each
   * descriptor cell.
   */
  scanId?: string;
  /** Strong brand blue (ops-blue-dark) used for the domain and component
   *  chrome, as on screen. Defaults to the stock OPS value. */
  primaryDarkColor?: string;
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
 * Payload of the printout's QR code: format version, observation id, scope
 * and content flags, so an importer knows which observation the sheet
 * belongs to and which regions it should expect.
 */
export function scanPayload(
  scanId: string,
  scope: PrintScope,
  content: RubricPrintContent,
): string {
  const flags = [
    content.lookFors ? 'L' : '',
    content.componentNotes ? 'N' : '',
    content.overallNotes ? 'O' : '',
  ].join('');
  return `OPS-OBS:1:${scanId}:${scope === 'full' ? 'F' : 'A'}:${flags}`;
}

function qrSvg(data: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();
  return qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
}

function ruledLines(count: number): string {
  return `<div class="lines">${'<span></span>'.repeat(count)}</div>`;
}

/**
 * Standalone, print-ready HTML for a rubric, styled like the on-screen
 * rubric grid: dark-blue domain strips, the red proficiency header row,
 * dark-blue component cells with white descriptor cells, and look-fors as
 * a two-column checklist. Laid out for portrait Letter paper; each
 * domain's strip and header row repeat when a domain runs onto a new page.
 * Pure — no DOM access — so it is unit-testable.
 */
export function buildRubricPrintHtml(opts: RubricPrintOptions): string {
  const { rubric, assignedComponentIds, scope } = opts;
  const content = opts.content ?? VIEW_PRINT_CONTENT;
  const scan = opts.scanId
    ? { id: opts.scanId, payload: scanPayload(opts.scanId, scope, content) }
    : null;
  const primary = HEX_COLOR_RE.test(opts.primaryColor) ? opts.primaryColor : '#2d3f89';
  const primaryDark =
    opts.primaryDarkColor && HEX_COLOR_RE.test(opts.primaryDarkColor)
      ? opts.primaryDarkColor
      : '#1d2a5d';

  const domains = rubric.domains
    .map((d) => ({
      ...d,
      components:
        scope === 'full'
          ? d.components
          : d.components.filter((c) => assignedComponentIds.has(c.id)),
    }))
    .filter((d) => d.components.length > 0);

  const levelHeaders = PROFICIENCY_LEVELS.map(
    (lvl) => `<th class="lvl">${escapeHtml(PROFICIENCY_LABELS[lvl])}</th>`,
  ).join('');

  const domainSections = domains
    .map((d) => {
      const rows = d.components
        .map((c) => {
          const assigned = assignedComponentIds.has(c.id);
          const descriptorCells = PROFICIENCY_LEVELS.map(
            (lvl) =>
              `<td class="desc">${scan ? '<span class="bubble"></span>' : ''}${escapeHtml(c.proficiencyLevels[lvl] || '—')}</td>`,
          ).join('');
          const lookFors =
            content.lookFors && c.lookFors.length > 0
              ? `<tr class="panel"><td colspan="5"><ul class="lookfors">${c.lookFors
                  .map((lf) => `<li><span class="box"></span>${escapeHtml(lf.text)}</li>`)
                  .join('')}</ul></td></tr>`
              : '';
          const notes = content.componentNotes
            ? `<tr class="panel notes"><td colspan="5"><span class="panel-label">Notes</span>${ruledLines(4)}</td></tr>`
            : '';
          return `<tbody class="component">
            <tr>
              <th scope="row" class="comp">
                <span class="comp-id">${escapeHtml(c.id)}</span>
                <span class="comp-title">${escapeHtml(c.title)}</span>
                ${assigned ? '<span class="tag">&#10003; Assigned</span>' : ''}
              </th>
              ${descriptorCells}
            </tr>
            ${lookFors}${notes}
          </tbody>`;
        })
        .join('');
      return `<section class="domain">
        <table>
          <colgroup><col class="c-comp" /><col /><col /><col /><col /></colgroup>
          <thead>
            <tr><th colspan="5" class="domain-strip"><span class="num">${escapeHtml(d.id)}</span>Domain ${escapeHtml(d.id)}: ${escapeHtml(d.name)}</th></tr>
            <tr class="levels"><th class="comp-head">Component</th>${levelHeaders}</tr>
          </thead>
          ${rows}
        </table>
      </section>`;
    })
    .join('');

  const overall = content.overallNotes
    ? `<section class="overall">
        <h2 class="domain-strip">Overall Comments</h2>
        <div class="overall-body">${ruledLines(16)}</div>
      </section>`
    : '';

  const scopeLabel = scope === 'full' ? 'Full Rubric' : 'Assigned only';
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
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&family=Roboto:wght@400;500;700&display=swap" />
<style>
  @page { size: letter portrait; margin: 0.45in; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    font-size: 7.5pt; line-height: 1.35; color: #364153;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .heading { font-family: 'Lexend', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

  header.doc {
    display: flex; justify-content: space-between; align-items: flex-end; gap: 12pt;
    padding-bottom: 8pt; margin-bottom: 10pt; border-bottom: 1px solid #e5e7eb;
  }
  .brand { margin: 0 0 2pt; font-size: 7pt; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: #6a7282; }
  h1 { margin: 0; font-size: 15pt; font-weight: 600; color: ${primaryDark}; }
  .sub { margin: 2pt 0 0; font-size: 9.5pt; color: #364153; }
  .meta { text-align: right; font-size: 7pt; color: #6a7282; white-space: nowrap; }
  .pill {
    display: inline-block; margin-bottom: 3pt; padding: 2pt 7pt; border-radius: 4pt;
    font-size: 7.5pt; font-weight: 500; color: #fff; background: ${primary};
  }

  section.domain { margin-bottom: 12pt; }
  body.full section.domain + section.domain { break-before: page; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  col.c-comp { width: 21%; }
  thead { display: table-header-group; }

  .domain-strip {
    margin: 0; padding: 5pt 9pt; text-align: left; background: ${primaryDark}; color: #fff;
    font-family: 'Lexend', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 10pt; font-weight: 600;
  }
  .domain-strip .num {
    display: inline-flex; align-items: center; justify-content: center;
    width: 15pt; height: 15pt; margin-right: 7pt; border-radius: 50%;
    background: rgba(255,255,255,0.15); font-size: 8pt; vertical-align: 1pt;
  }
  tr.levels th {
    padding: 4pt 7pt; text-align: left; color: #fff;
    font-family: 'Lexend', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 6.5pt; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
  }
  tr.levels th.comp-head { background: ${primaryDark}; }
  tr.levels th.lvl { background: #c13435; border-left: 1px solid rgba(255,255,255,0.2); }

  tbody.component { break-inside: avoid; }
  tbody.component + tbody.component tr:first-child > * { border-top: 1px solid #f3f4f6; }
  th.comp {
    padding: 7pt 7pt; vertical-align: top; text-align: left; font-weight: 400;
    background: ${primaryDark}; color: #fff;
  }
  .comp-id { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 7pt; font-weight: 600; color: rgba(255,255,255,0.5); }
  .comp-title { display: block; margin-top: 2pt; font-size: 8pt; font-weight: 700; line-height: 1.3; }
  .tag { display: block; margin-top: 6pt; font-size: 6pt; font-weight: 500; text-transform: uppercase; color: #c13435; }
  td.desc {
    padding: 7pt 7pt; vertical-align: top; text-align: left; background: #fff;
    border-left: 1px solid #f3f4f6; border-bottom: 1px solid #f3f4f6; white-space: pre-line;
  }

  tr.panel td { padding: 6pt 8pt; background: #fdfdfe; border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
  ul.lookfors { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4pt; }
  ul.lookfors li {
    display: flex; align-items: flex-start; gap: 5pt; padding: 4pt 6pt;
    border: 1px solid #e5e7eb; border-radius: 4pt; background: #fff; color: #364153;
  }
  .box { flex: none; width: 8pt; height: 8pt; margin-top: 0.5pt; border: 1px solid #99a1af; border-radius: 2pt; }
  .panel-label { display: block; font-size: 7.5pt; font-weight: 500; color: #364153; }
  .lines span { display: block; height: 17pt; border-bottom: 1px solid #d1d5dc; }

  section.overall { margin-top: 14pt; break-inside: avoid; }
  .overall-body { padding: 4pt 9pt 9pt; border: 1px solid #e5e7eb; border-top: 0; }

  .empty { padding: 24pt; text-align: center; color: #6a7282; font-size: 10pt; }
  footer.doc { margin-top: 8pt; font-size: 6.5pt; color: #99a1af; text-align: center; }

  /* Scan-ready printouts. The fixed bands repeat on every printed page;
     the outer table's header/footer spacer rows (also repeated per page)
     keep the content clear of them. */
  table.page { width: 100%; border-collapse: collapse; }
  table.page > thead > tr > td, table.page > tfoot > tr > td { padding: 0; }
  .band-space { height: 0.5in; }
  .band { position: fixed; left: 0; right: 0; height: 0.42in; }
  .band.top { top: 0; }
  .band.bottom { bottom: 0; }
  .mark { position: absolute; width: 0.2in; height: 0.2in; background: #000; }
  .band.top .mark { top: 0; }
  .band.bottom .mark { bottom: 0; }
  .mark.l { left: 0; }
  .mark.r { right: 0; }
  .qr { position: absolute; top: 0; right: 0.32in; width: 0.42in; height: 0.42in; }
  .qr svg { display: block; width: 100%; height: 100%; }
  .scan-id {
    position: absolute; bottom: 0; left: 0.32in; right: 0.32in; text-align: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 6.5pt; color: #6a7282;
  }
  .scan-hint { margin: -4pt 0 10pt; font-size: 7pt; color: #6a7282; }
  .scan-hint .bubble { position: static; display: inline-block; vertical-align: -1.5pt; margin: 0 2pt; }
  body.scan td.desc { position: relative; padding-right: 17pt; }
  .bubble {
    position: absolute; top: 6pt; right: 5pt; width: 9pt; height: 9pt;
    border: 1px solid #364153; border-radius: 50%; background: #fff;
  }
</style>
</head>
<body class="${scope}${scan ? ' scan' : ''}">
  ${
    scan
      ? `<div class="band top" aria-hidden="true"><span class="mark l"></span><span class="mark r"></span><div class="qr">${qrSvg(scan.payload)}</div></div>
  <div class="band bottom" aria-hidden="true"><span class="mark l"></span><span class="mark r"></span><span class="scan-id">${escapeHtml(scan.payload)}</span></div>
  <table class="page"><thead><tr><td><div class="band-space"></div></td></tr></thead><tfoot><tr><td><div class="band-space"></div></td></tr></tfoot><tbody><tr><td>`
      : ''
  }
  <header class="doc">
    <div>
      <p class="brand">${escapeHtml(opts.appName)}</p>
      <h1 class="heading">${escapeHtml(opts.title)}</h1>
      ${opts.subtitle ? `<p class="sub">${escapeHtml(opts.subtitle)}</p>` : ''}
    </div>
    <div class="meta">
      <span class="pill">${escapeHtml(scopeLabel)}</span><br />
      ${escapeHtml(rubric.displayName)} · Printed ${escapeHtml(printed)}
    </div>
  </header>
  ${scan ? '<p class="scan-hint">Fill in one circle <span class="bubble"></span> per component to record a rating. Keep marks inside the boxes.</p>' : ''}
  ${domainSections || '<p class="empty">No components are assigned for this role/year combination.</p>'}
  ${overall}
  <footer class="doc">Orono Public Schools · ${escapeHtml(opts.appName)}</footer>
  ${scan ? '</td></tr></tbody></table>' : ''}
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
    // Wait for Lexend/Roboto so the printout matches the app's type, but
    // never hold the dialog hostage to a slow font CDN.
    const fontsReady = Promise.race([
      win.document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    void fontsReady.then(() => {
      win.focus();
      win.print();
    });
  };
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}
