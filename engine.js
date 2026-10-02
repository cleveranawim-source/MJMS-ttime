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
   그 상태를 그 교사의 실효 한도로 보고, 교체로 거기서 더 늘어나면 "한도 초과"로 적는다. */
const capFor = (teacherId, day) =>
  Math.max(capOf(day), (byTeacherDay.get(teacherId + "|" + day) || []).length);
const consecFor = (teacherId, day) =>
  Math.max(CONSEC_CAP, consecutiveMax((byTeacherDay.get(teacherId + "|" + day) || []).map(l => l.period)));
/* 이 회전이 각 교사의 하루를 얼마나 무겁게 만드는지, 교체 전후를 비교한다.
   한도를 넘는 날은 overLoad가 따로 "한도 초과"로 적으므로, 여기서는 한도 안에서 부담이 커지는 경우만 잡는다. */
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
const ROOM_WEIGHT = 12;   // 교실을 새로 잡아야 하는 자리 하나당 더하는 부담 — 이틀 떨어진 값과 비슷하다
const OVER_WEIGHT = 60;   // 한도를 넘는 날 하나당 — 수업별 후보 안에서 맨 뒤로 보낸다
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
/* 결강 수업을 하나씩 처리하며, 지금까지 가장 좋은 부분안 BEAM개만 들고 간다(빔 탐색).
   예전에는 깊이 우선으로 훑다가 안 60개를 찾으면 멈췄는데, 그 60개가 모두 앞쪽 수업의 첫 대안에
   묶여 있었다. 하루 전체 결강의 절반(248건 중 125건)에서 더 나은 1위를 놓쳤고, 한도 안에서 다 풀리는
   안이 있는데도 한도 초과 안이 1위에 오기도 했다(9건). 80개면 끝까지 찾은 결과와 247건이 같다(2026-10-02). */
const SHOW = 12, BEAM = 80;

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

  /* 못 메운 수업이 적은 안, 그다음 한도를 넘지 않는 안, 그다음 부담이 낮은 안. */
  const order = (a, b) => a.missed.length - b.missed.length || a.over - b.over || a.score - b.score;
  let beams = [{ steps: [], temp: [], used: new Set(), score: 0, missed: [], over: 0 }];
  let nodes = 0;
  for (const unit of units) {
    const next = [];
    for (const b of beams) {
      nodes += 1;
      if (b.used.has(unit.head.id)) { next.push(b); continue; }   // 블록 통째 이동에 이미 실렸다
      /* 수업마다 SHOW개까지 본다. 6개로 자르면 한 교시 결강은 대안이 여섯 개를 넘지 못해,
         계산은 됐는데 화면에 못 오르는 안이 평균 넷 중 셋이었다. */
      for (const o of optionsFor(unit, b.temp, b.used, SHOW, sel)) {
        const used = new Set(b.used);
        for (const id of o.usedIds) used.add(id);
        next.push({ steps: b.steps.concat(o), temp: b.temp.concat(o.temp), used,
                    score: b.score + o.score, missed: b.missed, over: b.over + o.over.length });
      }
      next.push({ ...b, missed: b.missed.concat(unit.head) });   // 이 수업은 짝을 못 찾은 채로 — 부분 조합
    }
    next.sort(order);
    beams = next.slice(0, BEAM);
  }
  const plans = beams.filter(b => b.steps.length).map(b => ({ steps: b.steps, missed: b.missed, score: b.score }));

  const seen = new Set(), unique = [];
  /* 한도를 넘는 안은 적어서 보여 주되 한도 안의 안보다 앞에 서지 않는다 (위 order와 같은 순서). */
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

/* ── 설명 ─────────────────────────────── */
/* 화면에는 "1학년 1반"으로 적는다. 자료와 신고서의 "1-1"은 그대로 둔다 — 종이 양식의 관례다.
   칸이 좁은 곳(교시 칸, 교사별 표)은 "1-1반". */
const classLong = id => { const c = C.get(id); if (!c) return id; const m = /^(\d+)-(\d+)$/.exec(c.name); return m ? m[1] + "학년 " + m[2] + "반" : c.name; };
const classShort = id => { const c = C.get(id); if (!c) return id; return /^\d+-\d+$/.test(c.name) ? c.name + "반" : c.name; };

/* 고른 교시를 사람이 읽는 문구로 — 하루 전체 / 2~4교시 / 1·5교시 */
function periodLabel(sel) {
  const d = DATA.days.find(x => x.id === sel.day);
  const ps = [...sel.periods].sort((a, b) => a - b);
  if (!ps.length) return "선택 없음";
  if (d && ps.length === d.periods) return "하루 전체";
  if (ps.length === 1) return ps[0] + "교시";
  const solid = ps.every((p, i) => i === 0 || p === ps[i - 1] + 1);
  return (solid ? ps[0] + "~" + ps[ps.length - 1] : ps.join("·")) + "교시";
}

