# Prompts and eval scaffolding

This folder is reserved for **versioned prompts**, golden “intent → command” transcripts, and small fixtures used when running **eval loops** (see [docs/evals/loop-matrix.md](../evals/loop-matrix.md)).

## Intended use

- **Phase 1 (MVP lock):** keep machine-checkable tests in packages (`*.test.ts`) and `docs/evals/` markdown; prompts may be informal until the eval harness grows.
- **Phase 2 (agents):** add curated prompt + expected command batches here or under `packages/examples/` so QA can run Loop E without pasting chat logs into CI secrets.

## Conventions (TODO as harness lands)

- One scenario per subdirectory or numbered file.
- Reference `CommandSchema` in `packages/core/src/commandSchema.ts` for validated command shapes; never duplicate the `Command` union in free text without linking to `docs/COMMANDS.md`.

## Related

- [docs/COMMANDS.md](../COMMANDS.md)
- [AGENTS.md](../../AGENTS.md)
