// Behavioural rubric — default weights. Overridable per event via
// events.settings.principles overrides weights per event.

export interface Principle {
  key: string;
  label: string;
  weight: number; // relative importance
}

export const PRINCIPLES: Principle[] = [
  { key: "novelty", label: "Novelty & distinctiveness", weight: 1.4 },
  { key: "fluency", label: "Processing fluency (instantly 'get it')", weight: 1.2 },
  { key: "salience", label: "Shelf salience & pack standout", weight: 1.3 },
  { key: "indulgence", label: "Indulgence & taste appeal", weight: 1.3 },
  { key: "health_halo", label: "Health halo & better-for-you cues", weight: 1.0 },
  { key: "social_proof", label: "Social proof signals", weight: 0.8 },
  { key: "convenience", label: "Convenience & format fit", weight: 0.9 },
  { key: "context_fit", label: "Fit to this room (curious tasters)", weight: 1.2 },
  { key: "scarcity", label: "Scarcity / discovery appeal", weight: 0.8 },
  { key: "value", label: "Perceived value for money", weight: 0.9 },
];

export const TOTAL_WEIGHT = PRINCIPLES.reduce((s, p) => s + p.weight, 0);
