import React, { useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip as RTooltip,
  ResponsiveContainer, Cell, ReferenceLine, CartesianGrid, BarChart,
} from "recharts";

/* ============================================================
   감자마켓 출점 상권 진단 — 단일 파일 React 앱
   - 계산 엔진(calc)은 스펙 Section 3·4를 그대로 구현 (TC1~TC4 검증 완료)
   - 정책 수치는 전부 DEFAULT_CONFIG 한 곳에만 존재
   - ⚠ Claude.ai 아티팩트는 localStorage 미지원 → 관리자 설정은
     세션 내 메모리 유지. 자체 Vite 배포 시 아래 [PERSIST] 주석
     두 곳에 localStorage 코드를 넣으면 스펙 그대로 영속화됨.
   ============================================================ */

const BRAND = { navy: "#1F3864", pos: "#1E7A46", neg: "#C00000", accent: "#F2B705", canvas: "#F3F4F6" };

const DEFAULT_CONFIG = {
  minArea: 9, minHH: 1500,
  criteria: [
    { name: "배후 세대 규모 (도보 10분 내 아파트 세대수)", weight: 25, g1: "1,500~2,500세대", g3: "3,000~5,000세대", g5: "7,000세대 이상" },
    { name: "단지 구매력 (전세가·매매가 수준)", weight: 15, g1: "지역 평균 대비 하위", g3: "지역 평균 수준", g5: "지역 평균 대비 상위" },
    { name: "경쟁 강도 (반경 1km 공구마켓·식자재할인점)", weight: 15, g1: "동종 2개 이상", g3: "동종 1개 또는 할인점 다수", g5: "동종 없음" },
    { name: "임대 조건 (평당 월세)", weight: 15, g1: "평당 13만원 초과", g3: "평당 10만원 내외", g5: "평당 7만원 이하" },
    { name: "생활동선·픽업 접근성", weight: 10, g1: "단지 이면·접근 불편", g3: "단지 인근 도보권", g5: "단지 출입구 정면" },
    { name: "커뮤니티 잠재력 (맘카페·오픈채팅 활성도)", weight: 10, g1: "커뮤니티 없음", g3: "맘카페 저활성", g5: "활성 맘카페·기존 공구방" },
    { name: "상가 공실·권리금 여건", weight: 10, g1: "권리금 과다", g3: "권리금 소액", g5: "무권리·렌트프리 가능" },
  ],
  grades: [
    { min: 0, label: "보류", joinRate: 0.05, rec: "출점 보류 — 후보지 제외 또는 무점포 셀러만 검토" },
    { min: 50, label: "C", joinRate: 0.07, rec: "조건부 출점 — 임대조건 재협상·렌트프리 확보 필수" },
    { min: 65, label: "B", joinRate: 0.09, rec: "출점 권장 — 표준 매장형" },
    { min: 80, label: "A", joinRate: 0.11, rec: "적극 출점 — 우선 배정·광고 집중 상권" },
  ],
  conv: 0.35, freq: 2.5, aov: 25000, margin: 0.25, gmallRate: 0.03, feeRate: 0.025,
  pyeong: {
    "10": { cap: 25000000, stdRent: 1000000, interior: 15000000, equipment: 8000000, util: 300000, fridge: 2 },
    "15": { cap: 35000000, stdRent: 1500000, interior: 22500000, equipment: 11000000, util: 400000, fridge: 3 },
    "20": { cap: 45000000, stdRent: 2000000, interior: 30000000, equipment: 14000000, util: 500000, fridge: 5 },
  },
  franchise: 5000000, initial: 3000000, reserve: 3000000, misc: 200000,
  ramp: [0.35, 0.5, 0.65, 0.75, 0.85, 0.9, 0.95, 1, 1, 1, 1, 1],
  scenario: { con: { join: 0.8, aov: 0.9 }, base: { join: 1, aov: 1 }, opt: { join: 1.2, aov: 1.1 } },
  comparableStores: [],
  hq: { currentStores: 30, purchasePerStore: 14000000, realMargin: 0.07, sgna: 50000000, openingProfit: 8500000, monthlyOpenings: 3 },
};
const deepClone = (o) => JSON.parse(JSON.stringify(o));

/* ---------------- 계산 엔진 (스펙 Section 3·4 그대로) ---------------- */
function hardFilter(inp, cfg) {
  if (inp.area < cfg.minArea) return { pass: false, reason: "전용면적 9평 미만 (냉장고 2대 배치 불가)" };
  if (inp.hh < cfg.minHH) return { pass: false, reason: `배후 세대수 ${cfg.minHH.toLocaleString("ko-KR")}세대 미만` };
  return { pass: true, reason: "" };
}
function scoreAndGrade(scores, cfg) {
  const weighted = cfg.criteria.map((c, i) => (c.weight * scores[i]) / 5);
  const totalScore = weighted.reduce((a, b) => a + b, 0);
  let grade = cfg.grades[0];
  for (const g of cfg.grades) if (totalScore >= g.min) grade = g;
  return { weighted, totalScore, gradeObj: grade, joinRate: grade.joinRate };
}
const pyeongKey = (area) => (area <= 12.5 ? "10" : area <= 17.5 ? "15" : "20");

