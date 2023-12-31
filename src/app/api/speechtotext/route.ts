import OpenAI from "openai";

export const runtime = "edge";

// route.ts
// POST /api/speechtotext

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File;
  const token = formData.get("token") as string;
  const lang = formData.get("lang") as string;
  
  if ((!token || token === "null") && !process.env.OPENAI_API_KEY) {
    return Response.json({
      error: "No API key provided.",
    });
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: lang || undefined,
  });

  return Response.json(transcription);
}