/* 계산기 비교 검사 — engine.js가 예전 계산기와 같은 교체안을 내는지 전부 맞춰 본다.
   실행: node check-engine.mjs [비교할 커밋, 기본 HEAD]

   비교할 커밋의 template.html(계산기가 안에 들어 있던 때) 또는 engine.js를 꺼내 옛 계산기로 쓰고,
   지금의 engine.js를 새 계산기로 쓴다. 두 계산기에 모든 교사 × 요일 × 교시 조합
   (한 교시, 두 교시, 하루 전체)을 똑같이 넣어 결과가 한 글자라도 다르면 실패로 끝낸다.
   계산기를 옮기거나 다듬은 뒤, 푸시하기 전에 돌린다. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const ref = process.argv[2] || "HEAD";
const show = file => {
  try { return execFileSync("git", ["show", `${ref}:${file}`], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
};

/* 옛 계산기: 그 커밋에 engine.js가 있으면 그것, 없으면 template.html에서 규칙~solve 부분을 잘라 낸다. */
function oldEngine() {
  const eng = show("engine.js");
  if (eng) return eng;
  const tpl = show("template.html");
  if (!tpl) throw new Error(`${ref}에서 template.html을 찾지 못했습니다`);
  const a = tpl.indexOf("/* ── 학교 규칙"), b = tpl.indexOf("/* ── 그리기");
  if (a < 0 || b < 0) throw new Error("template.html에서 계산기 부분을 찾지 못했습니다");
  /* 그때는 학급 이름 함수 cls가 화면 쪽(그리기)에 있었다. 계산기가 그것을 빌려 썼으므로 함께 붙인다. */
  const cls = tpl.match(/^const cls = .*$/m);
  return tpl.slice(a, b) + (cls ? "\n" + cls[0] + "\n" : "");
}
const newEngine = fs.readFileSync(path.join(dir, "engine.js"), "utf8");
const dataText = fs.readFileSync(path.join(dir, "timetable.json"), "utf8");

/* DATA는 계산기마다 새로 만든다 — 계산기가 slotStates를 고쳐 쓰기 때문이다. */
const load = src => vm.runInNewContext(src + "\n;({ solve, ACTIVE, DATA })", { DATA: JSON.parse(dataText) });
const A = load(oldEngine()), B = load(newEngine);

const scenarios = [];
for (const t of B.ACTIVE) {
  for (const d of B.DATA.days) {
    const ps = Array.from({ length: d.periods }, (_, i) => i + 1);
    const sets = [...ps.map(p => [p]), ps];
    for (let i = 0; i < ps.length; i += 1) for (let j = i + 1; j < ps.length; j += 1) sets.push([ps[i], ps[j]]);
    for (const periods of sets) scenarios.push({ teacherId: t.id, day: d.id, periods, reason: "출장" });
  }
}

let diff = 0, plans = 0, full = 0;
for (const sel of scenarios) {
  const x = JSON.stringify(A.solve(sel)), y = JSON.stringify(B.solve(sel));
  if (x !== y) {
    diff += 1;
    if (diff <= 5) console.log("다름:", JSON.stringify(sel));
  }
  const r = JSON.parse(y);
  plans += r.plans.length;
  if (r.full) full += 1;
}
console.log(`비교 기준 ${ref} · 조합 ${scenarios.length}가지 · 교체안 ${plans}개 · 완전 해결 있는 조합 ${full}가지`);
if (diff) { console.log(`결과가 다른 조합 ${diff}가지`); process.exit(1); }
console.log("모든 조합에서 결과가 같습니다");
