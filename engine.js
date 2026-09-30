/* 수업 교체 계산기 — 학교 규칙, 시간표 색인, 교체안 탐색(solve)
   화면 코드는 하나도 들어 있지 않다. 이 파일 한 벌을 두 곳이 같이 쓴다.

   ① 이 앱: build.mjs가 template.html의 __ENGINE__ 자리표시자에 그대로 끼워 넣는다.
      같은 <script> 안에 들어가므로 화면 코드가 여기 이름들(solve, ACTIVE, T …)을 바로 쓴다.
   ② 서버(AI 교무실 등): 전역 DATA(timetable.json)를 넣고 돌린 뒤 필요한 이름만 꺼낸다.
        vm.runInNewContext(src + "\n;({ solve, ACTIVE, T, C })", { DATA })
      규칙(부장 명단, 하루 한도 …)을 바꾸면 여기만 고치면 되고, 두 곳이 함께 바뀐다.

   실행 전에 전역 DATA가 있어야 한다. KEEP_FREE가 DATA.teachers의 slotStates를 고쳐 쓰므로
   한 번 쓴 DATA를 다른 계산기에 다시 넣지 않는다. */

/* ── 학교 규칙 ─────────────────────────── */
/* 보강을 부탁하지 않는 사람 — 부장교사와 신고 당사자.
   부장 여부는 시간표 자료에 없으므로 이름으로 관리한다. 바뀌면 여기만 고치면 된다. */
const BUJANG = ["박정미", "강한주", "오지영", "성은아", "이은홍", "최현",
                "이제현", "전제광", "김은경", "임슬기", "조민택"];
const NO_COVER = [...BUJANG, "이승열"];   // 이승열은 신고 당사자

/* 강사가 맡아 다른 교사로 대체할 수 없는 수업. 교체 대상에도, 상대 후보에도 넣지 않는다. */
const NO_SWAP = [
  { subject: "운동" },                        // 이서윤·임이경·이종영
  { subject: "중국", days: ["목", "금"] },    // 목·금 강사 수업
];
const noSwap = l => NO_SWAP.some(r => r.subject === l.subject && (!r.days || r.days.includes(l.day)));

/* 회의·업무로 반드시 비워 두는 시간. 여기로는 어떤 수업도 옮기지 않는다. */
const KEEP_FREE = [
  { who: [...BUJANG, "이승열"], day: "목", periods: [1] },
  { who: ["심재경", "이승열"], day: "목", periods: [2, 3] },
];
/* ── 색인: 원본은 배정 960건을 매번 훑지만, 여기서는 미리 묶어 둔다 ── */
const T = new Map(DATA.teachers.map(t => [t.id, t]));
const C = new Map(DATA.classes.map(c => [c.id, c]));
const DAY_IX = new Map(DATA.days.map((d, i) => [d.id, i]));
const byTeacherDay = new Map();   // "tid|요일" → 수업[]
const byTeacherSlot = new Map();  // "tid|요일-교시" → 수업
const byTeacher = new Map();      // tid → 수업[]
for (const l of DATA.schedule) {
  if (!l.teacherId) continue;
  const dk = l.teacherId + "|" + l.day;
  if (!byTeacherDay.has(dk)) byTeacherDay.set(dk, []);
  byTeacherDay.get(dk).push(l);
  byTeacherSlot.set(l.teacherId + "|" + l.day + "-" + l.period, l);
  if (!byTeacher.has(l.teacherId)) byTeacher.set(l.teacherId, []);
  byTeacher.get(l.teacherId).push(l);
}
for (const rule of KEEP_FREE) {
  for (const t of DATA.teachers) {
    if (!rule.who.includes(t.name)) continue;
    for (const p of rule.periods) t.slotStates[rule.day + "-" + p] = "unavailable";
  }
}
const ACTIVE = DATA.teachers.filter(t => byTeacher.has(t.id));
const byClassSlot = new Map();   // "cid|요일-교시" → 수업
const byRoomSlot = new Map();    // "교실|요일-교시" → 수업
const byClass = new Map();       // cid → 수업[]
const byClassDay = new Map();    // "cid|요일" → 수업[]
for (const l of DATA.schedule) {
  const dk = l.classId + "|" + l.day;
  if (!byClassDay.has(dk)) byClassDay.set(dk, []);
  byClassDay.get(dk).push(l);
  byClassSlot.set(l.classId + "|" + l.day + "-" + l.period, l);
  if (!byClass.has(l.classId)) byClass.set(l.classId, []);
  byClass.get(l.classId).push(l);
  if (l.room) byRoomSlot.set(l.room + "|" + l.day + "-" + l.period, l);
}

