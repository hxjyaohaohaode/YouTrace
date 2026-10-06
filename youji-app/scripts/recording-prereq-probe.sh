#!/usr/bin/env bash
# Hosted CI capability check. No package installation or browser rendering here.
# Hosted-CI invocation MUST supply the total deadline:
# timeout --signal=TERM --kill-after=2s 45s bash scripts/recording-prereq-probe.sh
set -euo pipefail

stage=temporary-directory
probe_dir=''
trap 'status=$?; printf "::error::Recording prerequisite failed: stage=%s exit=%s\n" "$stage" "$status" >&2' ERR
trap 'if [[ -n "$probe_dir" ]]; then rm -rf -- "$probe_dir"; fi' EXIT
trap 'printf "::error::Recording prerequisite terminated: stage=%s\n" "$stage" >&2; exit 143' TERM
: "${RUNNER_TEMP:?RUNNER_TEMP must name the hosted runner temporary directory}"
[[ -d "$RUNNER_TEMP" && -w "$RUNNER_TEMP" ]]
probe_dir=$(mktemp -d "$RUNNER_TEMP/youtrace-recording-prereq.XXXXXXXX")

stage=installed-tools-and-packages
command -v ffmpeg ffprobe fc-match
dpkg-query --show --showformat '${binary:Package}=${Version} ${db:Status-Status}\n' ffmpeg fonts-noto-cjk fontconfig

# This proves the existing executable/version only. Native tasks prove rendering.
stage=chrome-version
[[ -x /usr/bin/google-chrome ]]
/usr/bin/google-chrome --version

# fc-match exit zero can mean fallback: inspect the selected face and its owner.
stage=chinese-font-match
font_match=$(fc-match --format '%{family[0]}\n%{file}\n%{lang}\n' 'Noto Sans CJK SC:lang=zh-cn')
printf 'Chinese font match (family, file, languages):\n%s\n' "$font_match"
mapfile -t font_fields <<< "$font_match"
[[ ${#font_fields[@]} == 3 ]]
stage=chinese-font-family
[[ ${font_fields[0]} == 'Noto Sans CJK SC' ]]
stage=chinese-font-language
[[ "|${font_fields[2]}|" == *'|zh-cn|'* ]]
stage=chinese-font-file
font_file=${font_fields[1]}
[[ -f "$font_file" && -r "$font_file" ]]
stage=chinese-font-package-owner
font_owner=$(dpkg-query --search "$font_file")
printf '%s\n' "$font_owner"
[[ "$font_owner" == "fonts-noto-cjk: $font_file" ]]

stage=ffmpeg-version
ffmpeg -hide_banner -version
cpu_used=$(node -p 'Math.min(require("node:os").cpus().length / 2, 8)')

# Fixed, stdlib-validated 32x24 RGB PNG (93 bytes). Repeat 36 frames so the
# original nobuffer/probe settings can consume initial frames without false red.
stage=fixed-synthetic-png
base64 --decode > "$probe_dir/input.png" <<'PNG'
iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAAJElEQVR42mMwKNhAU8QwasGoBaMWjFowasGoBaMWjFowNCwAANWS8C66wuI4AAAAAElFTkSuQmCC
PNG
for (( frame=0; frame<36; frame++ )); do
  cat "$probe_dir/input.png"
done > "$probe_dir/frames.pngs"

# Retain the locked recorder's relevant arguments/order and pipe input/output.
# Crop/pad deliberately turns the 32x24 input into a 64x48 stream.
stage=png-to-vp9-webm
timeout --signal=TERM --kill-after=1s 15s ffmpeg \
  -hide_banner -loglevel error -avioflags direct \
  -fpsprobesize 0 -probesize 32 -analyzeduration 0 -fflags nobuffer \
  -framerate 12 -f image2pipe -vcodec png -i pipe:0 \
  -an -threads 1 -b:v 0 -vcodec vp9 -crf 35 \
  -deadline realtime -cpu-used "$cpu_used" -f webm \
  -vf "crop='min(64,iw):min(48,ih):0:0',pad=64:48:0:0" pipe:1 \
  < "$probe_dir/frames.pngs" > "$probe_dir/probe.webm"
[[ -s "$probe_dir/probe.webm" ]]

stage=webm-stream-and-frame-count
stream_info=$(ffprobe -v error -count_frames \
  -show_entries stream=codec_type,codec_name,width,height,nb_read_frames \
  -of default=noprint_wrappers=1 "$probe_dir/probe.webm")
printf 'Synthetic WebM stream:\n%s\n' "$stream_info"
[[ $(grep -c '^codec_type=' <<< "$stream_info") == 1 ]]
grep -Fxq 'codec_type=video' <<< "$stream_info"
grep -Fxq 'codec_name=vp9' <<< "$stream_info"
grep -Fxq 'width=64' <<< "$stream_info"
grep -Fxq 'height=48' <<< "$stream_info"
frames=$(sed -n 's/^nb_read_frames=//p' <<< "$stream_info")
[[ "$frames" =~ ^[0-9]+$ ]]
(( frames >= 1 ))

# Decode the complete stream; no frame limit and errors are fatal.
stage=complete-webm-decode
timeout --signal=TERM --kill-after=1s 10s ffmpeg \
  -hide_banner -loglevel error -xerror -err_detect explode \
  -i "$probe_dir/probe.webm" -map 0:v:0 -f null -
printf 'PASS prerequisites: expected Chinese font; Chrome binary/version; VP9 64x48, %s decoded frames, no audio; full decode\n' "$frames"
printf 'Synthetic codec probe only; unchanged native browser evidence is still required.\n'
