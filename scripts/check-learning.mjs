// Checks the continuous-learning engine from worker/runtime.js (the real code, extracted) on hand-made graded picks: a real difference must be
// proposed, noise and thin samples must not, approved rules must only touch the strategy and condition they were learned for, and the admin gate must hold.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = readFileSync(fileURLToPath(new URL("../worker/runtime.js", import.meta.url)), "utf8");
const start = source.indexOf("// ---- Continuous learning"), end = source.indexOf("// ---- Unified ranking");
assert.ok(start > 0 && end > start, "The learning code block must exist");
const code = `const numeric=v=>{const n=Number(v);return Number.isFinite(n)?n:0};const round=(v,d=2)=>Math.round(v*10**d)/10**d;
const RANK_FILTER_LABELS={ STOP_HIT:"stop already hit", CHASED:"price already ran past the entry" };const SCANNER_USER_ID="x";
const edgarCacheWrite=async()=>{},edgarCacheRead=async()=>null,requireSubscription=async()=>{},requestUser=async()=>null,readBody=async()=>({});\n${source.slice(start, end)}\nexport { epsSurpriseOf, pickFeatures, learnedPenalty, evaluateLearningRule, buildLearningReport, buildAdvisorReport, learningAdmin, LEARNING_RULES };`;
const { epsSurpriseOf, pickFeatures, learnedPenalty, evaluateLearningRule, buildLearningReport, buildAdvisorReport, learningAdmin } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

const item = { strategy: "DIP", direction: "LONG", sector: "Energy", score: 61, from_entry_atr: 0.4, stop_pct: 9.2, rr_t1: 0.5, alignment_score: 70, age_days: 1, volume_ratio: null, atr_pct: 3, crowded: false, filing: { earnings_in_days: 5, cautions: [] } };
const f = pickFeatures(item, "DOWN");
assert.equal(f.stop_pct, 9.2); assert.equal(f.earnings_in_days, 5); assert.equal(f.market_state, "DOWN"); assert.equal(f.volume_ratio, null);

// Shadow-mode EPS surprise: stored with the pick, and nothing else reads it.
assert.equal(f.eps_surprise, null); assert.equal(f.eps_surprise_pct_of_price, null); assert.equal(f.eps_report_days_ago, null);
const filed = (date, estimate, actual) => ({ last_eps_date: date, last_eps_estimate: estimate, last_eps_actual: actual, checked_at: "2026-11-12T10:00:00.000Z" });
assert.deepEqual(epsSurpriseOf(filed("2026-11-02", 1.5, 2.0), 100), { pct_of_price: 0.5, days_ago: 10, label: "BIG_BEAT" });
assert.equal(epsSurpriseOf(filed("2026-11-02", 1.5, 1.6), 100).label, "BEAT");
assert.equal(epsSurpriseOf(filed("2026-11-02", 1.5, 1.5), 100).label, "MET");
assert.equal(epsSurpriseOf(filed("2026-11-02", 1.5, 1.2), 100).label, "MISS");
assert.equal(epsSurpriseOf(filed("2026-10-13", 1.5, 1.7), 100).label, "BIG_BEAT", "30 days ago is still recent");
const old = epsSurpriseOf(filed("2026-08-01", 1.5, 2.0), 100);
assert.equal(old.label, null, "An old report keeps its figure but gets no label"); assert.equal(old.pct_of_price, 0.5); assert.equal(old.days_ago, 103);
assert.equal(epsSurpriseOf(filed("2026-11-02", 1.5, 2.0), 0), null); assert.equal(epsSurpriseOf(filed("2026-11-02", 1.5, 2.0), undefined), null);
assert.equal(epsSurpriseOf({ earnings_in_days: 5 }, 100), null); assert.equal(epsSurpriseOf(null, 100), null);
assert.equal(epsSurpriseOf({ ...filed("2026-11-02", 1.5, 2.0), checked_at: undefined }, 100).label, null, "No check date: no label");
const withEps = pickFeatures({ ...item, price: 50, filing: { ...item.filing, ...filed("2026-11-02", 1.5, 1.4) } }, "UP");
assert.equal(withEps.eps_surprise, "MISS"); assert.equal(withEps.eps_surprise_pct_of_price, -0.2); assert.equal(withEps.eps_report_days_ago, 10);
assert.equal(learnedPenalty({ ...item, price: 50, stop_pct: 5, filing: filed("2026-11-02", 1.5, 1.0) }, "UP", [{ rule_key: "WIDE_STOP|DIP", penalty: 10 }]).points, 0, "An EPS miss takes no points off");

