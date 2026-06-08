export const meta = {
  name: 'optimize-codebase',
  description:
    'Repeatable codebase optimization pass: audit across 5 dimensions, rank by impact, implement in file-disjoint waves with verify-after-each-wave.',
  whenToUse:
    'Run a full optimization sweep of the Orono Peer Observations monorepo. args.mode="analyze" stops after the ranked findings list (read-only audit); args.mode="full" (default) also implements the findings in waves. The orchestrator (main loop) owns git commits, push, CI/deploy monitoring, CLAUDE.md, and the PR.',
  phases: [
    {
      title: 'Baseline',
      detail: 'typecheck + test + build must be green before optimizing',
      model: 'sonnet',
    },
    { title: 'Explore', detail: '5 read-only auditors, one per dimension', model: 'sonnet/opus' },
    { title: 'Synthesize', detail: 'merge + dedup into ONE impact-ranked list', model: 'opus' },
    { title: 'Critic', detail: 'completeness pass — surface missed findings', model: 'sonnet' },
    { title: 'Plan', detail: 'deterministic file-disjoint wave packing (JS, no agent)' },
    {
      title: 'Implement',
      detail: 'one implementer per finding per wave; verify+fix after each wave',
    },
    { title: 'Report', detail: 'structured summary returned to the orchestrator' },
  ],
};

// ----------------------------------------------------------------------------
// Args (all optional)
//   mode:          'full' (default) | 'analyze'  — analyze stops after ranking
//   dimensions:    string[] subset of dimension keys (default: all 5)
//   applyInvasive: boolean (default true) — run solo invasive/behaviorChange waves
//   maxWaves:      number (default Infinity) — cap implemented waves; rest deferred
//   critic:        boolean (default true) — run the completeness-critic pass
// ----------------------------------------------------------------------------
const mode = (args && args.mode) || 'full';
const applyInvasive = !(args && args.applyInvasive === false);
const runCritic = !(args && args.critic === false);
const maxWaves = args && typeof args.maxWaves === 'number' ? args.maxWaves : Infinity;

const REPO =
  'pnpm monorepo (Orono Peer Observations — Firebase + React + TypeScript). ' +
  'Workspaces: apps/web (@ops/web, React/Vite/TS), apps/functions (@ops/functions, Firebase Functions), ' +
  'apps/pdf-renderer, packages/shared (@ops/shared). Run all commands from the repo root.';

const GATES =
  '1. `pnpm typecheck`\n2. `pnpm lint` (eslint --max-warnings 0)\n3. `pnpm format:check`\n4. `pnpm test`\n5. `pnpm build`';

const ALL_DIMENSIONS = [
  {
    key: 'ui-ux-a11y',
    label: 'UI/UX & accessibility',
    model: 'sonnet',
    focus:
      'React component UX, accessibility (jsx-a11y): keyboard navigation, ARIA, focus management, color contrast, form labels; responsive layout; loading / empty / error states; confusing flows.',
  },
  {
    key: 'render-perf',
    label: 'render & runtime performance',
    model: 'sonnet',
    focus:
      'unnecessary re-renders, missing/incorrect memoization, expensive render paths, effect dependency bugs, list virtualization, bundle size, and Firestore listener / subscription churn.',
  },
  {
    key: 'data-net',
    label: 'data layer / queries / network',
    model: 'sonnet',
    focus:
      'Firestore query efficiency, N+1 reads, missing composite indexes, over-fetching, caching/batching opportunities, request waterfalls, and mismatches between security rules and client queries.',
  },
  {
    key: 'logic-correctness',
    label: 'business-logic correctness & edge cases',
    model: 'opus',
    focus:
      'off-by-one and null/undefined handling, race conditions, silent failures / swallowed errors, edge cases in observation & scoring logic, date/timezone bugs, and validation gaps.',
  },
  {
    key: 'build-infra-quality',
    label: 'build / infra & code quality',
    model: 'sonnet',
    focus:
      'dead code, duplication, weak/loose types, ESLint config gaps, build & CI config, dependency hygiene, monorepo boundaries, and correct use of the @ops/shared package.',
  },
];

const selectedDimensions =
  args && Array.isArray(args.dimensions) && args.dimensions.length
    ? ALL_DIMENSIONS.filter((d) => args.dimensions.includes(d.key))
    : ALL_DIMENSIONS;

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------
const FINDING_PROPS = {
  id: { type: 'string', description: 'short stable kebab-case slug' },
  dimension: { type: 'string' },
  title: { type: 'string' },
  problem: { type: 'string' },
  evidence: { type: 'string', description: 'one or more file:line references' },
  proposedFix: { type: 'string' },
  effort: { type: 'string', enum: ['low', 'medium', 'high'] },
  risk: { type: 'string', enum: ['low', 'medium', 'high'] },
  files: {
    type: 'array',
    items: { type: 'string' },
    description: 'ALL files the fix would edit (relative paths)',
  },
  invasive: { type: 'boolean' },
  behaviorChange: { type: 'boolean' },
  impact: { type: 'integer', minimum: 1, maximum: 10 },
};

