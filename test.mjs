import { DEFAULT_CONFIG as cfg, compute, computeHQ } from "./calc.js";

const TOL = 0.01;
const rows = [];
function ck(tc, name, got, exp) {
  let pass;
  if (typeof exp === "number" && typeof got === "number") pass = Math.abs(got - exp) <= TOL;
  else pass = got === exp;
  rows.push({ TC: tc, item: name, expected: exp, got: typeof got === "number" ? +got.toFixed(4) : got, pass: pass ? "PASS" : "FAIL" });
}

// TC1
const inp1 = { hh: 4500, area: 10, rent: 1000000, deposit: 10000000, premium: 0, scores: [4, 4, 5, 3, 4, 3, 4], labor: 0, misc: 200000 };
const r1 = compute(inp1, cfg);
ck("TC1", "totalScore", r1.totalScore, 78.0);
ck("TC1", "hardFilter", r1.filter.pass, true);
ck("TC1", "grade", r1.grade, "B");
ck("TC1", "joinRate", r1.joinRate, 0.09);
ck("TC1", "demand", r1.demand, 8859375);
ck("TC1", "pyeong", r1.pKey, "10");
ck("TC1", "cap", r1.cap, 25000000);
ck("TC1", "offRev", r1.offRev, 8859375);
ck("TC1", "capMsg", r1.capMsg, "캐파 여유");
ck("TC1", "gmall", r1.gmall, 265781.25);
ck("TC1", "totRev", r1.totRev, 9125156.25);
ck("TC1", "gp", r1.gp, 2480625);
ck("TC1", "fee", r1.fee, 221484.375);
ck("TC1", "op", r1.op, 759140.625);
ck("TC1", "bep", r1.bep, 5882352.94);
ck("TC1", "invest", r1.invest, 34000000);
ck("TC1", "payback", r1.payback, 44.79);
ck("TC1", "ramp m1 rev", r1.ramp[0].rev, 3193804.69);
ck("TC1", "ramp m1 op", r1.ramp[0].op, -709300.78);
ck("TC1", "ramp m12 cum", r1.ramp[11].cum, 4478449.22);
ck("TC1", "py10 op", r1.pyeongCompare[0].op, 759140.63);
ck("TC1", "py15 op", r1.pyeongCompare[1].op, 159140.63);
ck("TC1", "py20 op", r1.pyeongCompare[2].op, -440859.38);
ck("TC1", "py20 payback", r1.pyeongCompare[2].payback, null);
ck("TC1", "scen con op", r1.scenarios[0].op, 126581.25);
ck("TC1", "scen base op", r1.scenarios[1].op, 759140.63);
ck("TC1", "scen opt op", r1.scenarios[2].op, 1482065.63);
// 시나리오 회수기간은 spec이 소수 1자리로 제시 → 동일 자릿수로 반올림 후 비교
ck("TC1", "scen con payback", +r1.scenarios[0].payback.toFixed(1), 268.6);
ck("TC1", "scen base payback", +r1.scenarios[1].payback.toFixed(1), 44.8);
ck("TC1", "scen opt payback", +r1.scenarios[2].payback.toFixed(1), 22.9);

// TC2
const r2 = compute({ ...inp1, area: 8 }, cfg);
ck("TC2", "fail", r2.filter.pass, false);
ck("TC2", "reason", r2.filter.reason, "전용면적 9평 미만 (냉장고 2대 배치 불가)");
ck("TC2", "grade", r2.grade, "출점 불가");

// TC3
const r3 = compute({ ...inp1, hh: 1400 }, cfg);
ck("TC3", "fail", r3.filter.pass, false);
ck("TC3", "reason", r3.filter.reason, "배후 세대수 1,500세대 미만");

// TC4
const hq = computeHQ({ currentStores: 30, purchasePerStore: 14000000, realMargin: 0.07, sgna: 50000000, openingProfit: 8500000, newOpenings: Array(12).fill(3) });
ck("TC4", "logisticsProfit", hq.logisticsProfit0, 29400000);
ck("TC4", "zeroOpeningPL", hq.zeroOpeningPL, -20600000);
ck("TC4", "bepOpenings", hq.bepOpenings, 3);
ck("TC4", "selfSustainStores", hq.selfSustainStores, 52);
ck("TC4", "selfSustainMonth", hq.selfSustainMonth, 8);
ck("TC4", "m8 cumStores", hq.months[7].cumStores, 54);

console.table(rows);
const fails = rows.filter((r) => r.pass === "FAIL");
console.log(fails.length === 0 ? "ALL PASS ✓" : `${fails.length} FAILURES`);
process.exit(fails.length === 0 ? 0 : 1);
