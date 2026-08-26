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

// 아이소메트릭 지오메트리
const num = (k, v) => Number(process.env[k] ?? v);
const TW = num("TW", 11);      // 타일 반너비
const TH = num("TH", 2.8);     // 타일 반높이 (작을수록 띠가 낮게 눕는다)
const GAP = num("GAP", 0.86);  // 블록 사이 틈 — 1이면 딱 붙는다
const BASE = num("BASE", 2.5); // 기여 0일의 두께
const UNIT = num("UNIT", 6);   // 레벨 1당 높이
const SVG_W = 830;             // README에서의 기본 폭

// 팔레트
const THEMES = {
  dark: {
    tops: ["#171C24", "#1B4A2B", "#238636", "#2EA043", "#3FB950"],
    left: 0.55,
    right: 0.75,
  },
  light: {
    tops: ["#EBEDF0", "#AEE1BC", "#6FC38A", "#3BA55C", "#1A7F37"],
    left: 0.72,
    right: 0.86,
  },
};

const LEVEL = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

// ─────────────────────────────────────────── 데이터

const QUERY = `
  query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              weekday
              contributionCount
              contributionLevel
            }
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

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data?.user) {
    throw new Error(`사용자를 찾을 수 없음: ${login}`);
  }

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

  const weeks = [];
  let total = 0;
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const recency = w / 52;
      let density = 0.22 + 0.5 * recency;
      if (d === 0 || d === 6) density *= 0.5;
      if (w > 10 && w < 15) density *= 0.25;

      let level = 0;
      let count = 0;
      if (rnd() < density) {
        level = Math.min(4, 1 + Math.floor(rnd() * 4 * (0.35 + 0.65 * recency)));
        count = level * 3 + Math.floor(rnd() * 4);
      }
      total += count;
      days.push({ weekday: d, contributionCount: count, _level: level });
    }
    weeks.push({ contributionDays: days });
  }
  return { totalContributions: total, weeks };
}

// ─────────────────────────────────────────── 렌더

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

const round = (n) => Math.round(n * 100) / 100;

function cellsFrom(calendar) {
  const cells = [];
  calendar.weeks.forEach((week, w) => {
    week.contributionDays.forEach((day) => {
      const level =
        day._level !== undefined ? day._level : LEVEL[day.contributionLevel] ?? 0;
      cells.push({ w, d: day.weekday, level, count: day.contributionCount });
    });
  });
  // 뒤쪽부터 앞쪽으로 — 화가 알고리즘
  cells.sort((a, b) => a.w + a.d - (b.w + b.d));
  return cells;
}

function renderSVG(calendar, themeName) {
  const theme = THEMES[themeName];
  const cells = cellsFrom(calendar);

  // 같은 레벨 안에서도 기여가 많은 날은 살짝 더 높게
  const maxCount = Math.max(1, ...cells.map((c) => c.count));

  const body = cells
    .map((c) => {
      const sx = (c.w - c.d) * TW;
      const sy = (c.w + c.d) * TH;
      const bonus = c.level === 0 ? 0 : (Math.min(c.count, maxCount) / maxCount) * 4;
      const h = BASE + c.level * UNIT + bonus;
      const top = theme.tops[c.level];

      const pts = (arr) => arr.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");

      // 위치는 격자 그대로, 그리기만 살짝 줄여서 블록 사이에 틈을 만든다
      const tw = TW * GAP;
      const th = TH * GAP;
      const cy = sy + TH; // 타일 중심

      const faceL = pts([
        [sx - tw, cy - h],
        [sx, cy + th - h],
        [sx, cy + th],
        [sx - tw, cy],
      ]);
      const faceR = pts([
        [sx, cy + th - h],
        [sx + tw, cy - h],
        [sx + tw, cy],
        [sx, cy + th],
      ]);
      const faceT = pts([
        [sx, cy - th - h],
        [sx + tw, cy - h],
        [sx, cy + th - h],
        [sx - tw, cy - h],
      ]);

      const delay = (c.w + c.d) * 7;

      return (
        `<g class="c" style="animation-delay:${delay}ms">` +
        `<polygon points="${faceL}" fill="${shade(top, theme.left)}"/>` +
        `<polygon points="${faceR}" fill="${shade(top, theme.right)}"/>` +
        `<polygon points="${faceT}" fill="${top}"/>` +
        `</g>`
      );
    })
    .join("");

  // 내용 경계에 맞춰 뷰박스를 잡는다
  const maxH = BASE + 4 * UNIT + 4;
  const x0 = -6 * TW - TW - 6;
  const x1 = 52 * TW + TW + 6;
  const y0 = -TH - maxH - 6;
  const y1 = 58 * TH + TH + 6;
  const vbW = round(x1 - x0);
  const vbH = round(y1 - y0);
  const viewBox = `${round(x0)} ${round(y0)} ${vbW} ${vbH}`;
  const height = Math.round((SVG_W * vbH) / vbW);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${height}" viewBox="${viewBox}" role="img" aria-label="${LOGIN}의 최근 1년 기여 그래프 — 총 ${calendar.totalContributions}회">
<style>
.c{animation:rise .5s cubic-bezier(.2,.75,.3,1) backwards}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.c{animation:none}}
</style>
${body}
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