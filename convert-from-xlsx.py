# -*- coding: utf-8 -*-
"""엑셀 최종 시간표 → 도구용 timetable-source.js"""
import json, re, sys
sys.path.insert(0, "/private/tmp/claude-501/-Users-yeopro14-Claude/3208a0f2-e3d0-4571-9666-355bb299684d/scratchpad")
import xlsx

D = "/Volumes/Mint 512/새 폴더/"
CONT = "─▷"          # 연강 이어짐 표시

g = xlsx.read(D + "2026학년도 2학기 시간표(전체 학반).xlsx")[0]["grid"]
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

# 교과교실: 교사 → 교실(첫 배정을 대표로)
rooms, multi = {}, {}
rg = xlsx.read(D + "2026학년도 2학기 교과교실배정표.xlsx")[0]["grid"]
for row in rg[3:]:
    room = (row[2] or "").strip()
    if not room:
        continue
    room = room[:-2] if room.endswith(".0") else room
    for ci in (6, 10):
        for t in re.split(r"[\n,/]+", (row[ci] or "")):
            t = t.strip()
            if not t:
                continue
            multi.setdefault(t, []).append(room)
            rooms.setdefault(t, room)

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
                     "slotStates": {}, "room": rooms.get(n, "")})

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
    "교실배정된교사": sum(1 for t in teachers if t["room"]),
    "교실없는교사": [t["name"] for t in teachers if not t["room"]],
    "여러교실교사": {k: v for k, v in multi.items() if len(set(v)) > 1 and k in tid},
    "경고": warn[:5],
}, ensure_ascii=False, indent=2))
open("/private/tmp/claude-501/-Users-yeopro14-Claude/3208a0f2-e3d0-4571-9666-355bb299684d/scratchpad/new-source.js", "w", encoding="utf-8").write(
    "window.TIMETABLE_SAMPLE = " + json.dumps(data, ensure_ascii=False) + ";\n")
