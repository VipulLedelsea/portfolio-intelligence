import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const workerPath = resolve(root, "dist/server/index.js");
const manifestPath = resolve(root, "dist/.openai/hosting.json");
const [source, manifest] = await Promise.all([readFile(workerPath, "utf8"), readFile(manifestPath, "utf8")]);
JSON.parse(manifest);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(typeof workerModule.default?.fetch, "function", "Worker must export default.fetch");
const response = await workerModule.default.fetch(new Request("https://example.test/health"), {}, { waitUntil() {} });
assert.equal(response.status, 200);
const health = await response.json();
assert.equal(health.read_only, true);
assert.equal(health.order_submission_supported, false);
console.log("Artifact is valid ESM and read-only health check passed");
