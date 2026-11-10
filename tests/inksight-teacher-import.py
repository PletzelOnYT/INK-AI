"""Audit that InkSight data is treated as unlabelled pen motion, not glyph truth."""
import tempfile
from pathlib import Path
import sys
sys.path.insert(0,"src")
from import_inksight_teacher import parse_inkml,teacher_motion_records
DOC="""<?xml version="1.0"?>
<ink xmlns="http://www.w3.org/2003/InkML">
<annotation type="application">InkSight</annotation>
<annotation type="sourceDataset">IAM</annotation>
<annotation type="textField">hello</annotation>
<trace id="0">0,0 2,4 4,8 8,10 12,11 16,12 20,14 25,17</trace>
</ink>"""
with tempfile.TemporaryDirectory() as root:
    folder=Path(root)/"large-i_IAM_inkml"/"vanilla"
    folder.mkdir(parents=True)
    file=folder/"example.inkml"
    file.write_text(DOC)
    info,paths=parse_inkml(file)
    assert info["textField"]=="hello" and len(paths)==1
    rows,stat=teacher_motion_records(root)
    assert len(rows)==1 and len(rows[0])==1
    assert stat["unlabelled_teacher_strokes"]==1
    assert stat["training_label_claim"].startswith("none")
    file.write_text(DOC.replace("InkSight","UnknownModel"))
    rows,stat=teacher_motion_records(root)
    assert not rows and stat["verified_files"]==0
print("PASS: real InkML pen-motion extraction, no fabricated character labels")
