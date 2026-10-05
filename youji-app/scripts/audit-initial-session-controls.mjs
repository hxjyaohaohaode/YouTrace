// Existing Y6L painted/clipped/foreground geometry; no DOM writes.
export function initialSessionGeometry(selector) {
    const nodes = [...document.querySelectorAll(selector)];
    if (nodes.length !== 1) return { unique: false, count: nodes.length, visible: false };
    const el = nodes[0], rect = el.getBoundingClientRect(), dialog = el.closest('[role=dialog]');
    const navs = dialog ? [] : [...document.querySelectorAll('nav[aria-label="主导航"]')].filter(node => !node.contains(el)).map(node => node.getBoundingClientRect()).filter(box => box.width >= innerWidth / 2 && box.height > 0 && box.top > innerHeight / 2 && box.bottom >= innerHeight - 1);
    const clip = { left: 0, top: 0, right: innerWidth, bottom: Math.min(innerHeight, ...navs.map(box => box.top)) };
    // A viewport-fixed navigation bar escapes static overflow ancestors. Keep
    // ordinary/modal clipping unchanged and fail closed for transformed or
    // specially contained ancestors; do not grant a fractional-pixel tolerance.
    const fixedNav = el.closest('nav[aria-label="主导航"]'), navAncestors = [];
    if (fixedNav && getComputedStyle(fixedNav).position === 'fixed') for (let parent = fixedNav.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      navAncestors.push({ tag: parent.tagName, transform: css.transform, perspective: css.perspective, filter: css.filter, backdropFilter: css.backdropFilter, contain: css.contain, willChange: css.willChange, containerType: css.containerType, contentVisibility: css.contentVisibility, clipPath: css.clipPath, maskImage: css.maskImage });
    }
    const viewportFixedNav = Boolean(fixedNav && getComputedStyle(fixedNav).position === 'fixed') && navAncestors.every(css =>
      [css.transform, css.perspective, css.filter, css.backdropFilter, css.clipPath, css.maskImage].every(value => !value || value === 'none') &&
      !/layout|paint|strict|content/.test(css.contain) && !/transform|perspective|filter|contain/.test(css.willChange) &&
      (!css.containerType || css.containerType === 'normal') && (!css.contentVisibility || css.contentVisibility === 'visible'));
    let scroller = null, painted = getComputedStyle(el).visibility === 'visible' && Number(getComputedStyle(el).opacity) >= 0.99;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), box = parent.getBoundingClientRect();
      painted = painted && css.visibility === 'visible' && Number(css.opacity) >= 0.99;
      const clipsThisTarget = !viewportFixedNav || parent === fixedNav || fixedNav.contains(parent);
      if (clipsThisTarget && /(auto|scroll|hidden|clip)/.test(css.overflowY)) { clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom); }
      if (clipsThisTarget && /(auto|scroll|hidden|clip)/.test(css.overflowX)) { clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right); }
      if (clipsThisTarget && !scroller && /(auto|scroll)/.test(css.overflowY) && parent.scrollHeight > parent.clientHeight) scroller = { tag: parent.tagName, role: parent.getAttribute('role'), scrollTop: parent.scrollTop, scrollHeight: parent.scrollHeight, clientHeight: parent.clientHeight };
    }
    const centerHit = el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    const textNotTruncated = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.scrollWidth <= el.clientWidth + 1;
    return { unique: true, text: el.innerText, rect: rect.toJSON(), clip, scroller, centerHit, painted, textNotTruncated, viewportFixedNav, navAncestors,
      visible: painted && centerHit && textNotTruncated && rect.width > 0 && rect.height > 0 && rect.left >= clip.left && rect.right <= clip.right && rect.top >= clip.top && rect.bottom <= clip.bottom };
  }
