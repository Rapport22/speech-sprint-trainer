// Cloudflare Worker: Gemini判定の中継サーバー（キーはここだけで保持）
// デプロイ手順は README-workspace.md / セットアップガイド参照

const PROMPT_TMPL = (jp, en, heard) => `You are an English pronunciation and speaking coach for Japanese learners. The student saw a Japanese prompt and answered in English. You received the speech-recognition transcript of their answer, and you must judge it as a COACH.

Japanese prompt: ${jp}
Model answer (ONE example translation, not the only correct answer): ${en}
Speech-recognition transcript (may contain recognition errors, e.g. similar-sounding words): ${heard || "(nothing recognized)"}

Judge on TWO layers:
1. Meaning: Does the answer convey the Japanese meaning? It does NOT need to match the model answer. Any natural, correct English that communicates the meaning passes. Ignore likely recognition errors (similar-sounding words like restaurant/restroom).
2. Speaking quality (0-5 each), inferred from the transcript pattern AND from what the recognition errors imply about the student's pronunciation:
   - pronunciation: sounds that were likely mispronounced if the recognizer heard a different English word
   - rhythm: word stress and content/function word balance
   - liaison: linking between words (a stiff word-by-word delivery often yields fragmented transcripts)
   - intonation: sentence melody, rising/falling patterns
   - speed: too fast/slow or even pace is inferable from omissions and errors

Reply ONLY with JSON:
{"pass": true/false, "natural": 1-5, "feedback": "日本語で40字以内。意味と発音の総括。直すべき点を具体的に", "skills": {"pronunciation": 0-5, "rhythm": 0-5, "liaison": 0-5, "intonation": 0-5, "speed": 0-5}}`;

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
    const MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.0-flash"];
    let r = null, lastDetail = "";
    for (const model of MODELS) {
      r = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
          body: JSON.stringify({
            contents: [{ parts: [{ text: PROMPT_TMPL(jp || "", en, heard) }] }],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
          })
        }
      );
      if (r.ok) break;
      lastDetail = (await r.text()).slice(0, 300);
      if (r.status === 400) break; // キー権限系はリトライ不要
    }
    if (!r.ok) {
      return cors(new Response(JSON.stringify({ error: "upstream " + r.status, detail: lastDetail }), { status: 502, headers: { "Content-Type": "application/json" } }));
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
