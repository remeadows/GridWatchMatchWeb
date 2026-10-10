#!/bin/bash
# Pitch of each spoken stretch of a recording:  measure.sh <file>
here=$(dirname "$0"); f=$1; tmp=$(mktemp -d)
"$here/segments.sh" "$f" | while read -r a b; do
  # -nostdin: otherwise ffmpeg can read the rest of the segment list off this loop's stdin.
  ffmpeg -nostdin -hide_banner -loglevel error -y -ss "$a" -to "$b" -i "$f" "$tmp/part.wav"
  printf "  %6.3f-%6.3f " "$a" "$b"; python3 "$here/pitch.py" "$tmp/part.wav" | sed -E 's/^[^ ]+ +//'
done
rm -rf "$tmp"
