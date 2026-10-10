"""Median speaking pitch of each audio file, by autocorrelation. A rough check that takes are the
same voice when nobody on this end can listen: usage  python3 pitch.py file [file...]"""
import array, math, statistics, subprocess, sys

RATE = 8000

def samples(path):
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(RATE),
                          "-f", "s16le", "-"], capture_output=True, check=True).stdout
    data = array.array("h")
    data.frombytes(raw)
    return [value / 32768 for value in data]

def pitch_track(signal, frame=320, hop=160, low=75, high=330):
    lags = range(RATE // high, RATE // low + 1)
    loud = max((sum(v * v for v in signal[i:i + frame]) for i in range(0, max(1, len(signal) - frame), hop)), default=0)
    track = []
    for start in range(0, len(signal) - frame - max(lags), hop):
        window = signal[start:start + frame]
        energy = sum(v * v for v in window)
        if energy < loud * 0.05:
            continue
        best, best_lag = 0.0, 0
        for lag in lags:
            other = signal[start + lag:start + lag + frame]
            corr = sum(a * b for a, b in zip(window, other))
            norm = math.sqrt(energy * sum(v * v for v in other)) or 1.0
            if corr / norm > best:
                best, best_lag = corr / norm, lag
        if best > 0.55 and best_lag:
            track.append(RATE / best_lag)
    return track

for path in sys.argv[1:]:
    track = pitch_track(samples(path))
    if len(track) < 4:
        print(f"{path.split('/')[-2]}/{path.split('/')[-1]}: too little voiced sound")
        continue
    ordered = sorted(track)
    print(f"{path.split('/')[-2]:28s} median {statistics.median(track):5.0f} Hz   low {ordered[len(ordered)//10]:4.0f}   high {ordered[-max(1, len(ordered)//10)]:4.0f}   voiced frames {len(track)}")
