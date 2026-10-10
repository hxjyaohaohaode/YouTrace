#!/usr/bin/env bash
# Isolated synthetic Docker contract. Never point this script at existing data.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != true && "${YOU_TRACE_SYNTHETIC_DOCKER_TEST:-}" != 1 ]]; then
  echo 'Run only in GitHub Actions or explicitly set YOU_TRACE_SYNTHETIC_DOCKER_TEST=1.' >&2
  exit 1
fi
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
config="$root/deploy/local/.env"
tls="$root/deploy/local/tls"
if [[ -e "$config" || -L "$config" || -e "$tls" || -L "$tls" ]]; then
  echo 'Refusing to replace existing local configuration or certificates.' >&2
  exit 1
fi
command -v docker >/dev/null
command -v openssl >/dev/null
command -v curl >/dev/null
temp="$(mktemp -d)"
project="youtrace-test-$(basename "$temp" | tr '[:upper:].' '[:lower:]-')"
compose=(docker compose --project-name "$project" --env-file "$config" -f deploy/local/compose.yaml)
cleanup() {
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -f "$config" "$tls/cert.pem" "$tls/key.pem"
  rmdir "$tls" 2>/dev/null || true
  rm -rf "$temp"
}
trap cleanup EXIT
umask 077
mkdir "$tls"
# This cert/key is for this throwaway localhost fixture only. No trust store changes.
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 1 \
  -keyout "$tls/key.pem" -out "$tls/cert.pem" -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost' >/dev/null 2>&1
cat > "$config" <<'CONFIG'
JWT_SECRET=synthetic-docker-fixture-only-never-production-123456
ALLOWED_ORIGINS=https://localhost:8443
SMS_PROVIDER_URL=https://sms.example.invalid/send
SMS_PROVIDER_TOKEN=synthetic-no-requests
# Fixed public fixture key, never a generated or production encryption key.
AI_CREDENTIAL_ENCRYPTION_KEY=ERERERERERERERERERERERERERERERERERERERERERE=
YOU_TRACE_INITIALIZE_EMPTY=true
CONFIG
base=https://localhost:8443
get() { curl --silent --show-error --cacert "$tls/cert.pem" "$@"; }
verify_ai_fixture() {
  "${compose[@]}" exec -T api node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prisma } from './dist/utils/db.js';
