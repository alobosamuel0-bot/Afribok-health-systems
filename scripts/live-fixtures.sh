#!/usr/bin/env bash
# Builds the fake paper records and synthetic consultation audio used by the live
# checks. Requires ffmpeg with the flite and drawtext filters (checked below).
#   clean.png  — a legible registration card
#   poor.jpg   — the same card photographed crooked, dim and blurred
#   consult.wav — a 52 s clinician/patient conversation
set -euo pipefail

out="${AFRIBOK_FIXTURES:-/tmp/afribok-live}"
mkdir -p "$out"

# Read the filter list once: piping ffmpeg into `grep -q` makes ffmpeg die of
# SIGPIPE and fake a failure under `set -o pipefail`.
filters="$(ffmpeg -hide_banner -filters 2>/dev/null)"
if ! grep -q drawtext <<<"$filters"; then
  echo "ffmpeg is missing the drawtext filter" >&2
  exit 1
fi
if ! grep -q flite <<<"$filters"; then
  echo "ffmpeg is missing the flite filter" >&2
  exit 1
fi

font="$(fc-match -f '%{file}' 'DejaVu Sans' 2>/dev/null || true)"
font="${font:-/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf}"

cat > "$out/record.txt" <<'EOF'
NORTHSTAR CLINIC - PATIENT RECORD

Hospital No: AFB-2048
Name: CHINWE OKONKWO
Sex: Female        DOB: 1987-04-12
Phone: 0803 555 0177
Address: 14 Ademola Street, Wuse 2, Abuja
National ID: NIN-5521-0093
Next of kin: Emeka Okonkwo (brother) 0805 555 0143
Presenting complaint: Fever and headache for 3 days
Temperature: 38.6 C   BP: 118/74   Pulse: 96
Seen by: Dr. C. Balogun        Date: 12/03/2026
EOF

ffmpeg -hide_banner -loglevel error -y -f lavfi -i "color=c=#fdfbf4:s=1000x1250" \
  -vf "drawtext=fontfile=$font:textfile=$out/record.txt:fontcolor=#23201c:fontsize=30:x=60:y=60:line_spacing=18, drawbox=x=55:y=40:w=880:h=6:color=#2b2b2b:t=fill" \
  -frames:v 1 "$out/clean.png"

ffmpeg -hide_banner -loglevel error -y -i "$out/clean.png" \
  -vf "scale=620:-1,rotate=6*PI/180:fillcolor=#e9e5db,eq=brightness=-0.10:contrast=0.72:gamma=1.25,gblur=sigma=1.5,noise=alls=12:allf=t" \
  -q:v 6 "$out/poor.jpg"

cat > "$out/consult.txt" <<'EOF'
Doctor: Good morning, what brings you in today? Patient: I have had fever for three days and a bad headache. I also feel very tired and my body is aching. Doctor: Have you taken anything for it? Patient: I took paracetamol twice, but the fever came back in the evening. Doctor: Any cough, sore throat or vomiting? Patient: My throat is a little sore. No vomiting, but I have no appetite. Doctor: Your temperature is thirty eight point six, blood pressure one eighteen over seventy four, pulse ninety six. Your throat is mildly red and your chest is clear. I think this is a viral upper respiratory infection. Patient: Do I need antibiotics? Doctor: No, antibiotics will not help a virus. I will give you paracetamol and ask you to drink plenty of water and rest. Come back in three days if the fever persists or if you develop chest pain or difficulty breathing.
EOF

ffmpeg -hide_banner -loglevel error -y -f lavfi -i "flite=textfile=$out/consult.txt:voice=slt" \
  -ar 16000 -ac 1 -c:a pcm_s16le "$out/consult.wav"

ls -l "$out/clean.png" "$out/poor.jpg" "$out/consult.wav"
