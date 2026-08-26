#!/usr/bin/env node
/**
 * 프로필 상단 블록 → SVG (hero + index)
 *
 * 한글 폰트를 실제로 쓴 글자만 서브셋해서 SVG 안에 박아 넣는다.
 * 그래서 보는 사람 환경과 무관하게 항상 같은 타이포로 렌더된다.
 *
 *   node scripts/render-profile.mjs
 *
 * 필요: npm install pretendard subset-font
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import subsetFont from "subset-font";

const OUT_DIR = process.env.OUT_DIR || "assets";
const FONT_DIR = "node_modules/pretendard/dist/web/static/woff2";

// ─────────────────────────────────────────── 내용
// 여기만 고치면 된다

const DATA = {
  name: "이진규",
  handle: "Jggyu",
  sub: "전북대학교 IT정보공학과 · BoB 14기 보안컨설팅 · 정보보안기사",
  now: "모의침투 정찰 단계를 자동화하는 도구를 만들고 있습니다.",

  sections: [
    {
      label: "Projects",
      // [연도, 제목, 우측 메타, 초록 점 여부]
      rows: [
        ["2026", "모의침투 정찰 자동화 도구", "진행 중", true],
        ["2026", "CUITrail — 방산 공급망 컴플라이언스", "국방기술품질원장상"],
        ["2025", "LLM 소스코드 보안 진단 파이프라인", "토큰 40% 절감 · 온프레미스 배포"],
        ["2024", "JFlow — 멀티테넌트 CI/CD 플랫폼", "학과 실서비스 운영 중", true],
        ["2024", "교내 웹 서비스 모의해킹", ""],
        ["2024", "TrendCore — 커머스 웹서비스", ""],
      ],
    },
    {
      label: "Writing",
      rows: [
        ["2025", "MCP 활용 토큰 효율화 기법", "한국정보통신학회 학생우수논문상"],
        ["2025", "로컬 LLM 취약점 분석 비교 연구", "한국융합보안학회 KISA원장상"],
      ],
    },
    {
      label: "Background",
      rows: [
        ["2025", "Best of the Best 14기 — 보안컨설팅 트랙", ""],
        ["2024", "WhiteHat School 2기", ""],
        ["", "정보보안기사 · CPPG · 네트워크관리사 2급 · AWS AI Practitioner", ""],
        ["", "총장상(우수졸업생) 외 수상 7건", ""],
      ],
    },
    {
      label: "Tools",
      rows: [["", "Python · FastAPI · React · Docker · Kubernetes · Burp Suite · Semgrep", ""]],
    },
  ],
};

// ─────────────────────────────────────────── 디자인 토큰

const W = 900;

const THEMES = {
  dark: {
    fg: "#E6EDF3",
    body: "#ADBAC7",
    muted: "#7D8590",
    dim: "#4E5661",
    line: "#21262D",
    accent: "#3FB950",
  },
  light: {
    fg: "#111418",
    body: "#3D444D",
    muted: "#59636E",
    dim: "#909AA4",
    line: "#D1D9E0",
    accent: "#1A7F37",
  },
};

const COL_YEAR = 0;
const COL_TITLE = 56;
const ROW_H = 27;
const LABEL_GAP = 26;
const SECTION_GAP = 40;

// ─────────────────────────────────────────── 폰트 서브셋

/** SVG에 들어갈 모든 글자를 모은다 */
function usedChars() {
  const bits = [DATA.name, DATA.handle, DATA.sub, DATA.now];
  for (const s of DATA.sections) {
    bits.push(s.label, s.label.toUpperCase());
    for (const [year, title, meta] of s.rows) bits.push(year, title, meta);
  }
  return [...new Set(bits.join("").split(""))].join("");
}

async function subset(weight, chars) {
  const src = join(FONT_DIR, `Pretendard-${weight}.woff2`);
  const buf = await readFile(src);
  const out = await subsetFont(buf, chars, { targetFormat: "woff2" });
  return out.toString("base64");
}

function fontFace(family, weight, b64) {
  return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
}

// ─────────────────────────────────────────── 렌더

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FF = "'Pretendard P','Pretendard',-apple-system,BlinkMacSystemFont,sans-serif";