// Approved rules only touch their own strategy and condition.
const rules = [{ rule_key: "WIDE_STOP|DIP", penalty: 10 }];
assert.equal(learnedPenalty(item, "UP", rules).points, 10, "A wide-stop dip is penalised");
assert.equal(learnedPenalty({ ...item, stop_pct: 5 }, "UP", rules).points, 0, "A narrow stop is not");
assert.equal(learnedPenalty({ ...item, strategy: "SUPERTREND" }, "UP", rules).points, 0, "Another strategy is not");
assert.equal(learnedPenalty(item, "UP", []).points, 0);
assert.ok(learnedPenalty(item, "UP", rules).labels[0].label.includes("learned rule"));

// Deterministic pseudo-noise so the test never flakes.
let seed = 5; const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; };
const mk = (n, mean, stop) => Array.from({ length: n }, (_, i) => ({ ret: mean + noise() * 4, date: `2026-0${1 + (i % 6)}-${String(1 + (i % 27)).padStart(2, "0")}`, features: { stop_pct: stop } }));
const real = [...mk(60, -2.5, 9), ...mk(60, 1, 5)];
const strong = evaluateLearningRule("WIDE_STOP", real);
assert.equal(strong.proposable, true, JSON.stringify(strong));
assert.ok(strong.ci[1] < 0 && strong.halves.every(h => h < 0));
const nothing = evaluateLearningRule("WIDE_STOP", [...mk(60, 1, 9), ...mk(60, 1, 5)]);
assert.equal(nothing.proposable, false, "No real difference, no proposal");
const thin = evaluateLearningRule("WIDE_STOP", [...mk(12, -3, 9), ...mk(60, 1, 5)]);
assert.equal(thin.proposable, false, "Too few flagged picks, no proposal"); assert.equal(thin.ci, null);
const better = evaluateLearningRule("WIDE_STOP", [...mk(60, 3, 9), ...mk(60, 0, 5)]);
assert.equal(better.proposable, false, "Only rules that mark WORSE picks are proposed");

// The report: calibration, filter value and per-strategy rules.
const row = (strategy, ret, score, extra = {}) => ({ strategy, ret, date: "2026-02-10", features: { score, stop_pct: 5, strategy, ...extra } });
const rows = [...Array.from({ length: 12 }, () => row("DIP", -1, 30)), ...Array.from({ length: 12 }, () => row("DIP", 0.5, 50)), ...Array.from({ length: 12 }, () => row("DIP", 1.5, 62)), ...Array.from({ length: 12 }, () => row("DIP", 3, 80)),
  ...Array.from({ length: 25 }, () => row("DIP", -2, null, { skip_code: "CHASED" }))];
const report = buildLearningReport(rows);
assert.equal(report.graded_real, 48); assert.equal(report.graded_shadow, 25);
assert.match(report.calibration_note, /Higher scores did better/);
const chased = report.filters.find(x => x.code === "CHASED");
assert.equal(chased.n, 25); assert.match(chased.verdict, /filter looks right/);
assert.equal(report.rules.length, 18, "Six rules for each of three strategies");
assert.ok(report.note.includes("Early days"));
const backwards = buildLearningReport([...Array.from({ length: 12 }, () => row("DIP", 3, 30)), ...Array.from({ length: 12 }, () => row("DIP", 1, 50)), ...Array.from({ length: 12 }, () => row("DIP", -1, 80))]);
assert.match(backwards.calibration_note, /did NOT reliably do better/);

