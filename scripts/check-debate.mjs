// Checks the debate's claim verifier with a scripted fake model: wrong figures, invented numbers, banned wording, other-side keys and bad
// rebuttal targets must be dropped; true claims must survive. Extracts the debate code from worker/runtime.js, so it tests the real code.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = readFileSync(fileURLToPath(new URL("../worker/runtime.js", import.meta.url)), "utf8");
const start = source.indexOf("// ---- Bull vs bear debate"), end = source.indexOf("const debateRowId");
assert.ok(start > 0 && end > start, "The debate code block must exist");
const code = `const round=(v,d=2)=>Math.round(v*10**d)/10**d;const WORKERS_AI_RANKING_MODEL="x";
function parseModelJson(t){const a=t.indexOf("{"),b=t.lastIndexOf("}");return JSON.parse(t.slice(a,b+1))}
const cleanError=e=>String(e);\n${source.slice(start, end)}\nexport { debateFacts, runDebate, verifyDebateClaims };`;
const { debateFacts, runDebate, verifyDebateClaims } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const item = { symbol: "MPC", direction: "LONG", tag: "Sharp dip", alignment_score: 70, stop_pct: 11.5, rr_t1: 0.5, from_entry_atr: 0.2, age_days: 1, volume_ratio: null, atr_pct: 3.1, crowded: true,
  evidence: { ev_pct: 1.14, win_rate_pct: 72, n: 1010, experimental: false }, filing: { earnings_in_days: 5, earnings_confirmed: true, cautions: [] } };
const facts = debateFacts(item, "DOWN");
assert.equal(facts.volume_ratio, undefined, "A missing figure must not become a fact");
assert.equal(facts.earnings_in_days, 5);
const keys = Object.keys(facts);
const ok = { text: "The scanner averaged 1.14% per trade over 1010 backtested trades.", facts: [{ key: "backtest_ev_pct", value: 1.14 }, { key: "backtest_trades", value: 1010 }] };
const cases = [
  [ok, true],
  [{ ...ok, facts: [{ key: "backtest_ev_pct", value: 2.5 }] }, false],                       // wrong value
  [{ text: "Win rate was 85% in the backtest.", facts: [{ key: "backtest_win_rate_pct", value: 72 }] }, false], // number in text not a real figure
  [{ text: "Earnings are 5 days away so it will rally.", facts: [{ key: "earnings_in_days", value: 5 }] }, false], // banned wording
  [{ text: "A claim that cites nothing at all here.", facts: [] }, false],
  [{ text: "A claim citing an unknown key here.", facts: [{ key: "made_up", value: 3 }] }, false],
];
for (const [claim, expected] of cases) assert.equal(verifyDebateClaims([claim], facts, keys).kept.length === 1, expected, claim.text);
assert.equal(verifyDebateClaims([ok], facts, ["stop_pct"]).kept.length, 0, "A key outside the side's pack must be rejected");
assert.equal(verifyDebateClaims([ok, ok, ok, ok], facts, keys).kept.length, 3, "At most three claims per side");
let calls = 0;
const env = { AI: { run: async (model, p) => { calls++; const sys = p.messages[0].content;
  if (sys.includes("BULL analyst")) return { response: JSON.stringify({ claims: [ok, { text: "Win rate was 85% in the backtest.", facts: [{ key: "backtest_win_rate_pct", value: 85 }] }] }) };
  if (sys.includes("BEAR analyst")) return { response: JSON.stringify({ claims: [{ text: "Earnings are expected in 5 days, inside a 10-day hold.", facts: [{ key: "earnings_in_days", value: 5 }] }, { text: "The stop sits 11.5% from entry, wide for a 10-day idea.", facts: [{ key: "stop_pct", value: 11.5 }] }] }) };
  // The first rebuttal has a wrong figure and is dropped; the second is valid and must keep ITS target (R2), not the dropped row's (R1).
  if (sys.includes("You answer")) return { response: JSON.stringify({ rebuttals: [{ to: "R1", text: "The sample is only 5 trades.", facts: [{ key: "backtest_trades", value: 5 }] }, { to: "R2", text: "The sample is 1010 trades.", facts: [{ key: "backtest_trades", value: 1010 }] }, { to: "ZZ", text: "A rebuttal aimed at nothing real.", facts: [{ key: "stop_pct", value: 11.5 }] }] }) };
  return { response: JSON.stringify({ leaning: "bear", verdict: "Earnings in 5 days outweigh the edge.", strongest_bull: "B1", strongest_bear: "R1", would_change_my_mind: "Earnings passing quietly." }) }; } } };
const result = await runDebate(env, item, "DOWN");
assert.equal(result.bull.length, 1); assert.equal(result.bear.length, 2);
assert.equal(result.rebuttals.bull.length, 1, "The valid rebuttal survives"); assert.equal(result.rebuttals.bull[0].to, "R2", "A kept rebuttal keeps its own target after an earlier one is dropped");
assert.equal(result.rebuttals.bear.length, 0, "A rebuttal aimed at an unknown claim is dropped");
assert.equal(result.judge.leaning, "bear"); assert.ok(result.dropped_claims >= 2);
assert.equal(calls, 5, "Two cases, two rebuttals and one verdict");
const noCase = await runDebate({ AI: { run: async () => ({ response: JSON.stringify({ claims: [] }) }) } }, item, "DOWN");
assert.equal(noCase.judge, null, "No verdict when a side has no verified claim");
console.log("Debate checks passed");
