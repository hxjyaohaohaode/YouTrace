// Real rendered text geometry, not a CSS-string or scroll-width-only assertion.
export function sampleTimelineHeading() {
  const header = document.querySelector('.record-page-heading');
  const links = header?.querySelectorAll('a[href="/quick-note"]') ?? [];
  const link = links[0];
  if (!link) return { count: links.length };
  const rect = element => {
    const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
    return { left, right, top, bottom, width, height };
  };
  const range = document.createRange();
  range.selectNodeContents(link);
  const lines = Array.from(range.getClientRects(), r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }));
  const bounds = rect(link);
  const hit = document.elementFromPoint((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
  const styles = [];
  for (let node = link; node; node = node.parentElement) {
    const css = getComputedStyle(node);
    styles.push({ display: css.display, visibility: css.visibility, opacity: css.opacity });
  }
  return { count: links.length, text: link.textContent, href: link.getAttribute('href'), viewport: { width: innerWidth, height: innerHeight }, bounds, heading: rect(header), copy: rect(header.firstElementChild), lines, styles, hit: Boolean(hit && (hit === link || link.contains(hit))) };
}

export function timelineHeadingFailures(sample) {
  const failures = [];
  if (sample.count !== 1 || sample.text !== '写一条速记 →' || sample.href !== '/quick-note') failures.push('expected one intact timeline capture action');
  const { bounds, heading, copy, lines, styles, viewport } = sample;
  if (!bounds || !heading || !copy || !viewport || !Array.isArray(lines) || !Array.isArray(styles)) return [...failures, 'missing rendered heading evidence'];
  if ([bounds, heading, copy, viewport, ...lines].some(rect => Object.values(rect).some(value => !Number.isFinite(value)))) failures.push('heading geometry must be finite');
  if (lines.length !== 1 || lines[0]?.height <= 0) failures.push('capture label and arrow must share one text line');
  if (lines.some(line => line.left < bounds.left || line.right > bounds.right || line.top < bounds.top || line.bottom > bounds.bottom)) failures.push('capture text must fit its clickable target');
  if (bounds.width <= 0 || bounds.height < 44 || bounds.left < 0 || bounds.right > viewport.width || bounds.top < 0 || bounds.bottom > viewport.height) failures.push('capture action must remain in the viewport with a 44px target');
  if (bounds.left < copy.right || bounds.left < heading.left || bounds.right > heading.right) failures.push('capture action must not overlap heading copy or escape the heading');
  if (!styles.length || styles.some(style => style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) < 1) || !sample.hit) failures.push('capture action must be painted and unobscured');
  return failures;
}
