/**
 * Configuration errors: a variable is missing, or asked for from the wrong section.
 *
 * Mirrors ranbval_sdk.exceptions.config.
 */

'use strict';

const { RanbvalError } = require('./base');

/** A `.ranbval` value is absent, malformed, or read from the wrong prefix group. */
class RanbvalConfigError extends RanbvalError {}
RanbvalConfigError.defaultCode = 'config_error';

/** Attribute or index access to a key that is not present. */
class MissingKeyError extends RanbvalError {}
MissingKeyError.defaultCode = 'missing_key';

module.exports = { RanbvalConfigError, MissingKeyError };
