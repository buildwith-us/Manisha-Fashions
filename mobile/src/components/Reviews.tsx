import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Divider, EmptyState, Group, SectionLabel } from './ui';
import { Icon } from './Icon';
import { PressableScale } from './motion';
import { colors, radius, spacing, typography } from '../theme';
import type { RatingSummary, Review } from '../api/types';

/**
 * Reviews & ratings for the product detail screen — App Store shaped: a big
 * average with a star histogram, then the individual reviews beneath it.
 *
 * Colours come entirely from the theme; stars use the single accent, and
 * everything else is the existing near-monochrome ramp.
 */

const STAR_SIZES = { sm: 13, md: 16, lg: 20 } as const;

/** A read-only row of five stars, filled to `value`. */
export function Stars({
  value,
  size = 'md',
  color = colors.primary,
}: {
  value: number;
  size?: keyof typeof STAR_SIZES;
  color?: string;
}) {
  const px = STAR_SIZES[size];
  return (
    <View style={styles.starRow} accessibilityLabel={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Icon
          key={star}
          name="star"
          size={px}
          // A half-filled star is rounded up so a 4.5 still reads as generous
          // rather than mean; the numeral beside it carries the precision.
          color={star <= Math.round(value) ? color : colors.textDisabled}
          strokeWidth={1.8}
        />
      ))}
    </View>
  );
}

/** The tappable star picker used when writing a review. */
function StarPicker({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable
          key={star}
          onPress={() => onChange(star)}
          hitSlop={8}
          accessibilityRole="radio"
          accessibilityState={{ selected: star === value }}
          accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
          style={styles.starTap}
        >
          <Icon
            name="star"
            size={28}
            color={star <= value ? colors.primary : colors.textDisabled}
            strokeWidth={1.8}
          />
        </Pressable>
      ))}
    </View>
  );
}

