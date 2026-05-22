# Dioramai CLI

Dioramai is a local-first runtime sync tool for React Three Fiber projects.

```bash
npx dioramai init --template vite-r3f
npx dioramai doctor
npx dioramai dev --open
```

The CLI starts a local bridge that can safely operate inside an explicit project
root. The hosted Dioramai browser shell connects to that bridge over localhost;
projects, GLBs, generated code, and scene state remain in the developer's repo.

## Commands

- `dioramai init --template vite-r3f` scaffolds a minimal Vite/R3F project.
- `dioramai doctor` checks project readiness without changing files.
- `dioramai dev --open` starts the local bridge and opens the shell URL.
- `dioramai export` writes the generated R3F scene module.
- `dioramai validate` prints raw project status JSON.

The `diorama` binary is kept as a compatibility alias.
