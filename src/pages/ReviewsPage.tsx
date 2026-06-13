import { marked } from "marked";
import { BookOpen, Calendar, ChevronRight, Newspaper, X } from "lucide-react";
import type { ReactNode } from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useReviews } from "../api/useReviews";
import { LoadingState } from "../components/LoadingState";
import type { Review } from "../domain/types";

marked.setOptions({ breaks: true });

export function ReviewsPage() {
  const { reviews, isLoading, error } = useReviews();
  const [openReview, setOpenReview] = useState<Review | null>(null);

  if (isLoading) {
    return <LoadingState label="Загружаем обзоры" />;
  }

  if (error) {
    return (
      <section className="panel empty-state">
        <Newspaper aria-hidden />
        <h2>Не удалось загрузить обзоры</h2>
        <p>{error}</p>
      </section>
    );
  }

  if (!reviews.length) {
    return (
      <section className="panel empty-state">
        <Newspaper aria-hidden />
        <h2>Обзоров пока нет</h2>
        <p>Первый обзор появится после старта турнира.</p>
      </section>
    );
  }

  return (
    <>
      <div className="stack">
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Ежедневная аналитика</p>
              <h2>Обзоры турнира</h2>
            </div>
            <Newspaper size={28} aria-hidden />
          </div>
          <div className="review-list">
            {reviews.map((review, idx) => (
              <ReviewCard
                key={review.id}
                review={review}
                isLatest={idx === 0}
                onOpen={() => setOpenReview(review)}
              />
            ))}
          </div>
        </section>
      </div>

      {openReview && (
        <ReviewModal review={openReview} onClose={() => setOpenReview(null)} />
      )}
    </>
  );
}

function ReviewCard({
  review,
  isLatest,
  onOpen,
}: {
  review: Review;
  isLatest: boolean;
  onOpen: () => void;
}) {
  const date = new Date(review.publishedAt);
  const dateStr = date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <article className="review-card">
      <div className="review-card-top">
        <div className="review-card-meta">
          <Calendar size={13} aria-hidden />
          <span>{dateStr}</span>
          {review.author && <span className="review-author">{review.author}</span>}
        </div>
        {isLatest && <span className="review-badge">Новый</span>}
      </div>
      <h3 className="review-card-title">{review.title}</h3>
      <p className="review-card-preview">{review.preview}</p>
      <button
        type="button"
        className="review-read-btn"
        onClick={onOpen}
        aria-label={`Читать обзор: ${review.title}`}
      >
        <BookOpen size={15} aria-hidden />
        Читать полностью
        <ChevronRight size={15} aria-hidden />
      </button>
    </article>
  );
}

function ReviewModal({
  review,
  onClose,
}: {
  review: Review;
  onClose: () => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const date = new Date(review.publishedAt);
  const dateStr = date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const markdown = renderMarkdown(marked.lexer(review.body));

  return (
    <div
      className="match-dialog-backdrop"
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={review.title}
    >
      <div className="match-dialog review-dialog">
        <div className="match-dialog-header">
          <div>
            <h2>{review.title}</h2>
            <p>
              {dateStr}
              {review.author && <> · {review.author}</>}
            </p>
          </div>
          <button
            className="icon-button close-dialog"
            type="button"
            onClick={onClose}
            aria-label="Закрыть обзор"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="review-body">{markdown}</div>
      </div>
    </div>
  );
}

type MarkdownToken = ReturnType<typeof marked.lexer>[number];

function renderMarkdown(tokens: MarkdownToken[]) {
  return tokens.map((token, index) => renderBlock(token, `block-${index}`));
}

function renderBlock(token: MarkdownToken, key: string): ReactNode {
  const data = token as Record<string, unknown>;
  switch (token.type) {
    case "heading": {
      const depth = Number(data.depth ?? 2);
      const children = renderInlineTokens(data.tokens, String(data.text ?? ""));
      if (depth <= 1) return <h1 key={key}>{children}</h1>;
      if (depth === 2) return <h2 key={key}>{children}</h2>;
      return <h3 key={key}>{children}</h3>;
    }
    case "paragraph":
      return <p key={key}>{renderInlineTokens(data.tokens, String(data.text ?? ""))}</p>;
    case "list": {
      const items = Array.isArray(data.items) ? data.items : [];
      const children = items.map((item, index) => {
        const itemData = item as Record<string, unknown>;
        const itemTokens = Array.isArray(itemData.tokens) ? itemData.tokens as MarkdownToken[] : [];
        const itemText = String(itemData.text ?? "");
        return (
          <li key={`${key}-item-${index}`}>
            {itemTokens.length ? renderMarkdown(itemTokens) : renderInlineText(itemText)}
          </li>
        );
      });
      return data.ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>;
    }
    case "blockquote": {
      const quoteTokens = Array.isArray(data.tokens) ? data.tokens as MarkdownToken[] : [];
      return <blockquote key={key}>{renderMarkdown(quoteTokens)}</blockquote>;
    }
    case "hr":
      return <hr key={key} />;
    case "space":
      return null;
    default:
      return null;
  }
}

function renderInlineTokens(tokens: unknown, fallback: string): ReactNode {
  if (!Array.isArray(tokens)) {
    return renderInlineText(fallback);
  }

  return tokens.map((token, index) => renderInline(token as Record<string, unknown>, `inline-${index}`));
}

function renderInline(token: Record<string, unknown>, key: string): ReactNode {
  const type = String(token.type ?? "");
  const text = String(token.text ?? "");
  switch (type) {
    case "strong":
      return <strong key={key}>{renderInlineTokens(token.tokens, text)}</strong>;
    case "em":
      return <em key={key}>{renderInlineTokens(token.tokens, text)}</em>;
    case "codespan":
      return <code key={key}>{text}</code>;
    case "br":
      return <br key={key} />;
    case "link":
      return (
        <a key={key} href={safeHref(String(token.href ?? ""))} rel="noreferrer" target="_blank">
          {renderInlineTokens(token.tokens, text)}
        </a>
      );
    case "text":
    case "escape":
      return <Fragment key={key}>{renderInlineText(text)}</Fragment>;
    default:
      return null;
  }
}

function renderInlineText(text: string) {
  return text;
}

function safeHref(href: string) {
  return /^(https?:|mailto:|\/)/i.test(href) ? href : "#";
}
