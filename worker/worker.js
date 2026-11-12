// Cloudflare Worker: Gemini判定の中継サーバー（キーはここだけで保持）
// デプロイ手順は README-workspace.md / セットアップガイド参照

const PROMPT_TMPL = (jp, en, heard) => `You are an English teacher for Japanese learners. The student saw a Japanese prompt and answered in English.
Japanese prompt: ${jp}
Model answer (ONE example translation, not the only correct answer): ${en}
Student's answer (from speech recognition, may contain small recognition errors): ${heard || "(nothing recognized)"}

Rules:
- The student's answer does NOT need to match the model answer. Any English that naturally and correctly conveys the Japanese meaning PASSES.
- Ignore likely speech-recognition typos.
- Only fail the answer if the meaning is wrong, incomplete, or unintelligible.
Reply ONLY with JSON:
{"pass": true/false, "natural": 1-5, "feedback": "日本語で30字以内のフィードバック。減点がある場合は何を直すか具体的に"}`;

function cors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return res;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }
    if (request.method !== "POST") {
      return cors(new Response("Method not allowed", { status: 405 }));
    }
    if (!env.GEMINI_KEY) {
      return cors(new Response(JSON.stringify({ error: "GEMINI_KEY not set" }), { status: 500, headers: { "Content-Type": "application/json" } }));
    }
    let body;
    try { body = await request.json(); } catch (e) {
      return cors(new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const { jp, en, heard } = body || {};
    if (!en) {
      return cors(new Response(JSON.stringify({ error: "missing en" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    if (!heard || !heard.trim()) {
      return cors(new Response(JSON.stringify({ pass: false, natural: 1, feedback: "回答が聞き取れませんでした" }), { headers: { "Content-Type": "application/json" } }));
    }
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT_TMPL(jp || "", en, heard) }] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
        })
      }
    );
    if (!r.ok) {
      return cors(new Response(JSON.stringify({ error: "upstream " + r.status }), { status: 502, headers: { "Content-Type": "application/json" } }));
    }
    const data = await r.json();
    let out;
    try {
      out = JSON.parse(data.candidates[0].content.parts[0].text);
    } catch (e) {
      out = { pass: false, natural: 3, feedback: "判定の読み取りに失敗しました" };
    }
    return cors(new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } }));
  }
}
