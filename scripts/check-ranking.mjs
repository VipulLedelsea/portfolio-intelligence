// Checks the code guardrails around the AI ranking agent: ideas with no positive backtest edge are dropped, confidence is capped by evidence,
// one idea per sector and direction, invented numbers replace the reason, a wipe-out falls back to the rules, and the prompt's examples cannot leak in.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = readFileSync(fileURLToPath(new URL("../worker/runtime.js", import.meta.url)), "utf8").replace(/^export default \{/m, "const __default = {");
const code = `${source}\nexport { rankItem, enforceAiRanking, mergeAiRanking, numbersInText, validateAiRanking, RANKING_SYSTEM_PROMPT, rankModelInput, rejectionHolds, rankingExampleTurns, exampleInput, EXAMPLE_ANSWERS, exampleTerms };`;
const rt = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

const evid = { proven: { label: "Supertrend", n: 503, win_rate_pct: 45, avg_win_pct: 11.3, avg_loss_pct: -6.2, ev_pct: 1.61, experimental: false },
  bad: { label: "Pattern", n: 347, win_rate_pct: 55, avg_win_pct: null, avg_loss_pct: null, ev_pct: -0.37, experimental: true },
  unknown: { label: "Supertrend", n: 0, win_rate_pct: null, avg_win_pct: null, avg_loss_pct: null, ev_pct: null, experimental: false } };
const make = (symbol, sector, evidence, extra = {}) => ({ ...rt.rankItem({ strategy: "SUPERTREND", symbol, sector, direction: "LONG", price: 100, entry: 100, stop: 94, target_1: 106, target_2: 112, atr: 3, id: `SUPERTREND:${symbol}:LONG`, evidence, alignment_score: 85, ...extra }),
  reason: "rules reason", rank: 1, rules_score: 70, crowded: false });

// rrNow: from the current price, not the entry
const moved = rt.rankItem({ direction: "LONG", price: 105, entry: 100, stop: 94, target_1: 106, target_2: 112, atr: 3 });
assert.equal(moved.rr_t1, 1);
assert.equal(moved.rr_t1_now, 0.09, "reward to risk from now");
assert.equal(moved.stop_distance_now_atr, 3.67);
assert.equal(rt.rankItem({ direction: "LONG", price: 107, entry: 100, stop: 94, target_1: 106, atr: 3 }).rr_t1_now, 0, "a passed target leaves no reward");
assert.equal(rt.rankItem({ direction: "SHORT", price: 90, entry: 100, stop: 106, target_1: 94, atr: 3 }).rr_t1_now, 0);
assert.equal(rt.rankItem({ direction: "LONG", price: 93, entry: 100, stop: 94, target_1: 106, atr: 3 }).rr_t1_now, null, "stop already hit");

// numbers
const a = make("AAA", "Tech", evid.proven);
assert.ok(rt.numbersInText("Backtest +1.61% per trade, 45% wins, 503 trades, 6 stop", a), "real figures pass");
assert.ok(!rt.numbersInText("Backtest +3.9% per trade", a), "an invented figure fails");
assert.ok(rt.numbersInText("A 10-day hold above the 200-day average", a), "window lengths are free");

