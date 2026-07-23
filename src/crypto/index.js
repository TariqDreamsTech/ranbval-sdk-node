/**
 * Decryption and the SecretString that guards what comes out of it.
 *
 * Mirrors ranbval_sdk.crypto.
 */

'use strict';

module.exports = { ...require('./cipher'), ...require('./secretString') };
