/**
 * Cryptographic and secret-handling errors.
 *
 * Mirrors ranbval_sdk.exceptions.crypto.
 */

'use strict';

const { RanbvalError } = require('./base');

/** Wrong project secret, or a corrupt/expired vault token. */
class RanbvalDecryptError extends RanbvalError {}
RanbvalDecryptError.defaultCode = 'decrypt_failed';

/**
 * Something tried to read a secret out of a SecretString by a route that is not `.use()`.
 *
 * Printing it, interpolating it, serialising it, comparing it — each is an extraction attempt, and
 * under strict enforcement each raises rather than quietly handing over the plaintext.
 */
class RanbvalSecurityError extends RanbvalError {}
RanbvalSecurityError.defaultCode = 'secret_extraction_blocked';

module.exports = { RanbvalDecryptError, RanbvalSecurityError };
