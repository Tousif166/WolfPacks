import Config from 'react-native-config';

/**
 * aiService — Groq-backed replacement for the web app's src/services/geminiService.js.
 *
 * WHY GROQ (Phase 9 decision): the web app used Google Gemini (@google/genai), whose free tier
 * caps at ~20 requests/day — the pain point that triggered this migration. Groq's free developer
 * tier is far more generous (~1K RPM on gpt-oss-20b) and keeps both vision (image diagnosis) and
 * strong Hindi/Bengali support. Groq exposes an OpenAI-COMPATIBLE REST API, so we call it with
 * plain fetch — no SDK, no native dependency, keeping the RN bundle lean.
 *
 * API SURFACE IS IDENTICAL to geminiService.js so callers are unchanged:
 *   - chatWithSahakarAI(messages, userRole)     -> { text, error }  (text is a bilingual fallback on error, never null)
 *   - getServiceDiagnosis(description, language, imageBase64) -> { text, error }  (text null on error)
 *   - getMaintenanceAdvice(serviceType, lastServiceDate, language) -> { text, error }  (text null on error)
 *
 * GRACEFUL MISSING-KEY PATTERN mirrors src/services/supabase.js: read Config.GROQ_API_KEY,
 * reject the .env placeholder, console.warn once, and short-circuit every function with the
 * service's own { text, error } shape instead of throwing at import (throwing at module import
 * in RN kills the JS bundle before any error boundary can mount).
 *
 * MODELS (Groq lineup as of 2026 — the older llama-3.1/3.3 IDs were deprecated Jun 2026):
 *   - TEXT_MODEL  openai/gpt-oss-20b : fast, high RPM, good multilingual — chat + maintenance advice.
 *   - VISION_MODEL qwen/qwen3.6-27b  : Groq's multimodal model (base64 image_url, <=5 imgs/20MB).
 *     Used ONLY when getServiceDiagnosis receives an image; text-only diagnosis uses TEXT_MODEL.
 *     qwen3.6-27b is a Groq *preview* model, so if it is ever unavailable the diagnosis call
 *     falls back to a text-only request on TEXT_MODEL rather than failing outright.
 */

const GROQ_API_KEY = Config.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const TEXT_MODEL = 'openai/gpt-oss-20b';
const VISION_MODEL = 'qwen/qwen3.6-27b';

const isConfigured =
  Boolean(GROQ_API_KEY) &&
  GROQ_API_KEY !== 'YOUR_GROQ_API_KEY' &&
  GROQ_API_KEY !== 'YOUR_GEMINI_API_KEY';

if (!isConfigured) {
  console.warn(
    '[aiService] GROQ_API_KEY is not set (check .env, then rebuild — it is a build-time var). ' +
      'AI diagnosis and chat will return a friendly "not configured" message until this is set. ' +
      'Get a free key at https://console.groq.com/keys. The rest of the app works without it.'
  );
}

const NOT_CONFIGURED_MESSAGE =
  'AI is not configured (missing GROQ_API_KEY in .env — add it and rebuild the app).';

// Bilingual fallback shown to end-users when a chat call fails (ported verbatim from geminiService
// so the chat surface behaves identically). Hindi + English so it reads for the whole user base.
const CHAT_FALLBACK_TEXT =
  'Maafi karein, abhi kuch technical samasya aa rahi hai. Kripya thodi der baad try karein. / ' +
  'Sorry, technical issue. Please try again shortly.';

// Ported verbatim from geminiService.js — the multilingual platform system prompt.
const SAHAKAR_SYSTEM_PROMPT = `You are Sahakar AI — the helpful multilingual assistant for Sahakar Seva (सहकार सेवा), a government-backed cooperative home services platform in India. 

You help:
- CUSTOMERS: Book services, understand pricing (including 18% GST, cooperative welfare cess, distance surcharge), track worker arrival, understand maintenance schedules (AC filter every 90 days, RO purifier every 60 days, chimney every 45 days), and resolve complaints.
- WORKERS: Understand work hour rules (40h/week max, 30h/week minimum target), overtime rules (only when no other worker available in zone, earns 1.5x bonus), insurance eligibility (after 3 months), CIBIL quality score system, leave policies (30 days annual + emergency), tier city mobility, training opportunities.

Services available: Plumbing, Electrical, AC Repair, Cleaning, Painting, Carpentry, Pest Control, Appliance Repair.

Helpline: 1800-XXX-SEVA (24x7 Toll-Free). Emergency SOS: 112.
For offline registration, visit your nearest Seva Kendra.

Respond in the same language the user writes in (Hindi/Bengali/English). Be warm, concise, and solution-focused.
`;

/**
 * Low-level Groq chat.completions call. Returns the assistant text on success or throws so the
 * public functions' try/catch can shape the error the same way geminiService did.
 */