function compute(inp, cfg) {
  const { hh, area, rent, scores } = inp;
  const labor = inp.labor ?? 0;
  const misc = inp.misc ?? cfg.misc;
  const filter = hardFilter(inp, cfg);
  const sg = scoreAndGrade(scores, cfg);
  const joinRate = sg.joinRate;

  // 3-3 수요·캐파
  const demand = hh * joinRate * cfg.conv * cfg.freq * cfg.aov;
  const pKey = pyeongKey(area);
  const P = cfg.pyeong[pKey];
  const cap = P.cap;
  const offRev = Math.min(demand, cap);
  const capMsg = demand > cap ? "수요가 캐파 초과 — 상위 평형 검토" : "캐파 여유";
  const gmall = offRev * cfg.gmallRate;
  const totRev = offRev + gmall;
  const joinedHH = hh * joinRate;
  const buyers = joinedHH * cfg.conv;

  // 3-4 월 손익
  const gp = offRev * cfg.margin + gmall;
  const fee = offRev * cfg.feeRate;
  const util = P.util;
  const op = gp - fee - rent - util - labor - misc;
  const denom = cfg.margin + cfg.gmallRate - cfg.feeRate;
  const bep = denom > 0 ? (rent + util + labor + misc) / denom : Infinity;
  const safety = totRev > 0 ? (totRev - bep) / totRev : 0;

  // 3-5 투자·회수
  const invest = cfg.franchise + P.interior + P.equipment + cfg.initial + cfg.reserve;
  const payback = op > 0 ? invest / op : null;

  // 3-6 램프업
  const gpRatio = totRev > 0 ? gp / totRev : 0;
  const offShare = totRev > 0 ? offRev / totRev : 0;
  let cum = 0, breakEvenMonth = null;
  const ramp = cfg.ramp.map((r, i) => {
    const rev_m = totRev * r;
    const op_m = rev_m * gpRatio - ((rent + util + labor + misc) + rev_m * cfg.feeRate * offShare);
    cum += op_m;
    if (breakEvenMonth === null && cum > 0) breakEvenMonth = i + 1;
    return { month: `${i + 1}월차`, m: i + 1, rev: rev_m, op: Math.round(op_m), cum: Math.round(cum) };
  });

  // 3-7 평형 비교 (표준 임대료 기준 — 동일 조건 포맷 비교)
  const pyeongCompare = ["10", "15", "20"].map((k) => {
    const c = cfg.pyeong[k];
    const offRev_p = Math.min(demand, c.cap);
    const op_p = offRev_p * (cfg.margin + cfg.gmallRate) - (c.stdRent + c.util + offRev_p * cfg.feeRate + misc);
    const invest_p = cfg.franchise + c.interior + c.equipment + cfg.initial + cfg.reserve;
    return {
      key: k, cap: c.cap, offRev: offRev_p, stdRent: c.stdRent, op: op_p, invest: invest_p,
      payback: op_p > 0 ? invest_p / op_p : null,
      diag: demand >= c.cap ? "수요가 캐파 초과 — 이 평형으로는 매출 손실" : "수요 수용 가능",
    };
  });
  let recommendedPyeong = null, best = 0;
  for (const p of pyeongCompare) if (p.op > 0 && p.op > best) { best = p.op; recommendedPyeong = p.key; }

  // 3-8 시나리오
  const scenarios = ["con", "base", "opt"].map((k) => {
    const s = cfg.scenario[k];
    const offRev_s = Math.min(demand * s.join * s.aov, cap);
    const op_s = offRev_s * (cfg.margin + cfg.gmallRate) - ((rent + util + labor + misc) + offRev_s * cfg.feeRate);
    return {
      key: k, label: k === "con" ? "보수" : k === "base" ? "기준" : "낙관", coef: s,
      offRev: offRev_s, op: op_s, payback: op_s > 0 ? invest / op_s : null,
    };
  });

  return {
    filter, ...sg, joinRate, demand, pKey, cap, offRev, capMsg, gmall, totRev, joinedHH, buyers,
    gp, fee, util, labor, misc, op, bep, safety, invest, payback, ramp, breakEvenMonth,
    pyeongCompare, recommendedPyeong, scenarios,
    gradeLabel: filter.pass ? sg.gradeObj.label : "출점 불가",
    rec: filter.pass ? sg.gradeObj.rec : "즉시 탈락 조건 미충족 — 다른 매물 검토",
  };
}

function computeHQ(h) {
  const logisticsProfit0 = h.currentStores * h.purchasePerStore * h.realMargin;
  const zeroOpeningPL = logisticsProfit0 - h.sgna;
  const bepOpenings = Math.ceil((h.sgna - logisticsProfit0) / h.openingProfit);
  const selfSustainStores = Math.ceil(h.sgna / (h.purchasePerStore * h.realMargin));
  let selfSustainMonth = null;
  const months = Array.from({ length: 12 }, (_, i) => {
    const cumStores = h.currentStores + h.monthlyOpenings * (i + 1);
    const pl = cumStores * h.purchasePerStore * h.realMargin + h.monthlyOpenings * h.openingProfit - h.sgna;
    if (selfSustainMonth === null && cumStores >= selfSustainStores) selfSustainMonth = i + 1;
    return { month: `${i + 1}월차`, m: i + 1, cumStores, pl: Math.round(pl) };
  });
  return { logisticsProfit0, zeroOpeningPL, bepOpenings, selfSustainStores, selfSustainMonth, months };
}

/* ---------------- 포맷 유틸 ---------------- */
const won = (n) => (n == null || !isFinite(n) ? "—" : Math.round(n).toLocaleString("ko-KR") + "원");
const pct = (n) => (n * 100).toFixed(1) + "%";
const mon = (n) => (n == null ? "회수 불가" : n.toFixed(1) + "개월");
const num = (n) => Math.round(n).toLocaleString("ko-KR");

/* ---------------- 공통 소품 ---------------- */
function Card({ title, basis, children, wide, style, badge }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm p-5 ${wide ? "col-span-full" : ""}`} style={style}>
      {title && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-base" style={{ color: BRAND.navy }}>{title}</h3>
          {badge}
        </div>
      )}
      {children}
      {basis && <p className="mt-3 text-xs text-gray-500 border-t border-gray-100 pt-2">근거: {basis}</p>}
    </div>
  );
}

function Gauge({ score, grades }) {
  const R = 80, CX = 100, CY = 95;
  const angle = (v) => Math.PI * (1 - v / 100);
  const pt = (v, r = R) => [CX + r * Math.cos(angle(v)), CY - r * Math.sin(angle(v))];
  const [ex, ey] = pt(Math.max(0, Math.min(100, score)));
  const arc = (from, to, color, w) => {
    const [x1, y1] = pt(from); const [x2, y2] = pt(to);
    return <path d={`M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" />;
  };
  return (
    <svg viewBox="0 0 200 110" className="w-48">
      {arc(0, 100, "#E5E7EB", 12)}
      {score > 0 && arc(0, Math.min(score, 100), BRAND.navy, 12)}
      {grades.filter((g) => g.min > 0).map((g) => {
        const [tx1, ty1] = pt(g.min, R - 9); const [tx2, ty2] = pt(g.min, R + 9);
        const [lx, ly] = pt(g.min, R + 18);
        return (
          <g key={g.min}>
            <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke={BRAND.accent} strokeWidth="2" />
            <text x={lx} y={ly} fontSize="8" fill="#6B7280" textAnchor="middle">{g.min}</text>
          </g>
        );
      })}
      <circle cx={ex} cy={ey} r="5" fill={BRAND.accent} stroke="#fff" strokeWidth="2" />
      <text x={CX} y={CY - 18} textAnchor="middle" fontSize="26" fontWeight="800" fill={BRAND.navy}>{score.toFixed(1)}</text>
      <text x={CX} y={CY - 2} textAnchor="middle" fontSize="9" fill="#6B7280">총점 / 100</text>
    </svg>
  );
}

