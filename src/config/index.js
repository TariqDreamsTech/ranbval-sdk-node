/**
 * Reading configuration: the `.ranbval` loader and the prefix rules that classify each name.
 *
 * Mirrors ranbval_sdk.config.
 */

'use strict';

module.exports = { ...require('./loader'), ...require('./manifest') };
