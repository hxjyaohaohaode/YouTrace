import { workspaceLayoutFailures } from './workspace-layout-contract.mjs';

// Serialized by Puppeteer: only live DOM/CSS/animation state, no fixed sleeps,
// style overrides, animation disabling, or screenshot rewriting.
export function sampleStableCoachEvidence(expectedResponse) {
  const key = '__youtraceCoachEvidenceSample';
  const mainSelector = 'main#workspace-main';
  const navSelector = 'nav[aria-label="主导航"]';
  const measure = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect(), css = getComputedStyle(el);
    let opacity = 1, visible = true, animating = false;
    const transforms = [];
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      opacity *= Number(style.opacity);
      visible &&= style.display !== 'none' && style.visibility === 'visible' && style.contentVisibility !== 'hidden';
      animating ||= node.getAnimations().some(animation => animation.playState === 'running' || animation.pending);
      transforms.push(style.transform);
    }
    const left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
    const top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
    const inViewport = right > left && bottom > top;
    const points = inViewport ? [[left + Math.min(1, (right-left)/2), top + Math.min(1, (bottom-top)/2)], [(left+right)/2, (top+bottom)/2]] : [];
    return {
      rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height },
      position: css.position, marginLeft: Number.parseFloat(css.marginLeft), lineHeight: Number.parseFloat(css.lineHeight),
      opacity, visible, animating, transforms, inViewport,
      painted: points.length > 0 && points.every(([x,y]) => el.contains(document.elementFromPoint(x,y))),
    };
  };
  const main = document.querySelector(mainSelector);
  const coach = main?.querySelector('.coach-page');
  const heading = coach?.querySelector('h1');
  const matches = [...(coach?.querySelectorAll('.whitespace-pre-wrap') ?? [])].filter(el => el.textContent.includes(expectedResponse));
  const response = matches.at(-1);
  const input = coach?.querySelector('textarea[aria-label="输入消息"]');
  const snapshot = {
    mainSelector, navSelector, path: location.pathname, expectedResponse,
    viewport: { width: innerWidth, height: innerHeight },
    desktop: matchMedia('(min-width: 1025px)').matches,
    tablet: matchMedia('(min-width: 769px) and (max-width: 1024px)').matches,
    fontsReady: document.fonts.status === 'loaded',
    streamComplete: Boolean(input && !input.disabled),
    mainCount: document.querySelectorAll(mainSelector).length,
    coachCount: main?.querySelectorAll('.coach-page').length ?? 0,
    headingText: heading?.textContent ?? '',
    main: measure(main), coach: measure(coach), heading: measure(heading), response: measure(response),
    navigation: [...document.querySelectorAll(navSelector)].map(nav => ({ nav: measure(nav), sidebar: measure(nav.closest('aside')) })),
  };
  const settled = item => item && item.visible && item.opacity === 1 && !item.animating;
  // Readiness does NOT depend on correct clearance, fit or paint/hit testing.
  // Stable broken geometry is returned immediately and rejected by the oracle.
  const ready = snapshot.path === '/coach' && snapshot.fontsReady && snapshot.streamComplete
    && snapshot.mainCount === 1 && snapshot.coachCount === 1
    && [snapshot.main, snapshot.coach, snapshot.heading, snapshot.response].every(settled)
    && snapshot.navigation.every(row => settled(row.nav) && (!row.sidebar || settled(row.sidebar)));
  const encoded = JSON.stringify(snapshot), previous = window[key];
  const frames = ready && previous?.encoded === encoded ? previous.frames + 1 : 0;
  window[key] = { encoded, frames, snapshot };
  return ready && frames >= 2 ? snapshot : false;
}

export function coachEvidenceFailures(snapshot) {
  const failures = workspaceLayoutFailures(snapshot, '/coach');
  const require = (ok, reason) => { if (!ok) failures.push(reason); };
  const painted = item => item && item.visible && item.opacity === 1 && !item.animating && item.inViewport && item.painted;
  require(snapshot.fontsReady && snapshot.streamComplete, 'fonts and actual response stream must finish');
  require(snapshot.coachCount === 1 && painted(snapshot.coach) && painted(snapshot.response), 'actual coach and response must be opaque, settled and painted');
  require(snapshot.headingText === '生活教练', 'actual Coach heading required');
  if (snapshot.heading) require(Number.isFinite(snapshot.heading.lineHeight) && snapshot.heading.rect.height <= snapshot.heading.lineHeight + 1, 'Coach heading must not collapse into wrapped/vertical text');
  if (snapshot.main && snapshot.coach) {
    require(snapshot.coach.rect.left >= snapshot.main.rect.left && snapshot.coach.rect.right <= snapshot.main.rect.right, 'Coach surface must fit actual workspace');
    if (!snapshot.desktop && !snapshot.tablet) require(snapshot.coach.rect.left === 0 && snapshot.coach.rect.right === snapshot.viewport.width, 'mobile Coach must use full viewport width');
  }
  if (snapshot.response && snapshot.coach) require(snapshot.response.rect.left >= snapshot.coach.rect.left && snapshot.response.rect.right <= snapshot.coach.rect.right, 'response text must stay inside the Coach surface');
  return failures;
}