function ScoreButtons({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((v) => (
        <button key={v} onClick={() => onChange(v)}
          className="flex-1 py-1.5 rounded-md text-sm font-semibold border transition-colors"
          style={value === v
            ? { background: BRAND.navy, color: "#fff", borderColor: BRAND.navy }
            : { background: "#fff", color: "#374151", borderColor: "#D1D5DB" }}>
          {v}
        </button>
      ))}
    </div>
  );
}

function InfoTip({ c }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button onClick={() => setOpen(!open)} onBlur={() => setOpen(false)}
        className="w-4 h-4 rounded-full text-[10px] leading-4 font-bold ml-1 align-middle"
        style={{ background: "#E5E7EB", color: BRAND.navy }} aria-label="채점 기준">ⓘ</button>
      {open && (
        <span className="absolute z-30 left-0 top-5 w-56 bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-xs text-gray-700 space-y-1">
          <span className="block"><b>1점</b> {c.g1}</span>
          <span className="block"><b>3점</b> {c.g3}</span>
          <span className="block"><b>5점</b> {c.g5}</span>
        </span>
      )}
    </span>
  );
}

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2";
function NumField({ label, value, onChange, suffix }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-600 text-xs font-medium">{label}</span>
      <div className="relative mt-1">
        <input type="number" className={inputCls} style={{ borderColor: undefined }}
          value={value} onChange={(e) => onChange(e.target.value)} />
        {suffix && <span className="absolute right-3 top-2 text-xs text-gray-400">{suffix}</span>}
      </div>
    </label>
  );
}

