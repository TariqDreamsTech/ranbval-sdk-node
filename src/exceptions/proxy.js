/**
 * Secure-proxy errors.
 *
 * Mirrors ranbval_sdk.exceptions.proxy.
 */

'use strict';

const { RanbvalError } = require('./base');

/** The proxy rejected the request, or could not be reached. */
class ProxyError extends RanbvalError {
  constructor(message = '', context = {}) {
    super(message, context);
    // Kept as own properties because callers have always read them directly.
    this.status = context.status;
    this.body = context.body;
  }
}
ProxyError.defaultCode = 'proxy_error';

module.exports = { ProxyError };
