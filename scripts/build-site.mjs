import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const html = await readFile(resolve(root, "engine/portfolio_intel/dashboard.html"), "utf8");
const runtime = await readFile(resolve(root, "worker/runtime.js"), "utf8");
// The Lorentzian Classification port keeps its own file because it carries its own licence (MPL 2.0).
const lorentzian = await readFile(resolve(root, "worker/lorentzian.js"), "utf8");
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "server"), { recursive: true });
await mkdir(resolve(output, ".openai"), { recursive: true });
await writeFile(resolve(output, "server/index.js"), `const PAGE = ${JSON.stringify(html)};\n${lorentzian}\n${runtime}`);
await cp(resolve(root, ".openai/hosting.json"), resolve(output, ".openai/hosting.json"));
console.log(`Built ${output}`);
