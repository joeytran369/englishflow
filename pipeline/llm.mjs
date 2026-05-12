// LLM client abstraction.
// MOCK_MODE=true → return canned outputs (demo flow, no API key needed)
// MOCK_MODE=false → call real Gemini API (set GEMINI_API_KEY env)

const MOCK_MODE = process.env.MOCK_MODE !== "false";

const MOCKS = {
  planner: {
    topic: "Kubernetes pod restart loop",
    setting: "Two SREs debugging on Slack huddle during on-call",
    level: "B2",
    keyConcepts: ["CrashLoopBackOff", "liveness probe", "OOMKilled", "kubectl describe"],
  },
  writer: {
    title: "The Restart Loop",
    sceneBrief: "10pm on-call ping. Junior is stressed — half-panicking but trying to sound composed. Senior has seen this a hundred times — dry humor, deadpan, quietly helpful.",
    characters: [
      { name: "Linh", role: "Junior SRE, 6 months in", voiceProfile: "junior-anxious" },
      { name: "Marcus", role: "Senior platform engineer, 12 years", voiceProfile: "tired-veteran" },
    ],
    lines: [
      { speaker: "Linh", text: "Hey Marcus — uh, hate to ping you this late, but the checkout pod is in a restart loop.", vn: "Anh Marcus ơi — em, em ngại phải ping anh giờ này, nhưng cái pod checkout đang restart liên tục.", emotion: "anxious", tags: ["urgent","quick"] },
      { speaker: "Marcus", text: "[chuckles] Of course it is. Alright — what does kubectl describe say?", vn: "[cười khẽ] Tất nhiên rồi. Được — kubectl describe nó báo gì?", emotion: "deadpan", tags: ["chuckles"] },
      { speaker: "Linh", text: "CrashLoopBackOff. Last state — OOMKilled, exit 137.", vn: "CrashLoopBackOff. State trước — OOMKilled, exit 137.", emotion: "panicked", tags: ["quick"] },
      { speaker: "Marcus", text: "Classic 137. [sighs] Memory limit, almost always. What's the cap right now?", vn: "137 quen thuộc. [thở dài] Gần như chắc chắn là memory limit. Cap đang để bao nhiêu?", emotion: "exhausted", tags: ["sighs"] },
      { speaker: "Linh", text: "Five-twelve megs. Which — yeah, that used to be plenty.", vn: "512 megs. Mà — vâng, trước giờ vẫn đủ.", emotion: "hesitant", tags: ["hesitates"] },
      { speaker: "Marcus", text: "Mm. Leak or a spike. Pull the last hour from Grafana, look for a step change. And before you ask — bump the limit as a stopgap, sure, but you owe me a root cause by morning.", vn: "Hmm. Leak hoặc spike. Lấy 1 tiếng vừa rồi từ Grafana, tìm chỗ step change. Trước khi em hỏi — bump limit tạm thì OK, nhưng sáng phải có root cause.", emotion: "focused", tags: ["slow"] },
      { speaker: "Linh", text: "Got it. Rolling back the image first to stop the bleeding, then I'll dig.", vn: "Em rõ. Em roll back image trước cho cầm máu đã, rồi đào tiếp.", emotion: "determined", tags: ["quick"] },
      { speaker: "Marcus", text: "Good. And Linh — [exhales] page me if it doesn't settle in five. Don't be a hero.", vn: "Tốt. Và Linh — [thở ra] 5 phút không yên thì page anh. Đừng cố làm anh hùng.", emotion: "warm", tags: ["exhales","soft"] },
    ],
  },
  editor: {
    levelChecked: "B2",
    notes: [
      "Replaced 'gimme a sec' with 'have you got a minute' for clarity.",
      "Kept 'stop the bleeding' as idiom — useful for engineers, glossed in vocab.",
    ],
    approved: true,
  },
  vocab: [
    { term: "restart loop", ipa: "/ˈriːstɑːrt luːp/", vn: "vòng lặp khởi động lại liên tục", example: "The pod is stuck in a restart loop." },
    { term: "CrashLoopBackOff", ipa: "/kræʃ luːp bæk ɒf/", vn: "trạng thái K8s khi container restart liên tục, K8s tăng dần delay", example: "It's CrashLoopBackOff." },
    { term: "OOMKilled", ipa: "/uː uː ɛm kɪld/", vn: "bị kernel kill do vượt memory limit", example: "Last state shows OOMKilled." },
    { term: "liveness probe", ipa: "/ˈlaɪvnəs proʊb/", vn: "kiểm tra app còn sống, fail → K8s restart", example: "Check the liveness probe too." },
    { term: "stopgap", ipa: "/ˈstɒpɡæp/", vn: "giải pháp tạm để cầm cự", example: "We can bump the limit as a stopgap." },
    { term: "root cause", ipa: "/ruːt kɔːz/", vn: "nguyên nhân gốc", example: "We need a root cause." },
    { term: "stop the bleeding", ipa: "/stɒp ðə ˈbliːdɪŋ/", vn: "(idiom) chặn đứng thiệt hại trước, fix gốc sau", example: "Roll back to stop the bleeding." },
    { term: "page someone", ipa: "/peɪdʒ ˈsʌmwʌn/", vn: "gọi/ping ai đó (qua hệ thống on-call)", example: "Page me if it doesn't settle." },
  ],
};

async function callGeminiOnce(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY required when MOCK_MODE=false");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(`Gemini ${res.status}: ${txt.slice(0, 200)}`);
    err.status = res.status;
    err.body = txt;
    throw err;
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(text);
}

async function callGemini(prompt) {
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await callGeminiOnce(prompt);
    } catch (e) {
      const transient = e.status === 429 || e.status === 503 || e.status === 500 || e.status === 502;
      if (!transient || attempt === MAX_RETRIES - 1) throw e;
      // Honor server's retryDelay if present, else exponential backoff
      let waitSec = (attempt + 1) * 8;
      const m = (e.body || "").match(/Please retry in (\d+(?:\.\d+)?)s/);
      if (m) waitSec = Math.ceil(parseFloat(m[1])) + 2;
      console.log(`  \x1b[33m↻ ${e.status} — waiting ${waitSec}s before retry ${attempt + 2}/${MAX_RETRIES}\x1b[0m`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
  }
}

export async function ask(agentName, prompt) {
  if (MOCK_MODE) {
    await new Promise((r) => setTimeout(r, 200));
    return MOCKS[agentName];
  }
  // small pre-call delay spreads requests across the 20 RPM free-tier limit
  await new Promise((r) => setTimeout(r, 3000));
  return callGemini(prompt);
}

export const MODE = MOCK_MODE ? "MOCK" : "GEMINI";
