import OpenAI from "openai";

export const runtime = "edge";

// route.ts
// POST /api/speechtotext

export async function POST(req: Request) {
  const formData = await req.formData();
  const token = formData.get("token") as string;
  const input = formData.get("input") as string;
  
  if ((!token || token === "null") && !process.env.OPENAI_API_KEY) {
    return Response.json({
      error: "No API key provided.",
    });
  }

  const openai = new OpenAI({
    apiKey:  process.env.OPENAI_API_KEY,
  });

  const mp3 = await openai.audio.speech.create({
    model: "tts-1",
    voice: "fable",
    input,
    speed: 1.0,
    response_format: "opus",
  });

  const arrayBuffer = await mp3.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });

  return new Response(blob, {
    headers: {
      "Content-Type": "audio/ogg",
    },
  });
}