'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { createWorker, PSM } = require('tesseract.js');

// Pure JS/WASM OCR via tesseract.js — no system `tesseract` binary or `apt install`
// required. `npm install` alone is enough to get a working app.
//
// On first use for a given language, tesseract.js downloads that language's
// `.traineddata` file (plus the WASM core) from a CDN (jsDelivr by default) and caches
// it locally, so the very first OCR run needs network access; subsequent runs for the
// same language are fully offline. We point `cachePath` at our own userData dir so the
// cache lives in a predictable, per-app location instead of the process's CWD.
//
// TODO (later, for the fully-offline distributable package): bundle the .traineddata
// files and tesseract.js-core WASM files inside the app itself and pass local
// `langPath`/`corePath` options here, so first-run doesn't depend on network access at
// all. Deliberately not done for this local v1 build.

function cacheDir() {
  const dir = path.join(app.getPath('userData'), 'tessdata-cache');
  // tesseract.js's Node cache adapter is a bare fs.writeFile (see node_modules/tesseract.js/
  // src/worker-script/node/cache.js) — it does NOT create the directory itself, and a
  // missing-directory write failure is caught *inside* tesseract.js and only logged to its
  // own internal logger, never thrown back to us. Without this, every write silently failed
  // and language data was re-downloaded from the CDN on every fresh worker (e.g. every daemon
  // restart) instead of ever actually landing on disk — worth being explicit about since it
  // was silent.
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Converts a user-facing OCR-languages setting like "eng+fas" or "eng,fas" into the
// array form tesseract.js's createWorker expects (['eng', 'fas']).
function parseLangs(ocrLanguagesSetting) {
  return ocrLanguagesSetting
    .split(/[+,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// A tesseract.js worker is expensive to spin up (WASM core + language data load into the
// engine) — creating and terminating a fresh one on every single capture was the reason
// OCR felt slow. Instead keep one alive across captures and only recreate it if the
// configured OCR languages actually change. warmUp() below also lets main.js start this
// init at app launch instead of on the user's first capture.
let cachedWorker = null;
let cachedLangsKey = null;

function langsKey(langs) {
  return langs.join('+');
}

async function getWorker(langs) {
  const key = langsKey(langs);
  if (cachedWorker && cachedLangsKey === key) {
    return cachedWorker;
  }
  if (cachedWorker) {
    const old = cachedWorker;
    cachedWorker = null;
    cachedLangsKey = null;
    try {
      await old.terminate();
    } catch {
      // best-effort — we're replacing it anyway
    }
  }
  const worker = await createWorker(langs, undefined, { cachePath: cacheDir() });
  // Default PSM (AUTO) runs full-page layout analysis — multi-column detection etc. —
  // which is wasted work (and measurably slower) for what this app actually feeds it:
  // a small user-selected crop that's normally one block of text. SINGLE_BLOCK skips that
  // analysis and assumes exactly that, which is both faster and more accurate for our case.
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  cachedWorker = worker;
  cachedLangsKey = key;
  return worker;
}

/**
 * Pre-initializes the OCR worker for the given language setting, so the first real
 * capture doesn't pay the (multi-second) worker startup cost. Safe to call at app launch;
 * failures here are non-fatal since runOcr() will just retry init on the first real call.
 */
async function warmUp(ocrLanguagesSetting) {
  try {
    const langs = parseLangs(ocrLanguagesSetting);
    if (langs.length === 0) return;
    console.log('[ocr] warming up worker for languages:', langs.join('+'));
    await getWorker(langs);
    console.log('[ocr] worker ready');
  } catch (err) {
    console.error('[ocr] warm-up failed (will retry on first capture):', err.message);
  }
}

/** Best-effort worker teardown, e.g. on app quit. */
async function shutdown() {
  if (!cachedWorker) return;
  const worker = cachedWorker;
  cachedWorker = null;
  cachedLangsKey = null;
  try {
    await worker.terminate();
  } catch {
    // process is exiting either way
  }
}

/**
 * Runs OCR on the given image file and returns the extracted text.
 * @param {string} imagePath
 * @param {string} ocrLanguagesSetting - e.g. "eng+fas"
 * @returns {Promise<string>}
 * @throws {Error} with a user-facing message on worker init or recognition failure
 *   (e.g. no network on first run to fetch language data, corrupt cache, bad image).
 */
async function runOcr(imagePath, ocrLanguagesSetting) {
  const langs = parseLangs(ocrLanguagesSetting);
  if (langs.length === 0) {
    throw new Error('No OCR languages configured. Check Settings.');
  }

  let worker;
  try {
    worker = await getWorker(langs);
  } catch (err) {
    throw new Error(
      `Failed to initialize OCR engine (language data may need to download on first use — check your network connection): ${err.message}`
    );
  }

  try {
    // `blocks: true` asks tesseract.js to also compute per-word confidence (off by default —
    // it's extra work tesseract.js skips unless asked). We need it to filter out low-
    // confidence "words", which in practice are very often a decorative UI icon that
    // happened to get misrecognized as a stray character (e.g. a diamond/logo glyph read as
    // "<") rather than a real low-quality text read — plain `data.text` has no way to tell
    // the two apart.
    const { data } = await worker.recognize(imagePath, {}, { blocks: true });
    return extractConfidentText(data);
  } catch (err) {
    throw new Error(`OCR recognition failed: ${err.message}`);
  }
}

// Below this confidence (tesseract's own 0-100 scale), a recognized "word" is dropped
// outright as garbage — a floor, not the main defense (see below).
const MIN_WORD_CONFIDENCE = 40;

// Confirmed against a real case: a decorative UI icon (a diamond/logo glyph) got
// misrecognized as the single character "<" at confidence 67 — comfortably above
// MIN_WORD_CONFIDENCE, right next to real text at confidence 95-96. A single global
// threshold can't separate those two cases without also risking real (if slightly less
// crisp) text. So: apply a much stricter confidence ceiling, but ONLY to "words" that are
// short and contain no letters or digits at all — i.e. could plausibly be a misread icon —
// and leave every word that contains any actual letter/digit alone regardless of
// confidence. This can't touch real text (which always has letters/digits) no matter how
// low its confidence gets; it only tightens the bar for symbol-only noise.
const SUSPICIOUS_SYMBOL_MAX_LEN = 2;
const SUSPICIOUS_SYMBOL_CONFIDENCE_CEILING = 85;
const ALL_SYMBOLS_RE = /^[^\p{L}\p{N}]+$/u; // true only if there's no letter/digit anywhere

function isLikelyMisreadIcon(word) {
  return (
    word.text.length <= SUSPICIOUS_SYMBOL_MAX_LEN &&
    ALL_SYMBOLS_RE.test(word.text) &&
    word.confidence < SUSPICIOUS_SYMBOL_CONFIDENCE_CEILING
  );
}

function extractConfidentText(page) {
  if (!page || !page.blocks || page.blocks.length === 0) {
    return (page && page.text) || ''; // fall back to raw text if block data is unavailable
  }
  const paragraphs = [];
  for (const block of page.blocks) {
    for (const paragraph of block.paragraphs || []) {
      const lines = [];
      for (const line of paragraph.lines || []) {
        const words = (line.words || [])
          .filter((w) => w.confidence >= MIN_WORD_CONFIDENCE && !isLikelyMisreadIcon(w))
          .map((w) => w.text);
        if (words.length) lines.push(words.join(' '));
      }
      if (lines.length) paragraphs.push(lines.join('\n'));
    }
  }
  return paragraphs.join('\n\n');
}

module.exports = { runOcr, warmUp, shutdown };