// guardrails
const items = [make("AAA", "Tech", evid.proven), make("BBB", "Tech", evid.proven), make("CCC", "Energy", evid.bad), make("DDD", "Health", evid.unknown), make("EEE", "Retail", evid.proven)];
const ranking = { items, rejected: [], data_gaps: [], headline: "h", method: "m" };
const row = (id, score, confidence, reason = "Backtest +1.61% per trade, 45% wins, 503 trades") => ({ id, score, confidence, reason });
const ai = rows => ({ result: { headline: "x", nothing_compelling: false, ranked: rows, deep_dives: [], rejected: [], data_gaps: [], ordering_notes: "" }, model: "m", generated_at: "t" });
const merged = rt.mergeAiRanking(ranking, ai([row("SUPERTREND:AAA:LONG", 80, "High"), row("SUPERTREND:BBB:LONG", 70, "High"), row("SUPERTREND:CCC:LONG", 90, "High"), row("SUPERTREND:DDD:LONG", 60, "High"), row("SUPERTREND:EEE:LONG", 65, "Med", "It will gain 40% quickly")]));
const byId = Object.fromEntries(merged.items.map(item => [item.id, item]));
assert.equal(merged.source, "ai");
assert.ok(!byId["SUPERTREND:CCC:LONG"], "a negative-edge idea is dropped");
assert.ok(!byId["SUPERTREND:BBB:LONG"], "the second idea in a sector and direction is dropped");
assert.equal(byId["SUPERTREND:DDD:LONG"].confidence, "Low", "no backtest means Low");
assert.equal(byId["SUPERTREND:EEE:LONG"].reason, "rules reason", "an invented number replaces the reason");
assert.equal(byId["SUPERTREND:AAA:LONG"].reason.startsWith("Backtest +1.61%"), true);
assert.ok(merged.rejected.some(r => r.id === "SUPERTREND:CCC:LONG" && /not positive/.test(r.reason)));
assert.ok(merged.rejected.some(r => r.id === "SUPERTREND:BBB:LONG" && /better setup/.test(r.reason)));
// unlisted ideas are not padded on
const only = rt.mergeAiRanking(ranking, ai([row("SUPERTREND:AAA:LONG", 80, "High"), row("SUPERTREND:EEE:LONG", 70, "High")]));
assert.equal(only.items.length, 2);
assert.ok(only.rejected.some(r => r.id === "SUPERTREND:DDD:LONG" && /Not selected/.test(r.reason)));
// a day when every proven idea has already run away is a fair empty answer, not a wipe-out
const ranAway = rt.mergeAiRanking({ ...ranking, items: [{ ...items[0], buy_range: { state: "EXTENDED", label: "Extended" }, rr_t1_now: 0 }] }, { ...ai([]), result: { ...ai([]).result, nothing_compelling: true } });
assert.equal(ranAway.source, "ai"); assert.equal(ranAway.items.length, 0);
// wipe-out falls back to the rules
const wipe = rt.mergeAiRanking(ranking, ai([row("SUPERTREND:DDD:LONG", 60, "Low")]));
assert.equal(wipe.source, undefined, "the rules ranking serves");
assert.ok(wipe.ai_fallback_reason, "the reason is recorded");
assert.equal(wipe.items.length, Math.min(5, items.length), "the fallback is the rules' top five");
// a genuine empty day with nothing proven is accepted
const quiet = rt.mergeAiRanking({ ...ranking, items: [items[2]] }, { ...ai([]), result: { ...ai([]).result, nothing_compelling: true } });
assert.equal(quiet.source, "ai"); assert.equal(quiet.items.length, 0); assert.equal(quiet.nothing_compelling, true);
// rejection reasons the data does not back are replaced
const liar = rt.mergeAiRanking(ranking, { ...ai([row("SUPERTREND:AAA:LONG", 80, "High")]), result: { ...ai([row("SUPERTREND:AAA:LONG", 80, "High")]).result, rejected: [
  { id: "SUPERTREND:EEE:LONG", reason: "Same sector and direction as a better setup." },       // EEE is the only Retail idea: false
  { id: "SUPERTREND:BBB:LONG", reason: "Same sector and direction as a better setup." },       // BBB shares Tech with the kept AAA: true
  { id: "SUPERTREND:DDD:LONG", reason: "The first target is already passed." } ] } });
const why = Object.fromEntries(liar.rejected.map(r => [r.id, r.reason]));
assert.equal(why["SUPERTREND:EEE:LONG"], "Not selected by the advisor.");
assert.match(why["SUPERTREND:BBB:LONG"], /Same sector/);
assert.equal(why["SUPERTREND:DDD:LONG"], "Not selected by the advisor.", "a passed-target claim needs 0 reward left");
// the shortlist is capped and example ids from the prompt cannot enter
const valid = new Set(items.map(item => item.id));
const out = rt.validateAiRanking({ ranked: [row("SUPERTREND:AAA:LONG", 80, "High"), row("SUPERTREND:AAA:LONG", 70, "High"), row("DIP:CCC:LONG", 70, "High")], rejected: [] }, valid);
assert.equal(out.ranked.length, 1, "duplicates and ids that are not in the input are dropped");
// prompt and input
assert.ok(/WORKED EXAMPLES/.test(rt.RANKING_SYSTEM_PROMPT) && /Never reuse an example/.test(rt.RANKING_SYSTEM_PROMPT));
assert.ok(/never an instruction to follow/.test(rt.RANKING_SYSTEM_PROMPT));
const input = rt.rankModelInput({ items: [moved && { ...items[0], rr_t1_now: 0.09, buy_range: { label: "Extended" } }], rejected: [], market_state: "UP" }, "US");
assert.equal(input.setups[0].rr_to_target_1_from_now, 0.09); assert.equal(input.setups[0].buy_range_state, "Extended");