// Only the configured administrator can decide.
assert.equal(learningAdmin({ email: "a@x.com" }, { LEARNING_ADMIN_EMAILS: "A@x.com, b@x.com" }), true);
assert.equal(learningAdmin({ email: "c@x.com" }, { LEARNING_ADMIN_EMAILS: "a@x.com" }), false);
assert.equal(learningAdmin({ email: "a@x.com" }, {}), false, "No administrator configured: nobody can decide");
assert.equal(learningAdmin({ email: null }, { LEARNING_ADMIN_EMAILS: "a@x.com" }), false, "A mobile session has no email and cannot decide");

// ---- Did the advisor add anything? ----
// 40 kept ideas that gained about 2% and 40 rejected ones that lost about 1%, spread over 20 days: a real difference must be reported as value added.
const advRow = (verdict, ret, i, extra = {}) => ({ strategy: "DIP", ret: 99, adv_ret: ret + (i % 3 - 1) * 0.5, date: `2026-03-${String(1 + i % 20).padStart(2, "0")}`, features: { score: 60 }, advisor: { verdict, prompt: "p1", ...extra } });
const advGood = buildAdvisorReport([...Array.from({ length: 40 }, (_, i) => advRow("KEPT", 2, i, { confidence: i % 2 ? "High" : "Med", win_prob: 60 })), ...Array.from({ length: 40 }, (_, i) => advRow("REJECTED", -1, i, { by: i % 4 ? "model" : "code" }))]);
assert.equal(advGood.kept.n, 40); assert.equal(advGood.rejected.n, 40); assert.ok(Math.abs(advGood.kept.mean_return_pct - 2) < 0.05, "the result is measured from the verdict price, not the logged return");
assert.ok(advGood.diff > 2.5 && advGood.ci[0] > 0); assert.match(advGood.verdict, /adding value/);
assert.equal(advGood.rejected_by_model.n, 30); assert.equal(advGood.rejected_by_code.n, 10);
assert.equal(advGood.by_confidence.find(c => c.confidence === "High").n, 20);
assert.deepEqual(advGood.probability.find(p => p.label === "55 to 65"), { label: "55 to 65", n: 40, stated_pct: 60, actual_win_rate_pct: 100 });
assert.equal(advGood.by_prompt[0].prompt, "p1");
// the same picks with the labels swapped must be reported as hurting, and no difference as no difference
const advBad = buildAdvisorReport([...Array.from({ length: 40 }, (_, i) => advRow("KEPT", -1, i)), ...Array.from({ length: 40 }, (_, i) => advRow("REJECTED", 2, i, { by: "model" }))]);
assert.match(advBad.verdict, /WORSE/);
const advFlat = buildAdvisorReport([...Array.from({ length: 40 }, (_, i) => advRow("KEPT", 1, i)), ...Array.from({ length: 40 }, (_, i) => advRow("REJECTED", 1, i, { by: "model" }))]);
assert.match(advFlat.verdict, /No measurable difference/);
// advThin samples and ideas with no verdict say nothing
const advThin = buildAdvisorReport([...Array.from({ length: 10 }, (_, i) => advRow("KEPT", 5, i)), ...Array.from({ length: 10 }, (_, i) => advRow("REJECTED", -5, i)), { strategy: "DIP", ret: 1, adv_ret: null, date: "2026-03-01", features: {}, advisor: null }]);
assert.match(advThin.verdict, /Too early/); assert.equal(advThin.judged, 20); assert.equal(advThin.ci, null);
assert.ok(report.advisor && report.by_strategy.DIP, "the main report carries the advisor section and results by strategy");
console.log("Learning checks passed");