const BASELINE_SCHEMA = {
  type: 'object',
  required: ['green', 'gates', 'summary'],
  properties: {
    green: { type: 'boolean' },
    gates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'pass'],
        properties: {
          name: { type: 'string' },
          pass: { type: 'boolean' },
          details: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
};

const DIMENSION_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'title',
          'problem',
          'evidence',
          'proposedFix',
          'effort',
          'risk',
          'files',
          'invasive',
          'behaviorChange',
        ],
        properties: FINDING_PROPS,
      },
    },
  },
};

const RANKED_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'title',
          'problem',
          'evidence',
          'proposedFix',
          'effort',
          'risk',
          'files',
          'invasive',
          'behaviorChange',
          'impact',
        ],
        properties: FINDING_PROPS,
      },
    },
  },
};

const IMPLEMENT_SCHEMA = {
  type: 'object',
  required: ['findingId', 'status', 'filesChanged', 'summary'],
  properties: {
    findingId: { type: 'string' },
    status: { type: 'string', enum: ['implemented', 'deferred', 'failed'] },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsAdded: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    deferReason: { type: 'string' },
  },
};

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['green', 'gates', 'summary'],
  properties: {
    green: { type: 'boolean' },
    gates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'pass'],
        properties: {
          name: { type: 'string' },
          pass: { type: 'boolean' },
          details: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
};

// ----------------------------------------------------------------------------
// Prompts
// ----------------------------------------------------------------------------
const explorePrompt = (d) =>
  `You are a READ-ONLY code auditor for the "${d.label}" dimension.\n\n${REPO}\n\n` +
  `Focus: ${d.focus}\n\n` +
  `Audit the codebase and report concrete, high-impact findings. DO NOT modify any code. ` +
  `Only report issues you can back with a specific file:line reference. Skip nitpicks with no real impact.\n\n` +
  `For each finding provide: title, problem (why it matters), evidence (exact file:line), proposedFix ` +
  `(minimal; preserves runtime behavior unless it is itself a bug fix), effort (low|medium|high), ` +
  `risk (low|medium|high), files (ALL files the fix would edit — be complete and conservative; include any ` +
  `shared barrel/index/config a fix would touch), invasive (true for large/cross-cutting refactors), and ` +
  `behaviorChange (true if user-visible behavior changes). Return 3-12 findings, best first.`;

const synthPrompt = (all) =>
  `You are the lead engineer synthesizing an optimization audit. Findings from ${selectedDimensions.length} parallel auditors (JSON):\n\n` +
  `${JSON.stringify(all)}\n\n` +
  `Produce ONE deduplicated list ordered by impact (highest first). Merge overlapping findings; drop duplicates and low-value nitpicks; ` +
  `keep only findings with concrete file:line evidence. For each, assign: id (stable kebab-case slug, unique), dimension, title, problem, ` +
  `evidence, proposedFix, effort, risk, files (COMPLETE list of files the fix edits), invasive, behaviorChange, and impact (integer 1-10). ` +
  `Be rigorous and decisive.`;

const criticPrompt = (ranked) =>
  `You are a completeness critic reviewing an optimization audit for GAPS.\n\n${REPO}\n\nCurrent ranked findings (JSON):\n\n` +
  `${JSON.stringify(ranked)}\n\n` +
  `Identify what is MISSING — an under-explored area, an untested critical path, or a correctness/security risk the auditors did not surface. ` +
  `Return ONLY NEW findings (same fields: id, dimension, title, problem, evidence with file:line, proposedFix, effort, risk, files, invasive, behaviorChange, impact). ` +
  `Do not repeat existing findings. If nothing meaningful is missing, return an empty findings array.`;