/* 미술은 두 시간을 이어서 하는 블록 수업이다. 두 칸을 한 덩어리로 다루려고 묶어 둔다. */
const byBlock = new Map();       // blockId → 수업[] (교시 순)
for (const l of DATA.schedule) {
  if (!l.blockId) continue;
  if (!byBlock.has(l.blockId)) byBlock.set(l.blockId, []);
  byBlock.get(l.blockId).push(l);
}
for (const g of byBlock.values()) g.sort((a, b) => a.period - b.period);

const consecutiveMax = periods => {
  const s = [...new Set(periods)].sort((a, b) => a - b);
  let max = 0, run = 0, prev = -100;
  for (const p of s) { run = p === prev + 1 ? run + 1 : 1; prev = p; if (run > max) max = run; }
  return max;
};
const cls = id => C.get(id)?.name || id;   // 자료의 학급 이름 "1-1" — 신고서에 그대로 쓴다
const esc = v => String(v ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
/* 결강 교시는 고른 번호 목록이다. 붙어 있지 않아도 된다 — 1교시와 5교시만 비는 날도 있다. */
const inWindow = (day, period, sel) => day === sel.day && sel.periods.indexOf(period) >= 0;

/* 해당 교사·요일의 교시 목록 — 결강분은 빼고, 임시로 떠맡은 수업은 더해서 */
function periodsOn(tid, day, temp, omit, sel) {
  const out = [];
  for (const l of byTeacherDay.get(tid + "|" + day) || []) {
    if (omit.has(l.id)) continue;
    if (tid === sel.teacherId && inWindow(l.day, l.period, sel)) continue;
    out.push(l.period);
  }
  for (const t of temp) if (t.teacherId === tid && t.day === day) out.push(t.period);
  return out;
}
/* 한도를 넘는 날의 목록. 넘어도 막지 않고 적는다 — 학교가 그렇게 정했다(2026-09-09).
   빈 목록이면 모든 날이 한도 안이다. */
function overLoad(teacher, temp, omit, sel) {
  const out = [];
  for (const d of DATA.days) {
    const p = periodsOn(teacher.id, d.id, temp, omit, sel);
    const cap = capFor(teacher.id, d.id), runCap = consecFor(teacher.id, d.id), run = consecutiveMax(p);
    if (p.length > cap || run > runCap) {
      out.push({ teacher: teacher.name, day: d.id, count: p.length, cap, run, runCap,
                 dayOver: p.length > cap, runOver: run > runCap });
    }
  }
  return out;
}

const stateAt = (teacher, day, period) => teacher.slotStates[day + "-" + period] || "available";

/* 하루에 설 수 있는 최대 수업 수. 학교 규칙이며 교사별 값보다 우선한다.
   월·수·금은 6교시, 화·목은 7교시여서 한도가 다르다.
   자료에 들어 있던 교사별 일일 최대는 현재 시간표에서 뽑아낸 추정값이라 쓰지 않는다. */
const DAILY_CAP = { 월: 5, 화: 6, 수: 5, 목: 6, 금: 5 };
const CONSEC_CAP = 4;                    // 연달아 설 수 있는 최대 시간. 3연강은 정상으로 본다.
const capOf = day => DAILY_CAP[day] || 5;

/* 하루에 몰아서 근무하는 강사처럼 이미 한도를 넘겨 짜인 경우가 있다.
   그 상태는 그대로 인정하되, 교체로 거기서 더 늘어나지는 않게 한다. */
const capFor = (teacherId, day) =>
  Math.max(capOf(day), (byTeacherDay.get(teacherId + "|" + day) || []).length);
const consecFor = (teacherId, day) =>
  Math.max(CONSEC_CAP, consecutiveMax((byTeacherDay.get(teacherId + "|" + day) || []).map(l => l.period)));
/* 이 회전이 각 교사의 하루를 얼마나 무겁게 만드는지, 교체 전후를 비교한다.
   한도를 넘는 안은 이미 걸러졌으므로 여기서 잡히는 것은 "합법이지만 부담되는" 경우다. */
const touchedDays = moves => {
  const out = new Set();
  for (const m of moves) {
    out.add(m.teacherId + "|" + m.from);   // 빠져나가는 날
    out.add(m.teacherId + "|" + m.to);     // 새로 들어가는 날
  }
  return out;
};
function strainOf(touched, temp, usedIds, add, omit, sel) {
  const notes = [];
  for (const key of touched) {
    const at = key.lastIndexOf("|");
    const tid = key.slice(0, at), day = key.slice(at + 1);
    const t = T.get(tid);
    if (!t) continue;
    const before = periodsOn(tid, day, temp, usedIds, sel);
    const after = periodsOn(tid, day, add, omit, sel);
    const beforeRun = consecutiveMax(before), afterRun = consecutiveMax(after);
    const cap = capFor(tid, day);
    if (after.length > cap || afterRun > consecFor(tid, day)) continue;      // 넘는 날은 따로 "한도 초과"로 적는다
    const runUp = afterRun >= 4 && afterRun > beforeRun;                    // 4연속이 새로 생김
    const loadUp = after.length > before.length && after.length >= cap;   // 하루 한도까지 참
    if (!runUp && !loadUp) continue;
    notes.push({
      teacher: t.name, day, runUp, loadUp,
      run: afterRun, maxRun: consecFor(tid, day),
      count: after.length, maxCount: cap,
      heavy: loadUp,          // 하루가 한도까지 찬 경우. 무리 판정은 안 전체를 보고 따로 한다.
    });
  }
  return notes;
}

/* 어느 교사가 어느 학년·학급에 들어가는지 — 같은 학년 선생님을 먼저 권하기 위해 */
const teacherGrades = new Map(), teacherClasses = new Map();
for (const l of DATA.schedule) {
  if (!l.teacherId) continue;
  if (!teacherGrades.has(l.teacherId)) teacherGrades.set(l.teacherId, new Set());
  if (!teacherClasses.has(l.teacherId)) teacherClasses.set(l.teacherId, new Set());
  const g = C.get(l.classId) && C.get(l.classId).grade;
  if (g) teacherGrades.get(l.teacherId).add(g);
  teacherClasses.get(l.teacherId).add(l.classId);
}

/* 그 교시에 수업이 없는 교사 — 보강을 부탁할 수 있는 사람들.
   담당 과목이나 총 시수는 따지지 않는다. 시수가 많아도 그 시간에 비어 있으면 후보다.
   같은 반, 그 다음 같은 학년에 들어가는 선생님을 앞세운다. */
function freeTeachersAt(day, period, sel, classId) {
  const grade = classId && C.get(classId) && C.get(classId).grade;
  const out = [];
  for (const t of DATA.teachers) {
    if (t.id === sel.teacherId || !byTeacher.has(t.id)) continue;
    if (NO_COVER.includes(t.name)) continue;
    if (!t.allowedDays.includes(day)) continue;
    if (stateAt(t, day, period) === "unavailable") continue;
    if (byTeacherSlot.has(t.id + "|" + day + "-" + period)) continue;
    const after = (byTeacherDay.get(t.id + "|" + day) || []).map(l => l.period).concat(period);
    if (after.length > capFor(t.id, day) || consecutiveMax(after) > consecFor(t.id, day)) continue;
    out.push({
      name: t.name, subjects: t.subjects.join("/"),
      sameClass: Boolean(classId && teacherClasses.get(t.id) && teacherClasses.get(t.id).has(classId)),
      sameGrade: Boolean(grade && teacherGrades.get(t.id) && teacherGrades.get(t.id).has(grade)),
      grade, load: after.length, max: capFor(t.id, day),
      run: consecutiveMax(after), prefers: stateAt(t, day, period) === "prefer",
    });
  }
  out.sort((a, b) =>
    (b.sameClass - a.sameClass) || (b.sameGrade - a.sameGrade) ||
    (b.prefers - a.prefers) || (a.run - b.run) || (a.load - b.load) ||
    a.name.localeCompare(b.name, "ko"));
  return out;
}

/* 보강 후보 한 명을 사람이 읽는 문구로 */
function coverLabel(f) {
  const tag = f.sameClass ? "이 반 담당" : f.sameGrade ? f.grade + "학년 담당" : "";
  const inner = [f.subjects, tag].filter(Boolean).join(", ");
  return esc(f.name) + (inner ? "(" + esc(inner) + ")" : "");
}

/* 무리한 교체 — 한 안에서 하루 한도까지 차는 교사가 둘 이상 나올 때.
   교체 자체는 규칙을 지키지만 여러 사람이 동시에 빡빡해지는 안이다.
   연속 4시간은 허용 범위라 표시만 하고 무리의 사유로 삼지 않는다. */
const heavyTeachers = plan =>
  [...new Set(plan.steps.flatMap(s => s.strain || []).filter(n => n.heavy).map(n => n.teacher))];
const overNotes = plan => plan.steps.flatMap(s => s.over || []);
const planIsHard = plan => heavyTeachers(plan).length >= 2 || overNotes(plan).length > 0;
const overLine = n => n.teacher + " 선생님 " + n.day + "요일 " +
  [n.dayOver ? "하루 " + n.count + "시간 (한도 " + n.cap + ")" : "", n.runOver ? "연속 " + n.run + "시간 (한도 " + n.runCap + ")" : ""].filter(Boolean).join(" · ");

function hardReason(n) {
  return n.teacher + " 선생님 " + n.day + "요일 " + n.count + "시간(한도 " + n.maxCount + ")";
}

const CYCLE_MAX = 3;      // 한 회전에 참여하는 수업 수 상한
const SUBJECT_CAP = 2;   // 한 반이 하루에 같은 과목을 받을 수 있는 최대 시간
const ROOM_WEIGHT = 12;
const OVER_WEIGHT = 60;  // 한도를 넘는 날 하나당 — 다른 어떤 안보다 뒤에 서게  // 교실을 새로 잡아야 하는 자리 하나당 더하는 부담 — 이틀 떨어진 값과 비슷하다
/* 상대 선생님의 주당 시수가 평균보다 적으면 부담을 덜고, 많으면 더한다.
   시수가 적은 분(진로·종교 등)과의 안을 앞세우기로 학교가 정했다(2026-09-09). */
const LOAD_WEIGHT = 1;
const AVG_HOURS = DATA.schedule.filter(l => l.teacherId).length / Math.max(1, ACTIVE.length);
const loadTerm = tid => Math.round(((byTeacher.get(tid) || []).length - AVG_HOURS) * LOAD_WEIGHT);

/* 결강 수업을 같은 반 안에서 다른 교시로 보낸다.
   반의 모든 교시가 차 있으므로 옮기면 반드시 누군가를 밀어내고, 그 사슬은 결국
   원래 자리로 돌아온다. 즉 언제나 회전이다. 길이 2면 두 수업의 맞교환이고,
   3이면 세 수업이 자리를 한 칸씩 돈다. 어느 쪽이든 모든 교사가 자기 과목을
   그대로 가르치므로 보강이 생기지 않고, 반이 주당 받는 과목 수도 변하지 않는다.

   미술 블록은 남이 건드리지 못한다. 다른 과목이 결강했을 때 상대 후보에서 빼므로
   블록이 남의 사정으로 흔들리는 일은 없다. 반대로 미술 선생님 본인이 결강하면
   자기 수업이니 두 시간을 통째로 옮기거나 한 시간씩 쪼개어 옮길 수 있다.
   둘 다 함께 보여 주되, 통째로 가는 안은 점수를 조금 우대해 앞쪽에 둔다. */
function optionsFor(unit, temp, usedIds, limit, sel) {
  const lesson = unit.head;
  const own = new Set(unit.lessons.map(x => x.id));
  const absent = T.get(sel.teacherId);
  if (unit.lessons.some(x => x.locked || x.type === "special")) return [];   // 창체·고정수업은 옮길 수 없다
  if (unit.lessons.some(x => noSwap(x))) return [];                          // 강사 수업은 교체하지 않는다

  const pool = (byClass.get(lesson.classId) || []).filter(x =>
    !own.has(x.id) && !usedIds.has(x.id) &&
    !(x.type === "special" || x.locked) &&
    !noSwap(x) &&
    x.teacherId && x.teacherId !== absent.id &&
    !inWindow(x.day, x.period, sel));                     // 결강 시간대로는 옮길 수 없다
  const singles = pool.filter(x => !x.blockId);           // 남의 블록은 상대 후보가 아니다

  const weigh = state => state === "avoid" ? 12 : state === "prefer" ? -6 : 0;
  const found = [];

  /* item 수업이 (day, period)로 갈 수 있는가. leaving은 이번 교체로 자리를 비우는 수업들. */
  function canGo(item, day, period, leaving) {
    const t = T.get(item.teacherId);
    if (!t || !t.allowedDays.includes(day)) return false;
    if (stateAt(t, day, period) === "unavailable") return false;
    const busy = byTeacherSlot.get(t.id + "|" + day + "-" + period);
    if (busy && !leaving.has(busy.id)) return false;
    if (temp.some(x => x.teacherId === t.id && x.day === day && x.period === period)) return false;
    /* 한 반이 하루에 같은 과목을 받는 시간은 두 시간까지다. 미술 연강이 그 두 시간을
       쓰는 형태이고, 지금 시간표에도 그 밖에 두 번을 넘기는 자리는 없다. */
    const same = (byClassDay.get(item.classId + "|" + day) || [])
        .filter(x => x.subject === item.subject && x.id !== item.id && !leaving.has(x.id)).length
      + temp.filter(x => x.classId === item.classId && x.day === day && x.subject === item.subject).length;
    if (same + 1 > SUBJECT_CAP) return false;
    return true;
  }

  /* 교과교실이 그 시간에 비어 있는가. 비어 있지 않아도 교체를 막지는 않는다 —
     교실은 일과계가 쉽게 다시 배정하므로, 대신 "교실 배정 필요"로 적어 둔다. */
  function roomFree(item, day, period, leaving) {
    if (!item.room) return true;
    const inRoom = byRoomSlot.get(item.room + "|" + day + "-" + period);
    if (inRoom && !leaving.has(inRoom.id)) return false;
    return !temp.some(x => x.room === item.room && x.day === day && x.period === period);
  }

  /* before 자리에 after 수업이 들어온다 — 화면과 신고서가 함께 쓰는 한 줄 */
  const mkSlot = (before, after, leaving) => ({
    day: before.day, period: before.period,
    beforeSubject: before.subject, beforeTeacher: T.get(before.teacherId).name,
    beforeRoom: before.room || "",
    afterSubject: after.subject, afterTeacher: T.get(after.teacherId).name,
    afterRoom: after.room || "",
    roomClash: !roomFree(after, before.day, before.period, leaving),   // 들어오는 수업의 교실이 그 시간에 차 있음
  });

  /* 사슬의 마지막 수업을 결강 교시로 되돌려 회전을 닫는다 */
  function close(chain) {
    const leaving = new Set(chain.map(x => x.id));
    if (!canGo(chain[chain.length - 1], lesson.day, lesson.period, leaving)) return;

    const add = temp.slice();
    for (let i = 0; i < chain.length; i += 1) {
      const to = chain[(i + 1) % chain.length];
      add.push({ teacherId: chain[i].teacherId, day: to.day, period: to.period, room: chain[i].room || "",
                 classId: chain[i].classId, subject: chain[i].subject });
    }
    const omit = new Set(usedIds);
    for (const x of chain) omit.add(x.id);
    const over = [];
    for (const id of new Set(chain.map(x => x.teacherId))) over.push(...overLoad(T.get(id), add, omit, sel));

    let score = (chain.length - 2) * 30;   // 짧은 회전을 강하게 우선한다
    let avoided = false;
    const slots = chain.map((before, i) => {
      const after = chain[(i - 1 + chain.length) % chain.length];   // 이 자리로 들어오는 수업
      const st = stateAt(T.get(after.teacherId), before.day, before.period);
      if (st === "avoid") avoided = true;
      score += weigh(st) + Math.abs(DAY_IX.get(before.day) - DAY_IX.get(after.day)) * 3;
      return mkSlot(before, after, leaving);
    });
    const clashes = slots.filter(sl => sl.roomClash).length;
    score += clashes * ROOM_WEIGHT;                            // 교실을 새로 잡아야 하는 안은 조금 뒤로
    for (const x of chain.slice(1)) score += loadTerm(x.teacherId);   // 상대의 주당 시수

    const strain = strainOf(touchedDays(chain.map((x, i) =>
      ({ teacherId: x.teacherId, from: x.day, to: chain[(i + 1) % chain.length].day }))),
      temp, usedIds, add, omit, sel);
    const heavy = strain.filter(n => n.heavy).length;
    found.push({
      lessonId: lesson.id, classId: lesson.classId, className: cls(lesson.classId),
      kind: "cycle", length: chain.length, own: 1, fixed: 1, roomClashes: clashes,
      label: chain.length === 2 ? "두 수업 맞교환" : chain.length + "개 수업 자리 이동",
      sameDay: slots.every(sl => sl.day === lesson.day),
      slots, avoided, strain, heavy, over,
      score: score + strain.length * 6 + heavy * 18 + over.length * OVER_WEIGHT,   // 부담되는 안은 뒤로, 한도를 넘는 안은 맨 뒤로
      usedIds: chain.slice(1).map(x => x.id),
      temp: add.slice(temp.length),
    });
  }

  function extend(chain) {
    if (chain.length >= 2) close(chain);
    if (chain.length >= CYCLE_MAX) return;
    const prev = chain[chain.length - 1];
    const leaving = new Set(chain.map(x => x.id));
    for (const cand of singles) {
      if (chain.some(x => x.id === cand.id)) continue;
      const next = new Set(leaving); next.add(cand.id);
      if (!canGo(prev, cand.day, cand.period, next)) continue;   // prev가 cand의 자리로 간다
      extend(chain.concat(cand));
    }
  }

  /* 블록 두 칸과 붙어 있는 낱개 두 칸이 통째로 자리를 맞바꾼다.
     블록은 언제나 두 칸이 이어진 채로 움직이므로 수업이 쪼개지지 않는다.
     pair는 같은 요일에 연달아 붙은 두 수업이고 교시 순으로 들어온다. */
  function exchange(block, pair) {
    const leaving = new Set(block.concat(pair).map(x => x.id));
    for (const s of pair) if (!canGo(block[0], s.day, s.period, leaving)) return;

    for (const flip of [0, 1]) {   // 두 수업을 블록이 비운 두 칸에 넣는 두 가지 배치
      const to = flip ? [block[1], block[0]] : [block[0], block[1]];
      if (!canGo(pair[0], to[0].day, to[0].period, leaving)) continue;
      if (!canGo(pair[1], to[1].day, to[1].period, leaving)) continue;

      const moves = [
        { from: block[0], to: pair[0] }, { from: block[1], to: pair[1] },
        { from: pair[0], to: to[0] }, { from: pair[1], to: to[1] },
      ];
      const add = temp.concat(moves.map(m =>
        ({ teacherId: m.from.teacherId, day: m.to.day, period: m.to.period, room: m.from.room || "",
           classId: m.from.classId, subject: m.from.subject })));
      const omit = new Set(usedIds);
      for (const x of block.concat(pair)) omit.add(x.id);
      const over = [];
      for (const id of new Set(moves.map(m => m.from.teacherId))) over.push(...overLoad(T.get(id), add, omit, sel));

      let score = -15, avoided = false;   // 블록이 붙은 채로 남으므로 쪼개는 안보다 앞에 둔다
      for (const m of moves) {
        const st = stateAt(T.get(m.from.teacherId), m.to.day, m.to.period);
        if (st === "avoid") avoided = true;
        score += weigh(st);
      }
      /* 요일이 멀수록 무겁다. 자리 두 쌍이 맞바뀌는 것이므로 낱개 맞교환과 같이 두 번만 센다 —
         움직이는 수업이 넷이라고 네 번 세면 블록이 까닭 없이 뒤로 밀린다. */
      score += Math.abs(DAY_IX.get(block[0].day) - DAY_IX.get(pair[0].day)) * 6;

      const slots = [mkSlot(block[0], flip ? pair[1] : pair[0], leaving), mkSlot(block[1], flip ? pair[0] : pair[1], leaving),
                     mkSlot(pair[0], block[0], leaving), mkSlot(pair[1], block[1], leaving)];
      const clashes = slots.filter(sl => sl.roomClash).length;
      score += clashes * ROOM_WEIGHT;
      for (const x of pair) score += loadTerm(x.teacherId);

      const strain = strainOf(touchedDays(moves.map(m =>
        ({ teacherId: m.from.teacherId, from: m.from.day, to: m.to.day }))),
        temp, usedIds, add, omit, sel);
      const heavy = strain.filter(n => n.heavy).length;
      found.push({
        lessonId: lesson.id, classId: lesson.classId, className: cls(lesson.classId),
        kind: "block", length: 4, own: block.length, roomClashes: clashes,
        fixed: block.filter(x => inWindow(x.day, x.period, sel)).length,
        label: block[0].subject + " 블록 통째로 옮기고 두 수업이 그 자리로",
        sameDay: slots.every(sl => sl.day === lesson.day),
        slots, avoided, strain, heavy, over,
        score: score + strain.length * 6 + heavy * 18 + over.length * OVER_WEIGHT,
        usedIds: block.concat(pair).filter(x => !own.has(x.id)).map(x => x.id),
        temp: add.slice(temp.length),
      });
    }
  }

  extend([lesson]);                       // 한 시간씩 쪼개어 옮기는 안
  /* 결강한 수업이 블록의 한쪽이면, 두 시간을 붙인 채로 옮기는 안도 만든다.
     unit.block은 그 블록의 앞 교시 하나에만 달려 있어 같은 안이 두 번 나오지 않는다. */
  if (unit.block && !unit.block.some(x => usedIds.has(x.id))) {
    for (const s1 of singles) {
      const s2 = byClassSlot.get(s1.classId + "|" + s1.day + "-" + (s1.period + 1));
      if (s2 && singles.includes(s2)) exchange(unit.block, [s1, s2]);
    }
  }

  found.sort((a, b) => a.score - b.score || a.length - b.length);
  const seen = new Set(), unique = [];
  for (const o of found) {
    const key = o.slots.map(s => s.day + s.period).sort().join(",");
    if (seen.has(key)) continue;                                 // 같은 자리 집합은 한 번만
    seen.add(key); unique.push(o);
    if (unique.length >= limit) break;
  }
  return unique;
}
const NODE_CAP = 4000, PLAN_CAP = 60, SHOW = 12;

function solve(sel) {
  const absent = T.get(sel.teacherId);
  const affected = (byTeacher.get(sel.teacherId) || [])
    .filter(l => inWindow(l.day, l.period, sel))
    .sort((a, b) => a.period - b.period);
  /* 결강 수업 하나가 한 덩어리다. 블록이면 통째로 옮기는 안을 첫 교시에 얹어 둔다. */
  const units = [], seenBlock = new Set();
  for (const l of affected) {
    const u = { head: l, lessons: [l], block: null };
    if (l.blockId && !seenBlock.has(l.blockId)) {
      seenBlock.add(l.blockId);
      const g = byBlock.get(l.blockId);
      if (g && g.length === 2) u.block = g;
    }
    units.push(u);
  }
  // 수업별 후보는 계산된 것을 전부 보여 준다 — 접혀 있는 목록이라 길어도 된다
  const perLesson = units.map(u => ({ unit: u, lesson: u.head, options: optionsFor(u, [], new Set(), Infinity, sel) }));

  const plans = [];
  let nodes = 0;
  function walk(i, steps, temp, used, score, missed) {
    nodes += 1;
    if (nodes > NODE_CAP || plans.length >= PLAN_CAP) return;
    if (i >= units.length) {
      if (steps.length) plans.push({ steps: steps.slice(), missed: missed.slice(), score });
      return;
    }
    const unit = units[i];
    if (used.has(unit.head.id)) { walk(i + 1, steps, temp, used, score, missed); return; }   // 블록 통째 이동에 이미 실렸다
    /* 수업마다 SHOW개까지 본다. 6개로 자르면 한 교시 결강은 대안이 여섯 개를 넘지 못해,
       계산은 됐는데 화면에 못 오르는 안이 평균 넷 중 셋이었다. 탐색량은 넉넉하다(노드 상한의 4%). */
    for (const o of optionsFor(unit, temp, used, SHOW, sel)) {
      const nextUsed = new Set(used);
      for (const id of o.usedIds) nextUsed.add(id);
      walk(i + 1, steps.concat(o), temp.concat(o.temp), nextUsed, score + o.score, missed);
    }
    // 이 수업은 짝을 못 찾은 채로 두고 나머지를 계속 — 부분 조합
    walk(i + 1, steps, temp, used, score, missed.concat(unit.head));
  }
  if (units.length) walk(0, [], [], new Set(), 0, []);

  const seen = new Set(), unique = [];
  /* 못 메운 수업이 적은 안, 그다음 한도를 넘지 않는 안, 그다음 부담이 낮은 안.
     한도를 넘는 안은 적어서 보여 주되 한도 안의 안보다 앞에 서지 않는다. */
  const overCount = p => p.steps.reduce((k, s) => k + (s.over || []).length, 0);
  plans.sort((a, b) => a.missed.length - b.missed.length || overCount(a) - overCount(b) || a.score - b.score);
  for (const p of plans) {
    const key = p.steps.map(s => s.lessonId + ">" + s.slots.map(x => x.day + x.period).join("+")).join("|");
    if (seen.has(key)) continue;
    seen.add(key); unique.push(p);
    if (unique.length >= SHOW) break;
  }
  return { absent, sel, affected, perLesson, plans: unique, nodes,
           full: unique.filter(p => !p.missed.length).length };
}
