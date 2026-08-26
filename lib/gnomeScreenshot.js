'use strict';

const dbus = require('dbus-next');
const { Variant } = dbus;

// Direct calls to org.gnome.Shell.Screenshot (SelectArea/ScreenshotArea) are what this
// module used originally, on the assumption that GNOME's own trusted Shell API bypasses
// the sandboxed xdg-desktop-portal entirely. Confirmed WRONG on this machine (Ubuntu
// 26.04 / GNOME Shell 50.1 / Electron 44): both calls fail with
//   GDBus.Error:org.freedesktop.DBus.Error.AccessDenied: SelectArea is not allowed
// GNOME now locks that API down for regular (non-Shell-internal) callers. The sanctioned
// replacement is the portal's Screenshot request with `interactive: true`, which drives
// the same GNOME area-selection UI but through the properly access-controlled path, and
// returns a URI to the resulting PNG in one round trip (no separate ScreenshotArea call).
//
// The portal protocol is request/response over signals (Screenshot() returns a `handle`
// object path; the actual result arrives later as a Response signal on that object), which
// isn't practical to drive by shelling out to `gdbus call` — hence the dbus-next dependency
// here, instead of the child_process approach used elsewhere in this app.

const PORTAL_TIMEOUT_MS = 5 * 60 * 1000; // interactive selection can sit open a long time

/**
 * Prompts the user to drag a selection rectangle on screen via the portal's interactive
 * screenshot flow, and returns the local filesystem path to the captured PNG.
 * Resolves `null` if the user cancelled.
 */
async function captureInteractiveArea() {
  const bus = dbus.sessionBus();
  try {
    const portalObj = await bus.getProxyObject(
      'org.freedesktop.portal.Desktop',
      '/org/freedesktop/portal/desktop'
    );
    const screenshotIface = portalObj.getInterface('org.freedesktop.portal.Screenshot');

    const token = `ocrtranslator_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const options = {
      handle_token: new Variant('s', token),
      interactive: new Variant('b', true),
    };

    console.log('[gnomeScreenshot] calling portal Screenshot (interactive)...');
    const requestPath = await screenshotIface.Screenshot('', options);
    console.log('[gnomeScreenshot] portal request handle:', requestPath);

    const requestObj = await bus.getProxyObject('org.freedesktop.portal.Desktop', requestPath);
    const requestIface = requestObj.getInterface('org.freedesktop.portal.Request');

    const results = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requestIface.removeAllListeners('Response');
        reject(new Error('Screenshot request timed out waiting for a response.'));
      }, PORTAL_TIMEOUT_MS);

      requestIface.on('Response', (responseCode, resultsMap) => {
        clearTimeout(timer);
        requestIface.removeAllListeners('Response');
        console.log('[gnomeScreenshot] portal Response:', responseCode, resultsMap);
        if (responseCode !== 0) {
          resolve(null); // 1 = user cancelled, 2 = ended some other way — treat both as cancel
          return;
        }
        resolve(resultsMap);
      });
    });

    if (!results) return null;

    const uriVariant = results.uri;
    const uri = uriVariant && typeof uriVariant.value === 'string' ? uriVariant.value : null;
    if (!uri) {
      throw new Error('Portal did not return a screenshot URI.');
    }

    if (!uri.startsWith('file://')) {
      throw new Error(`Unexpected screenshot URI scheme: ${uri}`);
    }
    return decodeURIComponent(uri.slice('file://'.length));
  } finally {
    bus.disconnect();
  }
}

module.exports = { captureInteractiveArea };
