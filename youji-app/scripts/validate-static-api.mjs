// Standalone static hosting has no same-origin API proxy. This format-only gate
// runs before npm ci and does not contact or approve the configured destination.
// Local Docker deliberately keeps its separate relative /api build unchanged.
function isStaticApiBase(value) {
  // Check the raw spelling as well as URL parsing: URL normalizes dot segments,
  // whitespace and backslashes, and hides empty query/fragment/credential markers.
  if (typeof value !== 'string' || /\s/.test(value) || !/^https:\/\/[^/?#\\@\s]+\/api$/i.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname !== '' &&
      url.username === '' && url.password === '' &&
      url.pathname === '/api' && url.search === '' && url.hash === ''
  } catch {
    return false
  }
}

if (!isStaticApiBase(process.env.VITE_API_BASE_URL)) {
  // Never print the supplied value or the URL parser's error: either may contain credentials.
  console.error('Static deployment refused: VITE_API_BASE_URL must be an absolute HTTPS URL with a hostname and exactly /api, without credentials, query, fragment, whitespace, or a trailing slash.')
  process.exitCode = 1
}
