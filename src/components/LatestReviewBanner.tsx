import { BookOpen, Newspaper } from "lucide-react";
import type { Review } from "../domain/types";
import { appHref } from "../routing";

export function LatestReviewBanner({ review }: { review: Review }) {
  const publishedAt = new Date(review.publishedAt);
  const date = Number.isNaN(publishedAt.getTime())
    ? ""
    : publishedAt.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long"
      });

  return (
    <section className="panel latest-review">
      <div className="latest-review-icon">
        <Newspaper size={22} aria-hidden />
      </div>
      <div>
        <p className="eyebrow">{date ? `Свежий обзор · ${date}` : "Свежий обзор"}</p>
        <h2>{review.title}</h2>
        <p>{review.preview}</p>
      </div>
      <a className="primary-action latest-review-action" href={appHref("/reviews")}>
        <BookOpen size={18} aria-hidden />
        Читать
      </a>
    </section>
  );
}