const missReason = l => l.locked || l.type === "special" ? "고정수업이라 옮길 수 없음"
  : noSwap(l) ? "강사가 맡는 수업이라 교체하지 않음"
  : "같은 반 안에 옮길 자리가 없음";

function planText(plan, r) {
  const head = r.absent.name + " 선생님 " + r.sel.day + "요일 " + periodLabel(r.sel) + " " + r.sel.reason
    + (plan.steps.length ? " · 수업 교체안" : " · 보강 요청");
  const sameDay = plan.steps.length > 0 && plan.steps.every(s => s.sameDay);
  const mark = sameDay ? "  [같은 날 안에서]" : "";
  const rows = plan.steps.map((s, i) => [
    (i + 1) + ". " + classLong(s.classId) + " — " + s.label + (!sameDay && s.sameDay ? " (같은 날 안에서)" : ""),
    ...s.slots.map(sl => "   " + sl.day + " " + sl.period + "교시: " +
      sl.beforeSubject + "(" + sl.beforeTeacher + ") → " + sl.afterSubject + "(" + sl.afterTeacher + ")"),
  ].join("\n"));
  const strain = plan.steps.flatMap(s => (s.strain || []).map(n =>
    "· " + n.teacher + " 선생님 " + n.day + "요일 " +
    [n.runUp ? "연속 " + n.run + "시간" : "", n.loadUp ? "하루 " + n.count + "시간(한도 " + n.maxCount + ")" : ""].filter(Boolean).join(" · ")));
  const twice = repeatNotes(plan).map(x =>
    "· " + x.className + " " + x.day + "요일 " + x.subject + " " + x.count + "시간");
  const rooms = roomNotes(plan).map(x =>
    "· " + x.className + " " + x.day + " " + x.period + "교시 " + x.subject + " — " + x.room + "호가 그 시간에 사용 중, 교실 새로 배정");
  const overs = overNotes(plan).map(n => "· " + overLine(n));
  const miss = plan.missed.map(l => {
    const free = freeTeachersAt(l.day, l.period, r.sel, l.classId).slice(0, 4)
      .map(f => f.name + (f.sameClass ? "(이 반 담당)" : f.sameGrade ? "(" + f.grade + "학년)" : "")).join(", ");
    return "· " + l.day + " " + l.period + "교시 " + classLong(l.classId) + " " + l.subject + " — " + missReason(l) +
      (free ? " (이 시간 공강: " + free + ")" : "");
  });
  const hardNotes = planIsHard(plan)
    ? plan.steps.flatMap(s => s.strain || []).filter(n => n.heavy) : [];
  const advise = hardNotes.length || overs.length
    ? ["", "[권고] " + (overs.length
         ? [...new Set(overNotes(plan).map(n => n.teacher))].join("·") + " 선생님의 한도를 넘깁니다 — " + overNotes(plan).map(overLine).join(", ") + "."
         : heavyTeachers(plan).join("·") + " 선생님의 하루가 한도까지 찹니다 — " + hardNotes.map(hardReason).join(", ") + "."),
       "아래 공강 교사에게 보강을 부탁하는 편이 나을 수 있습니다.",
       ...freeTeachersAt(r.affected[0].day, r.affected[0].period, r.sel, r.affected[0].classId)
         .filter(f => !hardNotes.some(n => n.teacher === f.name) && !overNotes(plan).some(n => n.teacher === f.name)).slice(0, 5)
         .map(f => "· " + f.name + "(" + [f.subjects, f.sameClass ? "이 반 담당" : f.sameGrade ? f.grade + "학년 담당" : ""].filter(Boolean).join(", ") + ")")]
    : [];
  return [head + mark, "", ...rows,
    ...(strain.length ? ["", "[부담 확인]", ...strain] : []),
    ...(twice.length ? ["", "[같은 과목이 하루에 두 시간]", ...twice] : []),
    ...(rooms.length ? ["", "[교체는 가능하나 교실 배정 필요]", ...rooms] : []),
    ...(overs.length ? ["", "[한도 초과 — 규칙을 넘는 안입니다]", ...overs] : []),
    ...(miss.length ? ["", "[미해결]", ...miss] : []),
    ...advise].join("\n");
}

/* 부담 한 줄(글자만). 화면은 이것을 esc해서 쓴다. */
function strainText(n) {
  const parts = [];
  if (n.runUp) parts.push("연속 " + n.run + "시간" + (n.run >= n.maxRun ? " (한도 " + n.maxRun + ")" : ""));
  if (n.loadUp) parts.push("하루 " + n.count + "시간 (한도 " + n.maxCount + ")");
  return n.teacher + " 선생님 " + n.day + "요일 " + parts.join(" · ");
}

/* 이 안을 쓰면 한 반이 하루에 같은 과목을 두 시간 받게 되는 곳.
   규칙상 두 시간까지는 되므로 막지 않고, 보고 판단하시라고 적어만 둔다.
   원래부터 두 시간이던 미술 연강은 새로 생긴 것이 아니므로 뺀다. */
