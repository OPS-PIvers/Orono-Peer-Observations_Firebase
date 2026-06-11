export const meta = {
  name: 'mvp-to-production',
  description:
    'Feature-completion pass: audit every subsystem for gaps (unwired settings, broken logic, incomplete integrations, missing lifecycle states), verify each gap adversarially, then implement in dependency-aware file-disjoint waves with verify-after-each-wave.',
  whenToUse:
    'Run when driving the app from MVP toward production-complete. args.mode="audit" stops after the verified, ranked gap list (read-only). args.mode="implement" takes args.gaps (an approved gap list from a prior audit run) and implements it. args.mode="full" (default) does both. The orchestrator (main loop) owns git commits, push, CI/deploy monitoring, and the PR.',
  phases: [
    { title: 'Baseline', detail: 'typecheck + test + build must be green before feature work' },
    { title: 'Audit', detail: 'one read-only auditor per subsystem, tracing end-to-end behavior' },
    { title: 'Skeptic', detail: 'per-area adversarial verification — refute false gaps' },
    { title: 'Synthesize', detail: 'merge + dedup into ONE dependency-annotated ranked work-list' },
    { title: 'Critic', detail: 'completeness pass — what did the auditors miss?' },
    { title: 'Plan', detail: 'deterministic dependency-aware file-disjoint wave packing (JS)' },
    { title: 'Implement', detail: 'one implementer per gap per wave; verify+fix after each wave' },
    { title: 'Report', detail: 'structured summary returned to the orchestrator' },
  ],
};

// ----------------------------------------------------------------------------
// Args (all optional)
//   mode:     'full' (default) | 'audit' | 'implement'
//   areas:    string[] subset of area keys (default: all)
//   gaps:     gap[] — required for mode 'implement' (the approved work-list)
//   maxWaves: number (default Infinity) — cap implemented waves; rest deferred
//   critic:   boolean (default true)
// ----------------------------------------------------------------------------
// args may arrive as a JSON string depending on the caller — parse defensively.
let A = args;
if (typeof A === 'string') {
  try {
    A = JSON.parse(A);
  } catch {
    A = undefined;
  }
}
const mode = (A && A.mode) || 'full';
const runCritic = !(A && A.critic === false);
const maxWaves = A && typeof A.maxWaves === 'number' ? A.maxWaves : Infinity;
// In mode "implement", args.gaps may be COMPACT entries ({id, title, files,
// dependsOn, effort, userImpact}) with args.specFile naming a JSON file that
// holds the full gap specs — implementers Read their spec by id.
const specFile = (A && A.specFile) || null;

const REPO =
  'pnpm monorepo (Orono Peer Observations — Firebase + React 19 + TypeScript). Workspaces: ' +
  'apps/web (@ops/web — Vite, Tailwind 4, shadcn/ui; evaluator & admin UIs), ' +
  'apps/functions (@ops/functions — Cloud Functions v2, Node 22; auth blocking, observation lifecycle, scheduling, calendar, email, transcription), ' +
  'apps/pdf-renderer (Cloud Run, Hono + Puppeteer), ' +
  'packages/shared (@ops/shared — Zod schemas, types, constants). ' +
  'Data: Cloud Firestore (rules in firestore.rules); blobs: Google Drive via service account + DWD. ' +
  'Google SSO restricted to @orono.k12.mn.us. Run all commands from the repo root.';

const GOTCHAS =
  '- After editing packages/shared, run `pnpm --filter @ops/shared build` — consumers import from dist/, not source.\n' +
  '- ESLint is strictTypeChecked with --max-warnings 0. NO suppressions: no `any`, no `@ts-ignore`/`@ts-expect-error`, no `eslint-disable`, no skipped tests.\n' +
  '- Type-only imports MUST use `import type { … }`.\n' +
  '- Line endings are LF everywhere (enforced by .gitattributes).\n' +
  '- Match the patterns in neighboring files exactly (admin pages, hooks, schema files all have strong conventions).\n' +
  '- Do NOT run `pnpm test:rules` (needs special emulator env) and do NOT deploy anything.';

const GATES =
  '1. `pnpm --filter @ops/shared build` (so typecheck sees fresh dist)\n' +
  '2. `pnpm typecheck`\n3. `pnpm lint`\n4. `pnpm format:check`\n5. `pnpm test`\n6. `pnpm build`';