/**
 * `reasoningEffort` matters on gpt-oss models, which are REASONING models: they spend completion
 * tokens on an internal `reasoning` field before emitting `content`. If max_completion_tokens runs
 * out during that phase, the request succeeds with an EMPTY content string — no error, just nothing.
 * Measured on this prompt: default effort burned 271 completion tokens (903 chars of reasoning)
 * whereas 'low' produced equally good output in 76. Pass 'low' for short, factual generations.
 */
async function groqChat({ model, messages, temperature = 0.7, maxTokens = 1024, reasoningEffort = null }) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_completion_tokens: maxTokens,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      stream: false,
    }),
  });

  if (!res.ok) {
    // Surface Groq's error body (rate limit, bad model, auth) as a thrown Error message.
    let detail = `Groq API error ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.error?.message || detail;
    } catch {
      // response body was not JSON; keep the status-based message
    }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  // An empty content with a non-empty reasoning field means the token budget was consumed before the
  // answer was written. Treated as an error so callers fall back instead of showing a blank panel.
  if (!text.trim() && data?.choices?.[0]?.message?.reasoning) {
    throw new Error('Model returned no content (token budget consumed by reasoning; raise maxTokens or lower reasoningEffort).');
  }
  return text;
}

function langInstructionFor(language) {
  if (language === 'Hindi') return 'Respond entirely in Hindi (Devanagari script).';
  if (language === 'Bengali') return 'Respond entirely in Bengali (Bengali script).';
  return 'Respond in English.';
}

/**
 * RN's plain <Text> can't render Markdown, so the raw **bold**, ### headings, tables and <br>
 * that gpt-oss / qwen emit show up as literal characters. Rather than pull in a markdown-render
 * dependency, we normalize the model output to clean plain text here — every consumer (diagnosis,
 * photo diagnosis, chat) benefits. This intentionally strips formatting, not content.
 */
function stripMarkdown(text) {
  if (!text) return text;
  return (
    text
      // fenced/inline code markers
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/`([^`]+)`/g, '$1')
      // bold/italic markers (**, __, *, _)
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, '$2')
      // headings: drop leading #'s
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      // list-table pipes → drop table separator rows, turn cell pipes into dashes
      .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, '')
      .replace(/^\s*\|/gm, '')
      .replace(/\|\s*$/gm, '')
      .replace(/\s*\|\s*/g, ' — ')
      // <br> and stray html-ish breaks → newlines
      .replace(/<br\s*\/?>/gi, '\n')
      // markdown links [text](url) → text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // collapse 3+ newlines
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * chatWithSahakarAI — multi-turn assistant chat. Same signature/return as the web version.
 * @param {{ role: 'user'|'model'|'assistant', text: string }[]} messages  running conversation
 * @param {string} userRole  'customer' | 'worker'
 * @returns {Promise<{ text: string, error: string|null }>}
 */
export async function chatWithSahakarAI(messages, userRole = 'customer') {
  if (!isConfigured) {
    // Chat contract: text is always a user-facing string (never null) even on failure.
    return { text: CHAT_FALLBACK_TEXT, error: NOT_CONFIGURED_MESSAGE };
  }
  try {
    // Map the app's { role, text } history to OpenAI chat format. Gemini used role 'model' for
    // the assistant; OpenAI/Groq use 'assistant'. Everything else maps to 'user'.
    const history = (messages || []).map((m) => ({
      role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text,
    }));

    const chatMessages = [
      { role: 'system', content: `${SAHAKAR_SYSTEM_PROMPT}\nUser role: ${userRole}.` },
      ...history,
    ];

    const text = await groqChat({ model: TEXT_MODEL, messages: chatMessages, temperature: 0.7 });
    return { text: stripMarkdown(text), error: null };
  } catch (err) {
    console.error('Groq chat error:', err);
    return { text: CHAT_FALLBACK_TEXT, error: err.message };
  }
}

/**
 * getServiceDiagnosis — analyze a home-service issue (optionally with a photo). Same
 * signature/return as the web version; text is null on error.
 * @param {string} description  problem description
 * @param {string} language     'Hindi' | 'Bengali' | 'English' (default English)
 * @param {string|null} imageBase64  raw base64 (NO data-URI prefix) or null
 * @returns {Promise<{ text: string|null, error: string|null }>}
 */
