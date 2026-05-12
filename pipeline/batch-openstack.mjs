// Batch generator — runs 5 OpenStack-focused episodes with sequential dates.
// Usage:
//   GEMINI_API_KEY=... node pipeline/batch-openstack.mjs

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Episodes still missing — uses slug IDs (not dates).
const EPISODES = [
  {
    slug: "openstack-launch-first-vm",
    scope: "An OpenStack operator helps a junior teammate launch their first VM via the dashboard or CLI. Cover image selection, flavor, network, key-pair, and verifying the instance boots.",
  },
  {
    slug: "openstack-volume-attach",
    scope: "Two engineers debug a Cinder volume attach: creating, attaching to an instance, then formatting and mounting it inside the guest. Talk about Linux block devices and persistent fstab entry.",
  },
  {
    slug: "openstack-ssh-troubleshoot",
    scope: "A teammate cannot SSH into a new OpenStack VM. They walk through assigning a floating IP, security group rule for port 22, and testing connectivity step by step.",
  },
];

const LEVEL = "B1"; // basic everyday, accessible

function runOne({ slug, scope }) {
  return new Promise((resolve, reject) => {
    console.log(`\n\x1b[1;33m▶▶ [${slug}] ${scope.slice(0, 80)}…\x1b[0m\n`);
    const child = spawn(
      "node",
      [join(__dirname, "generate.mjs")],
      {
        env: {
          ...process.env,
          MOCK_MODE: "false",
          EPISODE_ID: slug,
          TOPIC_SCOPE: scope,
          LEVEL_HINT: LEVEL,
        },
        stdio: "inherit",
      },
    );
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`generate.mjs exited ${code} for episode ${slug}`));
    });
  });
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("\x1b[31m✗ GEMINI_API_KEY not set\x1b[0m");
    process.exit(1);
  }
  const t0 = Date.now();
  for (let i = 0; i < EPISODES.length; i++) {
    const ep = EPISODES[i];
    console.log(`\n\x1b[1m=== Episode ${i + 1}/${EPISODES.length} ===\x1b[0m`);
    try {
      await runOne(ep);
    } catch (e) {
      console.error(`\x1b[31m✗ Episode ${ep.slug} failed:\x1b[0m`, e.message);
      console.log("Continuing with next episode…");
    }
    // Small delay between to be polite to API
    // Wait between episodes so we stay under 20 RPM (free tier)
    if (i < EPISODES.length - 1) await new Promise((r) => setTimeout(r, 30000));
  }
  console.log(`\n\x1b[1;32m✓ Batch done in ${Math.round((Date.now() - t0) / 1000)}s\x1b[0m`);
}

main();