// ----------------------------------------------------------------------------
// Subsystem areas — each gets a read-only auditor tracing END-TO-END behavior
// ----------------------------------------------------------------------------
const ALL_AREAS = [
  {
    key: 'admin-settings-wiring',
    label: 'admin settings → behavior wiring',
    focus:
      'Trace EVERY admin-configurable field from its Zod schema (packages/shared/src/schema/*) through its admin editor page (apps/web/src/admin/**) to the place it is CONSUMED (web UI behavior for non-admin users, functions behavior, emails, scheduling). Cover: settings, branding, scheduling settings, dashboard config (cycle steps, checkpoints, quick materials), signup fields, role-year mappings, roles, buildings + building schedules. A setting that is editable but never read anywhere, read but not reactive, or only partially applied is a gap. Also flag admin pages whose writes are not validated/persisted correctly.',
  },
  {
    key: 'modules-system',
    label: 'customizable modules end-to-end',
    focus:
      'The custom modules system: admin module builder (apps/web/src/admin/modules/**), module schema (packages/shared/src/schema/module.ts, moduleItem.ts), end-user rendering (apps/web/src/modules/**), navigation/visibility/role-or-year targeting, ordering, publish/draft states, section types (text, links, embeds, files). Every capability the admin editor exposes must render correctly for end users, and every gap between "what an admin would expect to customize" and what exists is a finding.',
  },
  {
    key: 'observation-lifecycle',
    label: 'observation creation → tracking → finalization',
    focus:
      'Full observation lifecycle: creation (CreateObservationDialog, NewObservationPage), editing (ObservationEditorPage, ScriptEditor, rubric scoring, component tagging, meeting notes), instructional-round + work-product response flows, status transitions, finalization (apps/functions/src/observations/**: locking, snapshotting, PDF generation, Drive upload, notification emails), re-opening, deletion/cancellation, the observations list + tracking views (ObservationsListPage, RecentObservationsStrip, dashboard checkpoints), and audit logging. Every state must be reachable, persisted, and visible to the right roles; every dead-end or unimplemented transition is a gap.',
  },
  {
    key: 'scheduling-calendar',
    label: 'scheduling, booking & Google Calendar',
    focus:
      'Observation windows (CreateObservationWindowDialog, MyObservationWindowsPage), slot generation against building schedules, booking flow (BookingPage, SlotGrid, apps/functions/src/scheduling/**, engine/bookingRules), assignment preferences (AssignPreferencesPage), signup detail fields, capacity rules, cancellation/rescheduling, and the Google Calendar integration (apps/web/src/scheduling/connectCalendar.ts, CalendarCallbackPage, apps/functions/src/calendar/** — OAuth token storage, event create/update/delete on book/cancel). Incomplete OAuth flows, events not created/cleaned up, or rules the engine ignores are gaps.',
  },
  {
    key: 'email-notifications',
    label: 'email templates & notifications',
    focus:
      'Email template admin (apps/web/src/admin/email-templates/**), template schema + token substitution (packages/shared/src/email/**, emailTemplate.ts), the sending path (apps/functions/src/email/**), and every trigger point that SHOULD send email (booking confirmation/cancellation, observation finalized, reminders, window invitations). Templates that exist but are never sent, triggers with no template, missing tokens, and hard-coded from-addresses that ignore admin settings are gaps.',
  },
  {
    key: 'audio-transcription',
    label: 'audio recording & transcription pipeline',
    focus:
      'Audio capture (AudioRecorder, AudioPopoverButton), upload/storage, transcription jobs (apps/functions/src/audio/**, transcription/**, packages/shared/src/schema/transcriptionJob.ts), job status surfacing in the UI, transcript insertion into the observation script, error/retry handling, and cleanup of blobs. Jobs that can hang forever without UI feedback, missing failure states, or orphaned recordings are gaps.',
  },
  {
    key: 'auth-roles-security',
    label: 'auth, roles, route guards & Firestore rules',
    focus:
      'Auth blocking function (apps/functions/src/auth/**), domain restriction, role resolution, RoleAwareRedirect + route guards in App.tsx, admin gating, Unauthorized/NotFound flows, dev sign-in gating in production builds, and firestore.rules: every collection the client reads/writes must have matching rules; every rule must match how the app actually queries (or legitimate queries will fail). Privilege gaps (non-admins able to write admin collections) and rule/query mismatches are gaps.',
  },
  {
    key: 'staff-data-management',
    label: 'staff directory, caseloads & profile',
    focus:
      'Staff admin (apps/web/src/admin/staff/**), staff schema, signup fields applied to profiles, role-year mappings driving who gets observed in which year, staff directory + person pages (StaffDirectoryPage, StaffPersonPage, MyStaffPage — evaluator caseload), ProfilePage self-service, and onboarding of new users on first sign-in. Mismatches between admin-entered staff data and what users see, or caseload views that do not reflect mappings, are gaps.',
  },
  {
    key: 'rubrics-workproduct',
    label: 'rubrics & work-product questions',
    focus:
      'Rubric admin editor (apps/web/src/admin/rubrics/**), rubric schema, per-role rubric assignment, MyRubricPage and in-observation rubric rendering/scoring (apps/web/src/components/rubric/**), score persistence and display after finalization, work-product question admin (apps/web/src/admin/work-product/**) and the answer/viewer flows. Rubric edits that break existing observations, scores that do not persist, or questions that never reach users are gaps.',
  },
  {
    key: 'dashboard-ux-polish',
    label: 'dashboard, branding & production UX',
    focus:
      'Staff dashboard (apps/web/src/dashboard/**, deriveCheckpoints), cycle-step configuration actually driving dashboard state, quick materials, branding settings (admin/branding) actually theming the app, plus production polish across the app: loading/empty/error states, optimistic updates vs stale data, toasts on failure (no silent failures), responsive/iPad behavior, and the audit-log admin view. Anything a paying customer would file as "unfinished" is a gap.',
  },
  {
    key: 'pdf-render-integration',
    label: 'PDF renderer & Drive storage',
    focus:
      'apps/pdf-renderer (Hono + Puppeteer Cloud Run service): its HTTP contract, how functions invoke it during finalization, the rendered document fidelity vs the observation editor, Drive upload via service account + DWD, link-back storage on the observation doc, and error handling when rendering or upload fails. A finalization that silently produces no PDF, or a renderer that is never called, is a gap.',
  },
];

