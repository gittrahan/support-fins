#!/usr/bin/env bash
# Real container checks, separate from the geometry suite. Requires a free :8731.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd -P)
mkdir -p "$root/tmp"
scratch=$(mktemp -d "$root/tmp/docker-smoke.XXXXXX")
evidence="$scratch/evidence"
mkdir "$evidence"
suffix=$(basename "$scratch" | tr '[:upper:]' '[:lower:]')
project="support-fins-$suffix"
image="support-fins-smoke:$suffix"
container="$project-web"
export PYTHONDONTWRITEBYTECODE=1
export TMPDIR="$scratch"
compose=(docker compose --project-directory "$root" --project-name "$project"
  --env-file "$scratch/empty.env" -f "$root/docker-compose.yml" -f "$scratch/override.json")

cleanup() {
  code=$?
  trap - EXIT
  if [ "$code" -ne 0 ]; then
    docker logs "$container" > "$evidence/failure.log" 2>&1 || true
    docker inspect "$container" > "$evidence/failure-inspect.json" 2>&1 || true
  fi
  # Never prune the daemon or stop another project's containers.
  "${compose[@]}" down --timeout 10 > "$evidence/cleanup.log" 2>&1 || code=1
  if docker image inspect "$image" > /dev/null 2>&1; then
    docker image rm "$image" >> "$evidence/cleanup.log" 2>&1 || code=1
  fi
  printf 'exit=%s\n' "$code" > "$evidence/result.txt"
  printf 'Docker smoke exit %s; evidence: %s\n' "$code" "$evidence"
  exit "$code"
}

touch "$scratch/empty.env"
printf '{"services":{"web":{"image":"%s","container_name":"%s"}}}\n' \
  "$image" "$container" > "$scratch/override.json"
trap cleanup EXIT

docker version > "$evidence/docker-version.txt"
docker compose version > "$evidence/compose-version.txt"
docker buildx version > "$evidence/buildx-version.txt"
"${compose[@]}" config --format json > "$evidence/compose.json"
python3 - "$evidence/compose.json" <<'PY'
import json, sys
web = json.load(open(sys.argv[1]))['services']['web']
assert any(p['target'] == 8080 and str(p['published']) == '8731' for p in web['ports']), web['ports']
assert 'http://127.0.0.1:8080/' in ' '.join(web['healthcheck']['test'])
assert not web.get('user'), 'Compose must exercise the image default user'
PY

# Exercise Docker's own ignore matcher, with harmless sentinels rather than any
# real personal files. A scratch build exports exactly what COPY can see.
python3 - "$root" "$scratch/context" <<'PY'
import pathlib, shutil, sys
root, context = map(pathlib.Path, sys.argv[1:])
context.mkdir()
shutil.copyfile(root / '.dockerignore', context / '.dockerignore')
for name in ['web/index.html', 'web/app.js', 'web/vendor/test.wasm', 'nginx.conf', 'LICENSE',
             '.git', 'AGENTS.md', '.codex/config.toml', 'tokens/sentinel', '.env', '.env.test',
             'tmp/sentinel', 'evidence/sentinel', '.playwright-mcp/sentinel',
             'docs/decisions.md', 'private.stl', 'web/_redirects']:
    path = context / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('public test sentinel\n')
PY
docker buildx build --progress plain --file - \
  --output "type=local,dest=$scratch/context-export" "$scratch/context" \
  > "$evidence/context-build.log" 2>&1 <<'DOCKERFILE'
FROM scratch
COPY . /
DOCKERFILE
python3 - "$scratch/context-export" <<'PY'
import pathlib, sys
context = pathlib.Path(sys.argv[1])
for name in ['web/index.html', 'web/app.js', 'web/vendor/test.wasm', 'nginx.conf', 'LICENSE']:
    assert (context / name).is_file(), f'required asset excluded: {name}'
for name in ['.git', 'AGENTS.md', '.codex', 'tokens', '.env', '.env.test', 'tmp', 'evidence',
             '.playwright-mcp', 'docs', 'private.stl', 'web/_redirects']:
    assert not (context / name).exists(), f'private/development path included: {name}'
print('Docker build context exclusions passed')
PY

# Max provenance records the resolved base digest, even if stable-alpine moves
# afterwards. No registry login, image push or application bundling is needed.
BUILDX_METADATA_PROVENANCE=max docker buildx build --load --pull --progress plain \
  --metadata-file "$evidence/build-metadata.json" --tag "$image" "$root" \
  2>&1 | tee "$evidence/build.log"
