# CF API Shield Schema Endpoint

**Date:** 2026-02-16
**Status:** Approved

## Problem

Cloudflare API Shield requires an OpenAPI 3.0.x schema for request validation. Our API serves an OpenAPI 3.1.0 spec. CF explicitly does not support 3.1 and has no plans to.

## Solution

Add a `GET /api/cf` endpoint that dynamically converts the existing 3.1.0 spec to 3.0.0 at runtime.

## Architecture

### Converter function: `convertToOas3_0(spec)`

Location: `packages/api/src/openapi-cf.ts`

A pure function that deep-clones the input spec and recursively walks the object tree applying these transformations:

| 3.1.0 feature | 3.0.0 equivalent |
|---|---|
| `openapi: "3.1.0"` | `openapi: "3.0.0"` |
| `type: ["string", "null"]` | `type: "string", nullable: true` |
| `type: ["integer", "null"]` | `type: "integer", nullable: true` |
| `type: ["array", "null"]` | `type: "array", nullable: true` |
| `examples: [val, ...]` | `example: val` (first item) |
| `const: val` | `enum: [val]` |

The function does not mutate the input.

### Route registration

```typescript
app.get("/api/cf", (c) => c.json(convertToOas3_0(openApiSpec)));
```

### Caching

- Excluded from pogocache (added to `excludePaths` alongside `/api/openapi.json`)
- Gets `Cache-Control: no-store` header

### CF API Shield constraints

From [CF docs](https://developers.cloudflare.com/api-shield/security/schema-validation/):

- Only OAS 3.0.x supported (not 3.1, not 2.0)
- No external `$ref` references (our spec uses only internal `#/components/...` refs)
- All parameters must use `schema` field (not `content`) — ours already do
- Only `application/json` request bodies are validated
- `type` field must be explicitly set in all schema objects
- Server variables not validated; relative URLs unsupported

### Files to create/modify

| File | Action |
|---|---|
| `packages/api/src/openapi-cf.ts` | Create — converter function |
| `packages/api/src/openapi-cf.test.ts` | Create — Vitest tests |
| `packages/api/src/index.ts` | Modify — add route + exclude from cache |

### Testing

1. Output has `openapi: "3.0.0"`
2. All `type: ["T", "null"]` arrays converted to `type: "T", nullable: true`
3. `examples` (plural) converted to singular `example`
4. `$ref` references preserved unchanged
5. No external `$ref` references present
6. All parameters have `schema` field
7. Endpoint returns 200 with valid JSON

## Decision log

- **Runtime vs build-time:** Runtime chosen — single source of truth, always in sync
- **In-house vs npm package:** In-house chosen — spec is simple, ~40 lines, zero dependencies
- **Full spec vs request-only:** Full spec — CF ignores what it doesn't validate, and full spec is useful for other tools
