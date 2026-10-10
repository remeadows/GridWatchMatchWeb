#!/bin/bash
# List the spoken stretches of a recording, splitting at pauses of 0.15 s or more:  segments.sh <file>
f=$1
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
ffmpeg -hide_banner -nostats -i "$f" -af silencedetect=noise=-40dB:d=0.15 -f null - 2>&1 |
  awk -v dur="$dur" '
    /silence_start/ { s[n++] = $NF }
    /silence_end/   { split($0, parts, "silence_end: "); split(parts[2], rest, " "); e[m++] = rest[1] }
    END {
      start = 0; i = 0; j = 0
      if (n > 0 && s[0] + 0 <= 0.01) { start = e[0]; i = 1; j = 1 }
      for (; i < n; i++) { printf "%.3f %.3f\n", start, s[i]; start = (j < m) ? e[j] : dur; j++ }
      if (start < dur - 0.05) printf "%.3f %.3f\n", start, dur
    }'
