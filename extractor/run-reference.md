# Reference-side capture — runnable protocol

The clone side is a script (`run-local.js`). The reference side is agent-driven
through the browser tool, because it needs the real signed-in session and because
behaviour questions need an eye on the page.

Both sides run the **same** `extract.js`, so their output is comparable field for
field. Never hand-write reference-side extraction logic: a one-off script uses
different rules than the clone side, which silently destroys the comparison the
whole tool exists to make.

## The constraint that shapes this procedure

The browser tool **cannot write files.** Its results come back through the
conversation, and long results get truncated. Truncation is the dangerous failure
here, not an inconvenient one: a capture cut off mid-list still *looks* complete,
and the modules sitting in the severed tail read as absent from the reference. A
whole rail — a carousel and a podcast player — has been lost exactly this way.

So the capture is stashed in the page, transferred in fixed slices, reassembled on
disk, and then **verified** to have survived. Steps 4 and 5 are not optional.

## Procedure

Set up per page:

```bash
ART=.parity/pages/<route-slug>      # e.g. .parity/pages/docs-guides
mkdir -p "$ART"
```

### 1. Match the clone side's environment

Resize the window so `innerWidth`/`innerHeight` and `devicePixelRatio` match what
`run-local.js` will use. `diff.js` refuses to compare captures taken at different
viewports — deliberately, since the alternative is a report full of phantom
geometry findings.

Note the actual measured values; the OS may clamp a resize request.

### 2. Navigate, then scroll the whole page

```js
for (let y = 0; y < document.body.scrollHeight; y += 650) {
  window.scrollTo(0, y); await new Promise(r => setTimeout(r, 80));
}
window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 1800));
```

Not optional. Lazily-rendered modules that have never been on screen measure 0×0
and read as missing — a podcast player did exactly that.

### 3. Inject the extractor and stash the capture

Read `extractor/extract.js` and paste its full contents into one browser script
evaluation. It is self-contained: no imports, and it defines
`window.__parityExtract`, `window.__parityStash`, `window.__paritySlice`.

Then, in a second call:

```js
const capture = await window.__parityExtract({
  kind: 'reference',
  route: '/<route>',
  archetype: '<archetype-id>',
  fontRoles: /* tokens.json fontRoles */,
  quietMs: 300, budgetMs: 5000,
});
window.__parityStash(capture)   // returns { bytes, modules, moduleOrder, slices, ... }
```

**Record `jsonBytes`, `modules` and `slices` from that result.** They are the
checksum for step 5.

If `settled` is false, stop and fix that first — every measurement below it is
unreliable.

### 4. Transfer in slices and assemble the file

`stash` stores the capture **base64-encoded**, and that matters. Transferring raw
JSON through a shell fails two ways: quotes, backslashes and `$` all need
escaping, and appending a slice adds a trailing newline — which corrupts the file
whenever a slice boundary lands inside a string value, since a literal newline is
an illegal JSON control character. That failure is silent until the file won't
parse. Base64's alphabet is shell-inert and tolerates stray whitespace, which is
simply stripped before decoding.

**`javascript_tool` cannot carry the slices.** Two limits in the browser tool make
`window.__paritySlice(i)` unusable as the carrier: a long unbroken base64 run
comes back as `[BLOCKED: Base64 encoded data]`, and any result is truncated at
roughly 1KB — so a 12000-char slice arrives about 8% complete, and a capture
transferred that way is silently short. Shrinking the slice size to fit works but
costs one round trip per ~950 characters.

Use `get_page_text` as the carrier instead. It reads from the page's main
text region — **which is not always `<main>`**: when the page contains any
`<article>`, the tool sources from that instead, and a `<pre>` appended to
`<main>` then comes back missing entirely while the call still succeeds. Append to
the largest `<article>` when one exists and fall back to `<main>`. Its budget is
large enough for a whole capture in one pass — a 37.8KB base64 payload
transferred complete and byte-exact this way. Line-wrapping is what defeats the
base64 filter, and it costs nothing because the decode step already strips
whitespace.

```js
// in the page, after __parityStash(capture)
const d = document.createElement('pre');
d.textContent = 'RLDUMPSTART\n' +
  window.__parityCapture.match(/.{1,64}/g).join('\n') + '\nRLDUMPEND';
document.querySelector('main').appendChild(d);   // must be inside <main>
```

Then call `get_page_text` and append everything between the two markers. The
markers matter: the page's own text comes back above the payload, and they are
what separates the capture from it.

Remove the `<pre>` afterwards if the page is still needed for step 6.

Either way — one dump or N slices — append with a quoted heredoc so the shell
cannot interpret the payload:

```bash
cat >> "$ART/capture.b64" <<'SLICE'
<paste verbatim>
SLICE
```

Then decode once all slices are in:

```bash
tr -d '\n\r \t' < "$ART/capture.b64" | base64 -d > "$ART/capture.json"
rm "$ART/capture.b64"
```

Start from an empty `.b64` file.

### 5. Verify the capture survived — do not skip

```bash
python3 - "$ART/capture.json" <<'PY'
import json, sys
raw = open(sys.argv[1], encoding='utf-8').read()
d = json.loads(raw)                      # a lossy transfer fails here
print("bytes   ", len(raw))
print("modules ", len(d["modules"]))
print("order   ", d["page"]["moduleOrder"])
print("settled ", d["environment"]["settled"])
PY
```

`bytes` must equal the `jsonBytes` from step 3, and `modules` must match. If the
file does not parse or a count differs, the transfer lost data — redo it. Never
build from a capture that failed this check.

This round trip is verified byte-identical on a 51KB / 16-module capture across
6 slices.

### 6. Record behaviour, while the page is still open

Property extraction cannot see interaction. Fill in each module's `behavior`
array now, because going back later means re-capturing:

- Carousel: does it loop or clamp? Dots, arrows, both, or neither?
- Feed: load-more, pagination, or infinite scroll? What does the button say?
- Hover and focus states; overlay dismissal; responsive behaviour at breakpoints.

Missing controls are a defect of the same kind as a wrong font size, so treat this
list as part of the capture rather than a note.

## The clone side needs `waitForSelector` on any client-fetched page

`run-local.js` takes a `--config` file, and for a page that fetches through SWR
(every page in this app) that config **must** set:

```json
{ "waitForSelector": "[data-parity-module]" }
```

Without it the capture races the fetch and loses. The first paint is a
"Loading…" placeholder whose layout is perfectly stable, so mutation-quiet fires
against it and the capture returns **zero modules with `settled: true`** — the
same silent, plausible-looking failure as a truncated transfer. It surfaces the
moment the dev server has to recompile the route, which is exactly when a build
has just changed.

Pass `fontRoles` through the same config, or every `elements.*.fontRole` on the
clone side comes back `null` against a populated reference and reports as a
mismatch on every module at once.

## Rules

- **Reference only.** Never point browser automation at our own app; that is
  `run-local.js`'s job.
- **Structure and behaviour, not content.** Record how the page is built. Do not
  copy its article text into artifacts; seeded copy is authored separately. UI
  microcopy on controls (a button's label) is structure and should be recorded.
- **No skip-lists.** Never filter families you judge uninteresting — that is how a
  rail carousel and a podcast player disappeared at once. Classify scaffold vs
  module and report both counts.
- **Don't trigger dialogs.** A native `alert`/`confirm` blocks the browser tool
  and the session loses the tab.
- **Log what you could not reach.** A paywalled or A/B-gated module goes in
  `unmatched` with a note. Silence reads as "fully captured", which is the more
  expensive mistake.