const implementPrompt = (f) =>
  `You are implementing ONE approved optimization in the existing working tree.\n\n${REPO}\n\n` +
  `FINDING (id: ${f.id})\n- Title: ${f.title}\n- Problem: ${f.problem}\n- Evidence: ${f.evidence}\n- Proposed fix: ${f.proposedFix}\n` +
  `- Files you OWN (edit ONLY these): ${f.files.join(', ')}\n\n` +
  `Rules:\n` +
  `- Edit ONLY your owned files. If the fix genuinely requires editing a file NOT in that list, STOP, revert any partial edits, and return status "deferred" with a deferReason explaining the conflict — another run will handle it.\n` +
  `- Match the existing code style, naming, and patterns exactly.\n` +
  `- Add or extend vitest tests to cover the change.\n` +
  `- Introduce NO suppressions: no \`any\`, no \`@ts-ignore\`/\`@ts-expect-error\`, no \`eslint-disable\`, no skipped tests. No quality shortcuts.\n` +
  `- Ensure your changes pass prettier and eslint (run \`pnpm format\` on your files if needed).\n` +
  `- Preserve runtime behavior unless this finding is explicitly a bug fix. Keep the change minimal and reviewable.\n\n` +
  `Return: findingId, status (implemented|deferred|failed), filesChanged, testsAdded, summary, deferReason (if any).`;

const verifyPrompt = () =>
  `Run the FULL verification gates for this ${REPO}\n\nRun each from the repo root, capturing pass/fail and key error output:\n${GATES}\n\n` +
  `Do NOT fix anything — only run and report. Return: green (true only if ALL pass), gates [{name, pass, details}], summary. ` +
  `(If a command fails because dependencies are missing, run \`pnpm install\` once and retry.)`;

const fixPrompt = (verify, files) =>
  `A verification wave FAILED. Gate results (JSON):\n\n${JSON.stringify(verify)}\n\n` +
  `Files changed in this wave: ${files.join(', ')}\n\n` +
  `Fix the failures so ALL gates pass. Rules: match existing style; NO suppressions (no any / @ts-ignore / eslint-disable / skipped tests); ` +
  `minimal changes; do not discard the wave's intended improvements unless one is the genuine root cause (if so, explain in summary). ` +
  `After fixing, re-run all 5 gates (${'typecheck, lint, format:check, test, build'}) and return green, gates, summary.`;

// ----------------------------------------------------------------------------
// Deterministic wave planning (plain JS — no agent)
//   - findings with no declared files are treated as solo/invasive (unknown blast radius)
//   - normal findings: greedy first-fit packing so no two in a wave share a file
//   - invasive / behaviorChange findings: each its own wave, sequenced LAST
// ----------------------------------------------------------------------------
function planWaves(findings) {
  const normalized = findings.map((f) => ({
    ...f,
    files: Array.isArray(f.files) ? f.files : [],
    invasive: f.invasive || !Array.isArray(f.files) || f.files.length === 0,
  }));

  const solo = normalized
    .filter((f) => f.invasive || f.behaviorChange)
    .sort((a, b) => b.impact - a.impact);
  const normal = normalized
    .filter((f) => !(f.invasive || f.behaviorChange))
    .sort((a, b) => b.impact - a.impact);

  const waves = [];
  for (const f of normal) {
    let placed = false;
    for (const wave of waves) {
      const used = new Set(wave.flatMap((x) => x.files));
      if (!f.files.some((file) => used.has(file))) {
        wave.push(f);
        placed = true;
        break;
      }
    }
    if (!placed) waves.push([f]);
  }
  for (const f of solo) waves.push([f]); // invasive items run alone, last

  return waves;
}

const waveFiles = (wave) => [...new Set(wave.flatMap((f) => f.files))];

// ============================================================================
// Orchestration
// ============================================================================

// Phase A — green baseline
phase('Baseline');
log('Establishing a green baseline (typecheck + test + build)...');
const baseline = await agent(
  `Establish a green baseline for this ${REPO}\n\nRun \`pnpm typecheck\`, \`pnpm test\`, and \`pnpm build\` from the repo root ` +
    `(run \`pnpm install\` first only if dependencies are missing). Do NOT change any code. ` +
    `Return: green (true only if all pass), gates [{name, pass, details}], summary.`,
  { label: 'baseline', phase: 'Baseline', schema: BASELINE_SCHEMA, model: 'sonnet' },
);

if (!baseline || !baseline.green) {
  log('Baseline is RED — refusing to optimize on a broken tree. Returning baseline failure.');
  return {
    mode,
    baseline,
    aborted: true,
    reason: 'Baseline not green; fix the tree before running an optimization pass.',
  };
}

// Phase B — explore (read-only, parallel, one per dimension)
phase('Explore');
log(`Auditing ${selectedDimensions.length} dimensions in parallel...`);
const dimResults = await parallel(
  selectedDimensions.map(
    (d) => () =>
      agent(explorePrompt(d), {
        label: `audit:${d.key}`,
        phase: 'Explore',
        schema: DIMENSION_SCHEMA,
        model: d.model,
      }),
  ),
);
const rawFindings = dimResults.filter(Boolean).flatMap((r, i) =>
  (r.findings || []).map((f) => ({
    ...f,
    dimension: f.dimension || selectedDimensions[i].label,
  })),
);
log(`Collected ${rawFindings.length} raw findings across dimensions.`);

