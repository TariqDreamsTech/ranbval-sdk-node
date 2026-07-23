/**
 * Plan-limit error.
 *
 * Thrown when the control plane refuses a call because the project's plan allowance is spent — not
 * because anything is broken. Kept distinct from ProxyError so callers can tell "you have run out"
 * apart from "the proxy is down", and back off or upgrade instead of retrying.
 *
 * The limit itself is enforced server-side. This SDK runs on the customer's machine, so a check it
 * performs is a check it can remove; this class exists to make the server's answer legible, not to
 * police anything locally.
 */

'use strict';

const { RanbvalError } = require('./base');

class PlanLimitError extends RanbvalError {
  /**
   * @param {string} message
   * @param {{used?: number, limit?: number, period?: string, plan?: string,
   *          kind?: string, code?: string}} [fields]
   */
  constructor(message, fields = {}) {
    super(message, fields);
    this.used = fields.used;        // how much of the allowance is consumed
    this.limit = fields.limit;      // the allowance on the current plan
    this.period = fields.period;    // billing window, e.g. "2026-07"
    this.plan = fields.plan;        // plan key, e.g. "free"
    this.kind = fields.kind;        // "requests" | "secrets" | "projects"
  }
}

PlanLimitError.defaultCode = 'plan_limit_reached';

module.exports = { PlanLimitError };
