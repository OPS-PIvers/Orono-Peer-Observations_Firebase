# @ops/pdf-renderer

Cloud Run service (Hono + Puppeteer) that renders observation PDFs for the
Peer Evaluator Observations app.

- **Service:** `pdf-renderer` · **Region:** `us-central1` · **Project:** `peer-evaluator-rubric`
- **URL:** `https://pdf-renderer-968674433533.us-central1.run.app` (configured for
  `@ops/functions` via `PDF_RENDERER_URL` in `apps/functions/.env.peer-evaluator-rubric`)

## How it's invoked

The sole consumers are the `finalizeObservation` and `regenerateObservationPdf`
Cloud Functions (`apps/functions/src/lib/pdfRenderer.ts`). They fetch the
observation + rubric with the Admin SDK, `POST` the payload to
`/render-observation`, and receive PDF bytes back. Auth is Cloud Run IAM:
the service deploys with `--no-allow-unauthenticated`, and the functions'
runtime service account holds `roles/run.invoker` on it. There is no
application-level auth and the service needs no secrets — only `PORT`
(Cloud Run-provided) and `NODE_ENV=production`.

## Deploying

`.github/workflows/deploy-pdf-renderer.yml` deploys automatically:

- **Push to `dev-paul`** touching `apps/pdf-renderer/**` (or the workflow
  file itself) → builds the image with Cloud Build (via `cloudbuild.yaml`,
  which sets the repo-root build context the Dockerfile needs for pnpm
  workspace deps) and runs `gcloud run deploy`.
- **Manual:** GitHub → Actions → "Deploy — pdf-renderer (Cloud Run)" → Run
  workflow → type `DEPLOY` to confirm (same gate as the production deploy).

Images are tagged with the commit SHA (plus `latest`) and pushed to
`us-central1-docker.pkg.dev/peer-evaluator-rubric/cloud-run-source-deploy/pdf-renderer`.

### IAM prerequisites

The deployer service account behind the `FIREBASE_SERVICE_ACCOUNT` GitHub
secret needs these roles in `peer-evaluator-rubric` (it may not have them
yet — the workflow will fail on the Cloud Build step until granted):

| Role                             | Why                                                        |
| -------------------------------- | ---------------------------------------------------------- |
| `roles/cloudbuild.builds.editor` | Submit Cloud Build jobs                                    |
| `roles/storage.objectAdmin`      | Upload build source to the `<project>_cloudbuild` bucket   |
| `roles/artifactregistry.writer`  | Push images to `cloud-run-source-deploy`                   |
| `roles/run.admin`                | Create/update the Cloud Run service                        |
| `roles/iam.serviceAccountUser`   | Act as the Cloud Run runtime service account during deploy |

## Local development

```sh
pnpm --filter @ops/pdf-renderer dev      # tsx watch on :8080
pnpm --filter @ops/pdf-renderer test     # vitest
pnpm --filter @ops/pdf-renderer docker:build && pnpm --filter @ops/pdf-renderer docker:run
```