const selectedAreas =
  A && Array.isArray(A.areas) && A.areas.length
    ? ALL_AREAS.filter((a) => A.areas.includes(a.key))
    : ALL_AREAS;

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------
const GAP_PROPS = {
  id: { type: 'string', description: 'stable kebab-case slug, prefixed with the area key' },
  area: { type: 'string' },
  title: { type: 'string' },
  category: {
    type: 'string',
    enum: ['broken', 'unwired', 'incomplete', 'missing', 'polish'],
    description:
      'broken=exists but malfunctions; unwired=configurable but never consumed; incomplete=partial path; missing=feature absent; polish=production-readiness',
  },
  currentState: { type: 'string', description: 'what the code does today' },
  expectedBehavior: { type: 'string', description: 'what a finished professional tool would do' },
  evidence: { type: 'string', description: 'one or more file:line references proving the gap' },
  implementationPlan: {
    type: 'string',
    description: 'concrete plan: schema changes, rules changes, functions, UI, tests',
  },
  files: {
    type: 'array',
    items: { type: 'string' },
    description:
      'ALL files the fix would create or edit (relative paths) — complete and conservative, including barrels/rules/schema',
  },
  effort: { type: 'string', enum: ['low', 'medium', 'high'] },
  risk: { type: 'string', enum: ['low', 'medium', 'high'] },
  userImpact: { type: 'integer', minimum: 1, maximum: 10 },
  dependsOn: {
    type: 'array',
    items: { type: 'string' },
    description: 'ids of gaps that must land first',
  },
};

const GATES_SCHEMA = {
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

const AUDIT_SCHEMA = {
  type: 'object',
  required: ['gaps'],
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'title',
          'category',
          'currentState',
          'expectedBehavior',
          'evidence',
          'implementationPlan',
          'files',
          'effort',
          'risk',
          'userImpact',
        ],
        properties: GAP_PROPS,
      },
    },
  },
};

const SKEPTIC_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'confirmed', 'reason'],
        properties: {
          id: { type: 'string' },
          confirmed: { type: 'boolean' },
          reason: { type: 'string' },
          correctedFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'replacement files list if the gap is real but mis-scoped',
          },
          correctedPlan: { type: 'string' },
        },
      },
    },
  },
};

