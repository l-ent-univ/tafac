#!/bin/zsh
set -eu
# rec-encode.sh for the desktop take: exact 60 fps (for each 1/60 s of
# content, the latest captured frame), scaled to $W×$H, x264 at $CRF.
W=${W:-780}; H=${H:-1594}; CRF=${CRF:-26}
cd "${1:?Pass the capture output directory}"
[[ -f frames.json ]] || exit 1
mkdir out && python3 - <<'PY'
import json, os
d=json.load(open('frames.json')); fr=d['frames']; k=d['slow']; t0=fr[0]['t']
times=[(f['t']-t0)/k for f in fr]
n=int((times[-1]+0.6)*60); j=0
for i in range(n):
    T=i/60
    while j+1<len(fr) and times[j+1]<=T: j+=1
    os.symlink(os.path.abspath('frames/'+fr[j]['name']), f'out/{i:05d}.jpg')
PY
ffmpeg -y -loglevel error -framerate 60 -i out/%05d.jpg -vf "scale=${W}:${H}:flags=lanczos,format=yuv420p" -c:v libx264 -preset slow -crf $CRF -profile:v high -movflags +faststart -an tour.mp4 && ffprobe -v error -show_entries format=duration,size -of default=nw=1 tour.mp4

ffmpeg -y -loglevel error -i tour.mp4 -frames:v 1 -c:v libwebp -quality 82 poster.webp
