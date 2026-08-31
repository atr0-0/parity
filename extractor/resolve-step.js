/**
 * Locate the element a flow step refers to, on either side.
 *
 * A flow has to run against both the reference and the clone, and the two
 * expose completely different identity signals: a clone built with utility
 * classes declares `data-parity-module`, while a reference built with CSS
 * modules leaks a generated class family and carries no markers at all. A step
 * written against raw selectors therefore only ever works on one side.
 *
 * So a step names a CATALOGUE MODULE and a CONTROL, and this resolves that pair
 * through whichever signal the page actually offers:
 *
 *   { module: "rail-carousel",
 *     control: { kind: "button", text: "navigation dot", index: 2 } }
 *
 * Control matching is by `kind` plus visible text or accessible name. Measured
 * against six real reference captures, that pair uniquely identifies 93% of
 * controls; the exceptions are runs of identical controls — the dots of a
 * carousel — which are ambiguous by nature and need `index`.
 *
 * Runs in the page. No dependencies.
 */
'use strict';

(function () {
  /** Reference module ids for one of our module ids, from the id-map. */
  function referenceIdsFor(ourId, idMap, route) {
    if (!idMap) return [];
    const tables = [idMap.modules || idMap];
    if (idMap.pages && route && idMap.pages[route]) tables.push(idMap.pages[route]);
    const out = [];
    for (const t of tables) {
      for (const [refId, mapped] of Object.entries(t)) {
        if (mapped === ourId) out.push(refId);
      }
    }
    return out;
  }

  /**
   * A reference module id is the kebab-cased class family
   * (`CardRow4UpVideo` -> `card-row4-up-video`), and instances carry a `#2`
   * suffix. Recover a matcher for the family from the id.
   */
  function familyMatcherFor(refId) {
    const base = String(refId).split('#')[0].replace(/-/g, '');
    return el => {
      const cls = typeof el.className === 'string' ? el.className : '';
      return cls.toLowerCase().replace(/[^a-z0-9]/g, '').includes(base.toLowerCase());
    };
  }

  function moduleElement(root, step, opts) {
    // Clone side: the marker is declared, so this is exact.
    const declared = root.querySelector(`[data-parity-module="${step.module}"]`);
    if (declared) return { el: declared, via: 'declared-marker' };

    // Reference side: recover the class family through the id-map. An instance
    // suffix (`#2`) selects the nth match of that family.
    for (const refId of referenceIdsFor(step.module, opts.idMap, opts.route)) {
      const match = familyMatcherFor(refId);
      const all = Array.from(root.querySelectorAll('[class]')).filter(match);
      if (!all.length) continue;
      const n = /#(\d+)$/.exec(refId);
      const el = n ? all[Number(n[1]) - 1] : all[0];
      if (el) return { el, via: `class-family:${refId}` };
    }
    return { el: null, via: null };
  }

  const CONTROL_SELECTOR =
    'button, [role="tab"], [role="button"], a[class*="button" i], a[class*="cta" i], a[class*="pill" i]';

  function controlsIn(moduleEl) {
    return Array.from(moduleEl.querySelectorAll(CONTROL_SELECTOR)).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  function describe(el) {
    return {
      // MUST match how `controlsOf` in extract.js classifies a control, or a
      // step written from a capture will not resolve against the page that
      // capture came from. Role wins over tag: a <button role="tab"> is a tab
      // in the capture, so it has to be a tab here too. Keep these in step.
      kind: el.getAttribute('role') || el.tagName.toLowerCase(),
      // Visible text and accessible name are kept apart on purpose: a control
      // whose aria-label contradicts its visible label is a real defect, and
      // collapsing them once let exactly that ship.
      text: (el.textContent || '').trim().slice(0, 40) || null,
      label: el.getAttribute('aria-label'),
    };
  }

  function matches(el, want) {
    const got = describe(el);
    if (want.kind && got.kind !== want.kind) return false;
    if (!want.text) return true;
    const w = String(want.text).toLowerCase();
    return (got.text || '').toLowerCase().includes(w) || (got.label || '').toLowerCase().includes(w);
  }

  /**
   * @returns {{ ok, el, via, reason, candidates }} — never throws, and reports
   * why it failed, because a step that silently resolves to the wrong element
   * is worse than one that refuses.
   */
  window.__parityResolveStep = function resolveStep(step, opts = {}) {
    const root = opts.root || document;
    const { el: moduleEl, via } = moduleElement(root, step, opts);
    if (!moduleEl) {
      return { ok: false, reason: `module "${step.module}" not found by marker or class family`, via: null };
    }
    if (!step.control) return { ok: true, el: moduleEl, via, reason: null };

    const found = controlsIn(moduleEl).filter(el => matches(el, step.control));
    if (!found.length) {
      return {
        ok: false, via,
        reason: `no control matching ${JSON.stringify(step.control)} in "${step.module}"`,
        candidates: controlsIn(moduleEl).map(describe),
      };
    }
    if (found.length > 1 && step.control.index == null) {
      return {
        ok: false, via,
        reason: `${found.length} controls match ${JSON.stringify(step.control)} — add an index`,
        candidates: found.map(describe),
      };
    }
    const el = step.control.index != null ? found[step.control.index] : found[0];
    if (!el) return { ok: false, via, reason: `index ${step.control.index} out of range (${found.length} matched)` };
    return { ok: true, el, via, reason: null };
  };
})();
