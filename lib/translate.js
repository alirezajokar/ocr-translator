'use strict';

// Sends OCR'd text to a configured OpenAI-compatible Chat Completions endpoint for
// translation. Uses Node's built-in global fetch (Node 24) — no HTTP client dependency.

/**
 * @param {string} text - the source text to translate (already OCR'd).
 * @param {{baseUrl:string, apiKey:string, model:string, targetLanguage:string}} settings
 * @returns {Promise<string>} the translated text.
 * @throws {Error} with a user-facing message on any network/API/parse failure.
 */
async function translateText(text, settings) {
  const { baseUrl, apiKey, model, targetLanguage } = settings;

  if (!apiKey) {
    throw new Error('No API key configured. Open Settings (Ctrl+Alt+Shift+O) to add one.');
  }
  if (!model) {
    throw new Error('No model configured. Open Settings (Ctrl+Alt+Shift+O) to set one.');
  }

  const url = `${baseUrl}/chat/completions`;
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: `Translate the user's text to ${targetLanguage}. Return only the translation, no explanation.`,
      },
      { role: 'user', content: text },
    ],
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // fetch throws on DNS/connection failures, timeouts, TLS errors, etc.
    throw new Error(`Network error contacting translation API: ${err.message}`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const errJson = await response.json();
      detail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      try {
        detail = await response.text();
      } catch {
        detail = '';
      }
    }
    throw new Error(`Translation API returned ${response.status} ${response.statusText}${detail ? ': ' + detail : ''}`);
  }

  let json;
  try {
    json = await response.json();
  } catch (err) {
    throw new Error(`Could not parse translation API response as JSON: ${err.message}`);
  }

  const translation = json?.choices?.[0]?.message?.content;
  if (typeof translation !== 'string' || !translation.trim()) {
    throw new Error('Translation API response did not contain the expected choices[0].message.content field.');
  }

  return translation.trim();
}

module.exports = { translateText };
