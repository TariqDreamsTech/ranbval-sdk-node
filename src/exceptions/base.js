/**
 * The base error every Ranbval exception derives from.
 *
 * Carries a machine-readable `code` and a structured `context` object, so callers can branch, log
 * and emit metrics without parsing the message — wording is free to change, `code` is not.
 *
 * Mirrors ranbval_sdk.exceptions.base in the Python SDK.
 */

'use strict';

class RanbvalError extends Error {
  /**
   * @param {string} message  Human-readable, actionable description.
   * @param {{code?: string, [key: string]: any}} [context]
   *   `code` is a stable slug (e.g. "decrypt_failed"); everything else is structured detail about
   *   the failure — safe to log, and never containing secret plaintext.
   */
  constructor(message = '', context = {}) {
    super(message);
    const { code, ...rest } = context || {};
    this.name = new.target.name;
    this.code = code || new.target.defaultCode || RanbvalError.defaultCode;
    this.context = rest;
    // Without this the stack starts inside this constructor rather than at the throw site.
    if (Error.captureStackTrace) Error.captureStackTrace(this, new.target);
  }
}

//: Used when a subclass does not declare its own.
RanbvalError.defaultCode = 'ranbval_error';

module.exports = { RanbvalError };
