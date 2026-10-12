import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const app = fileURLToPath(new URL('..', import.meta.url))
const script = fileURLToPath(new URL('../scripts/validate-static-api.mjs', import.meta.url))
const templates = ['render.yaml', 'deploy/render/free-static.yaml']

function runGate(value?: string) {
  const env = { ...process.env }
  delete env.VITE_API_BASE_URL
  if (value !== undefined) env.VITE_API_BASE_URL = value
  return spawnSync(process.execPath, [script], { cwd: app, env, encoding: 'utf8', timeout: 10000 })
}

const invalid: [string, string | undefined][] = [
  ['missing', undefined],
  ['empty', ''],
  ['whitespace', ' \t\n'],
  ['relative local API', '/api'],
  ['protocol relative', '//api.example.test/api'],
  ['HTTP', 'http://api.example.test/api'],
  ['other protocol', 'ftp://api.example.test/api'],
  ['missing hostname', 'https:///api'],
  ['missing authority slashes', 'https:api.example.test/api'],
  ['extra authority slash', 'https:///api.example.test/api'],
  ['not a URL', 'not-an-api-url'],
  ['origin only', 'https://api.example.test'],
  ['root path', 'https://api.example.test/'],
  ['wrong path', 'https://api.example.test/v1'],
  ['nested path', 'https://api.example.test/api/v1'],
  ['case-sensitive path', 'https://api.example.test/API'],
  ['trailing slash', 'https://api.example.test/api/'],
  ['extra slash', 'https://api.example.test//api'],
  ['normalized dot segment', 'https://api.example.test/other/../api'],
  ['encoded path', 'https://api.example.test/%61pi'],
  ['username', 'https://SYNTHETIC_PRIVATE_USERNAME@api.example.test/api'],
  ['password', 'https://user:SYNTHETIC_PRIVATE_PASSWORD@api.example.test/api'],
  ['empty credentials', 'https://@api.example.test/api'],
  ['empty username and password', 'https://:@api.example.test/api'],
  ['query', 'https://api.example.test/api?token=SYNTHETIC_PRIVATE_QUERY'],
  ['empty query', 'https://api.example.test/api?'],
  ['fragment', 'https://api.example.test/api#SYNTHETIC_PRIVATE_FRAGMENT'],
  ['empty fragment', 'https://api.example.test/api#'],
  ['empty query and fragment', 'https://api.example.test/api?#'],
  ['leading space', ' https://api.example.test/api'],
  ['trailing newline', 'https://api.example.test/api\n'],
  ['embedded tab', 'https://api.exa\tmple.test/api'],
  ['backslash normalization', 'https://api.example.test\\api'],
  ['invalid port', 'https://api.example.test:99999/api'],
  ['invalid IPv6', 'https://[not-an-address]/api'],
]

for (const [label, value] of invalid) {
  test(`standalone static CLI refuses ${label} without echoing the environment value`, () => {
    const result = runGate(value)
    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /^Static deployment refused: VITE_API_BASE_URL /)
    assert.doesNotMatch(result.stderr, /SYNTHETIC_PRIVATE|api\.example\.test|not-an-api-url/)
    assert.equal(result.stderr.split('\n').filter(Boolean).length, 1)
  })
}

for (const value of [
  'https://api.example.test/api',
  'https://api.example.test:8443/api',
  'HTTPS://API.EXAMPLE.TEST/api',
  'https://127.0.0.1/api',
  'https://[::1]:8443/api',
  'https://例子.测试/api',
]) {
  test(`standalone static CLI accepts valid HTTPS /api format: ${value}`, () => {
    const result = runGate(value)
    assert.ifError(result.error)
    assert.equal(result.status, 0)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
  })
}

for (const template of templates) {
  test(`${template} gates the static build before installing dependencies`, () => {
    const source = readFileSync(new URL(`../../${template}`, import.meta.url), 'utf8')
    const services = source.split(/^ {2}- type: /m).slice(1)
    const staticServices = services.filter(service => service.includes('\n    runtime: static\n'))
    assert.equal(staticServices.length, 1)
    const commands = [...staticServices[0].matchAll(/^ {4}buildCommand: (.+)$/gm)].map(match => match[1])
    assert.deepEqual(commands, ['cd youji-app && node scripts/validate-static-api.mjs && npm ci && npm run build'])
    assert.match(staticServices[0], /- key: VITE_API_BASE_URL\n {8}sync: false/)
    assert.match(staticServices[0], /autoDeployTrigger: 'off'/)
    for (const service of services.filter(service => !staticServices.includes(service))) {
      assert.doesNotMatch(service, /validate-static-api/)
    }
  })
}

test('the local Docker /api build keeps the ordinary build entrypoint without the standalone gate', () => {
  const dockerfile = readFileSync(new URL('../../deploy/local/Dockerfile', import.meta.url), 'utf8')
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(dockerfile, /^RUN VITE_API_BASE_URL=\/api npm run build$/m)
  assert.doesNotMatch(dockerfile, /validate-static-api/)
  assert.equal(manifest.scripts.build, 'tsc -b && vite build')
  assert.equal(manifest.scripts.prebuild, undefined)
  assert.equal(manifest.scripts.postbuild, undefined)
  assert.doesNotMatch(readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8'), /validate-static-api/)
})
