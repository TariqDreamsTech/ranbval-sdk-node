/**
 * Provenance policy: which git remotes a project's keys may be decrypted on.
 *
 * Mirrors ranbval_sdk.policy.
 */

'use strict';

module.exports = { ...require('./repo') };
