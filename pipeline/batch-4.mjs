// Batch gen 4 episodes to reach 10 total. Sequential to avoid Gemini rate-limit collisions.
import { spawn } from "node:child_process";

const JOBS = [
  { scope: "2 đồng nghiệp ăn trưa bàn nhau có nên nhảy việc — công ty hiện tại lương ổn nhưng môi trường chán", level: "A2" },
  { scope: "Demo cho khách thì wifi rớt — 1 IT support cuống, 1 dev đứng cười khổ", level: "B1" },
  { scope: "Đặt lịch khám bác sĩ qua app — bệnh nhân lúng túng, lễ tân hướng dẫn từng bước", level: "A2" },
  { scope: "2 đồng nghiệp tâm sự burnout cuối tuần — một người sắp xin nghỉ phép 1 tuần để reset", level: "B1" },
];

function run(env) {
  return new Promise((resolve, reject) => {
    const p = spawn("node", ["--env-file=.env", "pipeline/generate.mjs"], {
      stdio: "inherit",
      env: { ...process.env, ...env, MOCK_MODE: "false" },
    });
    p.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`gen failed: ${code}`)));
  });
}

for (let i = 0; i < JOBS.length; i++) {
  const j = JOBS[i];
  console.log(`\n\x1b[1m═══ ${i + 1}/${JOBS.length}: ${j.scope.slice(0, 50)}…  [${j.level}]\x1b[0m`);
  try {
    await run({ TOPIC_SCOPE: j.scope, LEVEL_HINT: j.level });
  } catch (e) {
    console.error(`\x1b[31m✗ ${e.message}\x1b[0m — skipping, continuing`);
  }
  if (i < JOBS.length - 1) {
    console.log(`\x1b[2m⏳ pause 20s before next…\x1b[0m`);
    await new Promise((r) => setTimeout(r, 20000));
  }
}
console.log(`\n\x1b[32m✓ Batch done.\x1b[0m`);
