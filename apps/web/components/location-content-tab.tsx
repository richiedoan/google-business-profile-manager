"use client";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  ContentCommandSchema,
  MAX_PHOTO_BYTES,
  PhotoCategorySchema,
  type ContentCommand,
  type ContentKind,
  type LocalPost,
  type PostDraft,
  type Review,
} from "@gbp/contracts";
import { useLanguage } from "../lib/i18n";
import { useMe } from "../lib/auth";
import {
  useContentMutation,
  useLocationContent,
} from "../lib/location-content";
import { EmptyState, ErrorState, LoadingState } from "./data-states";

function Modal({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { t } = useLanguage();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`content-dialog ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="content-dialog-heading">
        <h2>{title}</h2>
        <button type="button" aria-label={t("Close")} onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Copy({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 240 || text.split("\n").length > 5;
  const { t } = useLanguage();
  return (
    <>
      <p
        className={`content-copy${expanded || !long ? "" : " content-copy-clamped"}`}
      >
        {text}
      </p>
      {long && (
        <button
          className="detail-expand-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {t(expanded ? "Show less" : "Show more")}
        </button>
      )}
    </>
  );
}
function DisplayDate({ value }: { value: string | null }) {
  const { language } = useLanguage();
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-US", {
        dateStyle: "medium",
      }).format(new Date(value))}
    </time>
  );
}
const blankPost: PostDraft = {
  summary: "",
  languageCode: "en",
  topicType: "STANDARD",
  imageUrl: null,
  actionType: "NONE",
  actionUrl: null,
  event: null,
  offer: null,
};
export function LocationContentTab({
  locationId,
  connectionId,
  kind,
  canWrite,
}: {
  locationId: string;
  connectionId?: string;
  kind: ContentKind;
  canWrite: boolean;
}) {
  const { t, language } = useLanguage();
  const me = useMe();
  const query = useLocationContent(
    me.data?.id ?? "",
    connectionId,
    locationId,
    kind,
  );
  const mutation = useContentMutation(
    me.data?.id ?? "",
    connectionId,
    locationId,
  );
  const [editor, setEditor] = useState<"media" | "post" | Review | null>(null);
  const [editingPost, setEditingPost] = useState<LocalPost | null>(null);
  const [draft, setDraft] = useState<PostDraft>({
    ...blankPost,
    languageCode: language,
  });
  const [deleteCommand, setDeleteCommand] = useState<ContentCommand | null>(
    null,
  );
  const [filter, setFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const [validation, setValidation] = useState("");
  const items = Array.from(
    new Map(
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [
        item.id,
        item,
      ]),
    ).values(),
  );
  const page = query.data?.pages[0];
  const available = page?.available === true;
  const writable = canWrite && available;
  const title = t(
    kind === "media"
      ? "Photos & videos"
      : kind === "posts"
        ? "Posts"
        : "Reviews",
  );
  const busy = mutation.isPending;
  function openEditor(next: typeof editor) {
    mutation.reset();
    setValidation("");
    setNotice("");
    setEditor(next);
  }
  function closeEditor() {
    if (!busy) {
      setEditor(null);
      setEditingPost(null);
      setDeleteCommand(null);
      mutation.reset();
    }
  }
  async function submit(input: ContentCommand | FormData) {
    if (mutation.isPending) return;
    if (!(input instanceof FormData)) {
      const parsed = ContentCommandSchema.safeParse(input);
      if (!parsed.success) {
        setValidation(t("Check the required fields, dates and HTTPS links."));
        return;
      }
      input = parsed.data;
    }
    setValidation("");
    setNotice("");
    try {
      await mutation.mutateAsync(input);
      setEditor(null);
      setEditingPost(null);
      setDeleteCommand(null);
      setNotice(t("Changes saved."));
    } catch {
      /* ErrorState uses the normalized domain error. */
    }
  }
  function startPost(post?: LocalPost) {
    setEditingPost(post ?? null);
    setDraft(post?.draft ?? { ...blankPost, languageCode: language });
    openEditor("post");
  }
  function requestDelete(command: ContentCommand) {
    mutation.reset();
    setNotice("");
    setDeleteCommand(command);
  }
  function mediaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      if (
        file.size > MAX_PHOTO_BYTES ||
        !["image/jpeg", "image/png"].includes(file.type)
      ) {
        setValidation(t("Choose a JPG or PNG image up to 4 MB."));
        return;
      }
      const payload = new FormData();
      payload.set("file", file);
      payload.set("category", String(form.get("category")));
      void submit(payload);
    } else
      void submit({
        operation: "ADD_MEDIA",
        sourceUrl: String(form.get("sourceUrl") ?? ""),
        category: String(form.get("category")) as "ADDITIONAL",
        format: String(form.get("format")) as "PHOTO",
      });
  }
  const visibleItems = items.filter(
    (item) =>
      item.kind !== "reviews" ||
      filter === "all" ||
      (filter === "replied" ? !!item.reply : !item.reply),
  );
  return (
    <section className="location-content" aria-label={title}>
      <div className="content-section-heading">
        <div>
          <h2>{title}</h2>
          {kind === "media" && available && (
            <p>
              {page?.totalMediaItems != null
                ? t("{count} photos and videos", {
                    count: page.totalMediaItems.toLocaleString(
                      language === "vi" ? "vi-VN" : "en-US",
                    ),
                  })
                : query.hasNextPage
                  ? t("{count} media loaded", { count: items.length })
                  : t("{count} photos and videos", { count: items.length })}
            </p>
          )}
          {kind === "reviews" && page?.totalReviews != null && (
            <p>
              {page.averageRating != null && (
                <strong className="review-rating">
                  {page.averageRating.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}{" "}
                  ★{" "}
                </strong>
              )}
              {t("{count} reviews", { count: page.totalReviews })}
            </p>
          )}
        </div>
        {writable && kind !== "reviews" && (
          <button
            type="button"
            onClick={() =>
              kind === "media" ? openEditor("media") : startPost()
            }
          >
            {t(kind === "media" ? "Add photo or video" : "Add post")}
          </button>
        )}
      </div>
      {notice && (
        <p className="content-notice" role="status">
          {notice}
        </p>
      )}
      {query.isPending ? (
        <ContentSkeleton kind={kind} />
      ) : query.isError && !query.data ? (
        <ErrorState
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : !available ? (
        <EmptyState
          title={t("Connect Google to use this feature")}
          message={t(
            "Media, posts and reviews are available for connected Google Business profiles.",
          )}
        />
      ) : (
        <>
          {kind === "reviews" && items.length > 0 && (
            <div
              className="review-filters"
              role="group"
              aria-label={t("Filter reviews")}
            >
              {["all", "replied", "unreplied"].map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {t(
                    value === "all"
                      ? "All reviews"
                      : value === "replied"
                        ? "Replied"
                        : "Not replied",
                  )}
                </button>
              ))}
              {filter !== "all" && query.hasNextPage && (
                <p>
                  {t(
                    "Filters apply to loaded reviews. Load more to see additional matches.",
                  )}
                </p>
              )}
            </div>
          )}
          {visibleItems.length === 0 ? (
            <EmptyState
              title={t(
                kind === "media"
                  ? "No media yet"
                  : kind === "posts"
                    ? "No posts yet"
                    : "No reviews found",
              )}
              message={t(
                kind === "reviews"
                  ? items.length > 0
                    ? "Try another filter or load more reviews."
                    : "Customer reviews will appear here when they are available on Google."
                  : "New content will appear here after it is published on Google.",
              )}
            />
          ) : (
            <div
              className={
                kind === "media" ? "content-media-grid" : "content-list"
              }
            >
              {visibleItems.map((item) =>
                item.kind === "media" ? (
                  <article className="content-media-card" key={item.id}>
                    <div className="content-media-visual">
                      {item.url ? (
                        <a
                          className="content-media-preview"
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t("View media details on Google")}
                        >
                          {item.thumbnailUrl || item.format === "PHOTO" ? (
                            <img
                              src={item.thumbnailUrl ?? item.url}
                              alt={t(
                                item.format === "VIDEO"
                                  ? "Business video"
                                  : "Business photo",
                              )}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="media-placeholder">
                              {t("Video")}
                            </span>
                          )}
                          <span
                            className="content-media-hover"
                            aria-hidden="true"
                          >
                            {t("Click to see details")}
                          </span>
                        </a>
                      ) : item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt={t(
                            item.format === "VIDEO"
                              ? "Business video"
                              : "Business photo",
                          )}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="media-placeholder">
                          {t("Preview unavailable")}
                        </span>
                      )}
                      <div className="content-media-caption">
                        <div className="content-media-links">
                          {item.viewCount != null && (
                            <span className="content-media-views">
                              {t("{count} views", {
                                count: BigInt(item.viewCount).toLocaleString(
                                  language === "vi" ? "vi-VN" : "en-US",
                                ),
                              })}
                            </span>
                          )}
                        </div>
                        {writable && (
                          <button
                            type="button"
                            className="content-media-delete"
                            aria-label={t("Delete media")}
                            title={t("Delete media")}
                            onClick={() =>
                              requestDelete({
                                operation: "DELETE_MEDIA",
                                id: item.id,
                              })
                            }
                          >
                            <svg
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    {(item.createdAt || item.attribution) && (
                      <div className="content-media-metadata">
                        {item.createdAt &&
                          !Number.isNaN(Date.parse(item.createdAt)) && (
                            <p className="content-media-date">
                              <span>{t("Posted on")}</span>{" "}
                              <DisplayDate value={item.createdAt} />
                            </p>
                          )}
                        {item.attribution && (
                          <div className="content-media-contributor">
                            {item.attribution.profilePhotoUrl && (
                              <img
                                src={item.attribution.profilePhotoUrl}
                                alt=""
                                loading="lazy"
                                referrerPolicy="no-referrer"
                              />
                            )}
                            <div>
                              <span className="content-contributor-label">
                                {t("Contributor")}
                              </span>
                              {item.attribution.profileUrl ? (
                                <a
                                  href={item.attribution.profileUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {item.attribution.profileName ||
                                    t("View contributor")}
                                </a>
                              ) : (
                                item.attribution.profileName && (
                                  <span>{item.attribution.profileName}</span>
                                )
                              )}
                              {item.attribution.takedownUrl && (
                                <a
                                  className="content-media-report"
                                  href={item.attribution.takedownUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {t("Report media")}
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                ) : item.kind === "posts" ? (
                  <article className="content-post-card card" key={item.id}>
                    {item.imageUrl && (
                      <a
                        href={item.url ?? item.imageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={item.imageUrl}
                          alt={t("Post image")}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      </a>
                    )}
                    <div className="content-post-body">
                      <div className="content-meta">
                        <span>{t(item.topicType)}</span>
                        <DisplayDate value={item.createdAt} />
                        {item.state && <span>{t(item.state)}</span>}
                      </div>
                      <Copy text={item.summary} />
                      {item.draft?.event && (
                        <p>
                          {item.draft.event.title} ·{" "}
                          {item.draft.event.startDate} –{" "}
                          {item.draft.event.endDate}
                        </p>
                      )}
                      <div className="content-actions">
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t("View on Google")}
                          </a>
                        )}
                        {writable && (
                          <>
                            {item.draft && (
                              <button
                                type="button"
                                onClick={() => startPost(item)}
                              >
                                {t("Edit")}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                requestDelete({
                                  operation: "DELETE_POST",
                                  id: item.id,
                                })
                              }
                            >
                              {t("Delete")}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                ) : (
                  <article className="content-review-card card" key={item.id}>
                    <div className="review-heading">
                      {item.avatarUrl ? (
                        <img
                          src={item.avatarUrl}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="review-avatar" aria-hidden="true">
                          {(item.reviewer || "?").slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div>
                        <h3>{item.reviewer || t("Anonymous reviewer")}</h3>
                        <div className="content-meta">
                          <span
                            className="review-stars"
                            aria-label={t("{rating} out of 5 stars", {
                              rating: item.rating,
                            })}
                          >
                            {"★".repeat(item.rating)}
                            {"☆".repeat(5 - item.rating)}
                          </span>
                          <DisplayDate value={item.updatedAt} />
                        </div>
                      </div>
                    </div>
                    {item.comment && <Copy text={item.comment} />}
                    {item.reply && (
                      <div className="review-reply">
                        <strong>{t("Your reply")}</strong>
                        <Copy text={item.reply.comment} />
                        <DisplayDate value={item.reply.updatedAt} />
                      </div>
                    )}
                    {writable && (
                      <div className="content-actions">
                        <button type="button" onClick={() => openEditor(item)}>
                          {t(item.reply ? "Edit reply" : "Reply")}
                        </button>
                        {item.reply && (
                          <button
                            type="button"
                            onClick={() =>
                              requestDelete({
                                operation: "DELETE_REPLY",
                                id: item.id,
                              })
                            }
                          >
                            {t("Delete reply")}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                ),
              )}
            </div>
          )}
          {query.isError && query.data && (
            <ErrorState
              error={query.error}
              onRetry={() => {
                void (query.isFetchNextPageError
                  ? query.fetchNextPage()
                  : query.refetch());
              }}
            />
          )}
          {query.hasNextPage && (
            <div className="content-load-more">
              <button
                type="button"
                disabled={query.isFetching}
                onClick={() => {
                  void query.fetchNextPage({ cancelRefetch: false });
                }}
              >
                {t(query.isFetchingNextPage ? "Loading..." : "Load more")}
              </button>
            </div>
          )}
        </>
      )}
      {(editor || deleteCommand) && (
        <Modal
          title={t(
            deleteCommand
              ? "Confirm deletion"
              : editor === "media"
                ? "Add photo or video"
                : editor === "post"
                  ? editingPost
                    ? "Edit post"
                    : "Add post"
                  : "Reply to review",
          )}
          onClose={closeEditor}
        >
          {deleteCommand ? (
            <>
              <p>
                {t(
                  "This will remove the selected content from Google. This action cannot be undone.",
                )}
              </p>
              <div className="content-form-actions">
                <button type="button" disabled={busy} onClick={closeEditor}>
                  {t("Cancel")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void submit(deleteCommand);
                  }}
                >
                  {t(busy ? "Saving..." : "Delete")}
                </button>
              </div>
            </>
          ) : editor === "media" ? (
            <form className="content-form" onSubmit={mediaSubmit}>
              <p>
                {t(
                  "Choose an image from your device, or provide a public HTTPS photo/video URL.",
                )}
              </p>
              <label>
                {t("Photo file")}
                <input
                  name="file"
                  type="file"
                  accept="image/jpeg,image/png"
                  disabled={busy}
                />
              </label>
              <small>
                {t(
                  "JPG or PNG, up to 4 MB. File upload takes priority over the URL.",
                )}
              </small>
              <label>
                {t("Media URL")}
                <input
                  name="sourceUrl"
                  type="url"
                  placeholder="https://..."
                  maxLength={4096}
                  disabled={busy}
                />
              </label>
              <label>
                {t("Media type (URL)")}
                <select name="format" disabled={busy}>
                  <option value="PHOTO">{t("Photo")}</option>
                  <option value="VIDEO">{t("Video")}</option>
                </select>
              </label>
              <label>
                {t("Category")}
                <select name="category" disabled={busy}>
                  {PhotoCategorySchema.options.map((category) => (
                    <option value={category} key={category}>
                      {t(category)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="content-hint">
                {t(
                  "Google may take time to process media and choose which cover image appears publicly.",
                )}
              </p>
              <FormActions busy={busy} onCancel={closeEditor} label="Upload" />
            </form>
          ) : editor === "post" ? (
            <form
              className="content-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit(
                  editingPost
                    ? { operation: "UPDATE_POST", id: editingPost.id, draft }
                    : { operation: "CREATE_POST", draft },
                );
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  {t("Post type")}
                  <select
                    value={draft.topicType}
                    onChange={(event) => {
                      const topicType = event.target
                        .value as PostDraft["topicType"];
                      setDraft({
                        ...draft,
                        topicType,
                        event:
                          topicType === "STANDARD"
                            ? null
                            : (draft.event ?? {
                                title: "",
                                startDate: "",
                                endDate: "",
                                startTime: "09:00",
                                endTime: "17:00",
                              }),
                        offer:
                          topicType === "OFFER"
                            ? (draft.offer ?? {
                                couponCode: "",
                                redeemOnlineUrl: null,
                                termsConditions: "",
                              })
                            : null,
                      });
                    }}
                  >
                    {["STANDARD", "EVENT", "OFFER"].map((type) => (
                      <option key={type} value={type}>
                        {t(type)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Post content")}
                  <textarea
                    required
                    maxLength={1500}
                    rows={6}
                    value={draft.summary}
                    onChange={(event) =>
                      setDraft({ ...draft, summary: event.target.value })
                    }
                  />
                </label>
                <label>
                  {t("Post language")}
                  <input
                    required
                    maxLength={20}
                    value={draft.languageCode}
                    onChange={(event) =>
                      setDraft({ ...draft, languageCode: event.target.value })
                    }
                  />
                </label>
                <label>
                  {t("Image URL")}
                  <input
                    type="url"
                    maxLength={4096}
                    value={draft.imageUrl ?? ""}
                    placeholder="https://..."
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        imageUrl: event.target.value || null,
                      })
                    }
                  />
                </label>
                {draft.topicType !== "OFFER" && (
                  <>
                    <label>
                      {t("Action button")}
                      <select
                        value={draft.actionType}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            actionType: event.target
                              .value as PostDraft["actionType"],
                          })
                        }
                      >
                        {[
                          "NONE",
                          "BOOK",
                          "ORDER",
                          "SHOP",
                          "LEARN_MORE",
                          "SIGN_UP",
                          "CALL",
                        ].map((action) => (
                          <option key={action} value={action}>
                            {t(action)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!["NONE", "CALL"].includes(draft.actionType) && (
                      <label>
                        {t("Action URL")}
                        <input
                          required
                          type="url"
                          value={draft.actionUrl ?? ""}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              actionUrl: event.target.value || null,
                            })
                          }
                        />
                      </label>
                    )}
                  </>
                )}
                {draft.event && (
                  <>
                    <label>
                      {t("Event title")}
                      <input
                        required
                        maxLength={58}
                        value={draft.event.title}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            event: {
                              ...draft.event!,
                              title: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <div className="content-form-grid">
                      {(
                        [
                          "startDate",
                          "endDate",
                          "startTime",
                          "endTime",
                        ] as const
                      ).map((field) => (
                        <label key={field}>
                          {t(
                            {
                              startDate: "Start date",
                              endDate: "End date",
                              startTime: "Start time",
                              endTime: "End time",
                            }[field],
                          )}
                          <input
                            required
                            type={field.endsWith("Date") ? "date" : "time"}
                            value={draft.event![field]}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                event: {
                                  ...draft.event!,
                                  [field]: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {draft.offer && (
                  <>
                    {(
                      [
                        "couponCode",
                        "redeemOnlineUrl",
                        "termsConditions",
                      ] as const
                    ).map((field) => (
                      <label key={field}>
                        {t(
                          {
                            couponCode: "Coupon code",
                            redeemOnlineUrl: "Redemption URL",
                            termsConditions: "Offer terms",
                          }[field],
                        )}
                        <input
                          type={field === "redeemOnlineUrl" ? "url" : "text"}
                          maxLength={
                            field === "termsConditions"
                              ? 5000
                              : field === "couponCode"
                                ? 100
                                : 4096
                          }
                          value={draft.offer![field] ?? ""}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              offer: {
                                ...draft.offer!,
                                [field]:
                                  field === "redeemOnlineUrl"
                                    ? event.target.value || null
                                    : event.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </>
                )}
              </fieldset>
              <FormActions
                busy={busy}
                onCancel={closeEditor}
                label={editingPost ? "Save changes" : "Publish post"}
              />
            </form>
          ) : (
            typeof editor === "object" &&
            editor && (
              <form
                className="content-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void submit({
                    operation: "REPLY_REVIEW",
                    id: editor.id,
                    comment: String(form.get("comment") ?? ""),
                  });
                }}
              >
                <div className="review-original">
                  <strong>{editor.reviewer || t("Anonymous reviewer")}</strong>
                  <Copy text={editor.comment} />
                </div>
                <label>
                  {t("Your reply")}
                  <textarea
                    name="comment"
                    required
                    maxLength={4096}
                    rows={6}
                    defaultValue={editor.reply?.comment ?? ""}
                    disabled={busy}
                  />
                </label>
                <FormActions
                  busy={busy}
                  onCancel={closeEditor}
                  label="Publish reply"
                />
              </form>
            )
          )}
          {validation && (
            <p className="content-validation" role="alert">
              {validation}
            </p>
          )}
          {mutation.isError && <ErrorState error={mutation.error} />}
          {busy && <LoadingState message={t("Saving...")} />}
        </Modal>
      )}
    </section>
  );
}
function FormActions({
  busy,
  onCancel,
  label,
}: {
  busy: boolean;
  onCancel: () => void;
  label: string;
}) {
  const { t } = useLanguage();
  return (
    <div className="content-form-actions">
      <button type="button" disabled={busy} onClick={onCancel}>
        {t("Cancel")}
      </button>
      <button type="submit" disabled={busy}>
        {t(busy ? "Saving..." : label)}
      </button>
    </div>
  );
}
function ContentSkeleton({ kind }: { kind: ContentKind }) {
  const { t } = useLanguage();
  return (
    <div
      role="status"
      aria-label={t("Loading...")}
      className={kind === "media" ? "content-media-grid" : "content-list"}
    >
      <span className="sr-only">{t("Loading...")}</span>
      {[0, 1, 2].map((index) => (
        <div key={index} aria-hidden="true" className="content-skeleton">
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-short" />
        </div>
      ))}
    </div>
  );
}
