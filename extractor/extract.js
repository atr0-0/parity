/**
 * The single extraction function.
 *
 * Runs identically against the reference site (via claude-in-chrome) and against
 * our clone (via Playwright). Both sides MUST produce the same shape, field for
 * field, or the diff is meaningless — so this file is the one place extraction
 * logic is allowed to live.
 *
 * Usage — Playwright:
 *   await page.addScriptTag({ path: 'extract.js' })
 *   const capture = await page.evaluate(cfg => window.__parityExtract(cfg), config)
 *
 * Usage — claude-in-chrome javascript_tool:
 *   paste this file's contents, then:  await window.__parityExtract({ ... })
 */
(() => {
  const SCHEMA = 'parity/capture/v1';

  // CSS-module class names look like `Family_element__hash`. The family prefix is
  // the strongest available identity signal: two elements sharing it are the same
  // component in the reference's own source. Not inference — evidence.
  const HASHED_CLASS = /^([A-Za-z][A-Za-z0-9]*)_([A-Za-z][A-Za-z0-9]*)__([A-Za-z0-9_-]{4,})$/;

  // A SECOND convention, equally common: Parcel and newer Next builds emit
  // `file-module__HASH__local` — file name first, hash in the MIDDLE. Convention
  // A's trailing-hash pattern matches not one class on such a page, so every
  // element reads as unnamed, auto-discovery emits nothing, and the capture comes
  // back with zero modules while `settled: true` insists it went fine. That is
  // the disappearing-module failure arriving through the fingerprint instead of
  // through a skip-list: measured on a real page whose every module is named
  // `hero-lg-module__wVezNW__hero`.
  const HASHED_CLASS_B = /^([A-Za-z][A-Za-z0-9-]*)-module__([A-Za-z0-9_-]{4,})__([A-Za-z][A-Za-z0-9_-]*)$/;

  /**
   * File names that carry no identity of their own.
   *
   * A CSS-modules codebase overwhelmingly names its files `styles.module.css`, so
   * under convention B the file segment is generic far more often than not and the
   * per-file BUILD HASH is the only thing telling two of them apart. The hash
   * cannot be the identity: it changes on every deploy of the reference, and an
   * id-map keyed on it silently goes stale the next time the page is captured —
   * which reads afterwards as the module having gone missing.
   *
   * The authored local element name is the stable, semantic alternative, so it
   * stands in whenever the file name says nothing.
   */
  const GENERIC_FILE = new Set(['styles', 'style', 'index', 'shared', 'common', 'main']);

  const round = (n, p = 1) => {
    const f = 10 ** p;
    return Math.round(n * f) / f;
  };

  function normalizeColor(value) {
    if (!value) return null;
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return value;
    const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    const [r, g, b] = parts;
    const a = parts.length > 3 ? parts[3] : 1;
    if (a === 0) return 'transparent';
    const hex = [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
    return a < 1 ? `#${hex}@${round(a, 2)}` : `#${hex}`;
  }

  function classFamilies(el) {
    const out = [];
    for (const cls of el.classList) {
      const a = cls.match(HASHED_CLASS);
      if (a) {
        if (!out.includes(a[1])) out.push(a[1]);
        continue;
      }
      const b = cls.match(HASHED_CLASS_B);
      if (b) {
        // Prefer the file name; fall back to the local element name when the file
        // name is one every component shares.
        const family = GENERIC_FILE.has(b[1].toLowerCase()) ? b[3] : b[1];
        if (!out.includes(family)) out.push(family);
      }
    }
    return out;
  }

  /**
   * The class-FILE an element's styling comes from, under convention B.
   *
   * Kept separate from the display family on purpose. The family is what a module
   * is CALLED and has to stay stable across deploys, so the build hash can never
   * appear in it. But the hash is the only exact answer to "do these two elements
   * come from the same component source", and that question decides where a
   * module's boundary is — so it is read here and used for structure only, never
   * for naming.
   */
  function classFileOf(el) {
    for (const cls of el.classList) {
      const b = cls.match(HASHED_CLASS_B);
      if (b) return b[2];
    }
    return null;
  }

  /**
   * The children that carry a module's content.
   *
   * A header strip, a body and a control row are three of them; a slot wrapper's
   * lone child is one. Small decorative nodes are excluded so a rule line or an
   * empty positioning div cannot make a genuine pass-through wrapper look
   * composite.
   */
  function significantChildren(el) {
    if (!el) return [];
    return Array.from(el.children).filter(k => {
      const r = k.getBoundingClientRect();
      return r.width > 40 && r.height > 12;
    });
  }

  function fontRoleFor(family, roleMap) {
    if (!family) return null;
    const first = family.split(',')[0].trim().replace(/^["']|["']$/g, '');
    for (const [role, spec] of Object.entries(roleMap || {})) {
      const candidates = [spec.reference, spec.ours].filter(Boolean);
      if (candidates.some(c => first.toLowerCase() === String(c).toLowerCase())) return role;
    }
    return null;
  }

  function typographyOf(el, roleMap) {
    const s = getComputedStyle(el);
    return {
      fontRole: fontRoleFor(s.fontFamily, roleMap),
      fontFamily: s.fontFamily,
      fontSize: round(parseFloat(s.fontSize)),
      fontWeight: Number(s.fontWeight) || s.fontWeight,
      lineHeight: s.lineHeight === 'normal' ? 'normal' : round(parseFloat(s.lineHeight)),
      letterSpacing: s.letterSpacing === 'normal' ? 'normal' : round(parseFloat(s.letterSpacing), 2),
      textTransform: s.textTransform,
    };
  }

  function spacingOf(el) {
    const s = getComputedStyle(el);
    return {
      marginTop: round(parseFloat(s.marginTop)),
      marginBottom: round(parseFloat(s.marginBottom)),
      paddingTop: round(parseFloat(s.paddingTop)),
      paddingBottom: round(parseFloat(s.paddingBottom)),
      paddingLeft: round(parseFloat(s.paddingLeft)),
      paddingRight: round(parseFloat(s.paddingRight)),
    };
  }

  function a11yOf(el) {
    const heading = el.matches('h1,h2,h3,h4,h5,h6')
      ? Number(el.tagName[1])
      : (() => {
          const h = el.querySelector('h1,h2,h3,h4,h5,h6');
          return h ? Number(h.tagName[1]) : null;
        })();
    return {
      headingLevel: heading,
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      ariaExpanded: el.getAttribute('aria-expanded'),
      ariaCurrent: el.getAttribute('aria-current'),
      focusable: el.matches('a[href],button,input,select,textarea,[tabindex]'),
    };
  }

  /**
   * Grid shape, preferred in order of reliability: the authored grid definition,
   * then the observed row/column layout of children. Both are exact-match fields,
   * so a wrong answer here is worse than none — hence the explicit `source`.
   */
  function detectGrid(el) {
    const s = getComputedStyle(el);
    if (s.display === 'grid' || s.display === 'inline-grid') {
      const cols = s.gridTemplateColumns.split(' ').filter(Boolean).length;
      const kids = el.children.length;
      return { columns: cols, rows: cols ? Math.ceil(kids / cols) : null, source: 'grid-template' };
    }
    const kids = Array.from(el.children).filter(k => k.getBoundingClientRect().width > 0);
    if (kids.length < 2) return { columns: 1, rows: kids.length, source: 'observed' };

    const tops = kids.map(k => Math.round(k.getBoundingClientRect().top));
    const rows = new Set(tops).size;
    return { columns: Math.ceil(kids.length / rows), rows, source: 'observed' };
  }

  /**
   * The TIGHTEST containing role, not the first one found. `body` contains every
   * element, so first-match always answers "page" and every module's offset then
   * silently includes the page's centering margin.
   *
   * Takes a LIST of {role, node} rather than a role→node object, because a role
   * is not unique: a page laid out as a stack of banded grids has several
   * elements that are all legitimately "the rail". Keying by role kept one of
   * them and every module in the other bands fell through to "page".
   *
   * Returns the node as well as the role, so geometry can be measured against
   * the container that actually holds this module.
   */
  function containerOf(el, containers) {
    let best = { role: 'page', node: null };
    for (const { role, node } of containers) {
      if (!node || node === el || !node.contains(el)) continue;

      if (!best.node) {
        best = { role, node };
        continue;
      }
      /**
       * DEPTH decides, not area.
       *
       * Area was a proxy for depth and it inverts on a page whose <body> is only
       * viewport-tall — the common `html,body{height:100%}` pattern with the
       * scroller inside. There the body's RECT is smaller than the page column it
       * contains, so the outermost frame wins on area and every module in a wide
       * column is handed a body-relative offset. Worse, `slot` is derived from
       * this role, so a rail whose box happens to be narrower than the body still
       * resolves while the content column does not — the two sides of a diff then
       * measure offsets against different origins and every content module
       * reports a phantom mismatch. Measured on a real page: content modules came
       * back as `page` with offsets 662/1027/1806 instead of `content-column`
       * with 0/365/1144.
       */
      if (best.node.contains(node)) {
        best = { role, node };
        continue;
      }
      // Neither contains the other: unrelated candidates, so fall back to the
      // tighter box rather than letting document order decide.
      if (!node.contains(best.node)) {
        const a = node.getBoundingClientRect();
        const b = best.node.getBoundingClientRect();
        if (a.width * a.height < b.width * b.height) best = { role, node };
      }
    }
    return best;
  }

  /**
   * Geometry is always RELATIVE to the module's container. Absolute page
   * coordinates shift the moment an ad slot or notification bar renders, which
   * would make every capture disagree with every other one.
   */
  function geometryOf(el, container) {
    const r = el.getBoundingClientRect();
    const host = container.node;
    const hr = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
    return {
      container: container.role,
      width: round(r.width),
      height: round(r.height),
      offsetLeftRelative: round(r.left - hr.left),
      offsetTopRelative: round(r.top - hr.top),
    };
  }

  /**
   * Box decoration — border per side, radius, background, own padding.
   *
   * Its absence was a whole class of blindness: a site can frame every module in
   * a ruled, padded cell and a capture recording only geometry + typography will
   * not see it at all. Borders and internal padding are structural, not
   * decoration, so they are captured for every module and every card.
   */
  function boxOf(el) {
    const s = getComputedStyle(el);
    const side = w => round(parseFloat(w) || 0);
    /**
     * The colour of a side that actually has WIDTH.
     *
     * Reading `borderTopColor` first reports a colour no one can see whenever the
     * top side is 0 — and that is the normal case for a ruled cell, which draws
     * only its right and bottom. An unset side keeps `currentColor`, so the field
     * came back black for a reference cell whose visible rule is #b3b3b3, while a
     * clone that sets `border-color` for all four sides and draws the same two
     * reported #b3b3b3. Both were right and the comparison called them different:
     * the mismatch was in which side got asked, not in the rendered pixels.
     */
    const drawnColor = () => {
      const sides = [
        [s.borderTopWidth, s.borderTopColor],
        [s.borderRightWidth, s.borderRightColor],
        [s.borderBottomWidth, s.borderBottomColor],
        [s.borderLeftWidth, s.borderLeftColor],
      ];
      for (const [width, color] of sides) {
        if ((parseFloat(width) || 0) > 0) return normalizeColor(color);
      }
      // No side has width, so there is no border colour to report. Returning the
      // top side's anyway compares two invisible values: an unset border keeps
      // `currentColor`, so the answer tracks the element's TEXT colour, and a
      // framework that presets `border-color` globally reports its token. Both
      // describe a border neither side draws.
      return null;
    };
    return {
      border: {
        top: side(s.borderTopWidth),
        right: side(s.borderRightWidth),
        bottom: side(s.borderBottomWidth),
        left: side(s.borderLeftWidth),
        color: drawnColor(),
      },
      radius: s.borderRadius === '0px' ? 0 : s.borderRadius,
      background: normalizeColor(s.backgroundColor),
      padding: {
        top: side(s.paddingTop),
        right: side(s.paddingRight),
        bottom: side(s.paddingBottom),
        left: side(s.paddingLeft),
      },
      display: s.display,
    };
  }

  /**
   * The repeating card group inside a module: how many, in what arrangement.
   *
   * This is the level a capture most needs and is easiest to omit. Counting a
   * module's direct DOM children answers 1 or 2 for almost everything — it looks
   * like data and carries none. Without a real item count, the only remaining
   * clue is the component's NAME, and a name like "3Up" means three *per row*,
   * not three in total: the module that name belongs to holds six cards in two
   * rows. Guessing from the name gets it exactly half right.
   */
  function itemGridOf(moduleEl) {
    let best = null;

    for (const el of moduleEl.querySelectorAll('*')) {
      const kids = Array.from(el.children).filter(k => {
        const r = k.getBoundingClientRect();
        return r.width > 90 && r.height > 60;
      });
      if (kids.length < 2) continue;

      const rects = kids.map(k => k.getBoundingClientRect());
      // Repeated items are near-equal in width. Unequal siblings are a
      // deliberate asymmetric split, recorded separately below.
      const w0 = rects[0].width;
      const uniform = rects.every(r => Math.abs(r.width - w0) < 12);

      const rowTops = [...new Set(rects.map(r => Math.round(r.top)))].sort((a, b) => a - b);
      const s = getComputedStyle(el);
      // How deep below the module root this set was found, and whether the
      // repeated things are images or wrappers. Two captures can both report an
      // itemGrid while having resolved at DIFFERENT levels — one side's images
      // against the other side's columns — and comparing those is meaningless.
      // Recording the level is what lets the diff notice and decline.
      let depth = 0;
      for (let n = el; n && n !== moduleEl; n = n.parentElement) depth++;
      const candidate = {
        resolvedLevel: {
          depth,
          childTag: kids[0].tagName.toLowerCase(),
          childrenAreImages: kids.every(k => k.matches('img, picture') || !!k.querySelector('img, picture')),
        },
        count: kids.length,
        rows: rowTops.length,
        perRow: Math.round(kids.length / rowTops.length),
        uniform,
        card: { width: round(w0), height: round(rects[0].height) },
        widths: uniform ? null : rects.map(r => round(r.width)),
        display: s.display,
        gridTemplateColumns: s.gridTemplateColumns === 'none' ? null : s.gridTemplateColumns,
        gap: s.gap === 'normal' ? 0 : s.gap,
        cardBox: boxOf(kids[0]),
        // Non-serialised: lets arrangement be measured inside a card. Stripped
        // before the capture is written.
        _firstCard: kids[0],
      };
      if (!best || candidate.count > best.count) best = candidate;
    }
    return best;
  }

  /**
   * Interactive controls inside a module — buttons, pill links, carousel arrows,
   * dot paginations.
   *
   * Without this a capture is blind to an entire class of feature. A module's
   * geometry and typography can all match while a "Load more" button, a pair of
   * carousel arrows, or a centred dot strip is simply absent, and nothing in the
   * comparison notices. Controls are structure, not chrome.
   *
   * Alignment is MEASURED, not read from `justify-content`: a control can be
   * centred by auto margins, by a flex parent, or by text-align, and only the
   * resulting gaps are common to all three.
   */
  function controlsOf(moduleEl) {
    const host = moduleEl.getBoundingClientRect();
    if (host.width === 0) return null;

    const nodes = Array.from(
      moduleEl.querySelectorAll('button, [role="tab"], [role="button"], a[class*="button" i], a[class*="cta" i], a[class*="pill" i]')
    ).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    });
    if (nodes.length === 0) return null;

    const align = r => {
      const left = r.left - host.left;
      const right = host.right - r.right;
      if (Math.abs(left - right) <= 2) return 'center';
      return left < right ? 'left' : 'right';
    };

    const items = nodes.slice(0, 14).map(el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      /**
       * The VISIBLE text and the ACCESSIBLE name are recorded separately.
       *
       * They were one field — `aria-label || textContent` — and collapsing them
       * hid a real defect behind a coincidence. The reference's load-more button
       * reads "Load more" and carries `aria-label="more stories"`; ours read
       * "more stories" with no aria-label. Both collapsed to the string
       * "more stories", the comparison passed, and a button with visibly wrong
       * copy shipped as a match. Keeping them apart is what makes wrong copy and
       * a wrong accessible name two findings instead of zero.
       */
      const text = (el.textContent || '').trim().slice(0, 40);
      const label = (el.getAttribute('aria-label') || text).trim().slice(0, 40);
      return {
        kind: el.getAttribute('role') || el.tagName.toLowerCase(),
        label: label || null,
        text: text || null,
        width: round(r.width),
        height: round(r.height),
        alignment: align(r),
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        radius: s.borderRadius === '0px' ? 0 : s.borderRadius,
        borderWidth: round(parseFloat(s.borderTopWidth) || 0),
        cursor: s.cursor,
      };
    });

    /**
     * A pagination strip: several identically-sized controls sitting on one row.
     *
     * Detected by SHAPE, not by role or class. Keying on `role="tab"` misses the
     * common case — dots are frequently plain buttons carrying only an
     * aria-label — and a group that goes undetected takes its alignment with it,
     * which is exactly the property most visible when wrong.
     *
     * Alignment belongs to the group, never to an individual dot: the first dot
     * in a centred strip still sits left of centre.
     */
    let tabGroup = null;
    const byRow = new Map();
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      // bucket by row and by size, so a row of equal dots clusters together
      const key = `${Math.round(r.top / 4)}:${Math.round(r.width)}x${Math.round(r.height)}`;
      if (!byRow.has(key)) byRow.set(key, []);
      byRow.get(key).push(r);
    }
    for (const rects of byRow.values()) {
      if (rects.length < 2) continue;
      if (tabGroup && rects.length <= tabGroup.count) continue;
      const groupLeft = Math.min(...rects.map(r => r.left));
      const groupRight = Math.max(...rects.map(r => r.right));
      tabGroup = {
        count: rects.length,
        alignment: align({ left: groupLeft, right: groupRight }),
        itemWidth: round(rects[0].width),
      };
    }

    return { count: nodes.length, items, tabGroup };
  }

  /** Drop the non-serialisable element handles before a capture is written. */
  function stripInternals(obj) {
    if (!obj) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!k.startsWith('_')) out[k] = v;
    }
    return out;
  }

  /**
   * Is the image beside the text, or above it?
   *
   * One rect comparison, and it decides a module's entire silhouette. A module
   * 800px wide and 251px tall cannot be holding a full-width image with text
   * beneath — a 16:9 image alone would be ~466px tall — so the arrangement was
   * always derivable from numbers already in hand.
   */
  /**
   * Where the image sits relative to the text, inside a card.
   *
   * Returns `null` only when there is genuinely no image to arrange. When an
   * image IS present but the measurement could not be taken, it returns
   * `{ unmeasured: <reason> }` instead, and the caller records the field as
   * unmeasured rather than absent.
   *
   * That distinction is not academic. This anchors on `h1-h6`, and a reference
   * app whose card headlines are not headings — common, and recorded as a
   * deviation on this project — yields no anchor, so the reference measured
   * nothing while a clone using real headings measured a layout. The diff then
   * reported `expected undefined, got "image-right"` as a defect on every such
   * module. Reading that absence as evidence caused a real regression: a feed
   * was rebuilt without thumbnails and measured 758px against the reference's
   * 1412px before being reverted.
   */
  function arrangementOf(el) {
    const img = el.querySelector('img, picture');
    if (!img) return null;                       // measured: there is no image

    const text = el.querySelector('h1,h2,h3,h4,h5,h6');
    if (!text) return { unmeasured: 'no-heading-anchor' };

    const i = img.getBoundingClientRect();
    const t = text.getBoundingClientRect();
    if (i.width === 0 || t.width === 0) return { unmeasured: 'zero-rect' };

    let layout = 'overlapping';
    if (i.right <= t.left + 6) layout = 'image-left';
    else if (t.right <= i.left + 6) layout = 'image-right';
    else if (i.bottom <= t.top + 6) layout = 'image-above';
    else if (t.bottom <= i.top + 6) layout = 'image-below';

    return {
      layout,
      image: { width: round(i.width), height: round(i.height) },
      // Fraction of the module's width the image occupies — the number that
      // distinguishes a left-hand thumbnail from a full-bleed hero.
      imageWidthFraction: round(i.width / el.getBoundingClientRect().width, 2),
    };
  }

  const TEXT_ROLES = [
    ['title', 'h1,h2,h3,h4,h5,h6'],
    ['eyebrow', '[class*="eyebrow" i],[class*="kicker" i],[class*="label" i]'],
    ['dek', 'p'],
    ['cta', 'button,a[class*="button" i],a[class*="cta" i]'],
  ];

  function elementsOf(moduleEl, roleMap) {
    const out = [];
    for (const [role, sel] of TEXT_ROLES) {
      let node;
      try {
        node = moduleEl.querySelector(sel);
      } catch {
        continue; // some browsers reject the case-insensitive attribute syntax
      }
      if (!node) continue;
      out.push({
        role,
        tag: node.tagName.toLowerCase(),
        typography: typographyOf(node, roleMap),
        color: normalizeColor(getComputedStyle(node).color),
        spacing: spacingOf(node),
      });
    }
    return out;
  }

  /**
   * Look through a pass-through wrapper to the module inside it.
   *
   * Component systems commonly wrap every module in a generic grid/slot element,
   * so the outermost named thing is a layout wrapper rather than the module —
   * `moduleWrapper` instead of the specific module type, which makes every module on
   * the page report the same useless identity.
   *
   * "Wrapper" is defined structurally, never by a list of known names: an element
   * whose box is almost entirely filled by a descendant carrying a DIFFERENT
   * family. Keeping it structural is what lets this work on an app it has never
   * seen.
   *
   * "Fills it" is measured against the wrapper's CONTENT box, not its border box.
   * A padded cell can never be filled to its border box by definition, and the
   * error is not evenly distributed: the narrower the cell, the larger a share
   * its padding takes. A 35px-per-side inset leaves a 900px cell at 92% — which
   * passes — and an identically-padded 400px rail cell at 83.5%, which does not.
   * So a border-box test silently unwraps every content module and no rail
   * module, and a whole rail reports as anonymous layout wrappers while the
   * content column looks perfect. That is the same disappearing-rail failure
   * this function exists to prevent, arriving through the threshold instead.
   */
  function unwrapPassThrough(el) {
    const base = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const px = v => parseFloat(v) || 0;
    const availWidth = base.width - px(s.paddingLeft) - px(s.paddingRight);
    const availHeight = base.height - px(s.paddingTop) - px(s.paddingBottom);
    const baseFamily = classFamilies(el)[0] || null;

    for (const inner of el.querySelectorAll('[class*="__"]')) {
      const family = classFamilies(inner)[0];
      if (!family || family === baseFamily) continue;

      const r = inner.getBoundingClientRect();
      if (r.width < availWidth * 0.85 || r.height < availHeight * 0.5) continue;

      /**
       * Filling the wrapper's box is NOT sufficient evidence of a pass-through
       * wrapper — a pass-through wrapper contains nothing but the module.
       *
       * A section built as header + body + control row has a body that fills most
       * of its parent while two siblings sit outside it, and unwrapping to that
       * body silently drops both. Measured on a real page: it discarded a module's
       * own header and its "Load more" button, and the capture then reported
       * `controls: null` for a feed that visibly has one — a missing control
       * presented as a fact about the reference. So every level between the
       * wrapper and the candidate has to hold the candidate alone.
       */
      let composite = false;
      for (let p = inner; p && p !== el; p = p.parentElement) {
        if (significantChildren(p.parentElement).length > 1) {
          composite = true;
          break;
        }
      }
      if (composite) continue;

      return inner; // first descendant that nearly fills the wrapper
    }
    return el;
  }

  /**
   * Module discovery. Three strategies in descending reliability.
   *
   * The two sides of a comparison are NOT symmetric, which is the key thing to
   * understand here. A reference app built with CSS modules leaks a real identity
   * signal in its class names. A clone built with a utility-class framework
   * (Tailwind and friends) leaks nothing at all — every element is a pile of
   * `h-[250px] mx-auto` and no amount of heuristic recovers "this is the hero".
   *
   * So the clone side declares its modules with `data-parity-module` instead of being
   * guessed at. That makes clone-side identification exact rather than heuristic,
   * makes module identity greppable in our own source, and doubles as a record of
   * which catalogued module each component implements.
   */
  function findModules(root, config, hosts = []) {
    // 1. Declared markers — the clone side, and anything on the reference that
    //    happens to expose them. Exact.
    const declared = Array.from(root.querySelectorAll('[data-parity-module]'));
    if (declared.length) {
      return declared.map(el => ({
        id: el.getAttribute('data-parity-module'),
        el,
        // A clone can mark its framing cell separately with `data-parity-cell`,
        // mirroring the reference's own two levels (decorated wrapper + plain
        // module). Falling back to the marked element keeps single-level clones
        // working; without the pairing, cell decoration reads as absent on our
        // side and every size comparison comes out a level off.
        cellEl: el.closest('[data-parity-cell]') || el,
        fingerprint: { kind: 'declared', value: 'data-parity-module', confidence: 'high' },
      }));
    }

    // 2. An id→selector map from the archetype template.
    if (config.moduleSelectors) {
      const found = [];
      for (const [id, sel] of Object.entries(config.moduleSelectors)) {
        const el = root.querySelector(sel);
        if (el) found.push({ id, el, fingerprint: { kind: 'selector', value: sel, confidence: 'high' } });
      }
      return found;
    }

    // 3. Class-family auto-discovery — the reference side's first pass.
    //
    // A recursive walk, because two simpler rules both fail on a real page:
    //   - One element per family collapses SIBLING repeats. A section front runs
    //     the same module type down the page (four category grids sharing one
    //     family), and keeping only the first loses the module order and the
    //     page's shape — the two things the capture exists to record.
    //   - "Skip anything inside an already-accepted element" lets the outermost
    //     wrapper win: document order reaches the page-wide layout container
    //     first, and it then swallows every module inside it.
    //
    // So: descend through page-scale scaffolding, and emit the first module-scale
    // named element on each branch. Siblings are all emitted; a module's own
    // internals are not, because emitting stops the descent.
    const found = [];
    const seenCount = new Map();
    const rootHeight = root.getBoundingClientRect().height || 1;

    /**
     * Scaffolding is the page's own band grid — which `detectLayout` has already
     * identified — not "anything tall".
     *
     * Height was the original proxy and it misfires on exactly the pages this
     * tool exists to check. A category page is mostly one long archive feed: the
     * feed is taller than half the page, so it read as scaffolding, the walk
     * descended into it, and each of its thirteen ROWS was emitted as a separate
     * module. The page reported twenty modules instead of five, and the one
     * module that actually mattered was not among them.
     *
     * Identity, not proportion: an element is scaffolding if it IS a band grid,
     * IS one of that grid's columns, or CONTAINS a band grid. Everything else
     * carrying a class family is a module however tall it happens to be. The
     * contains-a-host test is what keeps page-scale wrappers above the bands from
     * being emitted as one giant module that swallows the page.
     */
    const scaffoldNodes = new Set();
    for (const host of hosts) {
      scaffoldNodes.add(host);
      for (const col of host.children) scaffoldNodes.add(col);
    }

    const walk = node => {
      for (const child of node.children) {
        const r = child.getBoundingClientRect();
        if (r.width < 100 || r.height < 20) continue; // atom, not a module

        const families = classFamilies(child);
        // No declared bands (an app whose grid we could not read) ⇒ fall back to
        // the original height proxy rather than treating everything as a module.
        const isScaffold = hosts.length
          ? scaffoldNodes.has(child) || hosts.some(h => child !== h && child.contains(h))
          : r.height > rootHeight * 0.5;

        /**
         * A grouping container holds sibling modules and contributes nothing of
         * its own, so it is not a module — its children are.
         *
         * Told apart by SOURCE, not by size or name: every significant child is
         * styled by a different class-file than the wrapper itself, which means
         * the wrapper supplies only the arrangement. A real composite module is
         * the opposite case — its header, body and controls are all styled by its
         * own file. Without this, one anonymous wrapper reports as a single
         * module and the several real modules inside it never appear at all;
         * measured on a real page, a bare wrapper swallowed two recap blocks.
         */
        const ownFile = classFileOf(child);
        const kids = significantChildren(child);
        const isGrouping =
          ownFile &&
          kids.length > 1 &&
          kids.every(k => {
            const kf = classFileOf(k);
            return kf && kf !== ownFile;
          });

        if (families.length && !isScaffold && !isGrouping) {
          // Unwrapping finds the module's IDENTITY, but the wrapper is usually
          // what carries the cell's border and padding — so keep both. Looking
          // only at the unwrapped inner element reports "no border" on a page
          // built entirely from ruled, padded cells.
          const el = unwrapPassThrough(child);
          const family = classFamilies(el)[0] || families[0];
          const n = (seenCount.get(family) || 0) + 1;
          seenCount.set(family, n);
          const base = family.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
          found.push({
            id: n === 1 ? base : `${base}#${n}`,
            el,
            cellEl: child, // the outer, decorated element
            fingerprint: { kind: 'class-family', value: family, confidence: 'high', instance: n },
          });
          continue; // do not descend into a module
        }
        walk(child);
      }
    };
    walk(root);
    return found;
  }

  /**
   * Layout: the content wrapper's width, plus the dominant multi-column region.
   *
   * "The first wide grid under main" is the wrong model, and observing a real page
   * is what shows why: a content/rail split is often internal to ONE module rather
   * than spanning the page, so picking the first wide grid grabs whatever
   * flex row happens to appear first — a nav strip, a button group — and reports
   * its children as page columns.
   *
   * Two corrections. A real column is TALL, not merely wide: it spans a
   * meaningful fraction of its container's height, which excludes toolbars and
   * button rows. And the region's vertical extent gets reported alongside it, so
   * a reader can see the columns cover part of the page rather than all of it
   * instead of being misled by an unqualified "columns" list.
   */
  function detectLayout(main) {
    // The content wrapper is the widest block that actually constrains content —
    // walk down while a single child keeps nearly the full width.
    let wrapper = main;
    while (wrapper.children.length === 1) {
      const child = wrapper.children[0];
      const cw = child.getBoundingClientRect().width;
      if (cw <= 0 || cw < wrapper.getBoundingClientRect().width * 0.6) break;
      wrapper = child;
    }
    const contentMaxWidth = round(wrapper.getBoundingClientRect().width);

    /**
     * Prefer columns the page DECLARES over columns inferred from proportions.
     *
     * A height-fraction heuristic was rejecting real page columns: a section
     * front's content/rail grid may span only a quarter of a long page's height,
     * yet it is explicitly declared as `grid-template-columns: 880px 400px` in
     * computed style. Inferring `fr` ratios while the exact pixel values sat
     * unread is strictly worse than reading them.
     *
     * Card grids also declare pixel tracks, so declared-ness alone is not
     * enough. Page columns are few, wide, and on the widest such container —
     * card tracks are narrower and live inside a module.
     */
    const candidates = [];
    for (const el of main.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if (s.display !== 'grid') continue;

      const tracks = s.gridTemplateColumns.split(' ').map(t => parseFloat(t)).filter(t => !Number.isNaN(t));
      if (tracks.length < 2 || tracks.length > 3) continue;
      if (!tracks.every(t => t >= 250)) continue;

      const r = el.getBoundingClientRect();
      if (r.width < 600) continue;
      candidates.push({ el, rect: r, tracks, style: s });
    }

    /**
     * Widest wins, and among equally wide candidates the TALLEST wins.
     *
     * The tie-break is not cosmetic. A page is commonly built as a stack of
     * bands that all declare the same page grid — header band, lead band, a
     * full-bleed ad band, the archive band — and every one of them is exactly
     * as wide as the others. Width alone therefore ties across all of them and
     * document order decides, which hands the answer to a 153px header strip
     * and makes the page's real columns unreachable. Height is what separates
     * a band that carries the page from one that carries a title.
     *
     * Width still leads, so a tall narrow card grid inside a module cannot win.
     */
    let declared = null;
    for (const c of candidates) {
      if (
        !declared ||
        c.rect.width > declared.rect.width + 1 ||
        (Math.abs(c.rect.width - declared.rect.width) <= 1 && c.rect.height > declared.rect.height)
      ) {
        declared = c;
      }
    }

    if (declared) {
      /**
       * Every band declaring the SAME tracks is a page-column host, not just the
       * winner. Registering only the winner leaves each other band's columns
       * unrepresented, so their modules fall through to "page" — which is how an
       * entire rail can be captured without a single module marked `rail`.
       *
       * Matched on the exact track string so a module-internal card grid, whose
       * tracks differ, can never be mistaken for a page band.
       */
      const signature = declared.style.gridTemplateColumns;
      const hosts = candidates
        .filter(c => c.style.gridTemplateColumns === signature)
        .sort((a, b) => a.rect.top - b.rect.top)
        .map(c => c.el);

      return {
        layout: {
          contentMaxWidth,
          columns: declared.tracks.map((width, i) => ({
            role: i === 0 ? 'content' : i === 1 ? 'rail' : `col-${i}`,
            width: round(width),
          })),
          gap: declared.style.gap && declared.style.gap !== 'normal' ? round(parseFloat(declared.style.gap)) : 0,
          source: 'declared',
          declaredWidth: round(declared.rect.width),
          columnsSpan: {
            height: round(declared.rect.height),
            fractionOfMain: round(declared.rect.height / (main.getBoundingClientRect().height || 1), 2),
          },
          bands: hosts.length,
        },
        hosts,
        wrapper,
      };
    }

    let best = null;
    for (const el of main.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if (s.display !== 'grid' && s.display !== 'flex') continue;

      const r = el.getBoundingClientRect();
      if (r.width < 600 || r.height < 200) continue;

      const kids = Array.from(el.children)
        .map(c => c.getBoundingClientRect())
        .filter(cr => cr.width > 0);
      // At least two children each covering a real share of the height. A
      // toolbar's children are short relative to their container; a column's
      // are not.
      const tall = kids.filter(cr => cr.height >= r.height * 0.25);
      if (tall.length < 2) continue;

      if (!best || r.height > best.rect.height) best = { el, rect: r, kids, style: s };
    }

    const mainHeight = main.getBoundingClientRect().height;

    // A page-level column layout must actually span the page. Observing a real
    // page shows why: every multi-column region here is internal to a single
    // module, and reporting the tallest of them as "the page columns" invents a
    // layout that does not exist. Module-internal splits are already captured by
    // each module's own `grid`, so they lose nothing by being excluded here.
    const spansPage = best && best.rect.height >= mainHeight * 0.6;

    if (!best || !spansPage) {
      return {
        layout: {
          contentMaxWidth,
          columns: [],
          gap: null,
          columnsSpan: null,
          noPageColumns: best
            ? `tallest multi-column region covers ${round(best.rect.height / mainHeight, 2)} of the page — treated as module-internal, not a page layout`
            : 'no multi-column region found',
        },
        hosts: [],
        wrapper,
      };
    }

    const columns = best.kids.map((cr, i) => ({
      role: i === 0 ? 'content' : i === 1 ? 'rail' : `col-${i}`,
      width: round(cr.width),
    }));

    return {
      layout: {
        contentMaxWidth,
        columns,
        gap: best.style.gap && best.style.gap !== 'normal' ? round(parseFloat(best.style.gap)) : 0,
        // Columns cover this vertical slice of the page, not necessarily all of it.
        columnsSpan: {
          height: round(best.rect.height),
          fractionOfMain: round(best.rect.height / main.getBoundingClientRect().height, 2),
        },
      },
      hosts: [best.el],
      wrapper,
    };
  }

  function freezeAnimations() {
    const style = document.createElement('style');
    style.id = '__parity_freeze';
    style.textContent = `*,*::before,*::after{
      animation-duration:0s !important; animation-delay:0s !important;
      transition-duration:0s !important; transition-delay:0s !important;
      scroll-behavior:auto !important;
    }`;
    document.head.appendChild(style);
  }

  /**
   * A frame tick that also works in a hidden tab.
   *
   * `requestAnimationFrame` never fires while a tab is backgrounded, and a
   * backgrounded tab is the NORMAL case for an agent-driven capture — the browser
   * window isn't focused, so `document.visibilityState` is "hidden" and every
   * `await raf()` blocks forever. A headless driver hides the problem because its
   * pages always report visible.
   *
   * Racing against a timer makes the stability loop advance either way. Layout is
   * still computed in a hidden tab, so the measurements stay valid.
   */
  const raf = () =>
    new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      requestAnimationFrame(finish);
      setTimeout(finish, 50);
    });

  /**
   * Wait until the DOM stops changing for `quietMs`.
   *
   * Geometry stability alone is not enough: a client-rendered page shows a
   * "Loading…" placeholder whose layout is perfectly stable, so a rect-sampling
   * check happily reports "settled" while the real content has not arrived. Any
   * app that fetches on the client — SWR, React Query, a plain useEffect — looks
   * finished at `load` and is not.
   *
   * Mutation quiet catches it: the placeholder is replaced, the DOM churns, then
   * genuinely goes quiet once data has rendered.
   */
  function waitForQuiet(root, quietMs, budgetMs) {
    return new Promise(resolve => {
      let timer;
      let done = false;
      const finish = reason => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(budgetTimer); // leaving this armed keeps the page busy after we're done
        observer.disconnect();
        resolve(reason);
      };
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish('quiet'), quietMs);
      };
      const observer = new MutationObserver(arm);
      observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
      arm();
      const budgetTimer = setTimeout(() => finish('budget-exhausted'), budgetMs);
    });
  }

  /**
   * Wait for the page to stop moving. Fonts and images both reflow layout after
   * load, and measuring mid-reflow is the single largest source of phantom
   * diffs — so measure twice and only proceed when the numbers agree.
   */
  async function settle(root, opts = {}) {
    const { attempts = 8, quietMs = 600, budgetMs = 15000, waitForSelector = null } = opts;
    // Every wait here is capped. A capture that hangs is worse than one that
    // reports what it couldn't wait for: the first burns a run with no output,
    // the second is honest and still usable.
    const withTimeout = (promise, ms) =>
      Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);

    if (document.fonts && document.fonts.ready) await withTimeout(document.fonts.ready, 3000);

    // Lazy images below the fold never load until they scroll into view, so
    // awaiting them never returns — and virtually every modern page lazy-loads
    // almost all of its imagery. Wait only for images plausibly loading right
    // now, and cap even those so one stuck asset can't stall the capture.
    const vh = window.innerHeight;
    const pending = Array.from(document.images).filter(img => {
      if (img.complete) return false;
      const r = img.getBoundingClientRect();
      const nearViewport = r.top < vh * 1.5 && r.bottom > -vh * 0.5;
      return nearViewport || img.loading !== 'lazy';
    });

    const imagesWaited = pending.length;
    await withTimeout(
      Promise.all(pending.map(img => new Promise(r => { img.onload = img.onerror = r; }))),
      5000
    );

    // Defensive on purpose. A page can hand back a missing or non-standard rect —
    // an unusual element, or a script that has tampered with
    // `getBoundingClientRect` — and an exception here aborts the whole capture,
    // which is strictly worse than a slightly degraded one. Skip what cannot be
    // measured rather than losing everything.
    const snapshot = () =>
      Array.from(root.querySelectorAll('*'))
        .slice(0, 400)
        .map(el => {
          let r;
          try {
            r = el.getBoundingClientRect();
          } catch {
            return 'x';
          }
          if (!r || typeof r.width !== 'number') return 'x';
          return `${round(r.width)}x${round(r.height)}@${round(r.top)}`;
        })
        .join('|');

    const lazyDeferred = Array.from(document.images).filter(
      img => !img.complete && !pending.includes(img)
    ).length;

    // Content readiness first, then layout stability. Order matters: confirming
    // geometry has stopped moving is meaningless if the real content hasn't
    // rendered yet.
    let selectorFound = null;
    if (waitForSelector) {
      const deadline = Date.now() + budgetMs;
      while (!root.querySelector(waitForSelector) && Date.now() < deadline) await raf();
      selectorFound = !!root.querySelector(waitForSelector);
    }
    const quietReason = await waitForQuiet(root, quietMs, budgetMs);

    let previous = snapshot();
    for (let i = 0; i < attempts; i++) {
      await raf();
      await raf();
      const next = snapshot();
      if (next === previous) {
        return { settled: true, framesWaited: i + 1, imagesWaited, lazyDeferred, quietReason, selectorFound };
      }
      previous = next;
    }
    return { settled: false, framesWaited: attempts, imagesWaited, lazyDeferred, quietReason, selectorFound };
  }

  /**
   * Transfer helpers for the reference side.
   *
   * The clone driver writes its capture straight to disk. The reference side runs
   * inside a browser tool that cannot write files, so its capture has to come
   * back through a conversation — and a conversation truncates. Truncation is not
   * a cosmetic problem: a capture cut off mid-list looks complete, and whole
   * modules sitting in the severed tail read as "not present in the reference".
   *
   * So the capture is stashed whole, its exact byte length reported, and it is
   * read back in fixed-size slices that the caller appends to a file and
   * re-parses. If the reassembled file parses and its module count matches the
   * reported count, nothing was lost — and that is checkable rather than assumed.
   */
  window.__parityStash = function stash(capture) {
    const json = JSON.stringify(capture);

    // Base64, not raw JSON. Transferring raw JSON through a shell is unsafe twice
    // over: quotes, backslashes and `$` need escaping, and appending a slice adds
    // a trailing newline — which corrupts the file whenever a slice boundary
    // falls inside a string value, since a literal newline is an illegal JSON
    // control character. Base64's alphabet is shell-inert and tolerates stray
    // whitespace, which can simply be stripped before decoding.
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const b64 = btoa(binary);

    window.__parityCapture = b64;
    return {
      encoding: 'base64',
      jsonBytes: json.length,
      base64Bytes: b64.length,
      modules: capture.modules.length,
      moduleOrder: capture.page.moduleOrder,
      slices: Math.ceil(b64.length / 12000),
      sliceSize: 12000,
      settled: capture.environment.settled,
      unmatched: capture.unmatched.length,
    };
  };

  /**
   * Read slice `i` of the stashed base64 capture. Concatenated in order and
   * decoded, the slices are the capture file.
   */
  window.__paritySlice = function slice(i, size = 12000) {
    const b64 = window.__parityCapture || '';
    return b64.slice(i * size, (i + 1) * size);
  };

  /**
   * @param {object} config
   * @param {'reference'|'clone'} config.kind
   * @param {string}  config.route
   * @param {string}  [config.archetype]
   * @param {object}  [config.fontRoles]        token role map, for role-based font compare
   * @param {object}  [config.moduleSelectors]  id → selector, from the archetype template
   * @param {string}  [config.mainSelector]     defaults to <main>, then body
   */
  window.__parityExtract = async function extractPage(config = {}) {
    freezeAnimations();

    const main =
      (config.mainSelector && document.querySelector(config.mainSelector)) ||
      document.querySelector('main') ||
      document.body;

    const settlement = await settle(main, {
      quietMs: config.quietMs,
      budgetMs: config.budgetMs,
      waitForSelector: config.waitForSelector,
    });

    const { layout, hosts: columnHosts, wrapper } = detectLayout(main);

    // Container roles, most specific last so `containerOf` prefers the tightest
    // match. `content-wrapper` matters more than it looks: most modules sit
    // directly in it, and reporting their offsets relative to the page instead
    // would fold in the page's centering margin — making every offset look wrong
    // by the same amount whenever the max-width changes.
    const containers = [
      { role: 'page', node: document.body },
      { role: 'main', node: main },
      { role: 'content-wrapper', node: wrapper },
    ];

    /**
     * Every band contributes its columns under the SAME role names.
     *
     * Deliberately not `rail#2`, `rail#3`: the role is the module's reference
     * frame, and it has to mean the same thing on both sides of a diff. The two
     * sides do not have to agree on how many bands the page is cut into — only
     * on which column a module lives in and where it sits inside that column.
     * Numbering the bands would make `geometry.container` depend on markup
     * layout the clone has no reason to reproduce, turning a faithful rail into
     * a mismatch.
     */
    for (const host of columnHosts || []) {
      Array.from(host.children).forEach((child, i) => {
        containers.push({
          role: i === 0 ? 'content-column' : i === 1 ? 'rail' : `col-${i}`,
          node: child,
        });
      });
    }

    const discovered = findModules(main, config, columnHosts || []);
    const modules = discovered.map(({ id, el, cellEl, fingerprint }) => {
      const container = containerOf(el, containers);
      // The outermost decorated element: often a separate wrapper on the
      // reference side, the marked element itself on the clone side. Both are
      // recorded identically so the two sides stay comparable — treating a
      // same-element cell as "absent" inverts the very comparison this exists for.
      const cell = cellEl || el;
      const itemGrid = itemGridOf(el);

      // Measurement state, gathered before the module is assembled. A field
      // listed here was NOT measured; that is a different claim from measuring
      // it and finding nothing, and the diff has to be able to tell them apart.
      const unmeasured = [];
      const arrangement = arrangementOf(itemGrid?._firstCard || el);
      if (arrangement && arrangement.unmeasured) unmeasured.push('arrangement');

      return {
        id,
        fingerprint,
        slot: container.role === 'rail' ? 'rail' : 'content',
        geometry: geometryOf(el, container),
        grid: detectGrid(el),
        // The framing cell: its border and padding are what make a page look
        // ruled and inset, and they live here rather than on the module.
        cell: cell
          ? { box: boxOf(cell), width: round(cell.getBoundingClientRect().width), height: round(cell.getBoundingClientRect().height) }
          : null,
        box: boxOf(el),
        // How many cards, in what arrangement — the level a module's name only
        // hints at and frequently misstates.
        itemGrid: stripInternals(itemGrid),
        // Buttons, arrows, dot paginations. Absent this, a module can match on
        // every measurement while missing its only interactive affordance.
        controls: controlsOf(el),
        // Measured inside a CARD, not across the module. Measuring the whole
        // module makes its header count as "text above the image" and reports
        // every headed module as image-below, which is never what it means.
        arrangement: arrangement && arrangement.unmeasured ? null : arrangement,
        itemCount: el.children.length, // DOM children; see itemGrid for real card counts
        elements: elementsOf(el, config.fontRoles),
        a11y: a11yOf(el),
        // Field paths this capture did NOT measure, as distinct from measured
        // and found absent. The diff skips them rather than comparing a value
        // against a gap in its own knowledge.
        unmeasured,
        volatile: false, // set by the driver's double-capture pass, never here
        behavior: [], // agent-observed; property extraction cannot see it
        notes: null,
      };
    });

    return {
      schema: SCHEMA,
      status: 'draft',
      captured: new Date().toISOString(),

      target: {
        kind: config.kind || 'unknown',
        url: location.href,
        route: config.route || location.pathname,

        // WHICH state of this route, and WHO was looking.
        //
        // A route stops being a page once an app has state. The same URL renders
        // differently for an empty list and a full one, for an admin and a
        // reporter, before and after a record exists. Two captures differing on
        // either are measurements of two different pages, so the diff refuses —
        // the same reasoning as the viewport guard.
        //
        // null means "unspecified", which is correct for an app whose pages do
        // not vary, and keeps captures taken before this field comparable.
        fixture: config.fixture || null,
        actor: config.actor || null,
      },

      environment: {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        deviceScaleFactor: window.devicePixelRatio,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        animationsDisabled: true,
        // Recorded because it changes how settling had to be measured: in a hidden
        // tab rAF never fires, so the stability loop advances on timers instead.
        visibilityState: document.visibilityState,
        fontsReady: true,
        settled: settlement.settled,
        framesWaited: settlement.framesWaited,
        imagesWaited: settlement.imagesWaited,
        lazyDeferred: settlement.lazyDeferred,
        quietReason: settlement.quietReason,
        waitForSelectorFound: settlement.selectorFound,
      },

      archetype: config.archetype || null,

      page: {
        chrome: ['header', 'nav', 'footer'].filter(sel => document.querySelector(sel)),
        layout,
        moduleOrder: modules.map(m => m.id),
      },

      modules,
      volatility: { detectedBy: null, runs: 1, ignore: [] },
      unmatched: [],
    };
  };
})();
