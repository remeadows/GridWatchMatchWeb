#!/bin/bash
# Turn a generated music track into a file the game can loop.
#
#   scripts/prepare-music.sh <source> <output.mp3> <start-seconds> <end-seconds> [target-lufs]
#
# The game loops a track by crossfading into a fresh copy four seconds before the end
# (src/services/music.ts), so the file must hold the same level from its first second to its
# last: generated tracks fade in and out, and <start> and <end> cut those fades off. The cut is
# then brought to one loudness (default -24 LUFS) with a plain gain, so every track sits at the
# level its entry in MUSIC_TRACKS (src/services/audio.ts) expects, and encoded as 112 kbps MP3.
set -euo pipefail

if [ "$#" -lt 4 ]; then
  sed -n '2,10p' "$0"
  exit 2
fi
source_file=$1
output=$2
start=$3
end=$4
target=${5:--24}
length=$(echo "$end - $start" | bc -l)

measured=$(ffmpeg -hide_banner -nostats -ss "$start" -t "$length" -i "$source_file" -af ebur128 -f null - 2>&1 |
  awk '/^ +I:/ { value = $2 } END { print value }')
gain=$(echo "$target - ($measured)" | bc -l)
fade_out_at=$(echo "$length - 0.03" | bc -l)

ffmpeg -hide_banner -loglevel error -y -ss "$start" -t "$length" -i "$source_file" \
  -af "volume=${gain}dB,afade=t=in:d=0.03,afade=t=out:st=${fade_out_at}:d=0.03" \
  -ar 44100 -ac 2 -c:a libmp3lame -b:a 112k -map_metadata -1 "$output"

final=$(ffmpeg -hide_banner -nostats -i "$output" -af ebur128=peak=true -f null - 2>&1 |
  awk '/^ +I:/ { loud = $2 } /^ +Peak:/ { peak = $2 } END { print loud " LUFS, peak " peak " dBFS" }')
printf '%s: %.1f s, %s (was %s LUFS, gain %+.1f dB), %s bytes\n' \
  "$(basename "$output")" "$length" "$final" "$measured" "$gain" "$(stat -f %z "$output")"
