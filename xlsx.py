"""표준 라이브러리만으로 xlsx 읽기. 시트별 2차원 배열과 병합 정보를 준다."""
import zipfile, re
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "pr": "http://schemas.openxmlformats.org/package/2006/relationships"}

def col_to_num(ref):
    m = re.match(r"([A-Z]+)(\d+)", ref)
    col, row = m.group(1), int(m.group(2))
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n, row

def read(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    rels = {}
    root = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    for rel in root:
        rels[rel.get("Id")] = rel.get("Target").lstrip("/")
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    sheets = []
    for sh in wb.find("m:sheets", NS):
        rid = sh.get("{%s}id" % NS["r"])
        target = rels[rid]
        if not target.startswith("xl/"):
            target = "xl/" + target
        sheets.append((sh.get("name"), target))

    out = []
    for name, target in sheets:
        root = ET.fromstring(z.read(target))
        cells, maxc, maxr = {}, 0, 0
        for c in root.iter("{%s}c" % NS["m"]):
            ref, t = c.get("r"), c.get("t")
            v = c.find("m:v", NS)
            isx = c.find("m:is", NS)
            if v is None and isx is None:
                continue
            if t == "s":
                val = shared[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in isx.iter("{%s}t" % NS["m"]))
            else:
                val = v.text
            val = (val or "").strip()
            if not val:
                continue
            cn, rn = col_to_num(ref)
            cells[(rn, cn)] = val
            maxc, maxr = max(maxc, cn), max(maxr, rn)
        merges = []
        mc = root.find("m:mergeCells", NS)
        if mc is not None:
            for m in mc:
                a, b = m.get("ref").split(":")
                merges.append((col_to_num(a), col_to_num(b)))
        # 병합 셀은 좌상단 값을 전체에 채운다
        for (c1, r1), (c2, r2) in merges:
            v = cells.get((r1, c1))
            if v:
                for rr in range(r1, r2 + 1):
                    for cc in range(c1, c2 + 1):
                        cells.setdefault((rr, cc), v)
        grid = [[cells.get((r, c), "") for c in range(1, maxc + 1)] for r in range(1, maxr + 1)]
        out.append({"name": name, "grid": grid, "rows": maxr, "cols": maxc, "merges": len(merges)})
    return out
