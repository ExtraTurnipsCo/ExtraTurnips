const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_PATH = path.join(__dirname, 'content', '.summary-cache.json');
const MODEL = 'claude-haiku-4-5';
// Notes shorter than this are one-liners with nothing to distill into three
// points — leave them without a summary so the card falls back to the
// client-side opening-sentence truncation.
const MIN_NOTE_CHARS = 140;

const SYSTEM = `You write the card summary for a restaurant review on "Extra Turnips", a blog where two friends rate shawarma out of 100 across taste, value, and experience. Given the full review note, distill it into three short bullet points (each roughly 8-16 words) that capture the standout praise and the main criticisms — usually one on taste, one on value, and one on the experience or vibe. Match the blog's voice: direct, specific, a little playful, no marketing fluff. Only use details present in the note; do not invent anything. Respond with JSON only.`;

// Structured output: an object with a `summary` array of strings. (JSON-schema
// structured outputs can't enforce an exact array length, so the count is
// requested in the prompt and clamped to three below.)
const FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: { summary: { type: 'array', items: { type: 'string' } } },
    required: ['summary'],
    additionalProperties: false
  }
};

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); }
  catch { return {}; }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
}

// Key by a hash of the note text so an edited note regenerates while an
// unchanged one is served from cache — mirrors the geocode cache.
function noteKey(note) {
  return crypto.createHash('sha256').update(note).digest('hex');
}

function normalizeLen(note) {
  return String(note || '').replace(/\s+/g, ' ').trim().length;
}

async function generateOne(client, note) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM,
    output_config: { format: FORMAT },
    messages: [{ role: 'user', content: note }]
  });
  const textBlock = res.content.find(b => b.type === 'text');
  const parsed = JSON.parse(textBlock ? textBlock.text : '{}');
  const bullets = Array.isArray(parsed.summary)
    ? parsed.summary.map(s => String(s).trim()).filter(Boolean).slice(0, 3)
    : [];
  return bullets.length ? bullets : null;
}

// Fills in r.summary for ratings that don't already have an authored one.
// Hand-written summaries in the frontmatter always win; only ratings without
// one (and with a substantial note) are sent to Haiku. Results are cached by
// note-hash so a rating is generated once, not on every build.
async function summarizeAll(ratings) {
  const cache = loadCache();

  const needing = ratings.filter(r =>
    !Array.isArray(r.summary) &&
    r.note &&
    normalizeLen(r.note) >= MIN_NOTE_CHARS
  );

  const uncached = [];
  for (const r of needing) {
    const key = noteKey(r.note);
    if (Array.isArray(cache[key])) r.summary = cache[key];
    else uncached.push({ r, key });
  }

  const fromCache = needing.length - uncached.length;
  if (uncached.length === 0) {
    if (fromCache) console.log(`Summaries: ${fromCache} from cache, 0 to generate.`);
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`Summaries: ${fromCache} from cache; ${uncached.length} need generation but ANTHROPIC_API_KEY is not set — those cards fall back to truncation.`);
    return;
  }

  let Anthropic;
  try {
    const mod = require('@anthropic-ai/sdk');
    Anthropic = mod.default || mod;
  } catch {
    console.log('Summaries: @anthropic-ai/sdk not installed — skipping generation (run `npm install`).');
    return;
  }

  const client = new Anthropic();
  let generated = 0;
  for (const { r, key } of uncached) {
    try {
      const bullets = await generateOne(client, r.note);
      if (bullets) { r.summary = bullets; cache[key] = bullets; generated++; }
    } catch (err) {
      console.log(`Summaries: failed for "${r.name}" (${err.message}) — falling back to truncation.`);
    }
  }
  if (generated) saveCache(cache);
  console.log(`Summaries: ${fromCache} from cache, ${generated} newly generated (Haiku).`);
}

module.exports = { summarizeAll, generateOne };
