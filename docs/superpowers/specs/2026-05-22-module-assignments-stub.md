# Module Assignments (Google-Doc Workflow) — Vision Stub

- **Date:** 2026-05-22
- **Status:** Captured, NOT scheduled. Needs its own full brainstorm → spec → plan.
- **Relationship:** Extends the existing module system
  (`2026-05-20-module-system-design.md`). Connects to the
  `2026-05-22-dashboard-step-builder-design.md` at one point (see Integration).

> This is a placeholder so the idea isn't lost. It is intentionally NOT a
> complete design. Do not implement from this document.

## The idea

Modules need richer, completable tasks beyond evergreen "materials". The driving
example: a "High Cycle" module whose work is a set of Google Docs the staff
member must complete.

Proposed "assignment" workflow (a new module-item kind):

1. **Admin creates an assignment** inside a module: embeds a Google Doc and
   assigns it (to staff, roles, or auto-enable rules — like modules today).
2. **Staff opens it** from the dashboard/module. Opening **creates their own
   copy** of the Doc (so the template is never edited) and the copy is
   **embedded in-app**, so the staff member doesn't have to track the file.
3. **Staff submits**, which **marks the item done** and **notifies a specified
   person** (e.g. the assigner / peer evaluator / admin).
4. Other module workflows of this shape ("open → work → submit → notify") follow
   the same pattern.

## Why it's a separate project

It introduces capabilities the step builder does not:

- **Google Drive integration** — programmatic copy of a Doc into the staff
  member's (or a service-owned) Drive, with an embeddable view. Auth model,
  copy ownership, and sharing/permissions are all open and non-trivial. (Note:
  the app's safety rules prohibit changing sharing/permissions on the user's
  behalf — this needs careful design and likely a backend/service account.)
- **Assignment + submission data model** — assignment definitions, per-staff
  copies, submission state, timestamps.
- **Notifications** — channel (email? in-app?) and recipient selection.

## Integration point with the step builder

When an assignment is submitted it should be a **trackable event** the dashboard
step builder can watch. Concretely: register `assignmentSubmitted` (likely
parameterized by assignment/module id) in the interpreter's `EVENT_EVALUATORS`
and add its option to the Show/Done dropdowns; extend `DeriveContext` with the
assignment/submission state. No change to the interpreter shape — this is the
extensibility the step-builder design reserves.

## Open questions (to resolve in its own brainstorm)

- Drive API auth: per-user OAuth vs. service account? Where do copies live and
  who owns them?
- Embedding: iframe of the Doc? Editing in-place vs. "open in Drive"?
- Submission semantics: is "submit" reversible? Versioning?
- Notification: email via existing functions, or in-app only? Who is "the
  specified person" and how is it configured per assignment?
- Relationship to existing `moduleProgress` (done-item tracking) — reuse or
  extend?
- Permissions/safety review for any Drive sharing actions.