if (!rawFindings.length) {
  return { mode, baseline, rankedFindings: [], note: 'No findings surfaced by the auditors.' };
}

// Phase C — synthesize & rank into ONE list
phase('Synthesize');
const ranked = await agent(synthPrompt(rawFindings), {
  label: 'synthesize',
  phase: 'Synthesize',
  schema: RANKED_SCHEMA,
  model: 'opus',
});
let findings = (ranked && ranked.findings) || [];

// Phase C2 — completeness critic (optional)
if (runCritic && findings.length) {
  phase('Critic');
  const extra = await agent(criticPrompt({ findings }), {
    label: 'critic',
    phase: 'Critic',
    schema: RANKED_SCHEMA,
    model: 'sonnet',
  });
  const newOnes = ((extra && extra.findings) || []).filter(
    (f) => f && !findings.some((g) => g.id === f.id),
  );
  if (newOnes.length) log(`Critic surfaced ${newOnes.length} additional finding(s).`);
  findings = findings.concat(newOnes).sort((a, b) => (b.impact || 0) - (a.impact || 0));
}

log(`Ranked ${findings.length} findings by impact.`);

// analyze-only: stop here with the audit
if (mode === 'analyze') {
  return { mode, baseline, rankedFindings: findings };
}

// Phase D — plan file-disjoint waves
phase('Plan');
let waves = planWaves(findings);
const deferrals = [];

// Respect applyInvasive: defer solo invasive/behaviorChange waves if disabled
if (!applyInvasive) {
  const kept = [];
  for (const w of waves) {
    if (w.length === 1 && (w[0].invasive || w[0].behaviorChange)) {
      deferrals.push({
        findingId: w[0].id,
        reason: 'invasive/behavior-change wave deferred (applyInvasive=false)',
      });
    } else kept.push(w);
  }
  waves = kept;
}

// Respect maxWaves: defer the overflow
if (waves.length > maxWaves) {
  for (const w of waves.slice(maxWaves))
    for (const f of w) deferrals.push({ findingId: f.id, reason: `beyond maxWaves=${maxWaves}` });
  waves = waves.slice(0, maxWaves);
}
log(
  `Planned ${waves.length} file-disjoint wave(s)${deferrals.length ? `; ${deferrals.length} finding(s) deferred` : ''}.`,
);

// Phase E — implement wave by wave (sequential; verify + fix after each)
const implementation = [];
const waveVerifications = [];
let lastVerify = null;

for (let i = 0; i < waves.length; i++) {
  const wave = waves[i];
  const tag = `Wave ${i + 1}/${waves.length}`;
  phase(tag);
  log(`${tag}: implementing ${wave.length} finding(s) [${wave.map((f) => f.id).join(', ')}].`);

  const results = await parallel(
    wave.map(
      (f) => () =>
        agent(implementPrompt(f), {
          label: `impl:${f.id}`,
          phase: tag,
          schema: IMPLEMENT_SCHEMA,
          model: f.effort === 'low' ? 'haiku' : f.effort === 'high' ? 'opus' : 'sonnet',
        }),
    ),
  );
  for (const r of results) if (r) implementation.push({ wave: i + 1, ...r });

  // verify the whole tree after the wave
  let verify = await agent(verifyPrompt(), {
    label: `verify:w${i + 1}`,
    phase: tag,
    schema: VERIFY_SCHEMA,
    model: 'sonnet',
  });
  if (verify && !verify.green) {
    log(`${tag}: gates red — dispatching a fix agent.`);
    const fix = await agent(fixPrompt(verify, waveFiles(wave)), {
      label: `fix:w${i + 1}`,
      phase: tag,
      schema: VERIFY_SCHEMA,
      model: 'opus',
    });
    if (fix) verify = fix;
  }
  waveVerifications.push({
    wave: i + 1,
    ...(verify || { green: false, summary: 'verify agent returned nothing' }),
  });
  lastVerify = verify;
}

// Phase F — structured report back to the orchestrator
phase('Report');
return {
  mode,
  baseline,
  rankedFindings: findings,
  wavePlan: waves.map((w, i) => ({
    wave: i + 1,
    findingIds: w.map((f) => f.id),
    files: waveFiles(w),
  })),
  implementation,
  waveVerifications,
  finalStatus: lastVerify,
  deferrals,
  note:
    'Workflow self-reports above. The orchestrator must independently re-run the full gates on the whole tree, ' +
    'then commit each wave, push, and monitor CI/deploy. Self-reports are not trusted as final.',
};
