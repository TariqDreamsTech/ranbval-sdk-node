/**
 * Repo-provenance policy errors.
 *
 * Mirrors ranbval_sdk.exceptions.policy.
 */

'use strict';

const { RanbvalError } = require('./base');

/** The current git origin is not on the project's allowlist, so decryption is refused. */
class RepoNotAllowedError extends RanbvalError {}
RepoNotAllowedError.defaultCode = 'repo_denied';

/** The allowlist itself could not be fetched or verified — fail closed, not open. */
class RepoPolicyError extends RanbvalError {}
RepoPolicyError.defaultCode = 'repo_policy_unavailable';

module.exports = { RepoNotAllowedError, RepoPolicyError };
