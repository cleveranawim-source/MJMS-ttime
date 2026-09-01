# -*- coding: utf-8 -*-
"""엑셀 최종 시간표 → 도구용 timetable-source.js"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xlsx

D = os.path.dirname(os.path.abspath(__file__)) + "/"
CONT = "─▷"          # 연강 이어짐 표시

g = xlsx.read(D + "source-전체학반시간표.xlsx")[0]["grid"]
days_row, per_row = g[2], g[3]

# (요일, 교시) 열 목록
cols = []
for c in range(1, len(days_row)):
    d = (days_row[c] or "").strip()
    p = (per_row[c] or "").strip()
    if d in ("월", "화", "수", "목", "금") and p.isdigit():
        cols.append((c, d, int(p)))

periods = {}
for _, d, p in cols:
    periods[d] = max(periods.get(d, 0), p)

classes, schedule, warn = [], [], []
r = 4
while r + 1 < len(g):
    name = (g[r][0] or "").strip()
    if not re.match(r"^\d-\d+$", name):
        r += 1
        continue
    subj_row, tch_row = g[r], g[r + 1]
    grade = int(name.split("-")[0])
    cid = "class-%s" % name.replace("-", "_")
    classes.append({"id": cid, "name": name, "grade": grade})

    prev = None   # 직전 칸 (연강 이어붙이기용)
    for c, d, p in cols:
        subj = (subj_row[c] or "").strip()
        tch = (tch_row[c] or "").strip()
        if not subj:
            prev = None
            continue
        if subj == CONT:
            if prev and prev["day"] == d:
                prev["_block"] = True
                schedule.append({"classId": cid, "subject": prev["subject"], "teacher": prev["teacher"],
                                 "day": d, "period": p, "cont": True})
            else:
                warn.append("%s %s%d 연강 표시가 앞 수업과 이어지지 않음" % (name, d, p))
            continue
        item = {"classId": cid, "subject": subj, "teacher": tch, "day": d, "period": p, "cont": False}
        schedule.append(item)
        prev = item
    r += 2

# 교사 목록
names = sorted({s["teacher"] for s in schedule if s["teacher"]})
tid = {n: "teacher-%d" % (i + 1) for i, n in enumerate(names)}

# 교과교실: (교사, 과목, 학급) → 교실.
# 교사 한 분이 여러 교실을 쓰므로 학급과 과목까지 봐야 한다.
# 체육·운동은 운동장과 체육관에서 하므로 교실을 붙이지 않는다.
ALIAS = {"스포츠": ["운동"], "중국어": ["중국"], "사회역사": ["사회", "역사"],
         "기술가정": ["기술", "가정"]}
NO_ROOM = {"체육", "운동"}

def parse_classes(text):
    out = set()
    for seg in re.split(r"[/\n]", text or ""):
        seg = seg.strip()
        if not seg:
            continue
        whole = re.search(r"(\d)\s*학년\s*전체", seg)
        if whole:
            gr = int(whole.group(1))
            out.update("%d-%d" % (gr, i) for i in range(1, 11))
            continue
        for m in re.finditer(r"(\d)\s*(?:\([AB]\))?\s*[-–]\s*([0-9,\s]+)", seg):
            gr = int(m.group(1))
            for n in re.findall(r"\d+", m.group(2)):
                if 1 <= int(n) <= 10:
                    out.add("%d-%d" % (gr, int(n)))
    return out

entries = []
rg = xlsx.read(D + "source-교과교실배정표.xlsx")[0]["grid"]
for row in rg[3:]:
    room = (row[2] or "").strip()
    if not room or room.startswith("담임이"):
        continue
    room = room[:-2] if room.endswith(".0") else room
    for base in (5, 9):
        subj = (row[base] or "").strip()
        tcell = (row[base + 1] or "").strip()
        ccell = (row[base + 2] or "").strip()
        if not tcell:
            continue
        subjects = ALIAS.get(subj, [subj] if subj else [])
        who = [x.strip() for x in re.split(r"[\n,]", tcell) if x.strip()]
        for i, nm in enumerate(who):
            if len(who) > 1:
                at = ccell.find(nm)
                nxt = min([ccell.find(o) for o in who[i + 1:] if ccell.find(o) > at] or [len(ccell)])
                part = ccell[at + len(nm):nxt] if at >= 0 else ""
            else:
                part = ccell
            entries.append({"room": room, "teacher": nm, "subjects": subjects,
                            "classes": parse_classes(part)})

def room_for(teacher, subject, class_name):
    if subject in NO_ROOM:
        return ""
    mine = [e for e in entries if e["teacher"] == teacher
            and (not e["subjects"] or subject in e["subjects"])]
    for e in mine:
        if class_name in e["classes"]:
            return e["room"]
    if len(mine) == 1:
        return mine[0]["room"]
    allmine = [e for e in entries if e["teacher"] == teacher]
    return allmine[0]["room"] if len(allmine) == 1 else ""

# 블록 id 부여
blocks = {}
for s in schedule:
    if s["cont"]:
        key = (s["classId"], s["day"], s["period"] - 1)
        blocks[key] = blocks.get(key) or "block-%d" % (len(blocks) + 1)

out_schedule = []
for i, s in enumerate(schedule):
    special = not s["teacher"]
    bid = ""
    if s["cont"]:
        bid = blocks[(s["classId"], s["day"], s["period"] - 1)]
    else:
        k = (s["classId"], s["day"], s["period"])
        if k in blocks:
            bid = blocks[k]
    item = {"id": "lesson-%d" % (i + 1), "classId": s["classId"],
            "teacherId": tid.get(s["teacher"], ""), "subject": s["subject"],
            "day": s["day"], "period": s["period"],
            "type": "special" if special else "regular"}
    if not special:
        cname = next(c["name"] for c in classes if c["id"] == s["classId"])
        rm = room_for(s["teacher"], s["subject"], cname)
        if rm:
            item["room"] = rm
    if bid:
        item["blockId"] = bid
    if special:
        item["locked"] = True
    out_schedule.append(item)

teachers = []
for n in names:
    mine = [s for s in schedule if s["teacher"] == n]
    subs = sorted({s["subject"] for s in mine})
    teachers.append({"id": tid[n], "name": n, "kind": "교사",
                     "subjects": subs,
                     "allowedDays": [d for d in ["월","화","수","목","금"] if any(s["day"] == d for s in mine)],
                     "slotStates": {}})

data = {
    "name": "2026학년도 2학기 명지중학교 시간표",
    "days": [{"id": d, "label": d + "요일", "periods": periods[d]} for d in ["월","화","수","목","금"]],
    "teachers": teachers,
    "classes": classes,
    "schedule": out_schedule,
}
print(json.dumps({
    "학급": len(classes), "교사": len(teachers),
    "배정": len(out_schedule),
    "정규": sum(1 for s in out_schedule if s["type"] == "regular"),
    "창체등": sum(1 for s in out_schedule if s["type"] == "special"),
    "연강칸": sum(1 for s in out_schedule if s.get("blockId")),
    "연강묶음": len(blocks),
    "요일교시": {d: periods[d] for d in periods},
    "교실 붙은 수업": sum(1 for a in out_schedule if a.get("room")),
    "교실 없는 수업": sum(1 for a in out_schedule if a["type"] == "regular" and not a.get("room")),
    "경고": warn[:5],
}, ensure_ascii=False, indent=2))
open(D + "timetable-source.js", "w", encoding="utf-8").write(
    "window.TIMETABLE_SAMPLE = " + json.dumps(data, ensure_ascii=False) + ";\n")
