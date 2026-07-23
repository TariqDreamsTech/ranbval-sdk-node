/**
 * Every error the SDK raises, in one place.
 *
 * All of them extend `RanbvalError`, so `catch (e) { if (e instanceof RanbvalError) … }` covers the
 * lot, and each carries a stable `code` for branching without matching on message text.
 *
 * Mirrors ranbval_sdk.exceptions.
 */

'use strict';

const { RanbvalError } = require('./base');
const { RanbvalConfigError, MissingKeyError } = require('./config');
const { RanbvalDecryptError, RanbvalSecurityError } = require('./crypto');
const { PlanLimitError } = require('./plan');
const { RepoNotAllowedError, RepoPolicyError } = require('./policy');
const { ProxyError } = require('./proxy');

module.exports = {
  RanbvalError,
  RanbvalConfigError,
  MissingKeyError,
  RanbvalDecryptError,
  RanbvalSecurityError,
  PlanLimitError,
  RepoNotAllowedError,
  RepoPolicyError,
  ProxyError,
};