// Synthesis returns a compact EDIT PLAN over the confirmed gaps instead of
// re-emitting every gap object — re-emission blows the structured-output
// token cap once the gap count is large.
const SYNTH_PLAN_SCHEMA = {
  type: 'object',
  required: ['order'],
  properties: {
    order: {
      type: 'array',
      items: { type: 'string' },
      description:
        'ALL surviving gap ids, highest priority first (ship-blockers, then userImpact, then polish). Every confirmed gap id appears exactly once across order/merges.dropIds/drops.',
    },
    merges: {
      type: 'array',
      items: {
        type: 'object',
        required: ['keepId', 'dropIds'],
        properties: {
          keepId: { type: 'string' },
          dropIds: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
      description: 'gaps that are the SAME underlying fix — files are unioned into keepId',
    },
    drops: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'reason'],
        properties: { id: { type: 'string' }, reason: { type: 'string' } },
      },
      description: 'gaps to discard entirely (out of scope, nitpick, duplicate of intended design)',
    },
    depEdits: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'dependsOn'],
        properties: {
          id: { type: 'string' },
          dependsOn: { type: 'array', items: { type: 'string' } },
        },
      },
      description: 'REPLACEMENT dependsOn arrays (use to add cross-area dependencies)',
    },
    fileAdds: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'addFiles'],
        properties: {
          id: { type: 'string' },
          addFiles: { type: 'array', items: { type: 'string' } },
        },
      },
      description: 'extra files a fix will also need to touch (barrels, firestore.rules, fixtures)',
    },
  },
};

const RANKED_SCHEMA = {
  type: 'object',
  required: ['gaps'],
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'area',
          'title',
          'category',
          'currentState',
          'expectedBehavior',
          'evidence',
          'implementationPlan',
          'files',
          'effort',
          'risk',
          'userImpact',
          'dependsOn',
        ],
        properties: GAP_PROPS,
      },
    },
  },
};

const COMPACT_GAPS_SCHEMA = {
  type: 'object',
  required: ['gaps'],
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'files'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          dependsOn: { type: 'array', items: { type: 'string' } },
          effort: { type: 'string' },
          risk: { type: 'string' },
          userImpact: { type: 'integer' },
        },
      },
    },
  },
};

const IMPLEMENT_SCHEMA = {
  type: 'object',
  required: ['gapId', 'status', 'filesChanged', 'summary'],
  properties: {
    gapId: { type: 'string' },
    status: { type: 'string', enum: ['implemented', 'deferred', 'failed'] },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsAdded: { type: 'array', items: { type: 'string' } },
    rulesChanged: { type: 'boolean' },
    summary: { type: 'string' },
    deferReason: { type: 'string' },
  },
};

// ----------------------------------------------------------------------------
// Prompts
// ----------------------------------------------------------------------------
const auditPrompt = (a) =>
  `You are a READ-ONLY feature-completeness auditor for the "${a.label}" subsystem.\n\n${REPO}\n\n` +
  `Focus: ${a.focus}\n\n` +
  `The app is moving from MVP to a fully functional professional tool. Your job is to find every GAP in this ` +
  `subsystem: logic that does not work, admin settings that do not actually configure the experience, ` +
  `integrations that are incomplete, lifecycle states that are unreachable or dead-end, and missing pieces a ` +
  `professional tool must have. TRACE end-to-end — schema → rules → admin UI → functions → end-user UI. ` +
  `Read the actual code; do NOT report a gap you cannot back with specific file:line evidence (for "missing" ` +
  `gaps, cite the file:line where the feature SHOULD hook in). DO NOT modify any code.\n\n` +
  `For each gap return: id (kebab-case, prefixed "${a.key}--"), title, category (broken|unwired|incomplete|missing|polish), ` +
  `currentState, expectedBehavior, evidence (file:line), implementationPlan (concrete: schema, firestore.rules, ` +
  `functions, web UI, tests), files (ALL files the fix would create or edit — complete and conservative), ` +
  `effort (low|medium|high), risk, userImpact (1-10), dependsOn (ids of other gaps of yours that must land first, if any).\n\n` +
  `Quality bar: a real product gap, not a style nitpick. Return every genuine gap you find — do not cap the list.`;

const skepticPrompt = (a, gaps) =>
  `You are an adversarial verifier for a feature-gap audit of the "${a.label}" subsystem.\n\n${REPO}\n\n` +
  `Claimed gaps (JSON):\n\n${JSON.stringify(gaps)}\n\n` +
  `For EACH gap, try to REFUTE it by reading the actual code: maybe the setting IS consumed somewhere the ` +
  `auditor missed (search broadly — hooks, functions, indirect reads), maybe the flow DOES work, maybe it is ` +
  `intentional design. Verify the evidence file:line really shows what is claimed. Also sanity-check the files ` +
  `list (is it complete? does it touch files that don't exist or miss the barrel/rules/schema edits?).\n\n` +
  `Return a verdict per gap: id, confirmed (false if refuted or not worth doing), reason, and optionally ` +
  `correctedFiles / correctedPlan when the gap is real but mis-scoped. Be rigorous — false gaps waste an ` +
  `implementation wave; refuted real gaps leave the product broken. When genuinely uncertain, confirm but say so.`;

