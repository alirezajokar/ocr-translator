'use strict';

const views = {
  status: document.getElementById('statusView'),
  cancelled: document.getElementById('cancelledView'),
  error: document.getElementById('errorView'),
  result: document.getElementById('resultView'),
};

function showView(name) {
  for (const key of Object.keys(views)) {
    views[key].classList.toggle('hidden', key !== name);
  }
}

let currentOcrText = '';

function resetTranslationSection() {
  const translateBtn = document.getElementById('translateBtn');
  const translatedEl = document.getElementById('translatedText');
  const translationErrorEl = document.getElementById('translationError');
  const copyTranslationBtn = document.getElementById('copyTranslationBtn');

  translateBtn.textContent = 'Translate';
  translateBtn.disabled = false;
  translateBtn.classList.remove('hidden');
  translatedEl.textContent = '';
  translatedEl.classList.add('hidden');
  translationErrorEl.textContent = '';
  translationErrorEl.classList.add('hidden');
  copyTranslationBtn.classList.add('hidden');
}

function render(payload) {
  switch (payload.type) {
    case 'status': {
      document.getElementById('statusMessage').textContent = payload.message || 'Working…';
      showView('status');
      break;
    }
    case 'cancelled': {
      document.getElementById('cancelledMessage').textContent = payload.message || 'Selection cancelled.';
      showView('cancelled');
      break;
    }
    case 'error': {
      document.getElementById('errorMessage').textContent = payload.message || 'Something went wrong.';
      showView('error');
      break;
    }
    case 'result': {
      // Translation is on-demand now (see #translateBtn below) — this only ever carries
      // the OCR'd text, so the user sees it as soon as it's ready instead of waiting on a
      // translate API round trip they might not even want.
      currentOcrText = payload.ocrText || '';
      document.getElementById('extractedText').textContent = currentOcrText;
      resetTranslationSection();
      showView('result');
      break;
    }
    default:
      break;
  }
}

window.api.onCaptureUpdate(render);

document.getElementById('translateBtn').addEventListener('click', async () => {
  const translateBtn = document.getElementById('translateBtn');
  const translatedEl = document.getElementById('translatedText');
  const translationErrorEl = document.getElementById('translationError');
  const copyTranslationBtn = document.getElementById('copyTranslationBtn');

  translateBtn.disabled = true;
  translateBtn.textContent = 'Translating…';
  translationErrorEl.classList.add('hidden');

  const result = await window.api.translateNow(currentOcrText);

  if (result.ok) {
    translatedEl.textContent = result.translation || '';
    translatedEl.classList.remove('hidden');
    copyTranslationBtn.classList.remove('hidden');
    translateBtn.classList.add('hidden');
  } else {
    translationErrorEl.textContent = result.error || 'Translation failed.';
    translationErrorEl.classList.remove('hidden');
    translateBtn.disabled = false;
    translateBtn.textContent = 'Retry Translate';
  }
});

document.getElementById('closeBtn').addEventListener('click', () => window.api.closePopup());
document.getElementById('retryBtn').addEventListener('click', () => window.api.triggerCapture());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.closePopup();
});

document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const targetId = btn.getAttribute('data-target');
    const text = document.getElementById(targetId).textContent.trim();
    await window.api.copyToClipboard(text);
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('copied');
    }, 1200);
  });
});
