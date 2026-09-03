# Spec: make the "generating supports…" spinner fade in reliably

Small, self-contained task for a fresh session. Fixes a bug in the already-shipped
long-build spinner: its fade-in only plays *sometimes*.

## Where

Repo: `~/projects/support-fins` (product name **Support Fins**). All three files
are in `web/`:

- `web/index.html` — the spinner element
- `web/style.css` — its styling + the fade transition
- `web/app.js` — `armSpinner()` / `clearSpinner()` (search those names)

Serve locally: `cd ~/projects/support-fins/web && python3 -m http.server 8731`
then open `http://localhost:8731/index.html?stl=dev-models/<a-part>.stl`. **ES
modules are cached hard — after editing `web/*.js`/`*.css` do cmd+shift+r**, and
note that a hard reload drops the `?stl=` query, so re-enter the full URL.

There is no build step; it is vanilla ES modules + three.js.

## What the spinner is (already built — do not re-derive)

A centered pill (`#spinner`) reading "generating supports…" with a rotating ring.
It is shown while support generation runs in a Web Worker (`web/finworker.js`)
and is meant to appear only for builds that run past a short delay, so a quick
rebuild never flashes it. `armSpinner()` is called when a worker build starts;
`clearSpinner()` when it lands (in `applyBuilt`) or is abandoned.

## The bug

**Observed:** the fade-in plays in some cases but most of the time the spinner
just snaps to full opacity (no fade). Inconsistent between builds.

**Root cause:** the element is toggled with the `hidden` attribute, i.e.
`display: none` ⇄ `display: flex`. The fade is a CSS `opacity` transition, and
`armSpinner()` does:

```js
s.hidden = false;                               // display:none -> flex, opacity:0
requestAnimationFrame(() => s.classList.add('show'));  // opacity -> 1
```

A single `requestAnimationFrame` is **not** a reliable boundary for a transition
that starts from a just-un-hidden (`display:none`→`flex`) element. The browser
often resolves the display change and the `.show` class in the same style pass,
never painting an intermediate frame at `opacity:0`, so the transition is skipped
and it snaps. It only fades on the occasions a paint happens to land in between —
hence "sometimes." A `display:none` element is the classic case where
opacity/transition starting states are unreliable.

Relevant current code:

```css
/* web/style.css */
#spinner { /* …position/looks… */ opacity: 0; transition: opacity 0.5s ease; }
#spinner.show { opacity: 1; }
@media (prefers-reduced-motion: reduce) { #spinner { transition: none; } }
```
```html
<!-- web/index.html -->
<div id="spinner" hidden aria-live="polite"><span class="ring"></span>generating supports…</div>
```
```js
// web/app.js
function armSpinner() {
  clearTimeout(finSpinnerTimer);
  finSpinnerTimer = setTimeout(() => {
    const s = el('spinner');
    s.hidden = false;
    requestAnimationFrame(() => s.classList.add('show'));
  }, 300);
}
function clearSpinner() {
  clearTimeout(finSpinnerTimer);
  finSpinnerTimer = null;
  const s = el('spinner');
  s.classList.remove('show');
  s.hidden = true;
}
```

Also note the global rule in `style.css`: `[hidden] { display: none !important; }`.

## Fix — Option A (recommended): stop toggling `display`

Never put the spinner in `display:none`. Keep it laid out at all times and drive
visibility purely with the `.show` class, so the `opacity` transition has a stable
box to animate and fires every time. `pointer-events:none` (already present) keeps
the always-present element inert; add `visibility` so an invisible spinner is not
focusable/announced when idle.

**`web/index.html`** — drop the `hidden` attribute:
```html
<div id="spinner" aria-live="polite"><span class="ring"></span>generating supports…</div>
```

