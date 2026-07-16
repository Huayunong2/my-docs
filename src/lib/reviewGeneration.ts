import type { Review, ReviewKind } from "./api";

export type ReviewGenerationStep = "idle" | "collecting" | "requesting" | "saving";

interface ReviewGenerationPort {
  generateReview(payload: { kind: ReviewKind; date: string }): Promise<Review>;
}

export async function generateReviewVersion(
  port: ReviewGenerationPort,
  payload: { kind: ReviewKind; date: string },
  isActive: () => boolean,
  onStep: (step: Exclude<ReviewGenerationStep, "idle">) => void = () => {},
): Promise<Review | null> {
  if (!isActive()) return null;
  onStep("collecting");
  onStep("requesting");
  const review = await port.generateReview(payload);
  if (!isActive()) return null;
  onStep("saving");
  return review;
}

export function upsertReviewVersion(reviews: Review[], generated: Review): Review[] {
  return [generated, ...reviews.filter((review) => review.id !== generated.id)]
    .sort((a, b) => b.version - a.version);
}
