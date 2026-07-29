/**
 * Synthetic emulator seed — writes a small, realistic, zero-PII dataset into
 * the Firestore emulator so `pnpm dev:emulators` boots a useful local
 * environment without requiring a GAS spreadsheet or production credentials.
 *
 * Run directly (emulator must already be running on 127.0.0.1:8080):
 *
 *   pnpm seed:dev
 *
 * Or let the dev:emulators:seed package.json script do it automatically when
 * the fixtures/seed snapshot is absent:
 *
 *   pnpm dev:emulators:seed
 *
 * The seeder is idempotent: documents are written with { merge: false } using
 * set() — existing docs are overwritten so re-runs always reach the same state.
 *
 * Collections seeded:
 *   /staff          — 1 admin, 2 peer evaluators, 6 teachers
 *   /roles          — administrator, peer-evaluator, teacher, counselor
 *   /rubrics        — one minimal 4-domain rubric shared by teacher & PE roles
 *   /roleYearMappings — active components for each (role, year) pair
 *   /buildings      — OHS, OMS
 *   /appSettings/global
 *   /emailTemplates — all SYSTEM_TEMPLATES from scripts/import/seed.ts
 *   /modules        — one example mentor-program module
 */

import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  SPECIAL_ROLES,
  DEFAULT_SCHEDULING_SETTINGS,
  roleYearMappingDocId,
  APP_SETTINGS_DOC_ID,
} from '@ops/shared';
import { initFirestore } from './import/firebase.js';
import { SYSTEM_TEMPLATES, defaultAppSettings } from './import/seed.js';

loadDotenv();

// ---------------------------------------------------------------------------
// Synthetic data constants (no real PII — all @orono.k12.mn.us addresses
// follow a first.last@orono.k12.mn.us pattern but refer to fictional people)
// ---------------------------------------------------------------------------

const NOW = new Date();
const UPDATED_AT = NOW;

/** Minimal 4-domain Danielson-style rubric reused by teacher & PE roles. */
const TEACHER_RUBRIC_ID = 'teacher';

const TEACHER_RUBRIC = {
  rubricId: TEACHER_RUBRIC_ID,
  displayName: 'Classroom Teacher Rubric',
  domains: [
    {
      id: '1',
      name: 'Domain 1 — Planning and Preparation',
      components: [
        {
          id: '1a',
          title: 'Demonstrating Knowledge of Content and Pedagogy',
          proficiencyLevels: {
            developing: 'Limited knowledge of content.',
            basic: 'Some knowledge of content.',
            proficient: 'Solid content knowledge.',
            distinguished: 'Extensive pedagogical expertise.',
          },
          lookFors: [
            { id: 'lf-1a-1', text: 'References standards-aligned resources' },
            { id: 'lf-1a-2', text: 'Anticipates student misconceptions' },
          ],
        },
        {
          id: '1b',
          title: 'Demonstrating Knowledge of Students',
          proficiencyLevels: {
            developing: 'Little knowledge of students.',
            basic: 'Basic knowledge of students.',
            proficient: 'Understands student backgrounds.',
            distinguished: 'Uses comprehensive student data.',
          },
          lookFors: [],
        },
      ],
    },
    {
      id: '2',
      name: 'Domain 2 — Classroom Environment',
      components: [
        {
          id: '2a',
          title: 'Creating an Environment of Respect and Rapport',
          proficiencyLevels: {
            developing: 'Interactions are negative or inappropriate.',
            basic: 'Interactions are generally appropriate.',
            proficient: 'Interactions are positive.',
            distinguished: 'Students take on leadership for respectful interactions.',
          },
          lookFors: [
            { id: 'lf-2a-1', text: 'Uses student names correctly' },
            { id: 'lf-2a-2', text: 'Responds respectfully to student errors' },
          ],
        },
        {
          id: '2b',
          title: 'Establishing a Culture for Learning',
          proficiencyLevels: {
            developing: 'Learning is not valued.',
            basic: 'Some value for learning.',
            proficient: 'High expectations communicated.',
            distinguished: 'Students hold each other to high standards.',
          },
          lookFors: [],
        },
      ],
    },
    {
      id: '3',
      name: 'Domain 3 — Instruction',
      components: [
        {
          id: '3a',
          title: 'Communicating with Students',
          proficiencyLevels: {
            developing: 'Communication is unclear.',
            basic: 'Communication is adequate.',
            proficient: 'Communication is clear and accurate.',
            distinguished: 'Communication is highly effective.',
          },
          lookFors: [{ id: 'lf-3a-1', text: 'Uses precise academic language' }],
        },
        {
          id: '3c',
          title: 'Engaging Students in Learning',
          proficiencyLevels: {
            developing: 'Students are passive.',
            basic: 'Some student engagement.',
            proficient: 'Most students are engaged.',
            distinguished: 'All students are highly engaged.',
          },
          lookFors: [
            { id: 'lf-3c-1', text: 'Tasks require higher-order thinking' },
            { id: 'lf-3c-2', text: 'Students self-direct their learning' },
          ],
        },
      ],
    },
    {
      id: '4',
      name: 'Domain 4 — Professional Responsibilities',
      components: [
        {
          id: '4a',
          title: 'Reflecting on Teaching',
          proficiencyLevels: {
            developing: 'Does not reflect accurately.',
            basic: 'Some accurate reflection.',
            proficient: 'Accurate reflection on practice.',
            distinguished: 'Detailed, accurate, forward-looking reflection.',
          },
          lookFors: [],
        },
        {
          id: '4b',
          title: 'Maintaining Accurate Records',
          proficiencyLevels: {
            developing: 'Records are inaccurate.',
            basic: 'Basic record-keeping.',
            proficient: 'Records are accurate and timely.',
            distinguished: 'Systems for records shared with students.',
          },
          lookFors: [],
        },
      ],
    },
  ],
  createdAt: NOW,
  updatedAt: UPDATED_AT,
};

