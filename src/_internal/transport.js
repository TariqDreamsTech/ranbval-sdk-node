/**
 * Every outbound call the SDK makes goes through here, so the URL scheme is checked in one place.
 *
 * Node's `fetch` already refuses `file:` and `ftp:`, which is the vulnerability the Python SDK had
 * to close explicitly — but it *does* accept `data:`. Since the host comes from configuration
 * (`RANBVAL_HOST`, a `host` option), a `data:` URL would let whoever set it hand the SDK a
 * response of their choosing, including a repo policy that permits everything. The allowlist is
 * closed rather than audited because nothing legitimate here needs another scheme.
 */

'use strict';

const { RanbvalConfigError } = require('../exceptions');

const ALLOWED_SCHEMES = new Set(['https:', 'http:']);

/**
 * Throw unless `url` is http(s).
 *
 * @param {string} url
 * @returns {string} the same url, for chaining
 */
function assertSafeUrl(url) {
  let scheme;
  try {
    scheme = new URL(String(url)).protocol;
  } catch {
    throw new RanbvalConfigError(
      `Ranbval: '${url}' is not a valid URL. Check RANBVAL_HOST.`,
      { code: 'disallowed_url_scheme' },
    );
  }
  if (!ALLOWED_SCHEMES.has(scheme)) {
    throw new RanbvalConfigError(
      `Refusing to open a ${scheme} URL — Ranbval talks to the control plane over http(s) only. ` +
      'A host pointed at data:, file: or another scheme would let whoever set it choose the ' +
      'response, including a repo policy that permits everything. Check RANBVAL_HOST.',
      { code: 'disallowed_url_scheme' },
    );
  }
  return String(url);
}

module.exports = { assertSafeUrl, ALLOWED_SCHEMES };
