#!/usr/bin/env node
/**
 * 지표 한 줄 → SVG (HackTheBox · 커밋 리듬 · 언어 분포)
 *
 *   node scripts/render-stats.mjs            토큰으로 실제 데이터
 *   node scripts/render-stats.mjs --demo     설정 파일 값만으로 렌더
 *
 * 텍스트는 전부 라틴 문자·숫자만 쓴다.
 * SVG 안의 한글은 보는 사람 브라우저 폰트로 렌더돼서 통제가 안 되기 때문.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const OUT_DIR = process.env.OUT_DIR || "assets";
const CONFIG = process.env.CONFIG || "profile.config.json";
const DEMO = process.argv.includes("--demo");

// ─────────────────────────────────────────── 치수

const W = 830;
const H = 92;
const COLS = 3;
const SEP = 40;                                  // 열 사이 여백
const CW = (W - SEP * (COLS - 1)) / COLS;        // 열 너비
const BASELINE = 66;                             // 그래픽 바닥선

const THEMES = {
  dark: {
    fg: "#E6EDF3",
    muted: "#7D8590",
    dim: "#565E68",
    line: "#21262D",
    accent: "#2EA043",
    track: "#21262D",
    steps: ["#4A5560", "#39414B", "#2A313A"],
  },
  light: {
    fg: "#1F2328",
    muted: "#59636E",
    dim: "#818B98",
    line: "#D1D9E0",
    accent: "#1A7F37",
    track: "#E4E8EC",
    steps: ["#9AA5B1", "#B6BEC8", "#D1D9E0"],
  },
};

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";

// ─────────────────────────────────────────── 데이터

const LANG_QUERY = `
  query ($login: String!) {
    user(login: $login) {
      repositories(first: 100, isFork: false, ownerAffiliations: OWNER, orderBy: {field: PUSHED_AT, direction: DESC}) {
        nodes {
          languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
            edges { size node { name } }
          }
        }
      }
    }
  }
`;

async function fetchLanguages(login, token) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-stats-renderer",
    },
    body: JSON.stringify({ query: LANG_QUERY, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);

  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));

  const totals = new Map();
  for (const repo of json.data.user.repositories.nodes) {
    for (const edge of repo.languages.edges) {
      totals.set(edge.node.name, (totals.get(edge.node.name) || 0) + edge.size);
    }
  }

  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  if (!sum) return [];

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 3).map(([name, size]) => ({
    name,
    pct: Math.round((size / sum) * 100),
  }));
  const rest = 100 - top.reduce((a, l) => a + l.pct, 0);
  if (rest > 0) top.push({ name: "etc", pct: rest });
  return top;
}

/** 공개 이벤트로 시간대 분포를 만든다. 최근 300건 한도라 대략적인 값. */
async function fetchRhythm(login, token) {
  const hours = new Array(24).fill(0);
  let found = 0;

  for (let page = 1; page <= 3; page++) {
    const res = await fetch(
      `https://api.github.com/users/${login}/events/public?per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${token}`, "User-Agent": "profile-stats-renderer" } }
    );
    if (!res.ok) break;
    const events = await res.json();
    if (!Array.isArray(events) || events.length === 0) break;

    for (const ev of events) {
      // KST 기준 시각으로 환산
      const h = new Date(new Date(ev.created_at).getTime() + 9 * 3600 * 1000).getUTCHours();
      hours[h]++;
      found++;
    }
    if (events.length < 100) break;
  }

  if (found < 20) return null; // 표본이 너무 적으면 설정값을 쓴다

  // 가장 활동이 몰린 4시간 구간을 찾아 라벨로
  let best = 0;
  let bestSum = -1;
  for (let s = 0; s < 24; s++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += hours[(s + k) % 24];
    if (sum > bestSum) { bestSum = sum; best = s; }
  }
  const pad = (n) => String(n).padStart(2, "0");
  return { hours, value: `${pad(best)}:00 – ${pad((best + 4) % 24)}:00`, foot: `Last ${found} events` };
}