**`web/style.css`** — control via class, transition opacity (+ visibility so it
snaps visible immediately but is removed from the a11y/hit tree when idle):
```css
#spinner {
  /* …unchanged position/looks… */
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.5s ease, visibility 0s linear 0.5s;  /* hide after the fade-out */
}
#spinner.show {
  opacity: 1;
  visibility: visible;
  transition: opacity 0.5s ease, visibility 0s;              /* show immediately */
}
@media (prefers-reduced-motion: reduce) {
  #spinner { transition: none; }
  #spinner.show { transition: none; }
}
```

**`web/app.js`** — no `hidden`, no `requestAnimationFrame` needed; just toggle the
class. Because the element is always displayed, adding `.show` transitions cleanly:
```js
function armSpinner() {
  clearTimeout(finSpinnerTimer);
  finSpinnerTimer = setTimeout(() => el('spinner').classList.add('show'), 300);
}
function clearSpinner() {
  clearTimeout(finSpinnerTimer);
  finSpinnerTimer = null;
  el('spinner').classList.remove('show');
}
```

Any other place that reads/sets `el('spinner').hidden` must move to the `.show`
class — grep for `spinner` across `web/app.js` and confirm the only touch-points
are `armSpinner`/`clearSpinner` (they are, as of this spec).

### Fix — Option B (minimal, if you must keep `hidden`)

Force a synchronous reflow between un-hiding and adding the class so the browser
commits the `opacity:0` start state at `display:flex` first:
```js
s.hidden = false;
void s.offsetWidth;          // reflow: commit opacity:0 @ display:flex
s.classList.add('show');     // now transitions 0 -> 1
```
This is a one-line change but is the fragile pattern; prefer Option A.

## Timing note (optional, ask the user)

Current delay before showing is **300ms**, fade **0.5s**. The user previously
found a 1s delay "late and jumpy." If, after the fade is reliable, it still feels
late, try delay 200–250ms. Don't change without confirming — the point of the
delay is that a sub-second build shows nothing at all.

## Verify (must do live in Chrome — a Worker/transition can't be checked headless)

Use a part that produces a multi-second build so the spinner actually appears.
`dev-models/` has small parts; a large/badly-posed part is better. A known slow
case: a large flat part (the user's `flat_bracket.stl`, ~311×120×192mm, builds
~2–4s flat). If needed, copy such an STL into `web/dev-models/` (gitignored) to
load it via `?stl=`.

1. Load the part, click **Add fins** → while it builds, the spinner should **fade
   in smoothly** (not snap). Watch it, not a screenshot (screenshot latency tends
   to land after the build; observe the live transition or record a short capture).
2. Trigger several more rebuilds (toggle **Tines**, drag **Tine grip**, rotate,
   **Suggest orientation** → apply a pose). **Every** time the spinner appears it
   should fade — no snap-in on any of them. This consistency is the acceptance bar.
3. A quick build (<~300ms, e.g. a well-oriented small part) should show **no**
   spinner at all.
4. Confirm it always clears when the build lands (never stuck) and there are no
   console errors.

## Acceptance criteria

- The spinner fades in every time it appears (no cases where it snaps).
- It still never appears for sub-~300ms builds.
- It always clears on build completion; never left on screen.
- No console errors; `prefers-reduced-motion` shows it with no transition/animation.

## Out of scope / separate work

- **Make the flat-pose build itself faster.** Deferred, separate task. Profiling
  finding to hand off: on the user's `flat_bracket.stl` flat, the geometry
  *primitives* (`insidePart`/`nearestPart`/`surfaceZAt`) are only ~20% of the
  ~2.5s; ~80% is the pure-JS station/probe loops in `web/prop.js`
  (`stationIsClear` walking the full height of ~16 tall walls × ~2900 stations).
  Speeding it up means restructuring that probe logic, which has a documented
  weld-regression history — treat as its own careful pass with the stress harness
  (`deno run --allow-read prototype/stress/run.js`, baseline 146 OK / 1 FAIL) and
  the unit tests (`deno test --allow-read tests/`) as guardrails.
