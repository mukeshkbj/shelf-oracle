export function isSyntheticEvent(event: { name?: string | null; settings?: unknown; synthetic?: boolean }): boolean {
  const settings = event.settings;
  return event.synthetic === true
    || (typeof settings === "object" && settings !== null && "synthetic" in settings && settings.synthetic === true)
    || event.name?.startsWith("[SYNTHETIC DEMO]") === true
    || event.name?.startsWith("E2E TEST ·") === true;
}

export const SYNTHETIC_DISCLOSURE = "Ratings, participant names and comments are simulated. This demo/test event is not evidence of retail demand.";
export const SYNTHETIC_PROOF_DISCLOSURE = "Reconstructed demo proof: recomputed lock hashes demonstrate demo payload consistency, not an actual historical market prediction.";
