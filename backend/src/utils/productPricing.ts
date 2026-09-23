import type { ProductVisibility } from './rbac';

/**
 * Which prices a product must carry, by who it is sold to (PRD 4.7).
 *
 *   retail    → retailPrice only
 *   wholesale → wholesalePrice only
 *   both      → both, with wholesale not above retail
 *
 * A price the product is not sold at is simply absent. Nothing here, or
 * anywhere else, derives one price from the other: the admin types each
 * price the product actually has.
 */
export function needsRetailPrice(visibility: ProductVisibility): boolean {
  return visibility !== 'wholesale';
}

export function needsWholesalePrice(visibility: ProductVisibility): boolean {
  return visibility !== 'retail';
}

export interface PricingIssue {
  field: 'retailPrice' | 'wholesalePrice';
  message: string;
}

export function pricingIssues(
  visibility: ProductVisibility,
  retailPrice: number | null | undefined,
  wholesalePrice: number | null | undefined,
): PricingIssue[] {
  const issues: PricingIssue[] = [];
  const hasRetail = retailPrice !== null && retailPrice !== undefined;
  const hasWholesale = wholesalePrice !== null && wholesalePrice !== undefined;

  if (needsRetailPrice(visibility) && !hasRetail) {
    issues.push({
      field: 'retailPrice',
      message: 'Enter a retail price — this product is sold to retail customers.',
    });
  }
  if (needsWholesalePrice(visibility) && !hasWholesale) {
    issues.push({
      field: 'wholesalePrice',
      message: 'Enter a wholesale price — this product is sold to wholesale customers.',
    });
  }
  if (visibility === 'both' && hasRetail && hasWholesale && wholesalePrice > retailPrice) {
    issues.push({
      field: 'wholesalePrice',
      message: 'Wholesale price should not be higher than retail price',
    });
  }
  return issues;
}

/**
 * The product's price for one tier, or undefined when it is not sold to that
 * tier. A price left stored from before a visibility change is ignored here,
 * so it can never be shown or charged.
 */
export function tierPriceOf(
  product: { visibility?: ProductVisibility; retailPrice?: number; wholesalePrice?: number },
  tier: 'retail' | 'wholesale',
): number | undefined {
  const visibility = product.visibility ?? 'both';
  if (tier === 'retail') return needsRetailPrice(visibility) ? product.retailPrice : undefined;
  return needsWholesalePrice(visibility) ? product.wholesalePrice : undefined;
}