const synthPrompt = (all) =>
  `You are the lead engineer turning a verified feature-gap audit into ONE implementation work-list.\n\n${REPO}\n\n` +
  `Confirmed gaps from ${selectedAreas.length} subsystem auditors (JSON):\n\n${JSON.stringify(all)}\n\n` +
  `Return a compact EDIT PLAN (do NOT re-emit the gap objects):\n` +
  `- order: ALL surviving gap ids ranked by priority — ship-blockers first (broken/unwired core flows), then incomplete/missing by userImpact, then polish.\n` +
  `- merges: gaps that are the SAME underlying fix reported by different auditors ({keepId, dropIds}).\n` +
  `- drops: gaps to discard ({id, reason}) — out-of-scope, nitpicks, or claims that contradict intended design.\n` +
  `- depEdits: REPLACEMENT dependsOn arrays — add cross-area dependencies you can see (e.g. a shared schema change another gap builds on); every referenced id must survive.\n` +
  `- fileAdds: files a fix clearly also needs but its list misses (packages/shared barrels, firestore.rules, emulator fixtures).\n` +
  `Every confirmed gap id must appear exactly once across order / merges.dropIds / drops. Be decisive; do not drop real gaps.`;

const criticPrompt = (ranked) =>
  `You are a completeness critic reviewing a feature-gap work-list for HOLES.\n\n${REPO}\n\n` +
  `Current ranked gaps (compact JSON — id/area/title/category/files only):\n\n${JSON.stringify(ranked)}\n\n` +
  `The goal is "fully functional professional tool": all logic works, all admin settings configure the real ` +
  `experience, modules fully customizable, all integrations complete, observation creation/tracking/finalization ` +
  `solid. What is MISSING from this list? Think about: flows nobody audited end-to-end, error/failure paths, ` +
  `multi-user/role interactions, data migration for schema changes, Firestore rules for new collections, ` +
  `emulator fixtures, and seasonal flows (year rollover). Read code to confirm before claiming. Return ONLY NEW ` +
  `gaps (same fields, id prefixed "critic--", with dependsOn referencing existing ids where relevant). If ` +
  `nothing meaningful is missing, return an empty gaps array.`;

const gapBrief = (g) =>
  g.implementationPlan
    ? `GAP (id: ${g.id}) — ${g.title}\n` +
      `- Category: ${g.category}\n- Current state: ${g.currentState}\n- Expected behavior: ${g.expectedBehavior}\n` +
      `- Evidence: ${g.evidence}\n- Plan: ${g.implementationPlan}\n`
    : `GAP (id: ${g.id}) — ${g.title}\n` +
      `- FIRST ACTION: Read ${specFile} and locate the JSON object with id "${g.id}" — it is your full spec ` +
      `(category, currentState, expectedBehavior, evidence with file:line references, implementationPlan). ` +
      `Follow that spec.\n`;

const implementPrompt = (g) =>
  `You are implementing ONE approved feature gap in the existing working tree.\n\n${REPO}\n\n` +
  `${gapBrief(g)}` +
  `- Files you OWN (create/edit ONLY these): ${g.files.join(', ')}\n\n` +
  `Rules:\n` +
  `- Implement the feature COMPLETELY: schema + firestore.rules + functions + UI + tests as the plan requires. No half-wiring.\n` +
  `- Edit ONLY your owned files. If the fix genuinely requires another file, STOP, revert your partial edits, and return status "deferred" with deferReason — a later wave will handle it.\n` +
  `- Add or extend Vitest tests covering the new behavior.\n${GOTCHAS}\n` +
  `- Verify your slice: run \`pnpm --filter @ops/shared build\` if you touched packages/shared, then typecheck the workspaces you touched (e.g. \`pnpm --filter @ops/web typecheck\`) and run the test files you added/changed. Run \`pnpm format\` on your files.\n` +
  `- Keep the change reviewable; preserve unrelated behavior.\n\n` +
  `Return: gapId, status (implemented|deferred|failed), filesChanged, testsAdded, rulesChanged, summary, deferReason (if any).`;

const verifyPrompt = () =>
  `Run the FULL verification gates for this ${REPO}\n\nRun each from the repo root, capturing pass/fail and key error output:\n${GATES}\n\n` +
  `Do NOT fix anything — only run and report. Return: green (true only if ALL pass), gates [{name, pass, details}], summary. ` +
  `(If a command fails because dependencies are missing, run \`pnpm install\` once and retry.)`;