docker image inspect "$image" > "$evidence/image.json"
python3 - "$evidence/image.json" <<'PY'
import json, os, sys
image = json.load(open(sys.argv[1]))[0]
config = image['Config']
assert config['User'] in ['101', '101:101', 'nginx'], config['User']
assert '8080/tcp' in config['ExposedPorts'] and '80/tcp' not in config['ExposedPorts']
assert image['Os'] == 'linux'
if os.environ.get('EXPECTED_ARCH'):
    assert image['Architecture'] == os.environ['EXPECTED_ARCH'], image['Architecture']
print(f"Built {image['Os']}/{image['Architecture']} {image['Id']}; user={config['User']}")
PY

fetch_asset() {
  local mode=$1 path=$2 mime=$3 cache=$4
  curl --fail --silent --show-error --max-time 15 \
    -D "$evidence/$mode-headers.txt" -o "$evidence/$mode-body" "http://127.0.0.1:8731/$path"
  cmp "$root/web/${path:-index.html}" "$evidence/$mode-body"
  grep -Eiq "^Content-Type: ($mime)(;|[[:space:]]|$)" "$evidence/$mode-headers.txt"
  grep -Fiq "Cache-Control: $cache" "$evidence/$mode-headers.txt"
}

check_running() {
  local mode=$1
  [ "$(docker exec "$container" id -u)" = 101 ]
  # PID 1 is the nginx master after the inherited entrypoint execs it.
  [ "$(docker exec "$container" awk '/^Uid:/{print $2, $3, $4, $5}' /proc/1/status)" = '101 101 101 101' ]
  docker exec "$container" nginx -t > "$evidence/$mode-nginx.log" 2>&1
  docker inspect "$container" > "$evidence/$mode-inspect.json"
  [ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" = healthy ]
  fetch_asset "$mode-html" '' text/html 'no-store, must-revalidate'
  fetch_asset "$mode-js" app.js 'application/javascript|text/javascript' 'no-store, must-revalidate'
  fetch_asset "$mode-css" style.css text/css 'no-store, must-revalidate'
  fetch_asset "$mode-wasm" vendor/manifold-3d-3.5.4/manifold.wasm application/wasm 'public, max-age=31536000, immutable'
  fetch_asset "$mode-vendor" vendor/three/three.module.js 'application/javascript|text/javascript' 'public, max-age=31536000, immutable'
  for path in index index.html 'index.html?from=smoke'; do
    status=$(curl --silent --show-error --max-time 15 \
      -D "$evidence/$mode-redirect.txt" -o /dev/null -w '%{http_code}' "http://127.0.0.1:8731/$path")
    [ "$status" = 301 ]
    grep -Eiq '^Location: /[[:space:]]*$' "$evidence/$mode-redirect.txt"
  done
  curl --fail --silent --show-error --max-time 15 --compressed \
    -H 'Accept-Encoding: gzip' -D "$evidence/$mode-gzip.txt" \
    -o "$evidence/$mode-gzip-body" http://127.0.0.1:8731/app.js
  grep -Eiq '^Content-Encoding: gzip[[:space:]]*$' "$evidence/$mode-gzip.txt"
  cmp "$root/web/app.js" "$evidence/$mode-gzip-body"
  docker logs "$container" > "$evidence/$mode.log" 2>&1
  printf '%s: non-root, healthy, HTTP assets, redirects, cache and gzip passed\n' "$mode"
}

"${compose[@]}" up --no-build --pull never -d --wait --wait-timeout 120
check_running compose
"${compose[@]}" stop --timeout 10
[ "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0 ]
[ "$(docker inspect --format '{{.State.OOMKilled}}' "$container")" = false ]
"${compose[@]}" up --no-build --pull never -d --wait --wait-timeout 120
check_running restarted
"${compose[@]}" down --timeout 10

cat > "$scratch/hardened.json" <<'JSON'
{"services":{"web":{"read_only":true,"tmpfs":["/tmp:rw,noexec,nosuid,size=16m"],"cap_drop":["ALL"],"security_opt":["no-new-privileges:true"]}}}
JSON
"${compose[@]}" -f "$scratch/hardened.json" up --no-build --pull never -d --wait --wait-timeout 120
check_running hardened
python3 - "$evidence/hardened-inspect.json" <<'PY'
import json, sys
config = json.load(open(sys.argv[1]))[0]['HostConfig']
assert config['ReadonlyRootfs']
assert 'ALL' in config['CapDrop']
assert any(v in ['no-new-privileges', 'no-new-privileges:true'] for v in config['SecurityOpt'])
assert '/tmp' in config['Tmpfs']
PY
docker exec "$container" sh -c 'test ! -w /usr/share/nginx/html; test -w /tmp'
printf 'Docker smoke checks passed\n'
