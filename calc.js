// calc.js — 감자마켓 출점 상권 진단 순수 계산 모듈 (spec Section 3, 4)

export const DEFAULT_CONFIG = {
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
};

// 3-1 Hard filter
export function hardFilter(inp, cfg) {
  if (inp.area < cfg.minArea) return { pass: false, reason: "전용면적 9평 미만 (냉장고 2대 배치 불가)" };
  if (inp.hh < cfg.minHH) return { pass: false, reason: `배후 세대수 ${cfg.minHH.toLocaleString()}세대 미만` };
  return { pass: true, reason: "" };
}

// 3-2 Scoring & grade
export function scoreAndGrade(scores, cfg) {
  const weighted = cfg.criteria.map((c, i) => (c.weight * scores[i]) / 5);
  const totalScore = weighted.reduce((a, b) => a + b, 0);
  let grade = cfg.grades[0];
  for (const g of cfg.grades) if (totalScore >= g.min) grade = g;
  return { weighted, totalScore, grade, joinRate: grade.joinRate };
}

export function pyeongKey(area) {
  return area <= 12.5 ? "10" : area <= 17.5 ? "15" : "20";
}

// Full compute
export function compute(inp, cfg) {
  const { hh, area, rent, deposit, premium, scores } = inp;
  const labor = inp.labor ?? 0;
  const misc = inp.misc ?? cfg.misc;

  const filter = hardFilter(inp, cfg);
  const sg = scoreAndGrade(scores, cfg);
  const joinRate = sg.joinRate;

  // 3-3 Revenue (stabilized)
  const demand = hh * joinRate * cfg.conv * cfg.freq * cfg.aov;
  const pKey = pyeongKey(area);
  const P = cfg.pyeong[pKey];
  const cap = P.cap;
  const offRev = Math.min(demand, cap);
  const capMsg = demand > cap ? "수요가 캐파 초과 — 상위 평형 검토" : "캐파 여유";
  const gmall = offRev * cfg.gmallRate;
  const totRev = offRev + gmall;

  // Funnel intermediates
  const joinedHH = hh * joinRate;
  const buyers = joinedHH * cfg.conv;

  // 3-4 Monthly P&L
  const gp = offRev * cfg.margin + gmall;
  const fee = offRev * cfg.feeRate;
  const util = P.util;
  const op = gp - fee - rent - util - labor - misc;
  const denom = cfg.margin + cfg.gmallRate - cfg.feeRate;
  const bep = denom > 0 ? (rent + util + labor + misc) / denom : Infinity;
  const safety = totRev > 0 ? (totRev - bep) / totRev : 0;

  // 3-5 Investment & payback
  const invest = cfg.franchise + P.interior + P.equipment + cfg.initial + cfg.reserve;
  const payback = op > 0 ? invest / op : null; // null → "회수 불가 (영업이익 적자)"

  // 3-6 12-month ramp
  const gpRatio = totRev > 0 ? gp / totRev : 0;
  const offShare = totRev > 0 ? offRev / totRev : 0;
  let cum = 0, breakEvenMonth = null;
  const ramp = cfg.ramp.map((r, i) => {
    const rev_m = totRev * r;
    const gp_m = rev_m * gpRatio;
    const fixed_m = (rent + util + labor + misc) + rev_m * cfg.feeRate * offShare;
    const op_m = gp_m - fixed_m;
    cum += op_m;
    if (breakEvenMonth === null && cum > 0) breakEvenMonth = i + 1;
    return { month: i + 1, r, rev: rev_m, op: op_m, cum };
  });

  // 3-7 Pyeong comparison (standard rent)
  const pyeongCompare = ["10", "15", "20"].map((k) => {
    const c = cfg.pyeong[k];
    const offRev_p = Math.min(demand, c.cap);
    const op_p = offRev_p * (cfg.margin + cfg.gmallRate) - (c.stdRent + c.util + offRev_p * cfg.feeRate + misc);
    const invest_p = cfg.franchise + c.interior + c.equipment + cfg.initial + cfg.reserve;
    const payback_p = op_p > 0 ? invest_p / op_p : null;
    const diag_p = demand >= c.cap ? "수요가 캐파 초과 — 이 평형으로는 매출 손실" : "수요 수용 가능";
    return { key: k, cap: c.cap, offRev: offRev_p, stdRent: c.stdRent, op: op_p, invest: invest_p, payback: payback_p, diag: diag_p };
  });
  let recommendedPyeong = null, best = 0;
  for (const p of pyeongCompare) if (p.op > 0 && p.op > best) { best = p.op; recommendedPyeong = p.key; }

  // 3-8 Scenarios
  const scenarios = ["con", "base", "opt"].map((k) => {
    const s = cfg.scenario[k];
    const offRev_s = Math.min(demand * s.join * s.aov, cap);
    const op_s = offRev_s * (cfg.margin + cfg.gmallRate) - ((rent + util + labor + misc) + offRev_s * cfg.feeRate);
    const payback_s = op_s > 0 ? invest / op_s : null;
    return { key: k, label: k === "con" ? "보수" : k === "base" ? "기준" : "낙관", coef: s, offRev: offRev_s, op: op_s, payback: payback_s };
  });

  return {
    filter, ...sg, joinRate, demand, pKey, cap, offRev, capMsg, gmall, totRev,
    joinedHH, buyers, gp, fee, util, labor, misc, op, bep, safety,
    invest, payback, ramp, breakEvenMonth, pyeongCompare, recommendedPyeong, scenarios,
    grade: filter.pass ? sg.grade.label : "출점 불가",
    rec: filter.pass ? sg.grade.rec : "즉시 탈락 조건 미충족 — 다른 매물 검토",
  };
}

// Section 4 — HQ roadmap
export function computeHQ(h) {
  const { currentStores, purchasePerStore, realMargin, sgna, openingProfit, newOpenings } = h;
  const logisticsProfit0 = currentStores * purchasePerStore * realMargin;
  const zeroOpeningPL = logisticsProfit0 - sgna;
  const bepOpenings = Math.ceil((sgna - logisticsProfit0) / openingProfit);
  const selfSustainStores = Math.ceil(sgna / (purchasePerStore * realMargin));
  let selfSustainMonth = null;
  const months = newOpenings.map((n, i) => {
    const cumStores = currentStores + newOpenings.slice(0, i + 1).reduce((a, b) => a + b, 0);
    const logi = cumStores * purchasePerStore * realMargin;
    const pl = logi + n * openingProfit - sgna;
    if (selfSustainMonth === null && cumStores >= selfSustainStores) selfSustainMonth = i + 1;
    return { month: i + 1, cumStores, logi, pl };
  });
  return { logisticsProfit0, zeroOpeningPL, bepOpenings, selfSustainStores, selfSustainMonth, months };
}
