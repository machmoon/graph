# Fastify blast-radius report: `75d74e1a`

## Commit

- Repository: `/Users/hardikgoyal/2026/fastify`
- Commit: `75d74e1af74598deb18f2c052d64f815a5eec8f8`
- Date: 2026-07-05
- Subject: `feat: introduce log controller layer (#6580)`
- Size: 24 files, 782 insertions, 127 deletions

This is a useful stress case because it is not merely a large test or documentation
change. It adds a new public extension point and rewires logging across request,
response, routing, error, 404, and stream paths.

## Method

The analysis used an archive of the exact commit rather than the current checkout.
It parsed static relative `require()` edges among `fastify.js` and `lib/*.js`, built
the reverse import graph, and walked outward from the union of all changed runtime
files.

This measures structural exposure: files that directly or transitively import a
changed file. It does not claim that every exposed file is behaviorally broken.

## Result

| Metric | Result |
| --- | ---: |
| Core runtime files | 33 |
| Internal import edges | 108 |
| Changed runtime files | 11 |
| Unchanged but structurally exposed files | 16 |
| Total changed or exposed | 27 / 33 (82%) |
| Structurally isolated from the change | 6 / 33 (18%) |

### Changed runtime files

- `fastify.js`
- `lib/context.js`
- `lib/error-handler.js`
- `lib/errors.js`
- `lib/four-oh-four.js`
- `lib/log-controller.js` (new)
- `lib/logger-factory.js`
- `lib/reply.js`
- `lib/route.js`
- `lib/symbols.js`
- `lib/warnings.js`

### Highest-leverage changed files

| File | Direct importers | Transitive dependents | Furthest hop |
| --- | ---: | ---: | ---: |
| `lib/symbols.js` | 20 | 21 | 2 |
| `lib/errors.js` | 17 | 20 | 2 |
| `lib/warnings.js` | 5 | 9 | 4 |
| `lib/log-controller.js` | 1 | 6 | 3 |
| `lib/error-handler.js` | 4 | 5 | 2 |
| `lib/logger-factory.js` | 4 | 5 | 2 |

The raw line count understates the risk. The single-symbol change in
`lib/symbols.js` sits under 21 modules, while the new `lib/log-controller.js`
becomes reachable through the logger factory by routing, reply, 404, plugin
override, and the main entry point.

### Exposed unchanged files

One hop from at least one changed file:

- `lib/content-type-parser.js`
- `lib/decorate.js`
- `lib/error-status.js`
- `lib/handle-request.js`
- `lib/hooks.js`
- `lib/initial-config-validation.js`
- `lib/logger-pino.js`
- `lib/plugin-override.js`
- `lib/plugin-utils.js`
- `lib/promise.js`
- `lib/request.js`
- `lib/schemas.js`
- `lib/server.js`
- `lib/validation.js`
- `lib/wrap-thenable.js`

Two hops:

- `lib/schema-controller.js`

Structurally isolated:

- `lib/config-validator.js`
- `lib/content-type.js`
- `lib/error-serializer.js`
- `lib/head-route.js`
- `lib/noop-set.js`
- `lib/req-id-gen-factory.js`

## What changed architecturally

The commit centralizes Fastify's internal logging behind a new `LogController`
class. A controller instance is created during server setup, stored on the Fastify
instance using `kLogController`, and called from the main request path, routing,
reply completion, stream failure, default error handling, serialization failure,
404 handling, and shutdown rejection.

It also:

- exports `LogController` as public API;
- adds TypeScript declarations for the extension point;
- moves `disableRequestLogging` and `requestIdLogLabel` behavior into the
  controller;
- deprecates the old top-level options through `FSTDEP023` and `FSTDEP024`;
- adds validation that custom controllers must be `LogController` instances.

## Risk interpretation

The important test surfaces are broader than the changed-file list suggests:

1. Request lifecycle logging: incoming, completed, errored, and disabled paths.
2. Error paths: default handlers, serializer failures, and `writeHead` failures.
3. Routing and 404 behavior, including malformed URLs and shutdown 503s.
4. Streams and premature-close behavior.
5. Plugin encapsulation, because `lib/plugin-override.js` is transitively exposed.
6. Public API, TypeScript contracts, and deprecation compatibility.

History confirms two contract/documentation follow-ups after this commit:

- `9eaef512` widened the `requestCompleted` error type from `Error | null` to
  `Error | null | undefined`, matching the actual lifecycle callback value.
- `b6cdc6a4` fixed the migration example to construct `new LogController(...)`;
  the original docs showed a plain object even though runtime validation rejects
  plain objects.

These were not dependency-graph failures. They show why structural blast radius
should guide review and test selection, but cannot replace semantic API and docs
review.

## Verification

The five test files changed by the commit were run from the archived snapshot,
using the local checkout's installed dependencies:

- `test/internals/errors.test.js`
- `test/internals/logger.test.js`
- `test/internals/reply.test.js`
- `test/logger/logging.test.js`
- `test/stream.4.test.js`

Result: pass (`node --test`, exit code 0). The first sandboxed run failed only
where tests attempted to listen on localhost; rerunning with local socket access
removed those environment failures.

## Verdict

**High structural blast radius, with appropriate focused coverage.** The commit
touches 33% of core runtime files directly and exposes another 48%, for 82% total
structural reach. It is a strong example for validating a commit-aware version of
the Blast Radius UI.

The current HTML prototype cannot reproduce this full report because its graph is
hardcoded and it supports only one selected file. A real run path needs repository
and commit inputs plus multi-file union analysis.