/* ---------------- 메인 앱 ---------------- */
export default function App() {
  // [PERSIST] Vite 배포 시: useState(() => JSON.parse(localStorage.getItem("gamjaConfig")) ?? deepClone(DEFAULT_CONFIG))
  const [config, setConfig] = useState(() => deepClone(DEFAULT_CONFIG));
  const [raw, setRaw] = useState({ name: "", hh: "4500", area: "10", rent: "1000000", deposit: "10000000", premium: "0", labor: "0", misc: "200000" });
  const [scores, setScores] = useState([3, 3, 3, 3, 3, 3, 3]);
  const [memos, setMemos] = useState(["", "", "", "", "", "", ""]);
  const [meta, setMeta] = useState({ date: new Date().toISOString().slice(0, 10), manager: "" });
  const [panelOpen, setPanelOpen] = useState(true);
  const [adminOpen, setAdminOpen] = useState(false);
  const [hqOpen, setHqOpen] = useState(false);

  const n = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
  const inp = {
    name: raw.name, hh: n(raw.hh), area: n(raw.area), rent: n(raw.rent),
    deposit: n(raw.deposit), premium: n(raw.premium), labor: n(raw.labor), misc: n(raw.misc), scores,
  };
  const r = useMemo(() => compute(inp, config), [JSON.stringify(inp), JSON.stringify(config)]);
  const hq = useMemo(() => computeHQ(config.hq), [JSON.stringify(config.hq)]);
  const comps = useMemo(
    () => (config.comparableStores || []).filter((s) => inp.hh > 0 && Math.abs(s.households - inp.hh) / inp.hh <= 0.3),
    [JSON.stringify(config.comparableStores), inp.hh]
  );
  const fail = !r.filter.pass;
  const opColor = (v) => (v >= 0 ? BRAND.pos : BRAND.neg);

  return (
    <div style={{ background: BRAND.canvas, minHeight: "100vh", fontFamily: "'Pretendard','Noto Sans KR',system-ui,sans-serif" }}>
      <style>{`
        @media print {
          .screen-ui { display: none !important; }
          #print-report { display: block !important; }
          @page { size: A4 portrait; margin: 10mm; }
          body { background: #fff !important; }
        }
        #print-report { display: none; }
        .watermark::before {
          content: "탈락 매물 — 참고용 계산   탈락 매물 — 참고용 계산   탈락 매물 — 참고용 계산";
          position: absolute; inset: -20%; z-index: 10; pointer-events: none;
          display: flex; align-items: center; justify-content: center;
          transform: rotate(-24deg); font-size: 34px; font-weight: 800;
          color: rgba(192,0,0,0.08); white-space: pre-wrap; text-align: center; line-height: 3.2;
        }
      `}</style>

      {/* ===== 화면 UI ===== */}
      <div className="screen-ui">
        {/* 상단바 */}
        <header className="sticky top-0 z-40 flex items-center justify-between px-5 py-3 shadow-sm" style={{ background: BRAND.navy }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setPanelOpen(!panelOpen)} className="lg:hidden text-white text-xl" aria-label="입력 패널 열기/닫기">☰</button>
            <span className="text-white font-extrabold text-lg tracking-tight">감자마켓 출점 상권 진단</span>
            <span className="hidden md:inline text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: BRAND.accent, color: BRAND.navy }}>상담용</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="text-sm font-semibold px-3 py-1.5 rounded-lg" style={{ background: "#fff", color: BRAND.navy }}>인쇄 리포트</button>
            <button onClick={() => setAdminOpen(true)} className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-white/40 text-white">관리자 설정</button>
          </div>
        </header>

        <div className="flex">
          {/* ---- 좌측 입력 패널 ---- */}
          {panelOpen && (
            <aside className="w-[360px] shrink-0 bg-white border-r border-gray-200 p-4 space-y-5 max-h-[calc(100vh-56px)] overflow-y-auto sticky top-[56px]">
              <section>
                <h2 className="font-bold text-sm mb-2" style={{ color: BRAND.navy }}>후보지 정보</h2>
                <div className="space-y-2">
                  <label className="block text-sm">
                    <span className="text-gray-600 text-xs font-medium">후보지명</span>
                    <input className={inputCls + " mt-1"} value={raw.name} onChange={(e) => setRaw({ ...raw, name: e.target.value })} placeholder="예: OO아파트 상가 102호" />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="배후 세대수" value={raw.hh} onChange={(v) => setRaw({ ...raw, hh: v })} suffix="세대" />
                    <NumField label="전용면적(평)" value={raw.area} onChange={(v) => setRaw({ ...raw, area: v })} suffix="평" />
                  </div>
                  <NumField label="월 임대료(원)" value={raw.rent} onChange={(v) => setRaw({ ...raw, rent: v })} suffix="원" />
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="보증금(원)" value={raw.deposit} onChange={(v) => setRaw({ ...raw, deposit: v })} suffix="원" />
                    <NumField label="권리금(원)" value={raw.premium} onChange={(v) => setRaw({ ...raw, premium: v })} suffix="원" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="월 인건비(원)" value={raw.labor} onChange={(v) => setRaw({ ...raw, labor: v })} suffix="원" />
                    <NumField label="월 기타비용(원)" value={raw.misc} onChange={(v) => setRaw({ ...raw, misc: v })} suffix="원" />
                  </div>
                </div>
              </section>

              <section>
                <h2 className="font-bold text-sm mb-2" style={{ color: BRAND.navy }}>상권 평가 (1~5점)</h2>
                <div className="space-y-3">
                  {config.criteria.map((c, i) => (
                    <div key={i} className="border border-gray-100 rounded-xl p-2.5 bg-gray-50/60">
                      <div className="text-xs font-semibold text-gray-700 mb-1.5">
                        {c.name} <span className="text-gray-400">({c.weight}%)</span><InfoTip c={c} />
                      </div>
                      <ScoreButtons value={scores[i]} onChange={(v) => setScores(scores.map((s, j) => (j === i ? v : s)))} />
                      <input className="mt-1.5 w-full border border-gray-200 rounded-md px-2 py-1 text-xs" placeholder="평가 근거 (선택)"
                        value={memos[i]} onChange={(e) => setMemos(memos.map((m, j) => (j === i ? e.target.value : m)))} />
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="font-bold text-sm mb-2" style={{ color: BRAND.navy }}>상담 정보</h2>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-sm">
                    <span className="text-gray-600 text-xs font-medium">상담일</span>
                    <input type="date" className={inputCls + " mt-1"} value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-gray-600 text-xs font-medium">담당자명</span>
                    <input className={inputCls + " mt-1"} value={meta.manager} onChange={(e) => setMeta({ ...meta, manager: e.target.value })} />
                  </label>
                </div>
              </section>
            </aside>
          )}

          {/* ---- 우측 대시보드 ---- */}
          <main className={`flex-1 p-4 md:p-6 relative ${fail ? "watermark" : ""}`}>
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 max-w-[1200px] mx-auto">

              {/* 판정 헤더 */}
              <Card wide>
                <div className="flex flex-wrap items-center gap-6">
                  <div>
                    <span className="inline-block px-4 py-1.5 rounded-full text-white font-bold text-sm"
                      style={{ background: fail ? BRAND.neg : BRAND.pos }}>
                      {fail ? "출점 불가" : "통과"}
                    </span>
                    {fail && <p className="mt-2 text-sm font-semibold" style={{ color: BRAND.neg }}>{r.filter.reason}</p>}
                    {!fail && <p className="mt-2 text-xs text-gray-500">하드필터: 전용 {config.minArea}평 이상 · 배후 {config.minHH.toLocaleString()}세대 이상 충족</p>}
                  </div>
                  <Gauge score={r.totalScore} grades={config.grades} />
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-extrabold"
                      style={{ background: BRAND.accent, color: BRAND.navy }}>
                      {fail ? "✕" : r.gradeLabel}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">등급</div>
                  </div>
                  <div className="flex-1 min-w-[220px]">
                    <p className="font-bold" style={{ color: BRAND.navy }}>{r.rec}</p>
                    <p className="text-xs text-gray-500 mt-1">가입률 가정: 등급 {fail ? "—" : r.gradeLabel} → {pct(r.joinRate)} (등급별 정책값)</p>
                  </div>
                </div>
              </Card>

              {/* KPI 4카드 */}
              {[
                { t: "월 총매출", v: won(r.totRev), c: BRAND.navy, b: "오프라인 적용 매출 + 감자몰 연계 매출(오프라인×" + pct(config.gmallRate) + ")" },
                { t: "월 영업이익", v: won(r.op), c: opColor(r.op), b: "매출총이익 − 본사수수료 − 임대료·공과금·인건비·기타 (안정화 월 기준)" },
                { t: "손익분기 월매출", v: won(r.bep), c: BRAND.navy, sub: `안전마진 ${pct(r.safety)}`, b: "고정비 ÷ 공헌이익률(" + pct(config.margin + config.gmallRate - config.feeRate) + ")" },
                { t: "투자 회수기간", v: r.payback == null ? "회수 불가" : mon(r.payback), c: r.payback == null ? BRAND.neg : BRAND.navy, b: "총 투자비 ÷ 월 영업이익 (보증금·권리금은 회수성 자산으로 제외)" },
              ].map((k, i) => (
                <div key={i} className="bg-white rounded-2xl shadow-sm p-4">
                  <div className="text-xs text-gray-500 font-medium">{k.t}</div>
                  <div className="mt-1 font-extrabold" style={{ color: k.c, fontSize: 28, lineHeight: 1.15 }}>{k.v}</div>
                  {k.sub && <div className="text-xs font-semibold mt-0.5" style={{ color: r.safety >= 0 ? BRAND.pos : BRAND.neg }}>{k.sub}</div>}
                  <div className="text-[11px] text-gray-400 mt-2">{i === 0 ? "수요·캐파 중 작은 값 기준" : k.b}</div>
                </div>
              ))}

              {/* 매출 근거 퍼널 */}
              <Card wide title="매출 산출 근거 퍼널" basis={`가입률 ${pct(r.joinRate)}(등급 연동) × 전환율 ${pct(config.conv)} × 월 ${config.freq}회 × 객단가 ${won(config.aov)} — 수요와 평형 캐파(MIN) 중 작은 값을 매출로 적용`}>
                <div className="flex flex-wrap items-stretch gap-1.5 text-center text-xs">
                  {[
                    { l: "배후 세대수", v: num(inp.hh) + "세대" },
                    { op: `×가입률 ${pct(r.joinRate)}` },
                    { l: "가입 세대", v: num(r.joinedHH) + "세대" },
                    { op: `×전환율 ${pct(config.conv)}` },
                    { l: "월 구매고객", v: num(r.buyers) + "명" },
                    { op: `×${config.freq}회 ×${won(config.aov)}` },
                    { l: "수요 매출", v: won(r.demand) },
                    { op: `MIN(캐파 ${won(r.cap)})` },
                    { l: "적용 매출", v: won(r.offRev), hi: true },
                  ].map((s, i) =>
                    s.op ? (
                      <div key={i} className="flex items-center px-1 text-gray-400 font-medium self-center">→<span className="ml-1">{s.op}</span>→</div>
                    ) : (
                      <div key={i} className="flex-1 min-w-[90px] rounded-xl p-2.5 border"
                        style={s.hi ? { background: BRAND.navy, color: "#fff", borderColor: BRAND.navy } : { background: "#F9FAFB", borderColor: "#E5E7EB" }}>
                        <div className={s.hi ? "text-white/70" : "text-gray-500"}>{s.l}</div>
                        <div className="font-bold text-sm mt-0.5">{s.v}</div>
                      </div>
                    )
                  )}
                </div>
                <p className="mt-3 text-sm font-semibold" style={{ color: r.demand > r.cap ? BRAND.neg : BRAND.pos }}>
                  {r.capMsg} <span className="text-gray-400 font-normal text-xs">(선택 평형 {r.pKey}평 · 캐파 {won(r.cap)})</span>
                </p>
              </Card>

              {/* 12개월 램프업 */}
              <Card wide title="12개월 램프업 손익" basis={`램프업 계수 ${config.ramp.map((x) => x * 100 + "%").slice(0, 4).join("·")}… 적용, 고정비(임대·공과금·인건비·기타)는 1월차부터 전액 발생`}
                badge={r.breakEvenMonth && <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: "#EAF5EE", color: BRAND.pos }}>누적 흑자 전환: {r.breakEvenMonth}월차</span>}>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={r.ramp} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={(v) => (v / 10000).toLocaleString() + "만"} tick={{ fontSize: 11 }} width={56} />
                      <RTooltip formatter={(v, name) => [won(v), name === "op" ? "월 영업이익" : "누적 영업이익"]} />
                      <ReferenceLine y={0} stroke="#9CA3AF" />
                      {r.breakEvenMonth && <ReferenceLine x={`${r.breakEvenMonth}월차`} stroke={BRAND.accent} strokeWidth={2} strokeDasharray="4 3" />}
                      <Bar dataKey="op" name="op" radius={[4, 4, 0, 0]}>
                        {r.ramp.map((d, i) => <Cell key={i} fill={d.op >= 0 ? BRAND.pos : BRAND.neg} />)}
                      </Bar>
                      <Line dataKey="cum" name="cum" stroke={BRAND.navy} strokeWidth={2.5} dot={{ r: 2.5 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {!r.breakEvenMonth && <p className="text-xs font-semibold mt-1" style={{ color: BRAND.neg }}>12개월 내 누적 흑자 전환 없음</p>}
              </Card>

              {/* 평형별 비교 */}
              <Card wide title="평형별 비교 (표준 임대료 기준)" basis="실입력 임대료가 아닌 평형별 표준 임대료(100/150/200만원)로 동일 조건 비교 — 매물 격차가 아닌 '포맷' 자체의 적정성 진단 목적">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="text-xs text-gray-500 border-b border-gray-200">
                        <th className="text-left py-2 font-medium">항목</th>
                        {r.pyeongCompare.map((p) => (
                          <th key={p.key} className="text-right py-2 font-bold" style={{ color: BRAND.navy }}>
                            {p.key}평 {r.recommendedPyeong === p.key && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full align-middle" style={{ background: BRAND.accent, color: BRAND.navy }}>권장</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["월 매출 캐파", (p) => won(p.cap)],
                        ["적용 매출", (p) => won(p.offRev)],
                        ["표준 월 임대료", (p) => won(p.stdRent)],
                        ["월 영업이익", (p) => <span style={{ color: opColor(p.op), fontWeight: 700 }}>{won(p.op)}</span>],
                        ["총 투자비", (p) => won(p.invest)],
                        ["회수기간", (p) => (p.payback == null ? <span style={{ color: BRAND.neg }}>회수 불가</span> : mon(p.payback))],
                        ["평형 적정성 진단", (p) => <span className="text-xs">{p.diag}</span>],
                      ].map(([label, fn], ri) => (
                        <tr key={ri} className="border-b border-gray-50">
                          <td className="py-2 text-gray-600 text-xs">{label}</td>
                          {r.pyeongCompare.map((p) => (
                            <td key={p.key} className={`py-2 text-right ${r.recommendedPyeong === p.key ? "bg-amber-50/70" : ""}`}>{fn(p)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* 시나리오 */}
              <Card wide title="시나리오 분석" basis="보수(가입률×0.8·객단가×0.9) / 기준 / 낙관(×1.2·×1.1) — 조정 후에도 캐파 상한(MIN) 적용">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {r.scenarios.map((s) => (
                    <div key={s.key} className="rounded-xl border p-4"
                      style={{ borderColor: s.key === "base" ? BRAND.navy : "#E5E7EB", background: s.key === "base" ? "#F8FAFF" : "#fff" }}>
                      <div className="font-bold" style={{ color: BRAND.navy }}>{s.label}</div>
                      <div className="text-[11px] text-gray-400">조정계수: 가입률 ×{s.coef.join} · 객단가 ×{s.coef.aov}</div>
                      <dl className="mt-2 space-y-1 text-sm">
                        <div className="flex justify-between"><dt className="text-gray-500">월 매출</dt><dd className="font-semibold">{won(s.offRev)}</dd></div>
                        <div className="flex justify-between"><dt className="text-gray-500">월 영업이익</dt><dd className="font-bold" style={{ color: opColor(s.op) }}>{won(s.op)}</dd></div>
                        <div className="flex justify-between"><dt className="text-gray-500">회수기간</dt><dd className="font-semibold">{mon(s.payback)}</dd></div>
                      </dl>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: "#FFF8E1", color: "#7A5C00" }}>
                  출점 원칙: 보수 시나리오에서도 월 영업이익 흑자인 상권·매물만 계약을 권장합니다.
                </p>
              </Card>

              {/* 유사 기존점 실적 */}
              {comps.length > 0 && (
                <Card wide title="유사 기존점 실적" basis="후보지 배후 세대수 ±30% 이내 기존점의 실제 최근 3개월 평균 매출 — 매출 추정의 서면 객관 근거">
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-gray-500 border-b"><th className="text-left py-2">기존점</th><th className="text-right">배후 세대</th><th className="text-right">평형</th><th className="text-right">실제 월평균 매출(3M)</th><th className="text-right">후보지 추정 매출</th></tr></thead>
                    <tbody>
                      {comps.map((s, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-2 font-semibold">{s.name}</td>
                          <td className="text-right">{num(s.households)}세대</td>
                          <td className="text-right">{s.pyeong}평</td>
                          <td className="text-right font-bold">{won(s.avgMonthlyRevenue3m)}</td>
                          <td className="text-right text-gray-500">{won(r.offRev)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}

              {/* 본사 로드맵 (선택 모듈) */}
              <Card wide title="본사 확장 로드맵" badge={<button onClick={() => setHqOpen(!hqOpen)} className="text-xs font-semibold px-2 py-1 rounded-lg border border-gray-300">{hqOpen ? "접기" : "펼치기"}</button>}>
                {hqOpen ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                      {[
                        { t: "개설 0건 시 월 손익", v: won(hq.zeroOpeningPL), c: opColor(hq.zeroOpeningPL) },
                        { t: "월 손익분기 개설 수", v: hq.bepOpenings + "건" },
                        { t: "자생 가능 매장 수", v: hq.selfSustainStores + "개" },
                      ].map((k, i) => (
                        <div key={i} className="rounded-xl bg-gray-50 p-3">
                          <div className="text-xs text-gray-500">{k.t}</div>
                          <div className="font-extrabold text-xl mt-0.5" style={{ color: k.c || BRAND.navy }}>{k.v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ width: "100%", height: 200 }}>
                      <ResponsiveContainer>
                        <BarChart data={hq.months} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                          <YAxis tickFormatter={(v) => (v / 10000).toLocaleString() + "만"} tick={{ fontSize: 11 }} width={56} />
                          <RTooltip formatter={(v) => [won(v), "본사 월 손익"]} labelFormatter={(l, p) => `${l} (누적 ${p?.[0]?.payload?.cumStores ?? ""}개점)`} />
                          <ReferenceLine y={0} stroke="#9CA3AF" />
                          {hq.selfSustainMonth && <ReferenceLine x={`${hq.selfSustainMonth}월차`} stroke={BRAND.accent} strokeWidth={2} strokeDasharray="4 3" label={{ value: "자생 도달", fontSize: 11, fill: "#7A5C00", position: "top" }} />}
                          <Bar dataKey="pl" radius={[4, 4, 0, 0]}>
                            {hq.months.map((d, i) => <Cell key={i} fill={d.pl >= 0 ? BRAND.pos : BRAND.neg} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">근거: 누적 매장수 × 점당 월 매입 {won(config.hq.purchasePerStore)} × 실질 물류마진 {pct(config.hq.realMargin)} + 월 신규개설 {config.hq.monthlyOpenings}건 × 개설이익 {won(config.hq.openingProfit)} − 판관비 {won(config.hq.sgna)}</p>
                  </>
                ) : (
                  <p className="text-xs text-gray-400">가맹본부 관점의 물류마진·개설이익·판관비 손익분기 시뮬레이션. 상담과 무관하므로 기본 접힘.</p>
                )}
              </Card>
            </div>
          </main>
        </div>

        {/* ---- 관리자 설정 모달 ---- */}
        {adminOpen && <AdminModal config={config} setConfig={setConfig} onClose={() => setAdminOpen(false)} />}
      </div>

      {/* ===== 인쇄 리포트 (A4 1장) ===== */}
      <div id="print-report" style={{ color: "#111", fontSize: "11px", lineHeight: 1.45 }}>
        <div style={{ borderBottom: `3px solid ${BRAND.navy}`, paddingBottom: 6, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <b style={{ fontSize: 16, color: BRAND.navy }}>감자마켓 출점 상권 진단 리포트</b>
          <span>상담일: {meta.date} · 담당자: {meta.manager || "________"}</span>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
          <tbody>
            <tr>
              {[["후보지", inp.name || "—"], ["배후 세대수", num(inp.hh) + "세대"], ["전용면적", inp.area + "평 (" + r.pKey + "평형)"], ["월 임대료", won(inp.rent)], ["보증금/권리금", won(inp.deposit) + " / " + won(inp.premium)]].map(([k, v], i) => (
                <td key={i} style={{ border: "1px solid #ddd", padding: "3px 6px" }}><b>{k}</b><br />{v}</td>
              ))}
            </tr>
          </tbody>
        </table>

        <p style={{ margin: "4px 0" }}>
          <b>판정:</b>{" "}
          <span style={{ color: fail ? BRAND.neg : BRAND.pos, fontWeight: 800 }}>{fail ? `출점 불가 — ${r.filter.reason}` : "통과"}</span>
          {" · "}<b>총점 {r.totalScore.toFixed(1)}점 / 등급 {r.gradeLabel}</b> · {r.rec}
        </p>

        <b style={{ color: BRAND.navy }}>1. 매출 산출 근거</b>
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "3px 0 8px" }}>
          <tbody>
            {[["배후 세대수", num(inp.hh) + "세대"], ["× 가입률 (등급 " + r.gradeLabel + ")", pct(r.joinRate) + " → 가입 " + num(r.joinedHH) + "세대"], ["× 전환율 " + pct(config.conv), "월 구매고객 " + num(r.buyers) + "명"], ["× 월 " + config.freq + "회 × 객단가 " + won(config.aov), "수요 매출 " + won(r.demand)], ["MIN(평형 캐파 " + won(r.cap) + ")", "적용 매출 " + won(r.offRev) + " · " + r.capMsg]].map(([k, v], i) => (
              <tr key={i}><td style={{ border: "1px solid #ddd", padding: "2px 6px", width: "45%" }}>{k}</td><td style={{ border: "1px solid #ddd", padding: "2px 6px" }}>{v}</td></tr>
            ))}
          </tbody>
        </table>

        <b style={{ color: BRAND.navy }}>2. 월 손익 요약 (안정화 월)</b>
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "3px 0 8px" }}>
          <tbody>
            <tr>{["월 총매출", "월 영업이익", "손익분기 월매출", "안전마진", "총 투자비", "회수기간"].map((h, i) => <td key={i} style={{ border: "1px solid #ddd", padding: "2px 6px", background: "#F3F4F6", fontWeight: 700 }}>{h}</td>)}</tr>
            <tr>{[won(r.totRev), won(r.op), won(r.bep), pct(r.safety), won(r.invest), r.payback == null ? "회수 불가" : mon(r.payback)].map((v, i) => <td key={i} style={{ border: "1px solid #ddd", padding: "2px 6px" }}>{v}</td>)}</tr>
          </tbody>
        </table>
        <p style={{ margin: "0 0 8px", color: "#555" }}>12개월 램프업 기준 누적 흑자 전환: {r.breakEvenMonth ? `${r.breakEvenMonth}월차` : "12개월 내 없음"} · 보증금·권리금은 회수성 자산으로 회수기간 계산에서 제외</p>

        <b style={{ color: BRAND.navy }}>3. 평형별 비교 (표준 임대료 기준)</b>
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "3px 0 8px" }}>
          <tbody>
            <tr><td style={{ border: "1px solid #ddd", padding: "2px 6px", background: "#F3F4F6", fontWeight: 700 }}>평형</td>{r.pyeongCompare.map((p) => <td key={p.key} style={{ border: "1px solid #ddd", padding: "2px 6px", fontWeight: 700 }}>{p.key}평{r.recommendedPyeong === p.key ? " ★권장" : ""}</td>)}</tr>
            <tr><td style={{ border: "1px solid #ddd", padding: "2px 6px" }}>월 영업이익</td>{r.pyeongCompare.map((p) => <td key={p.key} style={{ border: "1px solid #ddd", padding: "2px 6px", color: p.op >= 0 ? BRAND.pos : BRAND.neg }}>{won(p.op)}</td>)}</tr>
            <tr><td style={{ border: "1px solid #ddd", padding: "2px 6px" }}>회수기간</td>{r.pyeongCompare.map((p) => <td key={p.key} style={{ border: "1px solid #ddd", padding: "2px 6px" }}>{p.payback == null ? "회수 불가" : mon(p.payback)}</td>)}</tr>
          </tbody>
        </table>

        <b style={{ color: BRAND.navy }}>4. 시나리오</b>
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "3px 0 8px" }}>
          <tbody>
            <tr><td style={{ border: "1px solid #ddd", padding: "2px 6px", background: "#F3F4F6", fontWeight: 700 }}>구분</td>{r.scenarios.map((s) => <td key={s.key} style={{ border: "1px solid #ddd", padding: "2px 6px", fontWeight: 700 }}>{s.label}</td>)}</tr>
            <tr><td style={{ border: "1px solid #ddd", padding: "2px 6px" }}>월 영업이익</td>{r.scenarios.map((s) => <td key={s.key} style={{ border: "1px solid #ddd", padding: "2px 6px", color: s.op >= 0 ? BRAND.pos : BRAND.neg }}>{won(s.op)}</td>)}</tr>
            <tr><td style={{ border: "1px solid #ddd", padding: "2px 6px" }}>회수기간</td>{r.scenarios.map((s) => <td key={s.key} style={{ border: "1px solid #ddd", padding: "2px 6px" }}>{s.payback == null ? "회수 불가" : mon(s.payback)}</td>)}</tr>
          </tbody>
        </table>

        <p style={{ marginTop: 10, padding: "6px 8px", border: "1px solid #bbb", background: "#FAFAFA", fontSize: "9.5px" }}>
          본 자료는 기재된 가정과 근거에 기반한 추정치이며 실제 매출·수익을 보장하지 않습니다. 가정치는 상담일 기준이며, 가맹계약 시 정보공개서 및 관련 서면을 별도 제공합니다.
        </p>
      </div>
    </div>
  );
}

/* ---------------- 관리자 설정 모달 ---------------- */
function AdminModal({ config, setConfig, onClose }) {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [draft, setDraft] = useState(() => deepClone(config));
  const [compsJson, setCompsJson] = useState(() => JSON.stringify(config.comparableStores, null, 2));
  const [compsErr, setCompsErr] = useState("");
  const weightSum = draft.criteria.reduce((a, c) => a + Number(c.weight || 0), 0);

  const save = () => {
    let comps = draft.comparableStores;
    try { comps = JSON.parse(compsJson); setCompsErr(""); }
    catch { setCompsErr("comparableStores JSON 형식 오류 — 이 항목만 저장에서 제외했습니다."); }
    const next = { ...deepClone(draft), comparableStores: Array.isArray(comps) ? comps : [] };
    setConfig(next);
    // [PERSIST] Vite 배포 시: localStorage.setItem("gamjaConfig", JSON.stringify(next))
    onClose();
  };
  const reset = () => {
    if (window.confirm("모든 설정을 기본값으로 복원할까요?")) {
      setDraft(deepClone(DEFAULT_CONFIG));
      setCompsJson(JSON.stringify(DEFAULT_CONFIG.comparableStores, null, 2));
    }
  };
  const numIn = "w-full border border-gray-300 rounded-md px-2 py-1 text-sm";
  const F = ({ label, path, step }) => {
    const get = (o, p) => p.reduce((x, k) => x[k], o);
    const set = (p, v) => {
      const d = deepClone(draft);
      let o = d; for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
      o[p[p.length - 1]] = v === "" ? 0 : Number(v);
      setDraft(d);
    };
    return (
      <label className="block text-xs text-gray-600">
        {label}
        <input type="number" step={step || "any"} className={numIn + " mt-0.5"} value={get(draft, path)} onChange={(e) => set(path, e.target.value)} />
      </label>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl p-6 my-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-lg" style={{ color: BRAND.navy }}>관리자 설정</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        {!authed ? (
          <div className="max-w-xs mx-auto py-8 text-center space-y-3">
            <p className="text-sm text-gray-600">관리자 비밀번호를 입력하세요</p>
            <input type="password" className={numIn + " text-center"} value={pw} onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pw === "1234" && setAuthed(true)} placeholder="기본: 1234" />
            <button onClick={() => pw === "1234" && setAuthed(true)}
              className="w-full py-2 rounded-lg text-white font-semibold text-sm" style={{ background: BRAND.navy }}>확인</button>
            {pw && pw !== "1234" && <p className="text-xs" style={{ color: BRAND.neg }}>비밀번호가 일치하지 않습니다.</p>}
          </div>
        ) : (
          <div className="space-y-5 text-sm">
            <p className="text-[11px] px-3 py-2 rounded-lg" style={{ background: "#FFF8E1", color: "#7A5C00" }}>
              이 미리보기 환경에서는 설정이 세션 동안만 유지됩니다. 자체 배포 시 localStorage 영속화 지점이 코드에 [PERSIST]로 표시되어 있습니다.
            </p>

            <section>
              <h3 className="font-bold mb-2" style={{ color: BRAND.navy }}>하드필터</h3>
              <div className="grid grid-cols-2 gap-3">
                <F label="최소 전용면적(평)" path={["minArea"]} />
                <F label="최소 배후 세대수" path={["minHH"]} />
              </div>
            </section>

            <section>
              <h3 className="font-bold mb-1" style={{ color: BRAND.navy }}>평가 항목 가중치</h3>
              {weightSum !== 100 && <p className="text-xs font-bold mb-1" style={{ color: BRAND.neg }}>⚠ 가중치 합계가 {weightSum}입니다 — 100이 되도록 조정하세요.</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {draft.criteria.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="flex-1 text-xs text-gray-600 truncate" title={c.name}>{c.name}</span>
                    <input type="number" className="w-16 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
                      value={c.weight} onChange={(e) => {
                        const d = deepClone(draft); d.criteria[i].weight = Number(e.target.value || 0); setDraft(d);
                      }} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="font-bold mb-2" style={{ color: BRAND.navy }}>등급 컷·가입률</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {draft.grades.map((g, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-2 space-y-1">
                    <div className="text-xs font-bold">{g.label}</div>
                    <F label="최소 점수" path={["grades", i, "min"]} />
                    <F label="가입률" path={["grades", i, "joinRate"]} step="0.01" />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="font-bold mb-2" style={{ color: BRAND.navy }}>매출·손익 가정</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <F label="전환율" path={["conv"]} step="0.01" />
                <F label="월 구매횟수" path={["freq"]} step="0.1" />
                <F label="객단가(원)" path={["aov"]} />
                <F label="상품마진율" path={["margin"]} step="0.01" />
                <F label="감자몰 연계율" path={["gmallRate"]} step="0.01" />
                <F label="본사 수수료율" path={["feeRate"]} step="0.005" />
              </div>
            </section>

            <section>
              <h3 className="font-bold mb-2" style={{ color: BRAND.navy }}>평형별 정책값</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {["10", "15", "20"].map((k) => (
                  <div key={k} className="border border-gray-200 rounded-lg p-2 space-y-1">
                    <div className="text-xs font-bold">{k}평 (냉장고 {draft.pyeong[k].fridge}대)</div>
                    <F label="월 매출 캐파(원)" path={["pyeong", k, "cap"]} />
                    <F label="표준 월 임대료(원)" path={["pyeong", k, "stdRent"]} />
                    <F label="인테리어(원)" path={["pyeong", k, "interior"]} />
                    <F label="설비(원)" path={["pyeong", k, "equipment"]} />
                    <F label="월 공과금(원)" path={["pyeong", k, "util"]} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="font-bold mb-2" style={{ color: BRAND.navy }}>투자·기타</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <F label="가맹비(원)" path={["franchise"]} />
                <F label="초도물품(원)" path={["initial"]} />
                <F label="예비비(원)" path={["reserve"]} />
                <F label="기본 기타비용(원)" path={["misc"]} />
              </div>
            </section>

            <section>
              <h3 className="font-bold mb-2" style={{ color: BRAND.navy }}>시나리오 조정계수</h3>
              <div className="grid grid-cols-3 gap-3">
                {["con", "base", "opt"].map((k) => (
                  <div key={k} className="border border-gray-200 rounded-lg p-2 space-y-1">
                    <div className="text-xs font-bold">{k === "con" ? "보수" : k === "base" ? "기준" : "낙관"}</div>
                    <F label="가입률 ×" path={["scenario", k, "join"]} step="0.05" />
                    <F label="객단가 ×" path={["scenario", k, "aov"]} step="0.05" />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="font-bold mb-2" style={{ color: BRAND.navy }}>본사 로드맵 가정</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <F label="현재 매장 수" path={["hq", "currentStores"]} />
                <F label="점당 월 매입액(원)" path={["hq", "purchasePerStore"]} />
                <F label="실질 물류마진" path={["hq", "realMargin"]} step="0.01" />
                <F label="월 판관비(원)" path={["hq", "sgna"]} />
                <F label="개설이익/건(원)" path={["hq", "openingProfit"]} />
                <F label="월 신규개설(건)" path={["hq", "monthlyOpenings"]} />
              </div>
            </section>

            <section>
              <h3 className="font-bold mb-1" style={{ color: BRAND.navy }}>유사 기존점 데이터 (JSON)</h3>
              <p className="text-[11px] text-gray-400 mb-1">{`형식: [{ "name", "households", "pyeong", "openedAt", "chatMembers", "avgMonthlyRevenue3m" }]`}</p>
              <textarea rows={5} className="w-full border border-gray-300 rounded-lg px-2 py-1 text-xs font-mono"
                value={compsJson} onChange={(e) => setCompsJson(e.target.value)} />
              {compsErr && <p className="text-xs" style={{ color: BRAND.neg }}>{compsErr}</p>}
            </section>

            <div className="flex justify-between pt-2 border-t border-gray-100">
              <button onClick={reset} className="text-sm font-semibold px-4 py-2 rounded-lg border border-gray-300 text-gray-600">기본값 복원</button>
              <div className="flex gap-2">
                <button onClick={onClose} className="text-sm font-semibold px-4 py-2 rounded-lg border border-gray-300">취소</button>
                <button onClick={save} className="text-sm font-semibold px-4 py-2 rounded-lg text-white" style={{ background: BRAND.navy }}>저장</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
