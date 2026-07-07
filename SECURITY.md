# Security Policy

## Supported Versions

Security fixes are applied to the latest published `dioramai` CLI release and
the `main` branch. Older releases do not receive backported fixes.

## Reporting a Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Instead, report them privately via
[GitHub Security Advisories](https://github.com/makumasaka/dioramai/security/advisories/new)
for this repository. Include:

- A description of the issue and its impact.
- Steps to reproduce (a minimal project or scene JSON is ideal).
- The affected version (`npx dioramai --version`) and platform.

You can expect an acknowledgement within a few days. Once a fix is available,
we will coordinate disclosure and credit you in the release notes unless you
prefer otherwise.

## Security Model Notes

The local bridge (`@dioramai/local-bridge`) is designed to be safe to run next
to a real project checkout:

- It binds to localhost and rejects requests whose `Host` header is not a
  localhost name (this also blocks DNS-rebinding style attacks).
- Browser-originated requests (any request carrying an `Origin` header),
  including `/health` probes, must present the per-session pairing token
  (`x-dioramai-token` header or `token` query parameter). The token is
  generated randomly at startup unless `DIORAMAI_BRIDGE_TOKEN` is set.
- Local non-browser clients (the CLI, MCP stdio proxies, curl) do not send an
  `Origin` header and are trusted under the localhost model: any process on
  the same machine can call the bridge tool routes. Do not run the bridge on
  shared multi-user hosts.
- Cross-origin access is limited via `DIORAMAI_ALLOWED_ORIGINS`.
- Asset serving is restricted to the configured asset/HDRI directories, with
  path traversal checks and an allowlist of file extensions.

If you find a way around any of these guarantees (e.g. reading files outside
the project root through the bridge), that is exactly the kind of report we
want to hear about.
