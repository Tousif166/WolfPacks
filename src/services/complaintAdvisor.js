import { getComplaintSuggestion } from './aiService';
import {
  getComplaintsAwaitingAi,
  markAiPending,
  setAiSuggestion,
  resetAiSuggestion,
  AI_ERROR,
  mockComplaints,
} from '@data/mockComplaints';

/**
 * complaintAdvisor — fills in Groq suggestions for complaints in the background.
 *
 * WHY A SEPARATE MODULE RATHER THAN CALLING GROQ FROM A SCREEN
 * A complaint is read by three different surfaces (admin dashboard, the accused party's portal, and
 * the worker/customer notice). If each fetched its own suggestion we would pay for the same call
 * repeatedly, get different wording in each place, and make every one of those screens wait on the
 * network. Instead the suggestion is generated ONCE, written into the persisted complaint record,
 * and every surface just reads the field.
 *
 * HOW IT STAYS OFF THE RENDER PATH
 * `runAdvisor()` is fire-and-forget: nothing awaits it, and it resolves to a small summary only for
 * tests. Requests are processed one at a time with a gap between them, which keeps a burst of
 * complaints from tripping Groq's rate limit and keeps the JS thread free for the UI.
 *
 * FAILURE IS NOT FATAL
 * A complaint whose suggestion fails is marked AI_ERROR and keeps all its real content. The UI shows
 * the complaint without a suggestion rather than an error state, because the complaint itself is the
 * important thing — the advice is a bonus. `retryFailedSuggestions()` exists for a manual re-run.
 */

/** Gap between requests. Groq's free tier is generous, but a queue of 20 should still be polite. */
const REQUEST_SPACING_MS = 400;

/** Safety valve: never process more than this in one pass, so a huge backlog cannot hog the thread. */
const MAX_PER_RUN = 8;

let running = false;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generates suggestions for any complaint still waiting on one.
 *
 * Re-entrant-safe: a second call while a pass is in flight returns immediately rather than
 * double-requesting, which matters because several screens may trigger this on mount.
 *
 * @param {string} language  Language for the generated text, matching the reader's app language.
 * @returns {Promise<{ processed: number, failed: number, skipped: boolean }>}
 */
export async function runAdvisor(language = 'English') {
  if (running) return { processed: 0, failed: 0, skipped: true };

  const queue = getComplaintsAwaitingAi().slice(0, MAX_PER_RUN);
  if (!queue.length) return { processed: 0, failed: 0, skipped: false };

  running = true;
  let processed = 0;
  let failed = 0;

  try {
    for (const complaint of queue) {
      // Claim it first, so a concurrent pass (or a screen remounting) cannot pick up the same one.
      markAiPending(complaint.id);

      // The suggestion is written for the party being complained about, since that is who sees it in
      // their own portal. The admin view reuses the same text — it is neutral by construction.
      const { text, error } = await getComplaintSuggestion(complaint, 'accused', language);

      if (text) {
        setAiSuggestion(complaint.id, text, false);
        processed += 1;
      } else {
        // Store nothing rather than the raw error string: an API message has no business being
        // rendered next to somebody's dispute.
        setAiSuggestion(complaint.id, null, true);
        failed += 1;
        if (error) console.warn(`[complaintAdvisor] ${complaint.id}: ${error}`);
      }

      await wait(REQUEST_SPACING_MS);
    }
  } finally {
    running = false;
  }

  return { processed, failed, skipped: false };
}

/**
 * Kicks off a pass without the caller having to handle the promise.
 *
 * This is what screens call from an effect. Errors are swallowed deliberately — a failed suggestion
 * must never surface as an unhandled rejection in a portal the user is trying to use.
 */
export function scheduleAdvisor(language = 'English') {
  runAdvisor(language).catch((err) => {
    console.warn('[complaintAdvisor] background pass failed:', err?.message || err);
  });
}

/** Puts previously-failed suggestions back in the queue and runs another pass. */
export function retryFailedSuggestions(language = 'English') {
  const failedIds = mockComplaints.filter((c) => c.aiStatus === AI_ERROR).map((c) => c.id);
  if (!failedIds.length) return;
  failedIds.forEach((id) => resetAiSuggestion(id));
  scheduleAdvisor(language);
}
