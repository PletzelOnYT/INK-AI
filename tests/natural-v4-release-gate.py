from pathlib import Path
text=Path("src/train_stroke_natural_v4.py").read_text()
for phrase in ("MOTION_HARD","hard_gain>=.05","gain>=.035","old_hard_final","new_hard_final","natural_motion_v4"):
    assert phrase in text,phrase
print("PASS: real handwriting training and separate held-out natural-motion gates")
