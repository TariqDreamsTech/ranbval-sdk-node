/**
 * Decryption and the SecretString that guards what comes out of it.
 *
 * Mirrors ranbval_sdk.crypto.
 */

'use strict';

const outputGuards = require('./outputGuards');

module.exports = {
  installOutputGuards: outputGuards.installOutputGuards,
  uninstallOutputGuards: outputGuards.uninstallOutputGuards,
  PermissionError: outputGuards.PermissionError, ...require('./cipher'), ...require('./secretString') };