export async function getServiceDiagnosis(description, language = 'English', imageBase64 = null) {
  if (!isConfigured) {
    return { text: null, error: NOT_CONFIGURED_MESSAGE };
  }

  const langInstruction = langInstructionFor(language);
  const promptText = `${langInstruction} You are a home services expert. Analyze this home issue and provide, as short plain-text lines (NO markdown, NO tables, NO asterisks): 1) Likely cause (1-2 sentences) 2) Urgency level (Low/Medium/High/Emergency) 3) Recommended service type 4) Estimated repair time. Problem description: "${description}"`;

  // With an image, use the multimodal model and OpenAI-style content parts (text + image_url
  // with a base64 data URI, per Groq's vision docs). Without an image, a plain text request on
  // the fast text model.
  const buildMessages = (withImage) => {
    if (withImage) {
      return [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        },
      ];
    }
    return [{ role: 'user', content: promptText }];
  };

  try {
    const model = imageBase64 ? VISION_MODEL : TEXT_MODEL;
    const text = await groqChat({ model, messages: buildMessages(Boolean(imageBase64)), temperature: 0.5 });
    return { text: stripMarkdown(text), error: null };
  } catch (err) {
    // If the (preview) vision model was the problem and we had an image, retry text-only so the
    // user still gets a useful diagnosis from the description alone rather than a hard failure.
    if (imageBase64) {
      try {
        const text = await groqChat({ model: TEXT_MODEL, messages: buildMessages(false), temperature: 0.5 });
        return { text: stripMarkdown(text), error: null };
      } catch (err2) {
        return { text: null, error: err2.message };
      }
    }
    return { text: null, error: err.message };
  }
}

/**
 * getMaintenanceAdvice — short maintenance tip for a service type. Same signature/return as web.
 * (No call site in either app today, ported for API parity.)
 * @returns {Promise<{ text: string|null, error: string|null }>}
 */
export async function getMaintenanceAdvice(serviceType, lastServiceDate, language = 'English') {
  if (!isConfigured) {
    return { text: null, error: NOT_CONFIGURED_MESSAGE };
  }
  try {
    const promptText = `In ${language}: Give a 2-sentence maintenance tip for ${serviceType} (last serviced: ${lastServiceDate}). Mention key signs that indicate it needs servicing now.`;
    const text = await groqChat({
      model: TEXT_MODEL,
      messages: [{ role: 'user', content: promptText }],
      temperature: 0.6,
    });
    return { text: stripMarkdown(text), error: null };
  } catch (err) {
    return { text: null, error: err.message };
  }
}

/**
 * Generates a short, practical suggestion for handling a complaint.
 *
 * Called from a BACKGROUND worker (src/services/complaintAdvisor.js), never from render, so the UI
 * never waits on the network. Same { text, error } contract and missing-key behaviour as the other
 * functions here.
 *
 * The wording is role-aware because the same complaint needs different advice depending on who is
 * reading it:
 *   'accused' — the person complained about: what to do to put it right.
 *   'admin'   — the cooperative: how to adjudicate and what action to consider.
 *
 * Deliberately constrained: low temperature and a tight token budget, because this text is shown
 * verbatim next to a live dispute. It is also instructed not to assign blame or invent facts — an
 * AI confidently siding with one party in a real complaint would be worse than no suggestion.
 *
 * @param {object} complaint  The complaint record (subject, description, direction, service).
 * @param {'accused'|'admin'} audience  Who the suggestion is for.
 * @param {string} language  Output language name, e.g. 'English', 'Hindi', 'Bengali'.
 * @returns {Promise<{ text: string|null, error: string|null }>}
 */
export async function getComplaintSuggestion(complaint, audience = 'accused', language = 'English') {
  if (!isConfigured) {
    return { text: null, error: NOT_CONFIGURED_MESSAGE };
  }
  if (!complaint?.subject && !complaint?.description) {
    return { text: null, error: 'Complaint has no subject or description to analyse.' };
  }

  const filedByWorker = complaint.filedBy === 'worker';
  const complainant = filedByWorker ? 'the worker' : 'the customer';
  const accused = filedByWorker ? 'the customer' : 'the worker';

  const audienceInstruction = audience === 'admin'
    ? `You are advising the cooperative's admin team, who must adjudicate fairly between ${complainant} and ${accused}. `
      + 'Suggest what to verify first and one proportionate next step.'
    : `You are advising ${accused}, who this complaint is about. `
      + 'Suggest, kindly and without lecturing, how they can put this right and avoid a repeat.';

  const promptText = [
    'A complaint has been filed on a cooperative home-services platform in India.',
    `Filed by: ${complainant}. About: ${accused}.`,
    `Service: ${complaint.serviceName || 'home service'}.`,
    `Subject: ${complaint.subject || '(none given)'}.`,
    `Details: ${complaint.description || '(none given)'}.`,
    '',
    audienceInstruction,
    '',
    'Rules:',
    '- Reply in 2 to 3 short sentences, under 60 words total.',
    '- Do NOT decide who is at fault and do NOT invent details that are not stated above.',
    '- Be specific and actionable, not generic platitudes.',
    '- Plain text only, no markdown, no bullet points, no headings.',
    `- Write in ${language}.`,
  ].join('\n');

  try {
    const text = await groqChat({
      model: TEXT_MODEL,
      messages: [{ role: 'user', content: promptText }],
      temperature: 0.4,
      maxTokens: 400,
      // Short factual advice needs no deep reasoning, and this keeps content from being starved.
      reasoningEffort: 'low',
    });
    return { text: stripMarkdown(text), error: null };
  } catch (err) {
    console.error('Groq complaint-suggestion error:', err);
    return { text: null, error: err.message };
  }
}
