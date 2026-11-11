from pathlib import Path
s=Path("src/train_recurrent_lift_v5.py").read_text()
for fragment in ("block_geometry_row_gradients","teacher(seq,label)",
                 "final_metrics","normal_pen_down_accuracy","recurrent_lift_v5",
                 "writer_disjoint_validation","pen_lift_f1"):
    assert fragment in s,fragment
print("PASS: learned recurrent pen-up features and writer-disjoint release test")
