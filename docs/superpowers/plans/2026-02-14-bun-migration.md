# Bun Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate ligerotools from npm to Bun as package manager and rename the default branch from `master` to `main` (local and remote).

**Architecture:** Minimal adoption — Bun replaces npm for install/run only; app code and test files are untouched. Test runner compatibility with Bun is probed first; `node --test` remains the documented fallback if Bun cannot run the suite. Deploy configs (Netlify/Vercel) switch their build command to `bun run build`. Branch rename happens last so the remote receives the complete migration.

**Tech Stack:** Bun 1.3.14, Vite 8, React 19, TypeScript 6, oxlint, node:test (existing suite), Git

## Global Constraints

- Do NOT modify `src/`, test file contents, `tsconfig.*`, `vite.config.ts`, or `.oxlintrc.json`
- Do NOT add a `packageManager` field to `package.json`
- Do NOT rewrite tests to `bun:test`
- Do NOT deploy to Netlify/Vercel — config changes only
- Scripts in `package.json` (`dev`, `build`, `lint`, `preview`) stay unchanged
- Git identity for all commits: `GinoNovello <ginonovello9@gmail.com>` (already configured in repo)
- Spec: `docs/superpowers/specs/2026-02-14-bun-migration-design.md`

---

### Task 1: Replace npm lockfile with Bun lockfile

**Files:**
- Delete: `package-lock.json`
- Create: `bun.lock` (via `bun install`)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: existing `package.json` (unchanged)
- Produces: `bun.lock` at repo root; `node_modules` installed by Bun; `.gitignore` ignores `bun-debug.log*`

- [ ] **Step 1: Clean npm artifacts**

```bash
rm -rf node_modules package-lock.json
```

Expected: no output; `package-lock.json` gone from working tree (shows as deleted in `git status`).

- [ ] **Step 2: Install with Bun**

```bash
bun install
```

Expected: completes successfully; creates `bun.lock` and `node_modules/`. No `package-lock.json` regenerated.

- [ ] **Step 3: Add bun-debug.log to .gitignore**

Edit `.gitignore` — after the line `pnpm-debug.log*`, add:

```gitignore
bun-debug.log*
```

The logs section becomes:

```gitignore
# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
bun-debug.log*
lerna-debug.log*
```

- [ ] **Step 4: Verify install and lint**

```bash
test -f bun.lock && test ! -f package-lock.json && echo "lockfile OK"
bun run lint
```

Expected: `lockfile OK`; oxlint passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Migrate package manager from npm to Bun"
```

Expected: commit by `GinoNovello <ginonovello9@gmail.com>`; message matches.

---

### Task 2: Verify lint, types, and build under Bun

**Files:**
- None modified (verification only)
- Consumes: Task 1's Bun install

**Interfaces:**
- Produces: confirmation that `bun run lint`, `bunx tsc -b`, `bun run build` all pass; `dist/` generated

- [ ] **Step 1: Run lint**

```bash
bun run lint
```

Expected: oxlint exits 0, no errors.

- [ ] **Step 2: Run TypeScript build check**

```bash
bunx tsc -b
```

Expected: exits 0, no type errors.

- [ ] **Step 3: Run production build**

```bash
bun run build
```

Expected: `tsc -b && vite build` succeeds; `dist/` directory exists with `index.html` and `assets/`.

- [ ] **Step 4: No commit needed**

This task is verification-only. If any step fails, fix the underlying issue before proceeding (do not modify out-of-scope files; investigate first).

---

### Task 3: Probe Bun test compatibility and pick the runner

**Files:**
- Modify: `README.md` (only the test command line, finalized in Task 4 — record the outcome here)
- Consumes: existing `compressor.test.mjs`, `platform.test.mjs` (unchanged)

**Interfaces:**
- Produces: a decision — Bun runner command OR `node --test` fallback — carried into Task 4's README edit

- [ ] **Step 1: Baseline — run tests with Node**

```bash
node --test compressor.test.mjs platform.test.mjs
```

Expected: all tests PASS. This is the reference result.

- [ ] **Step 2: Try `bun test`**

```bash
bun test compressor.test.mjs platform.test.mjs
```

Record: PASS or FAIL (capture error output if FAIL).

- [ ] **Step 3: Try `bun --test` (if Step 2 failed or ambiguous)**

```bash
bun --test compressor.test.mjs platform.test.mjs
```

Record: PASS or FAIL.

- [ ] **Step 4: Try direct execution (if Step 2/3 failed)**

```bash
bun compressor.test.mjs
bun platform.test.mjs
```

Record: PASS or FAIL for each.

- [ ] **Step 5: Decide the documented runner**

- If ANY Bun invocation in Steps 2–4 passes both files fully (same pass count as Step 1): **Bun wins**. Document the exact working command (e.g. `bun test compressor.test.mjs platform.test.mjs`).
- If ALL Bun invocations fail: **Node fallback**. Document `node --test compressor.test.mjs platform.test.mjs`.

Record the decision explicitly before Task 4. Do not rewrite test files under any outcome.

---

### Task 4: Update README, netlify.toml, and vercel.json to Bun

**Files:**
- Modify: `README.md` (development/verification block, lines ~13–21, and the `node:test` sentence ~line 25 if Bun won)
- Modify: `netlify.toml:2`
- Modify: `vercel.json:2`

**Interfaces:**
- Consumes: Task 3's runner decision
- Produces: all project docs/configs invoke Bun; no `npm ` remains in commands

- [ ] **Step 1: Replace README development block**

Replace this block in `README.md`:

```sh
npm ci
npm run dev
npm run lint
npx tsc -b
npm run build
node --test compressor.test.mjs platform.test.mjs
npm run preview
```

with (using Task 3's decision for the test line):

```sh
bun install
bun run dev
bun run lint
bunx tsc -b
bun run build
<TEST_COMMAND>
bun run preview
```

Where `<TEST_COMMAND>` is either:
- `bun test compressor.test.mjs platform.test.mjs` (or the exact working Bun command from Task 3), OR
- `node --test compressor.test.mjs platform.test.mjs` (Node fallback)

- [ ] **Step 2: Update netlify.toml**

```toml
[build]
  command = "bun run build"
  publish = "dist"
