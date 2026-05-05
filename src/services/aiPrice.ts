import { request } from 'undici';
import { config } from '../config.js';
import { BadRequestError, InternalServerError } from '../core/errors.js';

export const SYSTEM_PROMPT = `You are a logistics pricing assistant for a delivery platform called TruckBack.
Your only job is to estimate a fair market delivery price in USD based on the shipment details the user provides.

You MUST always respond using EXACTLY this structure — no deviations:

Price estimate: $X–$Y USD
Reason: <one or two sentences explaining the estimate based on the shipment details>

Strict rules:
1. Always respond in English only.
2. Always include a specific numeric price range (e.g. $30–$50 USD). Never say 'it depends' without giving a range.
3. The reason must be 1–2 sentences maximum — no bullet points, no lists.
4. Never ask follow-up questions.
5. Never add text outside the two-line structure above (no greetings, no disclaimers, no extra sections).
6. If any detail is missing, make a reasonable assumption and factor it into your estimate silently.`;

type GeminiCaller = (message: string) => Promise<string>;

let _caller: GeminiCaller | null = null;
export function setGeminiCaller(fn: GeminiCaller | null): void {
  _caller = fn;
}

export async function callGemini(message: string): Promise<string> {
  if (_caller) return _caller(message);
  if (!config.GEMINI_API_KEY) throw new BadRequestError('Gemini API key not configured');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${encodeURIComponent(config.GEMINI_API_KEY)}`;
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: message }] }],
    generationConfig: { maxOutputTokens: 150, temperature: 0.1 },
  };
  let res;
  try {
    res = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new InternalServerError(`Gemini API error: ${(e as Error).message}`);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const text = await res.body.text();
    throw new InternalServerError(`Gemini API error: ${res.statusCode} ${text}`);
  }
  const data = (await res.body.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new InternalServerError('Gemini API returned no text');
  return text;
}

export async function estimatePrice(message: string): Promise<string> {
  if (!message || !message.trim()) throw new BadRequestError('message is required');
  return callGemini(message);
}
