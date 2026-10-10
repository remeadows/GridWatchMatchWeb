#!/bin/bash
# Turn a recorded line into Tish's comms channel.
#
#   scripts/prepare-voice.sh <source> <output.mp3> [target-lufs]
#
# Silence is cut from both ends, the voice is narrowed to a radio band and compressed, a short
# burst of channel noise opens and closes it, and the result is brought to one loudness
# (default -19 LUFS) as mono 96 kbps MP3. The level is in the file because phones ignore the
# volume the game asks an <audio> element for.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  sed -n '2,9p' "$0"
  exit 2
fi
source_file=$1
output=$2
target=${3:--19}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

trim="silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse"
comms="highpass=f=380,lowpass=f=3300,acompressor=threshold=-20dB:ratio=5:attack=4:release=90:makeup=5"
click="highpass=f=900,lowpass=f=3000,afade=t=in:d=0.004,afade=t=out:st=0.02:d=0.012"

ffmpeg -hide_banner -loglevel error -y -i "$source_file" \
  -f lavfi -t 0.032 -i "anoisesrc=color=white:amplitude=0.20:seed=923101" \
  -f lavfi -t 0.032 -i "anoisesrc=color=white:amplitude=0.12:seed=923102" \
  -filter_complex "[0:a]aformat=sample_rates=44100:channel_layouts=mono,${trim},${comms}[voice];[1:a]aformat=sample_rates=44100:channel_layouts=mono,${click}[open];[2:a]aformat=sample_rates=44100:channel_layouts=mono,${click}[close];[open][voice][close]concat=n=3:v=0:a=1[out]" \
  -map "[out]" -c:a pcm_s16le "$work/line.wav"

measured=$(ffmpeg -hide_banner -nostats -i "$work/line.wav" -af ebur128 -f null - 2>&1 | awk '/^ +I:/ { value = $2 } END { print value }')
gain=$(echo "$target - ($measured)" | bc -l)
ffmpeg -hide_banner -loglevel error -y -i "$work/line.wav" -af "volume=${gain}dB,alimiter=limit=0.89" \
  -ar 44100 -ac 1 -c:a libmp3lame -b:a 96k -map_metadata -1 "$output"

final=$(ffmpeg -hide_banner -nostats -i "$output" -af ebur128=peak=true -f null - 2>&1 |
  awk '/^ +I:/ { loud = $2 } /^ +Peak:/ { peak = $2 } END { print loud " LUFS, peak " peak " dBFS" }')
printf '%s: %s s, %s, %s bytes\n' "$(basename "$output")" \
  "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$output")" "$final" "$(wc -c < "$output" | tr -d ' ')"
