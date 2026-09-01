import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.TIMETABLE_PORT || 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
  let target = path.resolve(root, relative);
  // 폴더를 요청하면 그 안의 index.html을 내준다 (예: /exchange-site/)
  if (target !== root && fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, "index.html");
  }
  const inside = target === root || target.startsWith(root + path.sep);
  if (!inside || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("파일을 찾을 수 없습니다.");
    return;
  }
  response.writeHead(200, {
    "Content-Type": mime[path.extname(target).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(target).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`시간표 공방 실행 중: http://127.0.0.1:${port}`);
  console.log("종료하려면 이 창에서 Ctrl+C를 누르세요.");
});
