import { useEffect, useState } from "react";
import { apiClient } from "./client";
import type { Review } from "../domain/types";

export function useReviews() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .getReviews()
      .then((data) => {
        if (!cancelled) {
          // Newest first, with repeated publish attempts collapsed.
          setReviews(dedupeReviews(data).sort(
            (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
          ));
        }
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить обзоры.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { reviews, isLoading, error };
}

function dedupeReviews(reviews: Review[]) {
  const byContent = new Map<string, Review>();

  for (const review of reviews) {
    const key = `${normalizeReviewText(review.title)}\n${normalizeReviewText(review.body)}`;
    const existing = byContent.get(key);
    if (!existing || dateMs(review.publishedAt) > dateMs(existing.publishedAt)) {
      byContent.set(key, review);
    }
  }

  return [...byContent.values()];
}

function normalizeReviewText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function dateMs(value: string) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}