// ─────────────────────────────────────────── 렌더 조각

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function label(x, text, t) {
  return `<text x="${x}" y="12" font-family="${MONO}" font-size="9" letter-spacing="1.8" fill="${t.dim}">${esc(text.toUpperCase())}</text>`;
}
function value(x, text, t, sub) {
  const main = `<text x="${x}" y="36" font-family="${SANS}" font-size="17" font-weight="400" fill="${t.fg}">${esc(text)}`;
  const tail = sub ? `<tspan font-size="13" fill="${t.muted}"> ${esc(sub)}</tspan>` : "";
  return `${main}${tail}</text>`;
}
function foot(x, text, t) {
  return `<text x="${x}" y="82" font-family="${MONO}" font-size="10" fill="${t.dim}">${esc(text)}</text>`;
}
function rule(x, t) {
  return `<line x1="${x}" y1="2" x2="${x}" y2="86" stroke="${t.line}" stroke-width="1"/>`;
}

function progressBar(x, pct, t) {
  const y = BASELINE - 3;
  return (
    `<rect x="${x}" y="${y}" width="${CW}" height="3" rx="1.5" fill="${t.track}"/>` +
    `<rect x="${x}" y="${y}" width="${(CW * Math.max(0, Math.min(100, pct))) / 100}" height="3" rx="1.5" fill="${t.accent}"/>`
  );
}

function spark(x, hours, t) {
  const peak = Math.max(1, ...hours);
  const slot = CW / hours.length;
  const bw = slot - 1.6;
  return hours
    .map((v, i) => {
      const h = Math.max(2, (v / peak) * 22);
      const hot = v >= peak * 0.7;
      return `<rect x="${(x + i * slot).toFixed(2)}" y="${(BASELINE - h).toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" rx="1" fill="${hot ? t.accent : t.steps[0]}"/>`;
    })
    .join("");
}

function stack(x, langs, t) {
  const y = BASELINE - 3;
  let cx = x;
  return langs
    .map((l, i) => {
      const w = Math.max(0, (CW * l.pct) / 100 - 1);
      const fill = i === 0 ? t.accent : t.steps[Math.min(i - 1, t.steps.length - 1)];
      const seg = `<rect x="${cx.toFixed(2)}" y="${y}" width="${w.toFixed(2)}" height="3" rx="1.5" fill="${fill}"/>`;
      cx += w + 1;
      return seg;
    })
    .join("");
}

function renderSVG(data, themeName) {
  const t = THEMES[themeName];
  const x = [0, CW + SEP, (CW + SEP) * 2];
  const langs = data.languages.length ? data.languages : [{ name: "—", pct: 100 }];
  const langFoot = langs
    .slice(1)
    .map((l) => `${l.name} ${l.pct}`)
    .join(" · ");

  const parts = [
    // 1 — Hack The Box
    label(x[0], "Hack The Box", t),
    value(x[0], data.hackthebox.rank, t),
    progressBar(x[0], data.hackthebox.progress, t),
    foot(x[0], data.hackthebox.foot, t),

    rule(x[1] - SEP / 2, t),

    // 2 — 커밋 리듬
    label(x[1], "Commit rhythm", t),
    value(x[1], data.rhythm.value, t),
    spark(x[1], data.rhythm.hours, t),
    foot(x[1], data.rhythm.foot, t),

    rule(x[2] - SEP / 2, t),

    // 3 — 언어 분포
    label(x[2], "Languages", t),
    value(x[2], langs[0].name, t, `${langs[0].pct}%`),
    stack(x[2], langs, t),
    foot(x[2], langFoot || "—", t),
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="지표 요약">
${parts.join("\n")}
</svg>
`;
}

// ─────────────────────────────────────────── 실행

async function main() {
  const cfg = JSON.parse(await readFile(CONFIG, "utf8"));
  const login = process.env.LOGIN || cfg.login;
  const token = process.env.GITHUB_TOKEN;

  const data = {
    hackthebox: cfg.hackthebox,
    rhythm: cfg.rhythm,
    languages: cfg.languages || [],
  };

  if (!DEMO && token) {
    try {
      const langs = await fetchLanguages(login, token);
      if (langs.length) data.languages = langs;
    } catch (err) {
      console.warn(`언어 집계 실패, 설정값 사용: ${err.message}`);
    }

    try {
      const rhythm = await fetchRhythm(login, token);
      if (rhythm) data.rhythm = rhythm;
    } catch (err) {
      console.warn(`리듬 집계 실패, 설정값 사용: ${err.message}`);
    }
  } else if (!DEMO) {
    console.warn("GITHUB_TOKEN이 없어 설정 파일 값만 사용합니다.");
  }

  await mkdir(OUT_DIR, { recursive: true });
  for (const name of Object.keys(THEMES)) {
    const file = join(OUT_DIR, `stats-${name}.svg`);
    await writeFile(file, renderSVG(data, name), "utf8");
    console.log(`${file} 생성`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});