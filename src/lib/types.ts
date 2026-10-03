export type EventStatus =
  | "setup"
  | "intake"
  | "locked"
  | "voting"
  | "revealed"
  | "closed";

export interface Org {
  id: string;
  name: string;
  created_at: string;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: "owner" | "member";
}

export interface EventRow {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  location: string | null;
  status: EventStatus;
  settings: { principles?: { key: string; label: string; weight: number }[] };
  settings_version: number;
  products_version: number;
  draft: PredictionPayload | null;
  reveal: RevealPayload | null;
  locked_at: string | null;
  lock_hash: string | null;
  created_at: string;
}

export interface ShelfImage {
  id: number;
  event_id: string;
  image: string; // private Supabase Storage object path
  detected_count: number;
  created_at: string;
}

export interface ProductBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Product {
  id: string;
  event_id: string;
  brand: string;
  name: string;
  category: string | null;
  format: string | null;
  price: string | null;
  claims: string[];
  attributes: Record<string, string>;
  box: ProductBox | null;
  thumb: string | null;
  source_image_id: number | null;
  created_at: string;
}

export interface PrincipleScore {
  principle: string;
  score: number; // 1-10
  rationale: string;
}

export interface ProductPrediction {
  productId: string;
  rank: number;
  score: number; // 0-100 weighted
  principles: PrincipleScore[];
}

export interface PredictionPayload {
  model: string;
  createdAt: string;
  lockedAt?: string;
  principles: { key: string; weight: number; label: string }[];
  items: {
    productId: string;
    brand: string;
    name: string;
    rank: number;
    score: number;
    principles: PrincipleScore[];
  }[];
}

export interface DetectedItem {
  brand: string;
  nameGuess: string;
  format: string | null;
  box: ProductBox;
}

export interface Vote {
  id: number;
  event_id: string;
  voter_id: string;
  product_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface HumanPrediction {
  id: number;
  event_id: string;
  voter_id: string;
  display_name: string;
  top5: string[];
  created_at: string;
}

export interface RevealPayload {
  generatedAt: string;
  lockHash: string;
  verified: boolean;
  voterCount: number;
  voteCount: number;
  guesserCount: number;
  predicted: { productId: string; brand: string; name: string; rank: number; score: number; thumb: string | null }[];
  actual: { productId: string; rank: number | null; mean: number | null; adjustedMean: number | null; votes: number }[];
  consensus: { productId: string; rank: number; points: number }[];
  brandActual: { brand: string; rank: number | null; mean: number | null }[];
  brandPredicted: { brand: string; rank: number | null }[];
  metrics: {
    spearman: number | null;
    pValue: number | null;
    topKOverlap: number;
    humanSpearman: number | null;
    aiBeatsHumans: number; // count of individual predictors the AI beat
    humansTotal: number;
  };
  attribution: { principle: string; weight: number; voted: number }[];
  misses: { productId: string; brand: string; name: string; predictedRank: number; actualRank: number; note: string }[];
  leaderboard: { name: string; score: number; rho: number | null }[];
  comments: { product: string; brand: string; text: string; rating: number }[];
}
