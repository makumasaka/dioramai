# Dioramai Publishing Checklist

The publishable package is `packages/cli` (`name: dioramai`).

---

## Pre-publish checks

Run all of these from the **monorepo root** before publishing:

```bash
# 1. Install dependencies
npm install

# 2. Run all tests
npm test

# 3. Typecheck all packages
npm run typecheck

# 4. Lint the web shell
npm run lint

# 5. Build the CLI (also runs as part of prepack)
npm run build -w dioramai

# 6. Dry-run the tarball — verify the file list
cd packages/cli
npm pack --dry-run
```

Expected tarball contents (5 files, ~3.4 MB unpacked):
- `dist/index.js` (bundled ESM)
- `assets/quarry_cloudy_1k.hdr` (~2.1 MB bundled default HDRI, copied into projects on `init`)
- `README.md`
- `LICENSE`
- `package.json`

---

## Version bump

From `packages/cli`:

```bash
cd packages/cli

# Patch release (bug fixes): 0.1.0 → 0.1.1
npm version patch

# Minor release (new features): 0.1.0 → 0.2.0
npm version minor

# Major release (breaking changes): 0.1.0 → 1.0.0
npm version major
```

> `npm version` updates `package.json` and creates a git commit + tag automatically.
> Commit the version bump and tag to the repo before publishing.

---

## Publish dry-run

From `packages/cli`:

```bash
npm publish --dry-run
```

This runs `prepack` (which runs `build`) and shows everything that would be published without actually publishing.

---

## Publish

```bash
# Confirm npm identity
npm whoami

# Log in if needed
npm login

# Publish (prepack runs build automatically)
npm publish
```

---

## Post-publish smoke test

In a **fresh temp directory** (not inside the monorepo):

```bash
mkdir /tmp/dioramai-smoke && cd /tmp/dioramai-smoke

# Verify the latest version is available
npx dioramai@latest --help

# Full onboarding flow
npx dioramai@latest init --template vite-r3f --install
npx dioramai@latest doctor
npx dioramai@latest dev --open
```

Expected:
- `init` scaffolds a Vite + R3F project and installs deps
- `doctor` passes with no blocking issues
- `dev --open` starts the bridge and opens `https://dioramai.design/?bridgeToken=...&bridgeUrl=...`
- The hosted shell shows the Onboarding screen, then connects once the bridge is running

---

## Vercel deployment (hosted shell)

The hosted shell at `https://dioramai.design` is deployed via the `apps/web` Vite build.
See [Task 5 in the MVP plan](../.cursor/plans/) for the step-by-step Vercel git integration setup.

Key settings:
- Root Directory: `/` (repo root)
- Build Command: `npm run build -w web`
- Output Directory: `apps/web/dist`
- Node.js Version: 20.x

---

## Environment variable reference

| Variable | Default | Purpose |
|----------|---------|---------|
| `DIORAMAI_BRIDGE_PORT` | `7777` | Bridge server port |
| `DIORAMAI_BRIDGE_TOKEN` | (random) | Bridge pairing token |
| `DIORAMAI_WEB_SHELL_URL` | `https://dioramai.design` | Override shell URL |
| `DIORAMAI_ALLOWED_ORIGINS` | (all) | Comma-separated CORS allowlist |
| `DIORAMAI_WATCH_CODE` | `true` | Enable/disable code watcher |
| `VITE_DIORAMAI_BRIDGE_URL` | `http://127.0.0.1:7777` | Bridge URL baked into web build |

---

## npm safety

The CLI uses a `files` whitelist in `packages/cli/package.json`:

```json
"files": ["dist", "assets", "README.md", "LICENSE"]
```

This guarantees only the built CLI binary, the bundled default HDRI, README, and
LICENSE are published. The one-off `scripts/downsizeHdr.mjs` HDRI tooling is not
in the whitelist and is never published. The root `package.json` is
`private: true` and cannot be published.
