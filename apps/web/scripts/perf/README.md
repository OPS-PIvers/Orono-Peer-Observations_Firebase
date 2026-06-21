# Page-load performance harness

A repeatable First-Contentful-Paint (FCP) benchmark for every route in the app,
used to guard against critical-path bundle regressions.

## Run it

```bash
pnpm --filter @ops/web perf            # build + serve + measure every route
pnpm --filter @ops/web perf -- --no-build   # reuse the existing dist/
pnpm --filter @ops/web perf -- --runs 15     # more samples (lower noise)
```

## Method (held constant for comparability)

1. **Build** the production bundle once with a fixed, hermetic Firebase config
   (fake keys, no emulator) so the SDK initializes without throwing and no
   backend is required.
2. **Serve** `dist/` with `vite preview` on a fixed localhost port.
3. **Drive** headless Chromium (Playwright) at a fixed 1280×800 viewport, no CPU
   or network throttling, sharing one browser context so the HTTP cache is warm
   — i.e. the returning-visitor load, dominated by JS parse/exec + render.
4. For each route in [`routes.mjs`](./routes.mjs): one warmup navigation, then N
   measured navigations. The reported number is the **median FCP**.

A route passes when its median FCP is below the threshold (default **50 ms**).
The process exits non-zero if any route is over, so the harness can gate CI.

> Auth-gated routes resolve client-side to the loading splash / sign-in screen
> when unauthenticated, but the navigation still loads and executes the full
> shared critical path (HTML + entry + react-vendor + router). That shared cost
> is exactly what this harness tracks; per-route page chunks load lazily after
> first paint and so don't gate FCP.

## What the critical path looks like

The Firebase SDK, the signed-in `Layout` subtree, TipTap, and the Zod schema
barrel are all kept **off** the initial entry chunk (lazy `import()` / code
splitting / `sideEffects:false` tree-shaking). First paint needs only React +
the small app shell, so every route paints well under the threshold.
