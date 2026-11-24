import type { CanaryRequest, CanaryWorkflowInput } from './notification-workflow.types';

/**
 * Asks for one canary per channel. A channel whose request fails does not stop the others; the
 * run fails at the end so the failure shows in Temporal.
 */
export async function runCanary(
  input: CanaryWorkflowInput,
  requestedAt: string,
  request: (req: CanaryRequest) => Promise<void>,
): Promise<void> {
  const failed: string[] = [];
  for (const channel of input.channels) {
    try {
      await request({ channel, requestedAt });
    } catch {
      failed.push(channel);
    }
  }
  if (failed.length > 0) throw new Error(`Canary request failed for ${failed.join(', ')}`);
}
