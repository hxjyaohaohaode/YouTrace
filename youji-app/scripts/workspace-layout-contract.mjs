// Test-only: measure the actual workspace, never the first arbitrary <main>.
// Self-contained because Puppeteer serializes this function into the browser.
export function sampleStableWorkspace() {
  const key = '__youtraceWorkspaceLayoutSample';
  const mainSelector = 'main#workspace-main';
  const navSelector = 'nav[aria-label="主导航"]';
  const rect = el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const measure = el => {
    if (!el) return null;
    const r = rect(el), style = getComputedStyle(el);
    let opacity = 1, visible = true, animating = false;
    for (let node = el; node; node = node.parentElement) {
      const css = getComputedStyle(node);
      opacity *= Number(css.opacity);
      visible &&= css.display !== 'none' && css.visibility === 'visible' && css.contentVisibility !== 'hidden';
      animating ||= node.getAnimations().some(a => a.playState === 'running' || a.pending);
    }
    const left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
    const top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
    const inViewport = right > left && bottom > top;
    const points = inViewport ? [[left + Math.min(1, (right-left)/2), top + Math.min(1, (bottom-top)/2)], [(left+right)/2, (top+bottom)/2]] : [];
    return { rect: r, position: style.position, marginLeft: Number.parseFloat(style.marginLeft), opacity, visible, animating, inViewport, painted: points.length > 0 && points.every(([x,y]) => el.contains(document.elementFromPoint(x,y))) };
  };
  const main = document.querySelector(mainSelector);
  const navs = [...document.querySelectorAll(navSelector)];
  const snapshot = {
    mainSelector, navSelector, path: location.pathname,
    viewport: { width: innerWidth, height: innerHeight },
    desktop: matchMedia('(min-width: 1025px)').matches,
    tablet: matchMedia('(min-width: 769px) and (max-width: 1024px)').matches,
    mainCount: document.querySelectorAll(mainSelector).length,
    main: measure(main), heading: measure(main?.querySelector('h1,h2')),
    navigation: navs.map(nav => ({ nav: measure(nav), sidebar: measure(nav.closest('aside')) })),
  };
  // Readiness is independent of clearance. A stable overlap is returned and
  // rejected by the oracle, rather than retried until it happens to disappear.
  const ready = snapshot.path === '/' && snapshot.mainCount === 1 && snapshot.main?.visible && snapshot.main.opacity === 1 && snapshot.main.inViewport && !snapshot.main.animating && snapshot.heading?.visible && snapshot.heading.opacity === 1 && !snapshot.heading.animating;
  const encoded = JSON.stringify(snapshot), previous = window[key];
  const frames = ready && previous?.encoded === encoded ? previous.frames + 1 : 0;
  window[key] = { encoded, frames, snapshot };
  return ready && frames >= 2 ? snapshot : false;
}

export function workspaceLayoutFailures(s) {
  const errors = [];
  const require = (ok, reason) => { if (!ok) errors.push(reason); };
  const painted = item => item && item.visible && item.opacity === 1 && item.inViewport && item.painted && !item.animating && item.rect.width > 0 && item.rect.height > 0;
  require(s.mainSelector === 'main#workspace-main' && s.mainCount === 1 && s.path === '/', 'actual root workspace required');
  require(s.desktop === (s.viewport.width >= 1025) && s.tablet === (s.viewport.width >= 769 && s.viewport.width <= 1024), 'viewport and responsive mode must agree');
  require(painted(s.main) && painted(s.heading), 'workspace and heading must be visible, opaque, painted and settled');
  require(s.navigation.length === 1 && painted(s.navigation[0]?.nav), 'one painted primary navigation required');
  const sidebar = s.navigation[0]?.sidebar;
  if (s.desktop || s.tablet) {
    require(painted(sidebar) && sidebar.position === 'fixed', 'painted fixed sidebar required');
    if (sidebar && s.main) {
      const a = sidebar.rect, b = s.main.rect;
      require(a.left === 0 && a.top === 0 && a.bottom >= s.viewport.height && a.right > 0 && a.right < s.viewport.width, 'sidebar must occupy the left viewport edge');
      require(b.left >= a.right, 'workspace must not overlap sidebar, including one pixel');
      require(Number.isFinite(s.main.marginLeft) && s.main.marginLeft >= a.right, 'computed margin must clear the actual sidebar');
      require(b.right <= s.viewport.width && b.right > b.left, 'workspace must fit viewport');
    }
  } else {
    require(!sidebar, 'mobile navigation must not be a sidebar');
    require(s.main?.marginLeft === 0 && s.main.rect.left === 0, 'mobile workspace must not retain sidebar clearance');
    require(s.navigation[0]?.nav.position === 'fixed' && s.navigation[0]?.nav.rect.bottom === s.viewport.height, 'mobile primary navigation must be fixed at viewport bottom');
  }
  return errors;
}