function repeatNotes(plan) {
  const after = new Map();   // "cid|요일-교시" → 바뀐 뒤 과목
  for (const s of plan.steps) {
    for (const sl of s.slots) after.set(s.classId + "|" + sl.day + "-" + sl.period, sl.afterSubject);
  }
  const out = [], seen = new Set();
  for (const s of plan.steps) {
    for (const day of new Set(s.slots.map(x => x.day))) {
      const key = s.classId + "|" + day;
      if (seen.has(key)) continue;
      seen.add(key);
      const was = new Map(), now = new Map();
      for (const l of byClassDay.get(key) || []) {
        was.set(l.subject, (was.get(l.subject) || 0) + 1);
        const sub = after.get(key + "-" + l.period) || l.subject;
        now.set(sub, (now.get(sub) || 0) + 1);
      }
      for (const [sub, cnt] of now) {
        if (cnt > 1 && cnt > (was.get(sub) || 0)) out.push({ className: classLong(s.classId), day, subject: sub, count: cnt });
      }
    }
  }
  return out;
}

/* 교실을 새로 잡아야 하는 자리. 교체 자체는 되므로 막지 않고 적어만 둔다. */
function roomNotes(plan) {
  const out = [];
  for (const s of plan.steps) {
    for (const sl of s.slots) {
      if (sl.roomClash) out.push({ className: classLong(s.classId), day: sl.day, period: sl.period, room: sl.afterRoom, subject: sl.afterSubject });
    }
  }
  return out;
}

/* 부담 점수는 단계당 평균으로 본다 — 하루 전체 결강은 단계가 많아 합계만으로는 비교가 안 된다.
   30 이하는 짧은 맞교환 수준, 48을 넘으면 회전이 길거나 부담 표시가 붙은 안이다.
   한도 초과나 무리 판정이 붙은 안은 언제나 "높음"이다. 평균으로 재면 한도를 넘는 단계 하나가
   가벼운 단계들 사이에 묻혀, 칩은 "부담 큼"인데 눈금은 "낮음"이라고 하는 일이 있었다. */
function burdenOf(plan) {
  if (planIsHard(plan)) return { level: 3, word: "높음", cls: "high" };
  const per = plan.steps.length ? plan.score / plan.steps.length : 0;
  return per <= 30 ? { level: 1, word: "낮음", cls: "low" }
       : per <= 48 ? { level: 2, word: "보통", cls: "mid" }
       : { level: 3, word: "높음", cls: "high" };
}

/* 한 안의 설명을 화면 없이 묶어 낸다. AI 교무실이 카드와 AI 답에 쓴다.
   수업교체 도우미 화면(planCard·planText)과 같은 함수에서 나오므로 두 곳의 설명이 같다. */
function roomUser(room, day, period) {
  const l = byRoomSlot.get(room + "|" + day + "-" + period);
  if (!l) return "";
  const who = T.get(l.teacherId);
  return classLong(l.classId) + " " + l.subject + (who ? "(" + who.name + ")" : "");
}
function explainPlan(plan, r) {
  const b = burdenOf(plan);
  const hard = planIsHard(plan);
  return {
    burden: { level: b.level, word: b.word },
    hard,
    steps: plan.steps.map(s => ({
      className: classLong(s.classId),
      strain: (s.strain || []).map(n => ({ text: strainText(n), heavy: Boolean(n.heavy) })),
      over: (s.over || []).map(overLine),
    })),
    rooms: roomNotes(plan).map(x => {
      const user = roomUser(x.room, x.day, x.period);
      return x.className + " " + x.day + " " + x.period + "교시 " + x.subject + " — 원래 교실(" + x.room + ")은 그 시간에 "
        + (user ? user + " 수업" : "다른 수업") + "이 쓰고 있어 교실을 새로 정해야 합니다";
    }),
    repeats: repeatNotes(plan).map(x => x.className + "은 " + x.day + "요일에 " + x.subject + " 수업을 " + x.count + "시간 듣게 됩니다"),
    missed: plan.missed.map(l => ({
      text: l.day + " " + l.period + "교시 " + classLong(l.classId) + " " + l.subject + " — " + missReason(l),
      free: freeTeachersAt(l.day, l.period, r.sel, l.classId).slice(0, 4).map(f =>
        f.name + (f.sameClass ? "(이 반 담당)" : f.sameGrade ? "(" + f.grade + "학년 담당)" : "")),
    })),
    advise: hard ? (overNotes(plan).length
      ? [...new Set(overNotes(plan).map(n => n.teacher))].join("·") + " 선생님의 한도를 넘깁니다 — " + overNotes(plan).map(overLine).join(", ")
      : heavyTeachers(plan).join("·") + " 선생님의 하루가 한도까지 찹니다 — " + plan.steps.flatMap(s => s.strain || []).filter(n => n.heavy).map(hardReason).join(", "))
      + ". 그 시간 공강인 선생님께 보강을 부탁하는 편이 나을 수 있습니다." : null,
    text: planText(plan, r),
  };
}
