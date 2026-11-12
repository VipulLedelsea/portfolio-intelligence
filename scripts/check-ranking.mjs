// Checks the code guardrails around the AI ranking agent: ideas with no positive backtest edge are dropped, confidence is capped by evidence,
// one idea per sector and direction, invented numbers replace the reason, a wipe-out falls back to the rules, and the prompt's examples cannot leak in.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = readFileSync(fileURLToPath(new URL("../worker/runtime.js", import.meta.url)), "utf8").replace(/^export default \{/m, "const __default = {");
const code = `${source}\nexport { rankItem, enforceAiRanking, mergeAiRanking, numbersInText, validateAiRanking, RANKING_SYSTEM_PROMPT, rankModelInput, rejectionHolds, rankingExampleTurns, exampleInput, EXAMPLE_ANSWERS, exampleTerms, advisorVerdicts, liveRecordForModel, RANKING_PROMPT_VERSION };`;
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

// ---- advisor verdict log, live record and prompt ----
// every idea gets exactly one verdict: kept, removed by a guardrail ("code"), or left out by the model ("model")
const storedAi = { ...ai([{ ...row("SUPERTREND:AAA:LONG", 80, "High"), win_prob: 47 }, { ...row("SUPERTREND:BBB:LONG", 70, "High"), win_prob: 44 }, { ...row("SUPERTREND:CCC:LONG", 90, "High"), win_prob: 60 }]), prompt_version: rt.RANKING_PROMPT_VERSION };
const advVerdicts = rt.advisorVerdicts(ranking, storedAi), vById = Object.fromEntries(advVerdicts.map(v => [v.item.id, v.verdict]));
assert.equal(advVerdicts.length, items.length, "one verdict per idea");
assert.deepEqual([vById["SUPERTREND:AAA:LONG"].verdict, vById["SUPERTREND:AAA:LONG"].rank, vById["SUPERTREND:AAA:LONG"].win_prob, vById["SUPERTREND:AAA:LONG"].price], ["KEPT", 1, 47, 100]);
assert.deepEqual([vById["SUPERTREND:BBB:LONG"].verdict, vById["SUPERTREND:BBB:LONG"].by], ["REJECTED", "code"], "a same-sector duplicate is the code's rejection");
assert.deepEqual([vById["SUPERTREND:CCC:LONG"].verdict, vById["SUPERTREND:CCC:LONG"].by], ["REJECTED", "code"], "a negative-edge idea is the code's rejection");
assert.deepEqual([vById["SUPERTREND:EEE:LONG"].verdict, vById["SUPERTREND:EEE:LONG"].by], ["REJECTED", "model"], "an idea the model left out is the model's rejection");
assert.equal(vById["SUPERTREND:AAA:LONG"].prompt, rt.RANKING_PROMPT_VERSION); assert.equal(vById["SUPERTREND:AAA:LONG"].model, "m");
assert.equal(rt.advisorVerdicts(ranking, ai([row("SUPERTREND:DDD:LONG", 60, "Low")])).length, 0, "nothing is logged when the rules ranking served instead");
assert.equal(rt.advisorVerdicts(ranking, { result: null }).length, 0);
// the stated win probability survives validation and is bounded
const probed = rt.validateAiRanking({ headline: "h", nothing_compelling: false, ranked: [{ id: "SUPERTREND:AAA:LONG", score: 70, confidence: "Med", win_probability_pct: 140, reason: "r" }, { id: "SUPERTREND:EEE:LONG", score: 60, confidence: "Med", reason: "r" }], deep_dives: [], rejected: [], data_gaps: [], ordering_notes: "" }, new Set(items.map(i => i.id)));
assert.deepEqual(probed.ranked.map(r => r.win_prob), [100, null]);
for (const name of ["unproven", "mixed"]) for (const r of rt.EXAMPLE_ANSWERS[name].ranked) assert.ok(Number.isInteger(r.win_probability_pct), `${name}: every example row states a win probability`);
// the live record reaches the model only with enough graded ideas, and its figures may be quoted in a reason
const cellOf = (n, win, mean) => ({ n, win_rate_pct: win, mean_return_pct: mean });
const liveReport = { by_strategy: { SUPERTREND: { label: "Supertrend", ...cellOf(140, 41, 0.83) }, DIP: { label: "Dip", ...cellOf(12, 70, 0.4) } }, advisor: { kept: cellOf(45, 52, 0.91), rejected: cellOf(60, 47, 0.12), verdict: "No measurable difference yet." } };
const liveRec = rt.liveRecordForModel(liveReport);
assert.deepEqual(Object.keys(liveRec.by_strategy), ["Supertrend"], "a strategy with under 20 graded ideas is left out");
assert.equal(liveRec.your_own_record.ideas_you_kept.graded, 45);
assert.equal(rt.liveRecordForModel({ by_strategy: { DIP: { label: "Dip", ...cellOf(3, 70, 0.4) } } }), undefined);
assert.equal(rt.liveRecordForModel(null), undefined);
assert.deepEqual(rt.rankModelInput(ranking, "US", liveRec).live_track_record, liveRec);
assert.equal(rt.rankModelInput(ranking, "US").live_track_record, undefined);
const liveReason = "Live record: 140 graded ideas, 41% wins, +0.83% on average";
assert.equal(rt.mergeAiRanking(ranking, ai([row("SUPERTREND:AAA:LONG", 80, "High", liveReason)])).items[0].reason, "rules reason", "without a liveRec record those figures are invented");
assert.equal(rt.mergeAiRanking(ranking, { ...ai([row("SUPERTREND:AAA:LONG", 80, "High", liveReason)]), live: liveRec }).items[0].reason, liveReason, "live-record figures may be quoted");
// the prompt: the trader's hat, no list-size target, no variety nudge, and the probability is asked for
assert.ok(/veteran NYSE trader/.test(rt.RANKING_SYSTEM_PROMPT));
assert.ok(!/3 to 8/.test(rt.RANKING_SYSTEM_PROMPT) && !/not all one strategy/.test(rt.RANKING_SYSTEM_PROMPT));
assert.ok(/win_probability_pct/.test(rt.RANKING_SYSTEM_PROMPT) && /live_track_record/.test(rt.RANKING_SYSTEM_PROMPT));
// the model must get the backtest evidence when the ranking was read back from storage (the live path), with or without the stored id
for (const name of ["quiet", "unproven", "mixed"]) {
  const { ranking: fresh, market: mk } = rt.exampleInput(name), direct = rt.rankModelInput(fresh, mk);
  assert.ok(Object.keys(direct.strategy_evidence).length > 0, `${name}: evidence is sent`);
  const roundTrip = JSON.parse(JSON.stringify(fresh)), old = JSON.parse(JSON.stringify(fresh));
  for (const item of old.items) delete item.evidence_id;
  for (const [label, copy] of [["stored", roundTrip], ["stored before the id existed", old]]) {
    const again = rt.rankModelInput(copy, mk);
    assert.deepEqual(again.strategy_evidence, direct.strategy_evidence, `${name}: ${label} ranking sends the same evidence`);
    assert.deepEqual(again.setups.map(x => x.evidence), direct.setups.map(x => x.evidence), `${name}: ${label} ranking names the same evidence per setup`);
  }
}
console.log("Ranking guardrail checks passed");