/** Role docs — four roles cover the common dev scenarios. */
const ROLES = [
  {
    roleId: SPECIAL_ROLES.administrator,
    displayName: 'Administrator',
    isSpecialAccess: true,
    rubricId: TEACHER_RUBRIC_ID,
    isActive: true,
    color: 'rose' as const,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
  {
    roleId: SPECIAL_ROLES.peerEvaluator,
    displayName: 'Peer Evaluator',
    isSpecialAccess: true,
    rubricId: TEACHER_RUBRIC_ID,
    isActive: true,
    color: 'violet' as const,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
  {
    roleId: 'teacher',
    displayName: 'Teacher',
    isSpecialAccess: false,
    rubricId: TEACHER_RUBRIC_ID,
    isActive: true,
    color: 'blue' as const,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
  {
    roleId: 'counselor',
    displayName: 'Counselor',
    isSpecialAccess: false,
    rubricId: TEACHER_RUBRIC_ID,
    isActive: true,
    color: 'green' as const,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
];

/** Staff docs — all synthetic, @orono.k12.mn.us addresses only. */
const STAFF = [
  {
    email: 'admin.seed@orono.k12.mn.us',
    name: 'Admin Seed',
    role: SPECIAL_ROLES.administrator,
    year: 1 as const,
    buildings: ['orono-high-school'],
    modules: [] as string[],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: true,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
  {
    email: 'pe.alpha@orono.k12.mn.us',
    name: 'Alpha Peer Evaluator',
    role: SPECIAL_ROLES.peerEvaluator,
    year: 2 as const,
    buildings: ['orono-high-school'],
    modules: [] as string[],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
  {
    email: 'pe.beta@orono.k12.mn.us',
    name: 'Beta Peer Evaluator',
    role: SPECIAL_ROLES.peerEvaluator,
    year: 1 as const,
    buildings: ['orono-middle-school'],
    modules: [] as string[],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
  {
    email: 'teacher.one@orono.k12.mn.us',
    name: 'Teacher One',
    role: 'teacher',
    year: 1 as const,
    buildings: ['orono-high-school'],
    modules: ['mentor-program'] as string[],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
  {
    email: 'teacher.two@orono.k12.mn.us',
    name: 'Teacher Two',
    role: 'teacher',
    year: 2 as const,
    buildings: ['orono-high-school'],
    modules: [] as string[],
    summativeYear: true,
    isActive: true,
    hasAdminAccess: false,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
  {
    email: 'teacher.three@orono.k12.mn.us',
    name: 'Teacher Three',
    role: 'teacher',
    year: 3 as const,
    buildings: ['orono-middle-school'],
    modules: [] as string[],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
  {
    email: 'teacher.four@orono.k12.mn.us',
    name: 'Teacher Four',
    role: 'teacher',
    year: 4 as const,
    buildings: ['orono-middle-school'],
    modules: [] as string[],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
  {
    email: 'teacher.five@orono.k12.mn.us',
    name: 'Teacher Five',
    role: 'teacher',
    year: 5 as const,
    buildings: ['orono-high-school'],
    modules: [] as string[],
    summativeYear: true,
    isActive: true,
    hasAdminAccess: false,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
  {
    email: 'counselor.one@orono.k12.mn.us',
    name: 'Counselor One',
    role: 'counselor',
    year: 1 as const,
    buildings: ['orono-high-school', 'orono-middle-school'],
    modules: [] as string[],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
];

/** Buildings — two school buildings. */
const BUILDINGS = [
  {
    buildingId: 'orono-high-school',
    displayName: 'Orono High School',
    color: 'blue' as const,
    isActive: true,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
  {
    buildingId: 'orono-middle-school',
    displayName: 'Orono Middle School',
    color: 'green' as const,
    isActive: true,
    createdAt: NOW,
    updatedAt: UPDATED_AT,
  },
];

/** Role-year mappings for teacher (years 1-6) and PE (years 1-2).
 *  Uses only the components defined in TEACHER_RUBRIC above. */
const ROLE_YEAR_MAPPINGS: { roleId: string; year: number; components: string[] }[] = [
  // Teachers — years 1-3: 1a + 2a + 3c; years 4-6: all components
  { roleId: 'teacher', year: 1, components: ['1a', '2a', '3c'] },
  { roleId: 'teacher', year: 2, components: ['1a', '2a', '3c'] },
  { roleId: 'teacher', year: 3, components: ['1a', '2a', '3c'] },
  { roleId: 'teacher', year: 4, components: ['1a', '1b', '2a', '2b', '3a', '3c', '4a', '4b'] },
  { roleId: 'teacher', year: 5, components: ['1a', '1b', '2a', '2b', '3a', '3c', '4a', '4b'] },
  { roleId: 'teacher', year: 6, components: ['1a', '1b', '2a', '2b', '3a', '3c', '4a', '4b'] },
  // Peer Evaluators — same component set for all years
  {
    roleId: SPECIAL_ROLES.peerEvaluator,
    year: 1,
    components: ['1a', '1b', '2a', '2b', '3a', '3c'],
  },
  {
    roleId: SPECIAL_ROLES.peerEvaluator,
    year: 2,
    components: ['1a', '1b', '2a', '2b', '3a', '3c'],
  },
  // Counselors — years 1-3 only
  { roleId: 'counselor', year: 1, components: ['1a', '2a', '3c'] },
  { roleId: 'counselor', year: 2, components: ['1a', '2a', '3c'] },
  { roleId: 'counselor', year: 3, components: ['1a', '2a', '3c'] },
];

const MODULE_ID = 'mentor-program';
const MODULE_DOC = {
  moduleId: MODULE_ID,
  displayName: 'Mentor Program',
  description: 'Resources and materials for district mentors.',
  color: 'amber' as const,
  isActive: true,
  hasPage: true,
  icon: 'users' as const,
  sections: [
    { id: 'sec-intro', type: 'richtext' as const, title: 'Introduction' },
    { id: 'sec-resources', type: 'resources' as const, title: 'Resources' },
  ],
  autoEnable: null,
  createdAt: NOW,
  updatedAt: UPDATED_AT,
};

// ---------------------------------------------------------------------------
// Main seeder
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';
  process.env['FIREBASE_AUTH_EMULATOR_HOST'] ??= '127.0.0.1:9099';

  const db = initFirestore('emulator');

  const counts = {
    staff: 0,
    roles: 0,
    rubrics: 0,
    roleYearMappings: 0,
    buildings: 0,
    appSettings: 0,
    emailTemplates: 0,
    modules: 0,
  };

  // Staff
  for (const s of STAFF) {
    if (!dryRun) {
      await db
        .collection(COLLECTIONS.staff)
        .doc(s.email)
        .set({
          ...s,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
    }
    console.log(`  ${dryRun ? 'would write' : 'write'}  staff/${s.email}`);
    counts.staff += 1;
  }

  // Roles
  for (const r of ROLES) {
    if (!dryRun) {
      await db
        .collection(COLLECTIONS.roles)
        .doc(r.roleId)
        .set({
          ...r,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
    }
    console.log(`  ${dryRun ? 'would write' : 'write'}  roles/${r.roleId}`);
    counts.roles += 1;
  }

  // Rubric
  if (!dryRun) {
    await db
      .collection(COLLECTIONS.rubrics)
      .doc(TEACHER_RUBRIC.rubricId)
      .set({
        ...TEACHER_RUBRIC,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
  }
  console.log(`  ${dryRun ? 'would write' : 'write'}  rubrics/${TEACHER_RUBRIC.rubricId}`);
  counts.rubrics += 1;

  // Role-year mappings
  for (const mapping of ROLE_YEAR_MAPPINGS) {
    const docId = roleYearMappingDocId(mapping.roleId, mapping.year);
    const doc = {
      roleId: mapping.roleId,
      year: mapping.year,
      assignedComponentIds: mapping.components,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!dryRun) {
      await db.collection(COLLECTIONS.roleYearMappings).doc(docId).set(doc);
    }
    console.log(`  ${dryRun ? 'would write' : 'write'}  roleYearMappings/${docId}`);
    counts.roleYearMappings += 1;
  }

  // Buildings
  for (const b of BUILDINGS) {
    if (!dryRun) {
      await db
        .collection(COLLECTIONS.buildings)
        .doc(b.buildingId)
        .set({
          ...b,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
    }
    console.log(`  ${dryRun ? 'would write' : 'write'}  buildings/${b.buildingId}`);
    counts.buildings += 1;
  }

  // App settings
  const appSettingsDoc = {
    ...defaultAppSettings('admin.seed@orono.k12.mn.us'),
    scheduling: DEFAULT_SCHEDULING_SETTINGS,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!dryRun) {
    await db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).set(appSettingsDoc);
  }
  console.log(`  ${dryRun ? 'would write' : 'write'}  appSettings/${APP_SETTINGS_DOC_ID}`);
  counts.appSettings += 1;

  // Email templates
  for (const tmpl of SYSTEM_TEMPLATES) {
    if (!dryRun) {
      await db
        .collection(COLLECTIONS.emailTemplates)
        .doc(tmpl.templateId)
        .set({
          ...tmpl,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
    }
    console.log(`  ${dryRun ? 'would write' : 'write'}  emailTemplates/${tmpl.templateId}`);
    counts.emailTemplates += 1;
  }

  // Module
  if (!dryRun) {
    await db
      .collection(COLLECTIONS.modules)
      .doc(MODULE_DOC.moduleId)
      .set({
        ...MODULE_DOC,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
  }
  console.log(`  ${dryRun ? 'would write' : 'write'}  modules/${MODULE_DOC.moduleId}`);
  counts.modules += 1;

  console.log(
    `\n[seed:dev]${dryRun ? ' (dry-run)' : ''} target=emulator` +
      ` staff=${counts.staff.toString()} roles=${counts.roles.toString()} rubrics=${counts.rubrics.toString()}` +
      ` mappings=${counts.roleYearMappings.toString()} buildings=${counts.buildings.toString()}` +
      ` appSettings=${counts.appSettings.toString()} emailTemplates=${counts.emailTemplates.toString()} modules=${counts.modules.toString()}`,
  );

  if (!dryRun) {
    console.log(
      '\nSeed complete. Capture a snapshot with:\n' +
        '  firebase emulators:export ./fixtures/seed\n' +
        'Then pnpm dev:emulators will import it automatically.',
    );
  }
}

// Run main() only when the script is invoked directly, not when imported
// as a module (e.g. by seed-dev.test.ts). ESM equivalent of
// `require.main === module`.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error('[seed:dev] failed:', err);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Exported for unit tests
// ---------------------------------------------------------------------------

export {
  STAFF,
  ROLES,
  TEACHER_RUBRIC,
  ROLE_YEAR_MAPPINGS,
  BUILDINGS,
  MODULE_DOC,
  TEACHER_RUBRIC_ID,
  MODULE_ID,
};
