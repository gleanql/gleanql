---
title: vs Relay & gqty
group: Guide
order: 5
---

# GleanQL vs Relay vs gqty

The three tools answer the same question — *how does a React component get exactly the GraphQL data it reads?* — from three different directions. GleanQL's position: gqty's developer experience with Relay's runtime characteristics.

## The axis that actually matters

**Relay** asks you to write the data requirement *twice*: once as the JSX that reads fields, and once as a colocated fragment that declares them. The compiler then gives you optimal static operations, persisted queries, and a normalized store. Maximum runtime efficiency, paid for in ceremony.

**gqty** deletes the second copy: field access *is* the data requirement, captured by a runtime proxy. Maximum DX, paid for at runtime — the query is discovered *while rendering*, so first renders suspend against a proxy, requests can waterfall, and there is no static document to persist, allowlist, or analyze.

**GleanQL** takes gqty's contract — plain components, field access is the requirement, zero GraphQL in app code — and moves the discovery to *build time*. The compiler statically analyzes routes, components, prop flow, and islands, and emits the same kind of artifact Relay's compiler does: a merged, deduplicated, hashed, persisted-able operation per route.

> [!NOTE]
> **One sentence:** if Relay is "declare twice, optimal at runtime" and gqty is "declare once, resolved at runtime", GleanQL is "declare once, resolved at build time".

## Feature matrix

|  | GleanQL | Relay | gqty |
| --- | --- | --- | --- |
| GraphQL in app code | none — inferred from field reads | fragments + queries (GraphQL tagged templates) | none — inferred from field reads |
| When the operation is known | **build time** (static document) | **build time** (static document) | runtime (proxy capture, per render) |
| Request waterfalls | no — one operation per route | no — one query per surface | possible — discovery happens while rendering |
| Normalized cache | yes (entity + path identity) | yes (data-ID based) | yes |
| Re-render granularity | **field-level** (per-record + per-field versions) | fragment-level | field-level (proxy tracking) |
| Optimistic updates | declarative, incl. list membership (`optimisticRoots`) with auto-rollback | imperative updaters / declarative directives | manual cache writes |
| Subscriptions | compile-time selectors over SSE or graphql-ws | yes | yes |
| Persisted operations | yes — sha-256 manifest emitted per build, APQ-shaped wire format, server allowlist helper | yes — first-class | no (documents don't exist statically) |
| SSR / RSC | request-scoped runtime + hydration payload; RedwoodSDK (RSC) and React Router presets | framework integrations (Next, etc.) | SSR helpers; proxy model complicates RSC |
| Partial-render attribution | per-component read-map → `refresh()` targets one component's fields | fragment = the unit of refetch | — |
| Unanalyzable patterns | build-time diagnostic (never silently under-fetches) | impossible by construction (fragments are explicit) | n/a — everything resolves at runtime |
| @defer / @stream | not yet — `<GraphLazy>` covers the use-case (see [decisions](decisions.md)) | yes | no |
| Store GC / retention | reference-counted retention (mounted readers pin their records) + LRU cap + `gc()` | reference-counted retention | cache policies |
| Maturity | alpha | battle-tested at Meta scale | community project |

## What "compiled prop flow" replaces fragments with

Relay's fragments exist so a child component can own its data requirement and any parent can compose it. GleanQL gets the same composition by *following the props*: the compiler resolves imported components, binds graph-valued props into their bodies, and folds their reads into the route operation — through `.map` callbacks (inline, destructured, or a named function reference), intermediate bindings, helper functions, conditional component choice, registries, and islands that open their own roots. The per-component **read-map** keeps the attribution fragments would have given you: each component's field paths are recorded, so `refresh()` can refetch exactly one component's data.

> [!WARNING]
> **Honest limit:** a fragment is a *guarantee*; static analysis is a *best effort with a tripwire*. Code the analyzer can't follow (a dynamically selected callback, a component picked from a non-registry map) doesn't silently under-fetch — it fails the build with a diagnostic (`unsupported-list-flow`, `unresolved-dynamic-component`, …) and asks for an analyzable form. Relay never needs the tripwire; gqty never needs the analysis.

## When to choose what

**Choose Relay** when you're operating at a scale where its guarantees pay for the ceremony: hundreds of engineers, strict fragment ownership, @defer/@stream, store retention semantics, and a decade of production hardening.

**Choose gqty** when you want zero-GraphQL DX and your app is client-heavy with tolerance for runtime query discovery — or you need patterns static analysis fundamentally can't follow.

**Choose GleanQL** when you want plain TypeScript components *and* static operations: server-rendered React (RSC or SSR) where the route's data should be one compiled, hashed, allowlisted request — with fine-grained reactivity, optimistic writes, and live subscriptions on top, none of it visible in app code.

## Receipts

Every claim above is executable in this repo: the [golden cases](golden-cases.md) lock the compiler's coverage (36 fixtures through two type-checker engines), the runtime behaviors are unit-tested (380+ tests), and `examples/rwsdk-real`, `examples/rwsdk-todo` and `examples/remix-real` are bootable apps exercising RSC islands, optimistic TodoMVC membership, and isomorphic SSR respectively.