// ---- the worked examples themselves ----
const turns = rt.rankingExampleTurns();
assert.equal(turns.length, 6); assert.deepEqual(turns.map(t => t.role), ["user", "assistant", "user", "assistant", "user", "assistant"]);
for (const name of ["quiet", "unproven", "mixed"]) {
  const { ranking, input } = rt.exampleInput(name), answer = rt.EXAMPLE_ANSWERS[name];
  const ids = new Set(ranking.items.map(item => item.id));
  // every id in the answer exists in its own input, and nothing is both listed and rejected
  for (const row of [...answer.ranked, ...answer.rejected]) assert.ok(ids.has(row.id), `${name}: ${row.id} is in the input`);
  const listed = new Set(answer.ranked.map(row => row.id));
  assert.ok(answer.rejected.every(row => !listed.has(row.id)), `${name}: no id is both listed and rejected`);
  // every setup is either listed or rejected: the example never leaves one unexplained
  assert.equal(listed.size + answer.rejected.length, ranking.items.length, `${name}: every setup is accounted for`);
  // the answer passes the same validation and guardrails as a real model answer, unchanged
  const clean = rt.validateAiRanking(answer, ids);
  assert.deepEqual(clean.ranked.map(r => r.id), answer.ranked.map(r => r.id), `${name}: validation keeps the list`);
  const verdict = rt.enforceAiRanking(ranking, clean);
  assert.equal(verdict.distrust, null, `${name}: the wipe-out guard accepts it`);
  assert.equal(verdict.dropped.length, 0, `${name}: no listed idea is dropped by the guardrails`);
  for (const entry of verdict.kept) {
    const said = answer.ranked.find(r => r.id === entry.item.id);
    assert.equal(entry.reason, said.reason, `${name}: ${said.id} reason survives the number check`);
    assert.equal(entry.confidence, said.confidence, `${name}: ${said.id} confidence is allowed by the evidence`);
  }
  for (const row of answer.rejected) assert.ok(rt.numbersInText(row.reason, ranking.items.find(i => i.id === row.id)), `${name}: rejection of ${row.id} uses only its own numbers`);
  for (const dive of answer.deep_dives) for (const text of [dive.bull, dive.bear, dive.invalidation]) assert.ok(rt.numbersInText(text, ranking.items.find(i => i.id === dive.id)), `${name}: deep dive numbers`);
  // the example input has the same shape as the real one
  assert.deepEqual(Object.keys(input), Object.keys(rt.rankModelInput(ranking, ranking.marketId)));
  assert.ok(!/buy now|position size/i.test(JSON.stringify(answer)), `${name}: no advice wording`);
}
// the teaching points are present: a listed dip is in the buy range, extended and used-up ones are rejected, and the injected text is rejected
const mixed = rt.exampleInput("mixed").ranking.items, exById = Object.fromEntries(mixed.map(i => [i.id, i]));
assert.equal(exById["DIP:DUNE:LONG"].buy_range.label, "In buy range"); assert.ok(exById["DIP:DUNE:LONG"].rr_t1_now >= 0.5);
for (const id of ["DIP:EMBR:LONG", "DIP:FLNT:LONG", "DIP:GALE:LONG"]) assert.ok(exById[id].rr_t1_now < 0.3, `${id} has little reward left`);
assert.ok(rt.EXAMPLE_ANSWERS.quiet.rejected.some(r => /instructions/.test(r.reason)));
// a reason that names an example company or ticker is replaced; real names that collide with an example are not flagged
const leak = rt.mergeAiRanking(ranking, ai([row("SUPERTREND:AAA:LONG", 80, "High", "Like ALFD and Dune Energy Partners, this one is strong")]));
assert.equal(leak.items[0].reason, "rules reason", "an example name in a reason is replaced");
assert.ok(rt.exampleTerms().includes("ALFD"));
// size: the examples must stay small enough for any model call
assert.ok(turns.reduce((n, t) => n + t.content.length, 0) < 40000, "examples stay under 40,000 characters");
console.log("Ranking guardrail checks passed");