/** Average, count and the per-star histogram. */
export function RatingSummaryBlock({ summary }: { summary: RatingSummary }) {
  const max = Math.max(1, ...summary.breakdown);

  return (
    <View style={styles.summary}>
      <View style={styles.summaryLeft}>
        <Text style={styles.average}>{summary.average.toFixed(1)}</Text>
        <Stars value={summary.average} size="sm" />
        <Text style={styles.summaryCount}>
          {summary.count} review{summary.count === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={styles.histogram}>
        {[5, 4, 3, 2, 1].map((star) => {
          const count = summary.breakdown[star - 1];
          return (
            <View key={star} style={styles.histogramRow}>
              <Text style={styles.histogramStar}>{star}</Text>
              <View style={styles.histogramTrack}>
                <View style={[styles.histogramFill, { width: `${(count / max) * 100}%` }]} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function ReviewRow({ review, onDelete }: { review: Review; onDelete?: () => void }) {
  return (
    <View style={styles.review}>
      <View style={styles.reviewTop}>
        <Stars value={review.rating} size="sm" />
        <Text style={styles.reviewDate}>{formatDate(review.createdAt)}</Text>
      </View>

      <View style={styles.reviewAuthorRow}>
        <Text style={styles.reviewAuthor}>{review.author}</Text>
        {review.verifiedPurchase ? (
          <View style={styles.verified}>
            <Icon name="check" size={11} color={colors.success} strokeWidth={2.4} />
            <Text style={styles.verifiedLabel}>Verified purchase</Text>
          </View>
        ) : null}
      </View>

      {review.comment ? <Text style={styles.reviewBody}>{review.comment}</Text> : null}

      {review.mine && onDelete ? (
        <PressableScale onPress={onDelete} hitSlop={8} accessibilityRole="button">
          <Text style={styles.removeReview}>Remove my review</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

/** Star picker plus comment box. The caller decides who is allowed to see it. */
export function WriteReview({
  initialRating,
  initialComment,
  submitting,
  onSubmit,
}: {
  initialRating?: number;
  initialComment?: string;
  submitting: boolean;
  onSubmit: (input: { rating: number; comment?: string }) => void;
}) {
  const [rating, setRating] = useState(initialRating ?? 0);
  const [comment, setComment] = useState(initialComment ?? '');

  return (
    <View style={styles.write}>
      <StarPicker value={rating} onChange={setRating} />

      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="What did you think? (optional)"
        placeholderTextColor={colors.textPlaceholder}
        multiline
        maxLength={2000}
        style={styles.commentInput}
        textAlignVertical="top"
      />

      <Button
        label={initialRating ? 'Update review' : 'Submit review'}
        onPress={() => onSubmit({ rating, comment: comment.trim() || undefined })}
        // A review with no stars is not a review; the button stays inert until
        // one is picked rather than failing server-side.
        disabled={rating === 0 || submitting}
        loading={submitting}
      />
    </View>
  );
}

export function ReviewsSection({
  summary,
  reviews,
  canWrite,
  writing,
  submitting,
  hasMore,
  loadingMore,
  myReview,
  onStartWriting,
  onSubmit,
  onDelete,
  onLoadMore,
  signInPrompt,
}: {
  summary: RatingSummary;
  reviews: Review[];
  canWrite: boolean;
  writing: boolean;
  submitting: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  myReview?: Review;
  onStartWriting: () => void;
  onSubmit: (input: { rating: number; comment?: string }) => void;
  onDelete: () => void;
  onLoadMore: () => void;
  /** Shown instead of the write button for a guest. */
  signInPrompt?: () => void;
}) {
  return (
    <View style={styles.section}>
      <SectionLabel>Ratings & reviews</SectionLabel>

      {summary.count > 0 ? (
        <Group>
          <RatingSummaryBlock summary={summary} />
        </Group>
      ) : null}

      {writing ? (
        <Group style={styles.writeGroup}>
          <WriteReview
            initialRating={myReview?.rating}
            initialComment={myReview?.comment}
            submitting={submitting}
            onSubmit={onSubmit}
          />
        </Group>
      ) : (
        <Button
          label={myReview ? 'Edit your review' : 'Write a review'}
          variant="secondary"
          onPress={canWrite ? onStartWriting : (signInPrompt ?? onStartWriting)}
        />
      )}

      {summary.count === 0 ? (
        <EmptyState
          icon="star"
          title="No reviews yet"
          message="Be the first to review this piece."
        />
      ) : (
        <Group style={styles.reviewList}>
          {reviews.map((review, index) => (
            <View key={review.id}>
              {index > 0 ? <Divider /> : null}
              <ReviewRow review={review} onDelete={review.mine ? onDelete : undefined} />
            </View>
          ))}
        </Group>
      )}

      {hasMore ? (
        <Button
          label={loadingMore ? 'Loading…' : 'Load more reviews'}
          variant="secondary"
          onPress={onLoadMore}
          disabled={loadingMore}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: spacing.xl, gap: spacing.md, marginTop: spacing.xl },

  starRow: { flexDirection: 'row', gap: spacing.xs },
  starTap: { padding: spacing.xs },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.xl,
  },
  summaryLeft: { alignItems: 'center', gap: spacing.xs },
  average: { ...typography.display, color: colors.text },
  summaryCount: { ...typography.footnote, color: colors.textFaint },

  histogram: { flex: 1, gap: spacing.xs },
  histogramRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  histogramStar: { ...typography.footnote, color: colors.textFaint, width: 10 },
  histogramTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
    overflow: 'hidden',
  },
  histogramFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.primary },

  reviewList: { paddingVertical: spacing.xs },
  review: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  reviewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewDate: { ...typography.footnote, color: colors.textFaint },
  reviewAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reviewAuthor: { ...typography.calloutStrong, color: colors.text },
  verified: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  verifiedLabel: { ...typography.footnote, color: colors.success },
  reviewBody: { ...typography.callout, color: colors.textMuted, lineHeight: 21 },
  removeReview: { ...typography.footnoteStrong, color: colors.primary },

  writeGroup: { padding: spacing.lg },
  write: { gap: spacing.md },
  commentInput: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 88,
  },
});
