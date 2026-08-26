#!/usr/bin/env node
/**
 * 기여 그래프 → 아이소메트릭 SVG
 *
 *   node scripts/render-contrib.mjs            토큰으로 실제 데이터
 *   node scripts/render-contrib.mjs --demo     토큰 없이 예시 데이터
 *
 * env
 *   GITHUB_TOKEN   GraphQL 조회용 토큰 (private 기여 포함하려면 read:user PAT)
 *   LOGIN          대상 GitHub 로그인 (기본: Jggyu)
 *   OUT_DIR        출력 디렉터리 (기본: assets)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ─────────────────────────────────────────── 설정

const LOGIN = process.env.LOGIN || "Jggyu";
const OUT_DIR = process.env.OUT_DIR || "assets";
const DEMO = process.argv.includes("--demo");
const num = (k, v) => Number(process.env[k] ?? v);

/**
 * 투영 벡터
 *   A = 주(week) 축 — 오른쪽 아래로
 *   B = 요일(day) 축 — 오른쪽 위로 (화면 안쪽)
 * 두 축을 반대 방향으로 벌리면 길쭉한 대각선 띠가 아니라
 * 가로로 넓은 평행사변형이 나온다.
 */
const AX = num("AX", 11.5);
const AY = num("AY", 2.4);
const BX = num("BX", 7.0);
const BY = num("BY", -5.0);

const GAP = num("GAP", 0.12);   // 블록 사이 틈 (0~0.3)
const MIN_H = num("MIN_H", 4);  // 기여가 있는 날의 최소 높이
const MAX_H = num("MAX_H", 40); // 최대 높이
const IDLE_H = num("IDLE_H", 1.4); // 기여 0일의 두께
const PLATE_H = num("PLATE_H", 9); // 받침대 두께
const PAD = num("PAD", 26);     // 받침대 여백
const SVG_W = 900;

const WEEKS = 53;
const DAYS = 7;

const THEMES = {
  dark: {
    plate: "#12171E",
    idle: "#1B222B",
    ramp: ["#1E4E2E", "#238636", "#2EA043", "#3FB950", "#57D96B"],
    tick: "#4A535E",
    left: 0.62,
    right: 0.42,
  },
  light: {
    plate: "#E8ECF0",
    idle: "#DCE2E8",
    ramp: ["#BFE5CB", "#8ED0A3", "#57B87A", "#2E9B58", "#1A7F37"],
    tick: "#9AA5B1",
    left: 0.9,
    right: 0.78,
  },
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// ─────────────────────────────────────────── 데이터

const QUERY = `
  query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { date weekday contributionCount }
          }
        }
      }
    }
  }
`;

async function fetchCalendar(login, token) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-contrib-renderer",
    },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);

  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!json.data?.user) throw new Error(`사용자를 찾을 수 없음: ${login}`);

  return json.data.user.contributionsCollection.contributionCalendar;
}

/** 토큰 없이 형상만 확인할 때 쓰는 예시 데이터 */
function demoCalendar() {
  let seed = 20260826;
  const rnd = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const start = new Date(Date.UTC(2025, 7, 31)); // 일요일에서 시작
  const weeks = [];
  let total = 0;

  for (let w = 0; w < WEEKS; w++) {
    const days = [];
    for (let d = 0; d < DAYS; d++) {
      const recency = w / (WEEKS - 1);
      let density = 0.24 + 0.48 * recency;
      if (d === 0 || d === 6) density *= 0.5;
      if (w > 10 && w < 15) density *= 0.2;

      let count = 0;
      if (rnd() < density) {
        count = 1 + Math.floor(rnd() * rnd() * (6 + 22 * recency));
      }
      total += count;

      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + w * 7 + d);
      days.push({
        date: date.toISOString().slice(0, 10),
        weekday: d,
        contributionCount: count,
      });
    }
    weeks.push({ contributionDays: days });
  }
  return { totalContributions: total, weeks };
}

// ─────────────────────────────────────────── 기하

const round = (n) => Math.round(n * 100) / 100;
const pt = ([x, y]) => `${round(x)},${round(y)}`;
const poly = (points, fill) => `<polygon points="${points.map(pt).join(" ")}" fill="${fill}"/>`;

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** 격자 좌표 → 화면 좌표 */
const project = (w, d) => [w * AX + d * BX, w * AY + d * BY];

/**
 * 밑면 네 꼭짓점에서 높이 h 만큼 솟은 상자를 그린다.
 * 보이는 면은 윗면 + 앞왼쪽 + 앞오른쪽 세 개.
 */
function box(w, d, h, top, theme, span = 1) {
  const a = [AX * (1 - GAP), AY * (1 - GAP)];
  const b = [BX * (1 - GAP) * span, BY * (1 - GAP) * span];
  const o = project(w + GAP / 2, d + GAP / 2);

  const c0 = o;
  const c1 = [o[0] + a[0], o[1] + a[1]];
  const c2 = [o[0] + a[0] + b[0], o[1] + a[1] + b[1]];
  const c3 = [o[0] + b[0], o[1] + b[1]];
  const up = (p) => [p[0], p[1] - h];

  return (
    poly([c0, c1, up(c1), up(c0)], shade(top, theme.left)) +
    poly([c1, c2, up(c2), up(c1)], shade(top, theme.right)) +
    poly([up(c0), up(c1), up(c2), up(c3)], top)
  );
}