const fixPrompt = (verify, files) =>
  `A verification wave FAILED. Gate results (JSON):\n\n${JSON.stringify(verify)}\n\n` +
  `Files changed in this wave: ${files.join(', ')}\n\n` +
  `Fix the failures so ALL gates pass.\n${GOTCHAS}\n` +
  `Do not discard the wave's intended features unless one is the genuine root cause (if so, explain in summary). ` +
  `After fixing, re-run ALL the gates:\n${GATES}\nand return green, gates, summary.`;

// ----------------------------------------------------------------------------
// Deterministic dependency-aware wave planning (plain JS — no agent)
//   - topological levels by dependsOn, then greedy file-disjoint packing
//   - cycles: broken by ignoring unresolved deps after a stall (logged)
// ----------------------------------------------------------------------------
function planWaves(gaps) {
  const byId = new Map(gaps.map((g) => [g.id, g]));
  const normalized = gaps.map((g) => ({
    ...g,
    files: Array.isArray(g.files) ? g.files : [],
    dependsOn: (Array.isArray(g.dependsOn) ? g.dependsOn : []).filter((d) => byId.has(d)),
  }));

  const placed = new Set();
  const waves = [];
  let remaining = [...normalized].sort((a, b) => (b.userImpact || 0) - (a.userImpact || 0));

  while (remaining.length) {
    let ready = remaining.filter((g) => g.dependsOn.every((d) => placed.has(d)));
    if (!ready.length) {
      log(
        `Dependency cycle among [${remaining.map((g) => g.id).join(', ')}] — breaking cycle, sequencing by impact.`,
      );
      ready = [remaining[0]];
    }
    // pack this dependency level into file-disjoint waves
    const levelWaves = [];
    for (const g of ready) {
      let target = null;
      for (const w of levelWaves) {
        const used = new Set(w.flatMap((x) => x.files));
        if (!g.files.length || g.files.some((f) => used.has(f))) continue;
        target = w;
        break;
      }
      if (!g.files.length) {
        levelWaves.push([g]); // unknown blast radius → solo wave
      } else if (target) {
        target.push(g);
      } else {
        levelWaves.push([g]);
      }
    }
    for (const w of levelWaves) {
      waves.push(w);
      for (const g of w) placed.add(g.id);
    }
    remaining = remaining.filter((g) => !placed.has(g.id));
  }
  return waves;
}

const waveFiles = (wave) => [...new Set(wave.flatMap((g) => g.files || []))];

// Cost routing: send each implementer to the cheapest model that can do the job,
// using BOTH the audit's effort and risk scores. RISK gates the apex model — a
// one-line firestore.rules/auth change is "low effort" but a mistake is
// dangerous, so it still goes to Fable. Otherwise effort sets the tier. This is
// the dominant cost lever — there are 100+ implementers but only one of every
// other agent role.
//   high risk (anything)        → fable  (security/rules/auth/transaction)
//   high effort, low/med risk   → opus   (big multi-file features)
//   low effort                  → haiku  (mechanical wiring)
//   medium effort               → sonnet (standard feature work)
const modelForGap = (effort, risk) =>
  risk === 'high' ? 'fable' : effort === 'high' ? 'opus' : effort === 'low' ? 'haiku' : 'sonnet';

// ============================================================================
// Orchestration
// ============================================================================
let gaps = [];
let baseline = null;

