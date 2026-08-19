# Input sanitization & XSS prevention (task 43.1, Requirement 17.5)

This module neutralizes cross-site-scripting (XSS) vectors carried in
user-supplied strings. It has two orthogonal responsibilities behind the
`ISanitizer` interface:

- **Input sanitization** (`sanitizeHtml`) — strips dangerous markup and defangs
  dangerous URI schemes on the way IN, before storage.
- **Output escaping** (`escapeHtml`) — encodes HTML-significant characters on the
  way OUT, for any server-rendered HTML.

## Integration point

A global Fastify `preValidation` hook (`registerInputSanitization`, wired in
`src/presentation/middlewares/index.ts`) deep-sanitizes `request.body` before Zod
validation runs and before any use case / repository sees the value. This gives
uniform coverage with no per-route churn and keeps the domain/application layers
free of the presentation concern.

## Policy — sanitize input, escape output (do not escape JSON)

- The API is JSON. Clients escape on render, and the correct
  `Content-Type: application/json` prevents browsers from interpreting a
  response as HTML. **JSON responses are therefore NOT escaped** — doing so would
  corrupt legitimate data (e.g. `"Sancho & Co."`, `"stock < 10"`).
- The **input** path SANITIZES rather than ESCAPES: normal alphanumeric/business
  text, numbers and punctuation pass through byte-for-byte unchanged; only
  tag-like markup (`<tag …>`), script/style/iframe element bodies, HTML comments
  and dangerous URI schemes (`javascript:`, `vbscript:`) are neutralized.
- `escapeHtml` is provided for the few places the server itself emits HTML
  (Swagger branding, email templates, etc.). Use it there — never on JSON.

### Opt-out / allowlist

`deepSanitizeStrings` skips fields by key name or dotted path via
`skipFields`. Credential fields (`password`, `token`, …) are skipped by default
(`DEFAULT_SKIP_FIELDS`) because they are opaque, never rendered, and hashed or
compared verbatim downstream. To preserve a rich-text field (markdown/HTML a
downstream renderer escapes itself), add its key or path to `skipFields` when
registering the hook, e.g.:

```ts
registerInputSanitization(app, { skipFields: [...DEFAULT_SKIP_FIELDS, 'article.bodyHtml'] });
```

## Deferred dependency (DOMPurify)

The preferred allowlist sanitizer is DOMPurify (`isomorphic-dompurify`, or
`dompurify` + `jsdom`). This environment sits behind an SSL-inspecting proxy that
blocks installing it from the npm registry (the same constraint documented for
the `redis` client). Rather than weaken TLS verification (`strict-ssl` stays on),
the default `HtmlSanitizer` is a self-contained, dependency-free implementation
of the `ISanitizer` contract.

To bind a DOMPurify-backed implementation later — with **no change to callers or
the request hook** — install the dependency and provide an adapter:

```ts
// dompurify-sanitizer.ts
import createDOMPurify from 'isomorphic-dompurify';
import type { ISanitizer } from './sanitizer.js';

export class DomPurifySanitizer implements ISanitizer {
  private readonly purify = createDOMPurify();
  sanitizeHtml(input: string): string {
    return this.purify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  }
  escapeHtml(input: string): string {
    /* same entity encoding as HtmlSanitizer */
  }
}
```

Then pass it through `registerInputSanitization(app, { sanitizer: new DomPurifySanitizer() })`.
This mirrors the deferred-dependency seam used for `firebase-admin` / `redis`.
