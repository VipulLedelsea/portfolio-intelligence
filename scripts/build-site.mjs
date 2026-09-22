import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const html = await readFile(resolve(root, "engine/portfolio_intel/dashboard.html"), "utf8");
const runtime = await readFile(resolve(root, "worker/runtime.js"), "utf8");
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "server"), { recursive: true });
await mkdir(resolve(output, ".openai"), { recursive: true });
await writeFile(resolve(output, "server/index.js"), `const PAGE = ${JSON.stringify(html)};\n${runtime}`);
await cp(resolve(root, ".openai/hosting.json"), resolve(output, ".openai/hosting.json"));
console.log(`Built ${output}`);
