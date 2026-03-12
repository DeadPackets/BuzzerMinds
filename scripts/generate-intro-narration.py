#!/usr/bin/env python3
"""
Generate the intro narration MP3 using ElevenLabs TTS API.

Usage:
    export ELEVENLABS_API_KEY="sk-..."
    python scripts/generate-intro-narration.py

Output: frontend/public/audio/intro-narration.mp3
"""

import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: 'requests' is required. Install with: pip install requests")
    sys.exit(1)

# ── Config ──────────────────────────────────────────────────────────────────

VOICE_ID = "dEc1rkm0ul0kDedEuETS"  # Lively Announcing voice
MODEL_ID = "eleven_v3"
OUTPUT_FORMAT = "mp3_44100_192"  # 44.1kHz, 192kbps
OUTPUT_PATH = (
    Path(__file__).resolve().parent.parent
    / "frontend"
    / "public"
    / "audio"
    / "intro-narration.mp3"
)

# Narration text with v3 audio tags for expressive delivery.
# Uses ellipses and punctuation for pauses (v3 does not support SSML <break> tags).
# Timed to align with the visual demo timeline:
#   0s  welcome       → opening lines
#   4s  howtoplay     → "Here's how it works"
#   7s  topics        → topic voting explanation
#  16s  reveal        → progressive reveal
#  28s  buzzer        → buzz-in mechanic
#  36s  answering     → answering state (covered by buzzer section)
#  42s  grading       → AI judge + scoring
#  52s  bonus         → bonus chain
#  62s  standings     → standings + end conditions
#  70s  letsgo        → sign-off
NARRATION_TEXT = (
    # ── welcome (0s) ──
    "[excited] Welcome to BuzzerMinds! "
    "The live trivia game show where quick thinking wins the day!"
    "\n\n"
    # ── howtoplay (4s) ──
    "[enthusiastic] Here's how it works..."
    "\n\n"
    # ── topics (7s) ──
    "First up — topic voting! "
    "Everyone picks their favorite categories. "
    "The most popular topics make it into the question pool."
    "\n\n"
    # ── reveal (16s) ──
    "[curious] Then the questions begin. "
    "Watch carefully as each question is revealed — piece by piece. "
    "The more you see, the easier it gets... "
    "but waiting costs you the chance to answer first!"
    "\n\n"
    # ── buzzer (28s) ──
    "[excited] When the buzzer opens — tap FAST! "
    "The first player to buzz in gets to answer. "
    "You'll have a limited time to type your response."
    "\n\n"
    # ── grading (42s) ──
    "[upbeat] Our AI judge grades your answer instantly. "
    "Get it right, and you earn TEN points! "
    "Get it wrong? No penalty... "
    "unless you buzzed in early before the full question was revealed. "
    "That'll cost you five points."
    "\n\n"
    # ── bonus (52s) ──
    "[enthusiastic] If you answer correctly, you'll unlock a bonus chain! "
    "Three rapid-fire solo questions — worth FIVE points each. "
    "Nail them all and pull WAY ahead!"
    "\n\n"
    # ── standings (62s) ──
    "Keep an eye on the standings after each round. "
    "The game ends after a set number of rounds... or when the timer runs out."
    "\n\n"
    # ── letsgo (70s) ──
    "[excited] That's everything you need to know! "
    "Good luck, have fun — and may the FASTEST mind win!"
)

# ── Main ────────────────────────────────────────────────────────────────────


def main():
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        print("Error: ELEVENLABS_API_KEY environment variable is not set.")
        sys.exit(1)

    print(f"Voice ID : {VOICE_ID}")
    print(f"Model    : {MODEL_ID}")
    print(f"Text     : {len(NARRATION_TEXT)} chars")
    print(f"Output   : {OUTPUT_PATH}")
    print()

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}?output_format={OUTPUT_FORMAT}"

    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }

    payload = {
        "text": NARRATION_TEXT,
        "model_id": MODEL_ID,
        "voice_settings": {
            "stability": 0.4,
            "similarity_boost": 0.85,
            "style": 0.6,
            "speed": 1.0,
            "use_speaker_boost": True,
        },
    }

    print("Sending request to ElevenLabs...")
    response = requests.post(
        url, json=payload, headers=headers, stream=True, timeout=120
    )

    if response.status_code != 200:
        print(f"Error {response.status_code}: {response.text}")
        sys.exit(1)

    # Ensure output directory exists
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Stream response to file
    total_bytes = 0
    with open(OUTPUT_PATH, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
                total_bytes += len(chunk)

    size_kb = total_bytes / 1024
    print(f"Done! Saved {size_kb:.1f} KB to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