if (mode !== 'implement') {
  // Phase A — green baseline
  phase('Baseline');
  log('Establishing a green baseline (shared build + typecheck + test + build)...');
  baseline = await agent(
    `Establish a green baseline for this ${REPO}\n\nRun \`pnpm --filter @ops/shared build\`, \`pnpm typecheck\`, \`pnpm test\`, and \`pnpm build\` ` +
      `from the repo root (run \`pnpm install\` first only if dependencies are missing). Do NOT change any code. ` +
      `Return: green (true only if all pass), gates [{name, pass, details}], summary.`,
    { label: 'baseline', phase: 'Baseline', schema: GATES_SCHEMA, model: 'sonnet' },
  );
  if (!baseline || !baseline.green) {
    log('Baseline is RED — refusing to start feature work on a broken tree.');
    return { mode, baseline, aborted: true, reason: 'Baseline not green.' };
  }

  // Phase B — audit + skeptic, pipelined per area (no barrier between the two)
  phase('Audit');
  log(`Auditing ${selectedAreas.length} subsystems in parallel (audit → skeptic per area)...`);
  const areaResults = await pipeline(
    selectedAreas,
    (a) =>
      agent(auditPrompt(a), {
        label: `audit:${a.key}`,
        phase: 'Audit',
        schema: AUDIT_SCHEMA,
        model: 'sonnet',
      }),
    (audit, a) => {
      const found = (audit && audit.gaps) || [];
      if (!found.length) return { area: a.key, confirmed: [] };
      return agent(skepticPrompt(a, found), {
        label: `skeptic:${a.key}`,
        phase: 'Skeptic',
        schema: SKEPTIC_SCHEMA,
        model: 'sonnet',
      }).then((s) => {
        const verdicts = new Map(((s && s.verdicts) || []).map((v) => [v.id, v]));
        const confirmed = found
          .filter((g) => {
            const v = verdicts.get(g.id);
            return !v || v.confirmed; // missing verdict → keep (skeptic must refute explicitly)
          })
          .map((g) => {
            const v = verdicts.get(g.id);
            return {
              ...g,
              area: a.key,
              files:
                v && Array.isArray(v.correctedFiles) && v.correctedFiles.length
                  ? v.correctedFiles
                  : g.files,
              implementationPlan: v && v.correctedPlan ? v.correctedPlan : g.implementationPlan,
            };
          });
        log(`${a.key}: ${found.length} found → ${confirmed.length} confirmed.`);
        return { area: a.key, confirmed };
      });
    },
  );
  const confirmedGaps = areaResults.filter(Boolean).flatMap((r) => r.confirmed || []);
  log(`Confirmed ${confirmedGaps.length} gaps across ${selectedAreas.length} subsystems.`);
  if (!confirmedGaps.length) {
    return {
      mode,
      baseline,
      rankedGaps: [],
      note: 'No confirmed gaps — app appears feature-complete.',
    };
  }

  // Phase C — synthesize ONE ranked, dependency-annotated work-list.
  // The synthesizer returns a compact edit plan; we apply it here in plain JS
  // (re-emitting every gap object blows the structured-output token cap).
  phase('Synthesize');
  const plan = await agent(synthPrompt(confirmedGaps), {
    label: 'synthesize',
    phase: 'Synthesize',
    schema: SYNTH_PLAN_SCHEMA,
  });
  if (plan && Array.isArray(plan.order) && plan.order.length) {
    const byId = new Map(confirmedGaps.map((g) => [g.id, { ...g }]));
    const dropped = new Set();
    const mergedInto = new Map();
    for (const d of plan.drops || []) dropped.add(d.id);
    for (const m of plan.merges || []) {
      const keep = byId.get(m.keepId);
      if (!keep) continue;
      for (const dropId of m.dropIds || []) {
        const dup = byId.get(dropId);
        if (!dup || dropId === m.keepId) continue;
        keep.files = [...new Set([...(keep.files || []), ...(dup.files || [])])];
        mergedInto.set(dropId, m.keepId);
        dropped.add(dropId);
      }
    }
    for (const e of plan.depEdits || []) {
      const g = byId.get(e.id);
      if (g) g.dependsOn = e.dependsOn;
    }
    for (const fa of plan.fileAdds || []) {
      const g = byId.get(fa.id);
      if (g) g.files = [...new Set([...(g.files || []), ...(fa.addFiles || [])])];
    }
    const seen = new Set();
    gaps = [];
    for (const id of plan.order) {
      const g = byId.get(id);
      if (g && !dropped.has(id) && !seen.has(id)) {
        seen.add(id);
        gaps.push(g);
      }
    }
    // safety net: anything the plan forgot to mention survives, lowest priority
    for (const g of confirmedGaps) {
      if (!dropped.has(g.id) && !seen.has(g.id)) {
        seen.add(g.id);
        gaps.push(byId.get(g.id));
      }
    }
    // remap dependsOn through merges, then prune dangling references
    for (const g of gaps) {
      g.dependsOn = [
        ...new Set(
          (g.dependsOn || [])
            .map((d) => mergedInto.get(d) || d)
            .filter((d) => seen.has(d) && d !== g.id),
        ),
      ];
    }
    log(
      `Synthesis applied: ${gaps.length} gaps (${(plan.merges || []).length} merges, ${(plan.drops || []).length} drops).`,
    );
  } else {
    log('Synthesizer returned no usable plan — falling back to impact-ranked confirmed gaps.');
    gaps = [...confirmedGaps].sort((a, b) => (b.userImpact || 0) - (a.userImpact || 0));
  }

  // Phase D — completeness critic (input is a compact projection to keep tokens sane)
  if (runCritic && gaps.length) {
    phase('Critic');
    const compact = gaps.map((g) => ({
      id: g.id,
      area: g.area,
      title: g.title,
      category: g.category,
      files: g.files,
    }));
    const extra = await agent(criticPrompt(compact), {
      label: 'critic',
      phase: 'Critic',
      schema: RANKED_SCHEMA,
      model: 'sonnet',
    });
    const fresh = ((extra && extra.gaps) || []).filter(
      (g) => g && !gaps.some((x) => x.id === g.id),
    );
    if (fresh.length) log(`Critic surfaced ${fresh.length} additional gap(s).`);
    gaps = gaps.concat(fresh);
  }
  log(`Final work-list: ${gaps.length} gaps.`);

  if (mode === 'audit') {
    return { mode, baseline, rankedGaps: gaps };
  }
} else {
  gaps = (A && A.gaps) || [];
  if (!gaps.length && A && A.gapsFile) {
    phase('Plan');
    log(`Loading approved gap list from ${A.gapsFile}...`);
    const loaded = await agent(
      `Read the file ${A.gapsFile} (path relative to the repo root). It contains a JSON array of gap planning entries ` +
        `({id, title, files, dependsOn, effort, risk, userImpact}). Return its contents EXACTLY as written — do not edit, ` +
        `reorder, summarize, or drop entries.`,
      { label: 'load-gaps', phase: 'Plan', schema: COMPACT_GAPS_SCHEMA, model: 'haiku' },
    );
    gaps = (loaded && loaded.gaps) || [];
  }
  if (!gaps.length) {
    return {
      mode,
      aborted: true,
      reason: 'mode "implement" requires args.gaps or args.gapsFile (approved work-list).',
    };
  }
  log(`Implementing ${gaps.length} pre-approved gaps.`);
}

