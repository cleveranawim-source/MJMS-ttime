/* 교체 수업 신고서(.hwpx) 채우기 — 첨부 양식의 section0.xml을 셀 주소로 채운다.
   브라우저와 Node에서 같은 코드를 쓴다. ZIP 입출력만 각자 처리한다. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HwpxFill = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TBL_ID = '<hp:tbl id="2052365658"';
  const DAY_NUM = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 };
  const HEAD_ROWS = 2;          // 그룹 머리글 + 열 머리글
  const BASE_ROWS = 8;          // 양식 원본 전체 행 수
  const NAME_REF = "20";        // 교체교사명 글자모양
  const CELL_REF = "10";        // 일반 칸 글자모양

  const xmlEscape = v => String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /* 지정한 요일의 날짜 — 기준일 이후 가장 가까운 같은 요일 */
  function dateForDay(base, dayId) {
    const target = DAY_NUM[dayId];
    const d = new Date(base.getTime());
    if (target) d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7));
    return d;
  }
  const monthDay = d => (d.getMonth() + 1) + "." + d.getDate();
  const spaced = name => String(name || "").split("").join(" ");
  const schoolYear = d => (d.getMonth() + 1 >= 3 ? d.getFullYear() : d.getFullYear() - 1);

  /* 회전에 참여한 교시마다 한 행. 왼쪽은 원래 있던 수업, 오른쪽은 바뀐 뒤 들어갈 수업.
     맞교환(2개)이면 2행, 3개 회전이면 3행이 된다. */
  function rowsFor(steps, baseDate) {
    const rows = [];
    for (const s of steps) {
      for (const sl of s.slots) {
        const d = monthDay(dateForDay(baseDate, sl.day));
        rows.push({
          left:  [sl.beforeSubject, d, sl.day, String(sl.period), s.className, sl.beforeTeacher],
          right: [sl.afterSubject, d, sl.day, String(sl.period), s.className, sl.afterTeacher],
        });
      }
    }
    return rows;
  }

  /* 표에서 (col,row) 칸의 첫 문단 글을 바꾼다 */
  function setCell(tbl, col, row, text, ref) {
    const addr = `<hp:cellAddr colAddr="${col}" rowAddr="${row}"/>`;
    const at = tbl.indexOf(addr);
    if (at < 0) throw new Error(`칸 (${col},${row})을 찾지 못했습니다`);
    const tcStart = tbl.lastIndexOf("<hp:tc", at);
    const pStart = tbl.indexOf("<hp:p ", tcStart);
    const pEnd = tbl.indexOf("</hp:p>", pStart);
    const para = tbl.slice(pStart, pEnd);
    const runRe = /<hp:run\b[^>]*?(?:\/>|>[\s\S]*?<\/hp:run>)/;
    if (!runRe.test(para)) throw new Error(`칸 (${col},${row})에 글자 요소가 없습니다`);
    const next = text === ""
      ? `<hp:run charPrIDRef="${ref}"/>`
      : `<hp:run charPrIDRef="${ref}"><hp:t>${xmlEscape(text)}</hp:t></hp:run>`;
    return tbl.slice(0, pStart) + para.replace(runRe, next) + tbl.slice(pEnd);
  }

  /* 빈 행을 복제해 6행을 넘는 교체도 담는다 */
  function growRows(tbl, need) {
    const trRe = /<hp:tr>[\s\S]*?<\/hp:tr>/g;
    const all = tbl.match(trRe);
    const last = all[all.length - 1];
    let extra = "";
    for (let r = BASE_ROWS; r < HEAD_ROWS + need; r += 1) {
      extra += last.replace(/rowAddr="\d+"/g, `rowAddr="${r}"`);
    }
    const insertAt = tbl.lastIndexOf("</hp:tr>") + "</hp:tr>".length;
    const grown = tbl.slice(0, insertAt) + extra + tbl.slice(insertAt);
    return grown.replace(/(<hp:tbl\b[^>]*?\srowCnt=")\d+(")/, `$1${HEAD_ROWS + need}$2`);
  }

  /* section0.xml 전체를 채운다 */
  function fillSection(xml, data) {
    const start = xml.indexOf(TBL_ID);
    if (start < 0) throw new Error("신고서 표를 찾지 못했습니다");
    const end = xml.indexOf("</hp:tbl>", start) + "</hp:tbl>".length;
    let tbl = xml.slice(start, end);

    const rows = data.rows;
    const capacity = BASE_ROWS - HEAD_ROWS;
    if (rows.length > capacity) tbl = growRows(tbl, rows.length);
    const total = Math.max(capacity, rows.length);

    for (let i = 0; i < total; i += 1) {
      const r = HEAD_ROWS + i;
      const row = rows[i];
      for (let c = 0; c < 6; c += 1) tbl = setCell(tbl, c, r, row ? row.left[c] : "", CELL_REF);
      for (let c = 0; c < 5; c += 1) tbl = setCell(tbl, 6 + c, r, row ? row.right[c] : "", CELL_REF);
      tbl = setCell(tbl, 11, r, row ? row.right[5] : "", NAME_REF);
      tbl = setCell(tbl, 12, r, "", CELL_REF);
    }

    let out = xml.slice(0, start) + tbl + xml.slice(end);
    out = out.replace(/<hp:t>\d{4}학년도<\/hp:t>/, `<hp:t>${data.schoolYear}학년도</hp:t>`);
    out = out.replace(/<hp:t>사유 :\s*[^<]*<\/hp:t>/, `<hp:t>사유 :         ${xmlEscape(data.reason)}</hp:t>`);
    out = out.replace(/<hp:t>신고 교사 :\s*[^<]*<\/hp:t>/, `<hp:t>신고 교사 :   ${xmlEscape(spaced(data.teacherName))}   </hp:t>`);
    return out;
  }

  /* 파일 탐색기 미리보기용 텍스트 — 원본과 같은 모양으로 다시 만든다 */
  function buildPrvText(data) {
    const cells = a => "<" + a.join("><") + ">";
    const lines = [
      `${data.schoolYear}학년도<일과계><부장><교감>`,
      "< ><><>",
      "         교체 수업 신고서",
      "",
      ` 사유 :         ${data.reason}                                                  신고 교사 :   ${spaced(data.teacherName)}   (서명 또는 인)`,
      "<수업 시간표 내역><수업 교체 내역><비고>",
      cells(["과목", "월 일", "요일", "교시", "학년 반", "수업교사명", "과목", "월 일", "요일", "교시", "학년 반", "교체교사명 (서명 또는 인)"]),
    ];
    const capacity = Math.max(BASE_ROWS - HEAD_ROWS, data.rows.length);
    for (let i = 0; i < capacity; i += 1) {
      const r = data.rows[i];
      lines.push(r
        ? cells(r.left.concat(r.right.slice(0, 5), r.right[5] + " (서명 또는 인)", ""))
        : cells(["", "", "", "", "", "", "", "", "", "", "", " (서명 또는 인)", ""]));
    }
    return lines.join("\n") + "\n";
  }

  return { fillSection, buildPrvText, rowsFor, dateForDay, monthDay, spaced, schoolYear };
});