function svgWrap(width, height, fonts, body, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">
<defs><style>
${fonts}
text{font-family:${FF};dominant-baseline:auto}
.fade{animation:f .7s ease both}
@keyframes f{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.fade{animation:none}}
</style></defs>
${body}
</svg>
`;
}

function renderHero(theme, fonts) {
  const t = THEMES[theme];
  const H = 190;

  const body = `
<g class="fade">
  <text x="0" y="76" font-size="66" font-weight="600" letter-spacing="-3.2" fill="${t.fg}">${esc(DATA.name)}<tspan dx="20" font-size="15" font-weight="400" letter-spacing="1.6" fill="${t.dim}">${esc(DATA.handle)}</tspan></text>
</g>
<g class="fade" style="animation-delay:.1s">
  <text x="2" y="110" font-size="15" font-weight="400" fill="${t.muted}">${esc(DATA.sub)}</text>
</g>
<g class="fade" style="animation-delay:.2s">
  <circle cx="6" cy="151" r="4.5" fill="${t.accent}"/>
  <text x="24" y="157" font-size="21" font-weight="400" letter-spacing="-0.5" fill="${t.fg}">${esc(DATA.now)}</text>
</g>
<line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" stroke="${t.line}" stroke-width="1"/>`;

  return svgWrap(W, H, fonts, body, `${DATA.name} — ${DATA.now}`);
}

function renderIndex(theme, fonts) {
  const t = THEMES[theme];
  const parts = [];
  let y = 18;
  let i = 0;

  for (const [si, section] of DATA.sections.entries()) {
    parts.push(
      `<text x="0" y="${y}" font-size="10" font-weight="600" letter-spacing="3.4" fill="${t.dim}">${esc(
        section.label.toUpperCase()
      )}</text>`
    );
    y += LABEL_GAP;

    for (const [year, title, meta, live] of section.rows) {
      const delay = (i++ * 45) / 1000;
      const row = [];

      if (year) {
        row.push(
          `<text x="${COL_YEAR}" y="${y}" font-size="12.5" font-weight="400" letter-spacing="0.3" fill="${t.dim}">${esc(year)}</text>`
        );
      }
      row.push(
        `<text x="${COL_TITLE}" y="${y}" font-size="15.5" font-weight="400" letter-spacing="-0.25" fill="${
          year ? t.fg : t.body
        }">${esc(title)}</text>`
      );
      if (meta) {
        const dot = live ? `<circle cx="${W - 8}" cy="${y - 5}" r="3.5" fill="${t.accent}"/>` : "";
        const mx = live ? W - 20 : W;
        row.push(
          `${dot}<text x="${mx}" y="${y}" text-anchor="end" font-size="12.5" font-weight="400" fill="${
            live ? t.accent : t.muted
          }">${esc(meta)}</text>`
        );
      }

      parts.push(`<g class="fade" style="animation-delay:${delay}s">${row.join("")}</g>`);
      y += ROW_H;
    }

    if (si < DATA.sections.length - 1) y += SECTION_GAP - ROW_H + 12;
  }

  const H = y - ROW_H + 14;
  return svgWrap(W, H, fonts, parts.join("\n"), "프로젝트 · 논문 · 이력 목록");
}

// ─────────────────────────────────────────── 실행

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const chars = usedChars();
  const [regular, semibold] = await Promise.all([
    subset("Regular", chars),
    subset("SemiBold", chars),
  ]);

  const fonts =
    fontFace("Pretendard", 400, regular) + "\n" + fontFace("Pretendard", 600, semibold);

  const kb = Math.round(((regular.length + semibold.length) * 0.75) / 1024);
  console.log(`글자 ${chars.length}자 서브셋 · 폰트 ${kb}KB`);

  for (const theme of Object.keys(THEMES)) {
    await writeFile(join(OUT_DIR, `hero-${theme}.svg`), renderHero(theme, fonts), "utf8");
    await writeFile(join(OUT_DIR, `index-${theme}.svg`), renderIndex(theme, fonts), "utf8");
    console.log(`${OUT_DIR}/hero-${theme}.svg, index-${theme}.svg 생성`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});