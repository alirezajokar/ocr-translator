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
    const { data } = await worker.recognize(imagePath);
    return (data && data.text) || '';
  } catch (err) {
    throw new Error(`OCR recognition failed: ${err.message}`);
  }
}

module.exports = { runOcr, warmUp, shutdown };
