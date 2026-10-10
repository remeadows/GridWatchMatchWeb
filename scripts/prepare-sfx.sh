#!/bin/bash
# Turn a generated sound effect into a board cue.
#
#   scripts/prepare-sfx.sh <source> <output.mp3> <max-seconds> [peak-dbfs]
#
# A cue is played at the instant of the event it belongs to, so the silence before the sound is
# cut off; it is then cut to <max-seconds> with a short fade, made mono, and its loudest sample
# brought to [peak-dbfs] (default -7) so the gains in the game mean the same thing for every cue.
set -euo pipefail

if [ "$#" -lt 3 ]; then
  sed -n '2,8p' "$0"
  exit 2
fi
source_file=$1
output=$2
max=$3
peak=${4:--7}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

ffmpeg -hide_banner -loglevel error -y -i "$source_file" \
  -af "aformat=sample_rates=44100:channel_layouts=mono,silenceremove=start_periods=1:start_threshold=-38dB:start_silence=0.004" \
  -t "$max" -c:a pcm_s16le "$work/cut.wav"
length=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$work/cut.wav")
fade_at=$(printf '%.3f' "$(echo "$length - 0.04" | bc -l)")
measured=$(ffmpeg -hide_banner -nostats -i "$work/cut.wav" -af volumedetect -f null - 2>&1 | awk '/max_volume/ { print $5 }')
gain=$(echo "$peak - ($measured)" | bc -l)
ffmpeg -hide_banner -loglevel error -y -i "$work/cut.wav" \
  -af "afade=t=in:d=0.002,afade=t=out:st=${fade_at}:d=0.04,volume=${gain}dB" \
  -ar 44100 -ac 1 -c:a libmp3lame -b:a 96k -map_metadata -1 "$output"
mean=$(ffmpeg -hide_banner -nostats -i "$output" -af volumedetect -f null - 2>&1 | awk '/mean_volume/ { print $5 }')
printf '%-24s %.2f s  peak %s dB  mean %s dB  %s bytes\n' "$(basename "$output")" "$length" "$peak" "$mean" "$(stat -f %z "$output")"