```

(Line 2 only: `npm run build` → `bun run build`. Rest of file unchanged.)

- [ ] **Step 3: Update vercel.json**

```json
{
  "buildCommand": "bun run build",
  ...
}
```

(Line 2 only: `npm run build` → `bun run build`. Rest of file unchanged.)

- [ ] **Step 4: Verify no npm remnants in commands**

```bash
grep -n 'npm ' README.md netlify.toml vercel.json || echo "no npm remnants"
```

Expected: `no npm remnants` (or only non-command matches like prose mentions — commands must be gone).

- [ ] **Step 5: Commit**

```bash
git add README.md netlify.toml vercel.json
git commit -m "Update docs and deploy configs to Bun"
```

Expected: commit by `GinoNovello <ginonovello9@gmail.com>`.

---

### Task 5: Full verification suite

**Files:**
- None modified (verification only)
- Consumes: Tasks 1–4

**Interfaces:**
- Produces: green board — install, lint, types, build, tests, preview all pass; configs clean

- [ ] **Step 1: Clean reinstall**

```bash
rm -rf node_modules && bun install
test -f bun.lock && test ! -f package-lock.json && echo "lockfile OK"
```

Expected: `lockfile OK`.

- [ ] **Step 2: Lint + types + build**

```bash
bun run lint && bunx tsc -b && bun run build
```

Expected: all exit 0; `dist/` exists.

- [ ] **Step 3: Run test suite with documented runner**

```bash
<TEST_COMMAND from Task 3/4>
```

Expected: all tests PASS (same as Task 3 baseline).

- [ ] **Step 4: Preview smoke test**

```bash
bun run preview
```

Expected: server starts and serves the app (verify HTTP 200 on the printed URL, then stop the server with Ctrl+C / kill).

- [ ] **Step 5: Config cleanliness**

```bash
grep -n 'npm ' README.md netlify.toml vercel.json || echo "clean"
test -f bun.lock && test ! -f package-lock.json && echo "lockfile OK"
```

Expected: `clean` and `lockfile OK`.

---

### Task 6: Rename branch master → main (local and remote)

**Files:**
- None (git metadata only)
- Consumes: Task 5 green; migration commits exist on current branch

**Interfaces:**
- Produces: local branch `main`; `origin/main` exists; `origin/master` deleted; `origin/HEAD` → `main`

- [ ] **Step 1: Confirm clean working tree and current state**

```bash
git status
git branch -a
```

Expected: clean tree (or only intended uncommitted changes committed first); currently on `master`.

- [ ] **Step 2: Rename local branch**

```bash
git branch -m master main
```

Expected: no output. `git branch` now shows `main`.

- [ ] **Step 3: Push main and delete origin/master**

```bash
git push -u origin main
git push origin --delete master
git remote set-head origin -a
```

Expected: `origin/main` created; `origin/master` deleted; `origin/HEAD` updated to `origin/main`.

- [ ] **Step 4: Verify remote state**

```bash
git branch -a
git status
git ls-remote --heads origin
```

Expected:
- `git branch -a` shows only `main` (plus `remotes/origin/main`)
- `git status` says `On branch main`
- `git ls-remote --heads origin` shows `refs/heads/main` and NOT `refs/heads/master`

- [ ] **Step 5: No additional commit**

Branch rename is metadata; nothing to commit.
