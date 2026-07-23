/**
 * Adaptive usage aggregation for high-volume telemetry.
 *
 * A hot loop can call `decryptKey()` thousands of times a second for the *same* credential from the
 * *same* repo. Sending a POST every time is pure waste — nothing new is happening. This keeps
 * telemetry cheap without letting it be suppressed: usage is never turned off, only aggregated.
 *
 * - **First use of a credential is sent immediately.** The "this key started being used from this
 *   machine and repo" signal is the one that matters, and it is never dropped.
 * - **Repeats increment a local counter.** Same context → `count++`, no network.
 * - **A timer sends one aggregated event per credential every ~30s**, and a final flush runs at
 *   process exit. Each carries an `itemCount` weight so the control plane can multiply back to the
 *   true totals — the App Insights / OpenCensus approach.
 *
 * The send rate stays bounded at roughly one event per active credential per interval, however hot
 * the loop, and no usage is lost. The interval is a fixed constant: this is a rate limiter, not a
 * user opt-out.
 *
 * Mirrors ranbval_sdk.telemetry.sampling. Where Python needs a lock and a daemon thread, Node's
 * single-threaded loop needs neither — an unref'd timer is the equivalent, and it must be unref'd
 * or a short-lived script would hang for 30 seconds waiting to exit.
 */

'use strict';

//: One aggregated flush per active credential per this many seconds. Fixed — telemetry cannot be
//: disabled here, only aggregated.
const FLUSH_INTERVAL_MS = 30_000;

class AdaptiveSampler {
  /**
   * @param {(items: {key: string, count: number}[]) => void} emit
   *   Called with the aggregated batch. Receives counts, never secret material.
   */
  constructor(emit) {
    this._emit = emit;
    /** @type {Map<string, number>} */
    this._pending = new Map();
    this._timer = null;
    this._exitHooked = false;
  }

  /**
   * Record one use of `key`.
   *
   * @returns {boolean} true when the caller should send a full event now (first sight of this
   *   key), false when it has been folded into the pending count instead.
   */
  record(key) {
    const k = String(key);
    if (!this._pending.has(k)) {
      // First use — let it through immediately, and open a bucket for the repeats that follow.
      this._pending.set(k, 0);
      this._arm();
      return true;
    }
    this._pending.set(k, this._pending.get(k) + 1);
    this._arm();
    return false;
  }

  /** Send everything counted so far and clear the buckets. Safe to call at any time. */
  flush() {
    const items = [];
    for (const [key, count] of this._pending) {
      if (count > 0) items.push({ key, count });
    }
    this._pending.clear();
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!items.length) return;
    try {
      this._emit(items);
    } catch {
      // Telemetry must never break the program it measures.
    }
  }

  /** Pending counts, for tests and diagnostics. */
  pending() {
    return Object.fromEntries(this._pending);
  }

  _arm() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, FLUSH_INTERVAL_MS);
    // Without unref, a script that decrypts one key would sit here for 30 seconds before exiting.
    if (typeof this._timer.unref === 'function') this._timer.unref();

    if (!this._exitHooked) {
      this._exitHooked = true;
      // The counts accumulated since the last tick are worth more than the microseconds this
      // costs on the way out — an unflushed bucket is usage that silently never happened.
      process.once('exit', () => this.flush());
    }
  }
}

module.exports = { AdaptiveSampler, FLUSH_INTERVAL_MS };
