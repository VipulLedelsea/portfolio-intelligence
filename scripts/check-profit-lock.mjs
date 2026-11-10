// Checks the advisory profit lock: armed by a daily CLOSE 3% over the buy price, sits 1% over it, hit only by a LATER low or the live price, stays armed once stored,
// and is flagged as superseded when the Supertrend line is already above it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = readFileSync(fileURLToPath(new URL("../worker/runtime.js", import.meta.url)), "utf8").replace(/^export default \{/m, "const __default = {");
const rt = await import("data:text/javascript;base64," + Buffer.from(`${source}\nexport { profitLockState };`).toString("base64"));
const bar = (d, l, h, c) => ({ d, l, h, c });
const state = (over = {}) => rt.profitLockState({ buy: 100, boughtDate: "2026-01-02", price: 104, bars: [], ...over });

let s = state();
assert.equal(s.armed, false); assert.equal(s.level, 101); assert.equal(s.arm_price, 103); assert.equal(s.hit, false);
// closes under +3% do not arm, a close at exactly +3% does; the buy day itself does not count
s = state({ bars: [bar("2026-01-02", 99, 110, 108), bar("2026-01-03", 99, 103, 102.9)] }); assert.equal(s.armed, false, "the buy day and a 2.9% close do not arm");
s = state({ bars: [bar("2026-01-03", 100, 103.2, 103)] }); assert.equal(s.armed, true); assert.equal(s.armed_on, "2026-01-03"); assert.equal(s.armed_close, 103);
// an intraday high of 5% with a lower close does not arm
s = state({ bars: [bar("2026-01-03", 100, 105, 102)] }); assert.equal(s.armed, false, "arming needs a close, not an intraday high");
// the arming day's own low cannot hit the lock; a later low can
s = state({ bars: [bar("2026-01-03", 100.4, 104, 103.5), bar("2026-01-04", 102, 105, 104)] }); assert.equal(s.armed, true); assert.equal(s.hit, false, "the arming day's low is ignored");
s = state({ bars: [bar("2026-01-03", 100.4, 104, 103.5), bar("2026-01-04", 100.9, 104, 102)] }); assert.equal(s.hit, true); assert.equal(s.touched_on, "2026-01-04");
// the live price at or under the lock hits it; one cent above does not
assert.equal(state({ bars: [bar("2026-01-03", 102, 104, 103.5)], price: 101 }).hit, true);
assert.equal(state({ bars: [bar("2026-01-03", 102, 104, 103.5)], price: 101.01 }).hit, false);
// stored dates: stays armed with no bars, and a stored hit stays hit even though price has recovered
s = state({ armedAt: "2026-01-03", bars: [], price: 107 }); assert.equal(s.armed, true); assert.equal(s.armed_on, "2026-01-03"); assert.equal(s.hit, false);
s = state({ armedAt: "2026-01-03T10:00:00Z", hitAt: "2026-01-06", bars: [], price: 107 }); assert.equal(s.hit, true); assert.equal(s.touched_on, "2026-01-06");
// superseded: the Supertrend line is already at or over the lock
assert.equal(state({ stop: 101 }).superseded, true); assert.equal(state({ stop: 100.99 }).superseded, false);
console.log("profit lock checks passed");
