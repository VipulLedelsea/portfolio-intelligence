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
const edgarCacheWrite=async()=>{},edgarCacheRead=async()=>null,requireSubscription=async()=>{},requestUser=async()=>null,readBody=async()=>({});\n${source.slice(start, end)}\nexport { pickFeatures, learnedPenalty, evaluateLearningRule, buildLearningReport, learningAdmin, LEARNING_RULES };`;
const { pickFeatures, learnedPenalty, evaluateLearningRule, buildLearningReport, learningAdmin } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

const item = { strategy: "DIP", direction: "LONG", sector: "Energy", score: 61, from_entry_atr: 0.4, stop_pct: 9.2, rr_t1: 0.5, alignment_score: 70, age_days: 1, volume_ratio: null, atr_pct: 3, crowded: false, filing: { earnings_in_days: 5, cautions: [] } };
const f = pickFeatures(item, "DOWN");
assert.equal(f.stop_pct, 9.2); assert.equal(f.earnings_in_days, 5); assert.equal(f.market_state, "DOWN"); assert.equal(f.volume_ratio, null);

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
console.log("Learning checks passed");