/** 전체를 받치는 판 — 이게 있어야 떠 있지 않고 물체로 보인다 */
function plate(theme) {
  const m = PAD / 20;
  const c0 = project(-m, -m);
  const c1 = project(WEEKS + m, -m);
  const c2 = project(WEEKS + m, DAYS + m);
  const c3 = project(-m, DAYS + m);
  const down = (p) => [p[0], p[1] + PLATE_H];

  return (
    poly([c0, c1, down(c1), down(c0)], shade(theme.plate, theme.left * 0.85)) +
    poly([c1, c2, down(c2), down(c1)], shade(theme.plate, theme.right * 0.85)) +
    poly([c0, c1, c2, c3], theme.plate)
  );
}

/** 판 앞쪽 모서리를 따라가는 월 눈금 */
function monthTicks(calendar, theme) {
  const angle = (Math.atan2(AY, AX) * 180) / Math.PI;
  const out = [];
  let last = -1;

  calendar.weeks.forEach((week, w) => {
    const first = week.contributionDays[0];
    if (!first?.date) return;
    const month = Number(first.date.slice(5, 7)) - 1;
    if (month === last) return;
    last = month;
    if (w < 1 || w > WEEKS - 3) return;

    const [x, y] = project(w, -(PAD / 20) - 0.35);
    out.push(
      `<text x="${round(x)}" y="${round(y + PLATE_H + 13)}" transform="rotate(${round(angle)} ${round(x)} ${round(y + PLATE_H + 13)})" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="8" letter-spacing="1.4" fill="${theme.tick}">${MONTHS[month]}</text>`
    );
  });

  return out.join("");
}

// ─────────────────────────────────────────── 렌더

function renderSVG(calendar, themeName) {
  const theme = THEMES[themeName];

  const cells = [];
  calendar.weeks.forEach((week, w) => {
    week.contributionDays.forEach((day) => {
      cells.push({ w, d: day.weekday, count: day.contributionCount });
    });
  });

  // 이상치 하나에 전체가 눌리지 않도록 상위 5% 지점을 기준으로 잡는다
  const counts = cells.map((c) => c.count).filter((n) => n > 0).sort((a, b) => a - b);
  const cap = Math.max(1, counts[Math.floor(counts.length * 0.95)] || 1);
  const peak = Math.max(1, counts[counts.length - 1] || 1);

  const heightOf = (count) => {
    if (count <= 0) return IDLE_H;
    const t = Math.min(count, cap) / cap;
    return MIN_H + Math.pow(t, 0.75) * (MAX_H - MIN_H);
  };
  const colorOf = (count) => {
    if (count <= 0) return theme.idle;
    const t = Math.min(count, cap) / cap;
    return theme.ramp[Math.min(theme.ramp.length - 1, Math.floor(t * theme.ramp.length))];
  };

  // 화면 위쪽(먼 곳)부터 그린다
  cells.sort((a, b) => a.w * AY + a.d * BY - (b.w * AY + b.d * BY));

  const blocks = cells
    .map((c) => {
      const h = heightOf(c.count);
      const delay = Math.round(c.w * 6 + (DAYS - c.d) * 3);
      return `<g class="c" style="animation-delay:${delay}ms">${box(c.w, c.d, h, colorOf(c.count), theme)}</g>`;
    })
    .join("");

  // 뷰박스 — 네 모서리를 모두 담는다
  const corners = [project(0, 0), project(WEEKS, 0), project(WEEKS, DAYS), project(0, DAYS)];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x0 = Math.min(...xs) - PAD;
  const x1 = Math.max(...xs) + PAD;
  const y0 = Math.min(...ys) - MAX_H - 10;
  const y1 = Math.max(...ys) + PLATE_H + 22;
  const vbW = round(x1 - x0);
  const vbH = round(y1 - y0);
  const height = Math.round((SVG_W * vbH) / vbW);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${height}" viewBox="${round(x0)} ${round(y0)} ${vbW} ${vbH}" role="img" aria-label="${LOGIN}의 최근 1년 기여 — 총 ${calendar.totalContributions}회, 최다 ${peak}회">
<style>
.c{animation:r .55s cubic-bezier(.2,.8,.3,1) backwards}
@keyframes r{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.c{animation:none}}
</style>
${plate(theme)}
${monthTicks(calendar, theme)}
${blocks}
</svg>
`;
}

// ─────────────────────────────────────────── 실행

async function main() {
  let calendar;

  if (DEMO) {
    console.log("데모 데이터로 렌더합니다.");
    calendar = demoCalendar();
  } else {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.error("GITHUB_TOKEN이 없습니다. 형상만 보려면 --demo 를 붙이세요.");
      process.exit(1);
    }
    calendar = await fetchCalendar(LOGIN, token);
  }

  await mkdir(OUT_DIR, { recursive: true });
  for (const name of Object.keys(THEMES)) {
    const file = join(OUT_DIR, `contrib-${name}.svg`);
    await writeFile(file, renderSVG(calendar, name), "utf8");
    console.log(`${file} 생성`);
  }
  console.log(`총 기여 ${calendar.totalContributions}회`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});