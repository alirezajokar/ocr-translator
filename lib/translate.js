'use strict';

// Sends OCR'd text to a configured OpenAI-compatible Chat Completions endpoint for
// translation, via the official `openai` npm package rather than a hand-rolled `fetch`
// call. This matters beyond "use a credible library": some OpenAI-compatible providers
// default to streaming responses (Server-Sent Events) when a request omits `stream`
// entirely, instead of defaulting to `false` per the OpenAI spec — our old hand-rolled
// fetch never set it and broke against exactly such a provider. The SDK always sends an
// explicit value and parses the response shape correctly either way, which a hand-rolled
// client would have to reimplement itself to be equally robust.
const OpenAI = require('openai');

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

  const client = new OpenAI({ apiKey, baseURL: baseUrl });

  let completion;
  try {
    completion = await client.chat.completions.create({
      model,
      stream: false, // explicit, not just the default — see the file-level comment above
      messages: [
        {
          role: 'system',
          content: `Translate the user's text to ${targetLanguage}. Return only the translation, no explanation.`,
        },
        { role: 'user', content: text },
      ],
    });
  } catch (err) {
    // OpenAI.APIConnectionError covers DNS/connection/TLS failures; OpenAI.APIError (and
    // its subclasses like AuthenticationError/RateLimitError) already builds a message
    // that includes the HTTP status and the provider's own error detail.
    if (err instanceof OpenAI.APIConnectionError) {
      throw new Error(`Network error contacting translation API: ${err.message}`);
    }
    throw new Error(`Translation API error: ${err.message}`);
  }

  const translation = completion?.choices?.[0]?.message?.content;
  if (typeof translation !== 'string' || !translation.trim()) {
    throw new Error('Translation API response did not contain the expected choices[0].message.content field.');
  }

  return translation.trim();
}

module.exports = { translateText };
