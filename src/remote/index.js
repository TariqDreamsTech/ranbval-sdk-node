/**
 * Remote configuration — fetch a project's env-set from the Ranbval control plane.
 *
 * A *source* only: `fetchEnvSet` returns the same {name: value} mapping a `.ranbval` file would,
 * and it feeds the identical classification and crypto pipeline. Only where the config comes from
 * differs.
 *
 * Mirrors ranbval_sdk.remote.
 */

'use strict';

module.exports = { ...require('./client') };
