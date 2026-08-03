// Interactive lesson wizard. Run: `npm run wizard`
// Asks category + (optional) scenario + level, then runs the generate pipeline.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const CATEGORIES = [
  { key: "Cloud Tech",  blurb: "incident debug, code review, sprint, on-call, design review" },
  { key: "Career",      blurb: "interview, salary talk, 1-on-1, time off, resign" },
  { key: "Office Life", blurb: "coffee chat, lunch invite, smalltalk, team building" },
  { key: "Life Admin",  blurb: "bank, doctor, rent, internet provider, insurance" },
  { key: "Travel",      blurb: "airport, directions, Grab/Uber, hotel, ordering food" },
  { key: "Hobbies",     blurb: "gym, gaming, movies, coffee, cycling, books" },
];

const rl = createInterface({ input: stdin, output: stdout });

function bold(s) { return `\x1b[1m${s}\x1b[0m`; }
function dim(s)  { return `\x1b[2m${s}\x1b[0m`; }
function cyan(s) { return `\x1b[36m${s}\x1b[0m`; }
function emerald(s) { return `\x1b[32m${s}\x1b[0m`; }

console.log(`\n${bold("▶ EnglishFlow — new lesson wizard")}\n`);

console.log(bold("Chọn category:"));
CATEGORIES.forEach((c, i) => {
  console.log(`  ${cyan((i + 1) + ".")} ${c.key.padEnd(13)} ${dim(c.blurb)}`);
});
console.log(`  ${cyan("0.")} ${dim("Random — planner tự chọn")}\n`);

const catAns = (await rl.question("→ Số (0-6) [0]: ")).trim();
const catIdx = catAns === "" ? 0 : parseInt(catAns, 10);
const cat = catIdx >= 1 && catIdx <= CATEGORIES.length ? CATEGORIES[catIdx - 1] : null;

let scope = "";
if (cat) {
  console.log(`\n${dim("Category:")} ${emerald(cat.key)}`);
  const sc = (await rl.question(`→ Scenario cụ thể (Enter để random trong "${cat.key}"): `)).trim();
  scope = sc ? sc : cat.key;
} else {
  const sc = (await rl.question(`→ Scenario cụ thể (Enter để fully random): `)).trim();
  if (sc) scope = sc;
}

const lvl = (await rl.question(`→ Level (A2/B1/B2/C1, Enter để planner tự chọn): `)).trim().toUpperCase();

const deployAns = (await rl.question(`→ Deploy lên GitHub Pages sau khi gen? (y/N): `)).trim().toLowerCase();
const deploy = deployAns === "y" || deployAns === "yes";

rl.close();

console.log(`\n${bold("▶ Gen với:")}`);
console.log(`  ${dim("TOPIC_SCOPE")} = ${scope || "(random)"}`);
console.log(`  ${dim("LEVEL_HINT")}  = ${lvl || "(planner picks)"}`);
console.log(`  ${dim("deploy")}      = ${deploy ? "yes" : "no"}\n`);

const env = { ...process.env, MOCK_MODE: "false" };
if (scope) env.TOPIC_SCOPE = scope;
if (lvl)   env.LEVEL_HINT = lvl;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", env, ...opts });
    p.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`)));
  });
}

try {
  await run("node", ["--env-file=.env", "pipeline/generate.mjs"]);
  if (deploy) {
    await run("npx", ["astro", "build"]);
    await run("npx", ["gh-pages", "-d", "dist", "--dotfiles"]);
    console.log(`\n${emerald("✓ Deployed.")} Mở: https://joeytrancloud.github.io/englishflow/`);
  } else {
    console.log(`\n${emerald("✓ Lesson saved.")} Chạy ${cyan("npm run deploy")} khi muốn đẩy lên web.`);
  }
} catch (e) {
  console.error(`\n\x1b[31m✗\x1b[0m ${e.message}`);
  process.exit(1);
}