// Phase E — deterministic wave plan
phase('Plan');
let waves = planWaves(gaps);
const deferrals = [];
if (waves.length > maxWaves) {
  for (const w of waves.slice(maxWaves))
    for (const g of w) deferrals.push({ gapId: g.id, reason: `beyond maxWaves=${maxWaves}` });
  waves = waves.slice(0, maxWaves);
}
log(
  `Planned ${waves.length} wave(s)${deferrals.length ? `; ${deferrals.length} gap(s) deferred` : ''}.`,
);

// Phase F — implement wave by wave (sequential; verify + fix after each)
const implementation = [];
const waveVerifications = [];
let lastVerify = null;

for (let i = 0; i < waves.length; i++) {
  const wave = waves[i];
  const tag = `Wave ${i + 1}/${waves.length}`;
  phase(tag);
  log(`${tag}: implementing ${wave.length} gap(s) [${wave.map((g) => g.id).join(', ')}].`);

  const results = await parallel(
    wave.map(
      (g) => () =>
        agent(implementPrompt(g), {
          label: `impl:${g.id}`,
          phase: tag,
          schema: IMPLEMENT_SCHEMA,
          model: modelForGap(g.effort, g.risk),
        }),
    ),
  );
  for (const r of results) if (r) implementation.push({ wave: i + 1, ...r });

  let verify = await agent(verifyPrompt(), {
    label: `verify:w${i + 1}`,
    phase: tag,
    schema: GATES_SCHEMA,
    model: 'sonnet',
  });
  if (verify && !verify.green) {
    log(`${tag}: gates red — dispatching a fix agent.`);
    const fix = await agent(fixPrompt(verify, waveFiles(wave)), {
      label: `fix:w${i + 1}`,
      phase: tag,
      schema: GATES_SCHEMA,
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

// Phase G — structured report
phase('Report');
return {
  mode,
  baseline,
  rankedGaps: gaps,
  wavePlan: waves.map((w, i) => ({
    wave: i + 1,
    gapIds: w.map((g) => g.id),
    files: waveFiles(w),
  })),
  implementation,
  waveVerifications,
  finalStatus: lastVerify,
  deferrals,
  note:
    'Workflow self-reports above. The orchestrator must independently re-run the full gates, inspect git status/diff ' +
    '(agents can mis-report), then commit, push, and monitor CI/deploy. firestore.rules changes additionally need ' +
    '`pnpm test:rules` run by the orchestrator with the documented emulator env (TEMP=C:/Temp, Java 21).',
};
