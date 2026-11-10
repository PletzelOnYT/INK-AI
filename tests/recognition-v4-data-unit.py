"""Offline parser checks for HASY user separation and official UCI digit files."""
import csv, io, json, sys, tarfile, tempfile, zipfile
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
import extra_handwriting_datasets as extra
from train import LOOKUP
from train_recognition_v4 import TARGET_LETTERS

def png(seed):
    im=Image.new("L",(32,32),255)
    from PIL import ImageDraw
    draw=ImageDraw.Draw(im)
    draw.ellipse((7+seed,5,22,26),outline=0,width=2)
    data=io.BytesIO()
    im.save(data,format="PNG")
    return data.getvalue()

with tempfile.TemporaryDirectory() as temp:
    root=Path(temp)
    tar_path=root/"mini.tar.bz2"
    writers=[f"writer-{i}" for i in range(80)]
    assert any(extra.heldout_writer(w) for w in writers)
    assert any(not extra.heldout_writer(w) for w in writers)
    rows=[["path","symbol_id","latex","user_id"]]
    with tarfile.open(tar_path,"w:bz2") as archive:
        for i,writer in enumerate(writers):
            name=f"hasy-data/v2-{i:05d}.png"
            rows.append([f"../{name}",str(i),"x" if i%2 else "o",writer])
            payload=png(i%4)
            info=tarfile.TarInfo(name)
            info.size=len(payload)
            archive.addfile(info,io.BytesIO(payload))
        text=io.StringIO()
        csv.writer(text).writerows(rows)
        payload=text.getvalue().encode()
        info=tarfile.TarInfo("HASYv2/hasy-data-labels.csv")
        info.size=len(payload)
        archive.addfile(info,io.BytesIO(payload))
    zip_path=root/"pendigits-uci.zip"
    def make_row(digit):
        return ",".join([str(v) for v in [12,3,18,12,24,30,30,55,
                                42,70,53,79,64,82,75,91,digit]])
    with zipfile.ZipFile(zip_path,"w") as z:
        z.writestr("data/pendigits.tra",make_row(2)+"\n"+make_row(7)+"\n")
        z.writestr("data/pendigits.tes",make_row(4)+"\n")
    original=extra.fetch_archive
    original_train,original_test=extra.PENDIGITS_TRAIN,extra.PENDIGITS_TEST
    try:
        extra.PENDIGITS_TRAIN=2;extra.PENDIGITS_TEST=1
        extra.fetch_archive=lambda url,path,expected_md5=None: (
            tar_path if "HASY" in url else zip_path
        )
        hasy_train=extra.HASYLetters(root,"train")
        hasy_val=extra.HASYLetters(root,"validation")
        assert len(hasy_train)+len(hasy_val)==80
        assert len(hasy_train)>0 and len(hasy_val)>0
        assert all(hasy_train[i][0].shape==(1,32,32)
                   for i in range(len(hasy_train)))
        assert set(hasy_train.targets).issubset({LOOKUP["o"],LOOKUP["x"]})
        digits_train=extra.PenDigits(root,"train")
        digits_test=extra.PenDigits(root,"test")
        assert len(digits_train)==2 and len(digits_test)==1
        assert digits_train[0][1]==LOOKUP["2"]
        assert digits_test[0][1]==LOOKUP["4"]
        assert digits_test[0][0].shape==(1,32,32)
    finally:
        extra.fetch_archive=original
        extra.PENDIGITS_TRAIN,extra.PENDIGITS_TEST=original_train,original_test

assert all(c in LOOKUP for c in TARGET_LETTERS)
print("PASS: real-data adapters read labeled HASY images, preserve user splits and parse official PenDigits features")