import { completeUserAI } from './dist/services/userAI.js';
const row = await prisma.userAIConnection.findUniqueOrThrow({where:{userId:'docker-synthetic-owner'}});
assert.equal(row.providerId, 'deepseek');
assert.equal(row.model, 'synthetic-test-model');
assert.equal(row.version, 1);
assert.equal(row.chatConsent, false);
assert.ok(!row.cipher.includes('synthetic-durable-api-key-never-valid'));
let calls = 0;
// Actual credential-decrypt path, with every outbound request replaced in-process.
globalThis.fetch = async (_url, options) => {
  calls += 1;
  assert.equal(options.headers.Authorization, 'Bearer synthetic-durable-api-key-never-valid');
  return new Response('data: {"choices":[{"delta":{"content":"synthetic-ok"}}]}\n\ndata: [DONE]\n\n');
};
const run = async () => { let text = ''; for await (const value of completeUserAI(row, [{role:'user',content:'Synthetic fixture'}], new AbortController().signal, true)) text += value; return text; };
try {
  assert.equal(await run(), 'synthetic-ok'); assert.equal(calls, 1);
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI=';
  await assert.rejects(run, error => error.code === 'AI_CREDENTIALS_UNAVAILABLE');
  delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  await assert.rejects(run, error => error.code === 'AI_CREDENTIAL_STORAGE_UNAVAILABLE');
  assert.equal(calls, 1);
  console.log(createHash('sha256').update(row.cipher).digest('hex'));
} finally { await prisma.$disconnect(); }
JS
}
ready() {
  for attempt in $(seq 1 60); do
    if get --fail "$base/health" > "$temp/health.json" 2>/dev/null; then return 0; fi
    sleep 2
  done
  echo 'HTTPS health did not become ready in 120 seconds.' >&2
  return 1
}
"${compose[@]}" build
"${compose[@]}" up -d
ready
"${compose[@]}" exec -T api sh -c 'test "$(id -u)" = 1000 && test -w /data && test -w /backups && test "$(stat -c %u /data/youtrace.sqlite3)" = 1000'
get --fail "$base/" > "$temp/index.html"
get --fail "$base/settings" > "$temp/spa.html"
cmp "$temp/index.html" "$temp/spa.html"
asset="$(python3 - "$temp/index.html" <<'PY'
import re,sys
text=open(sys.argv[1]).read()
match=re.search(r'<script[^>]+src="(/assets/[^\"]+\.js)"',text)
assert match, 'compiled frontend script missing'
print(match.group(1))
PY
)"
get --fail "$base$asset" > "$temp/asset.js"
test -s "$temp/asset.js"
# Install a synthetic account/session directly, not via the SMS provider.
"${compose[@]}" exec -T api node --input-type=module > "$temp/token" <<'JS'
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
const db = new PrismaClient();
await db.user.create({data:{id:'docker-synthetic-owner',phone:'13800000000',nickname:'Synthetic'}});
console.log(jwt.sign({id:'docker-synthetic-owner',phone:'13800000000'},process.env.JWT_SECRET,
{algorithm:'HS256',issuer:'youji-server',audience:'youji-web',subject:'docker-synthetic-owner',expiresIn:'1h'}));
await db.$disconnect();
JS
cookie="youji_session=$(cat "$temp/token")"
status="$(get -o "$temp/api404" -w '%{http_code}' --cookie "$cookie" "$base/api/not-an-endpoint")"
test "$status" = 404
python3 - "$temp/api404" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['error']=='Not found'
PY
status="$(get -o "$temp/denied" -w '%{http_code}' --cookie "$cookie" -H 'Content-Type: application/json' -H 'Origin: https://invalid.example' --data '{"text":"must not persist"}' "$base/api/todos")"
test "$status" = 403
status="$(get -o "$temp/created.json" -w '%{http_code}' --cookie "$cookie" -H 'Content-Type: application/json' -H "Origin: $base" --data '{"text":"durable synthetic Docker row"}' "$base/api/todos")"
test "$status" = 201
# Saving the synthetic connection performs no provider request. Do not call probe/chat.
status="$(get -o "$temp/ai-created.json" -w '%{http_code}' --cookie "$cookie" -H 'Content-Type: application/json' -H "Origin: $base" -X PUT --data '{"connectionId":null,"version":0,"providerId":"deepseek","model":"synthetic-test-model","apiKey":"synthetic-durable-api-key-never-valid","chatConsent":false}' "$base/api/ai-connection")"
test "$status" = 200
python3 - "$temp/ai-created.json" <<'PY'
import json,sys
connection=json.load(open(sys.argv[1]))['connection']
assert connection['connectivity']=='not_tested'
assert 'apiKey' not in connection and 'cipher' not in connection
PY
verify_ai_fixture > "$temp/ai-before.sha256"
"${compose[@]}" exec -T api python3 /app/local/storage.py backup --data-dir /data --output /backups/docker-fixture.sqlite3
# Down (without -v) removes containers, not the unique test volumes.
"${compose[@]}" down
sed -i 's/YOU_TRACE_INITIALIZE_EMPTY=true/YOU_TRACE_INITIALIZE_EMPTY=false/' "$config"
"${compose[@]}" up -d
ready
verify_ai_fixture > "$temp/ai-restarted.sha256"
cmp "$temp/ai-before.sha256" "$temp/ai-restarted.sha256"
get --fail --cookie "$cookie" "$base/api/todos" > "$temp/restarted.json"
python3 - "$temp/created.json" "$temp/restarted.json" <<'PY'
import json,sys
created=json.load(open(sys.argv[1]))['todo']
rows=json.load(open(sys.argv[2]))['todos']
assert len(rows)==1 and rows[0]['id']==created['id'] and rows[0]['text']==created['text']
PY
"${compose[@]}" exec -T api sh -c 'test -s /backups/docker-fixture.sqlite3 && test -s /backups/docker-fixture.sqlite3.json'
"${compose[@]}" stop api
"${compose[@]}" run --rm --no-deps api python3 /app/local/storage.py restore --source /backups/docker-fixture.sqlite3 --new-data-dir /data/restored-fixture
cat > "$temp/restore.yaml" <<'OVERRIDE'
services:
  api:
    environment:
      DATA_DIR: /data/restored-fixture
      DATABASE_URL: file:/data/restored-fixture/youtrace.sqlite3
OVERRIDE
"${compose[@]}" -f "$temp/restore.yaml" up -d --force-recreate
ready
verify_ai_fixture > "$temp/ai-restored.sha256"
cmp "$temp/ai-before.sha256" "$temp/ai-restored.sha256"
get --fail --cookie "$cookie" "$base/api/todos" > "$temp/restored.json"
cmp "$temp/restarted.json" "$temp/restored.json"
# Existing production logout keeps Secure/HttpOnly cookie policy behind TLS.
get --fail -D "$temp/logout.headers" -o /dev/null --cookie "$cookie" -H "Origin: $base" -X POST "$base/api/auth/logout"
grep -qi 'set-cookie:.*HttpOnly' "$temp/logout.headers"
grep -qi 'set-cookie:.*Secure' "$temp/logout.headers"
echo 'PASS: real Docker build, Nginx HTTPS, frontend/API routing, UID/volumes, restart, backup/restore, encrypted AI credential/key pairing and production cookie headers. External SMS/model calls: 0. Browser behavior not tested.'
