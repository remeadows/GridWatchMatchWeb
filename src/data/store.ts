export interface StoreItem {
  id: string;
  title: string;
  description: string;
  displayPrice: string;
  coins?: number;
  badge?: string;
}

export const coinPacks: StoreItem[] = [
  { id: "com.warsignallabs.gridwatchmatch.coins.small", title: "Small Coin Cache", description: "A small cache for Play On offers.", displayPrice: "$1.99", coins: 1_000 },
  { id: "com.warsignallabs.gridwatchmatch.coins.medium", title: "Field Coin Cache", description: "More countermeasure budget for harder sectors.", displayPrice: "$4.99", coins: 3_000, badge: "Popular" },
  { id: "com.warsignallabs.gridwatchmatch.coins.large", title: "Director Coin Cache", description: "High-capacity coin reserve.", displayPrice: "$9.99", coins: 7_000, badge: "Best value" }
];

export const clearancePass: StoreItem = {
  id: "com.warsignallabs.gridwatchmatch.pass.securityclearance",
  title: "Security Clearance Pass",
  description: "Subscription UI preview. Real fulfillment is disabled for the web beta.",
  displayPrice: "$4.99/mo",
  badge: "Web beta"
};

export const playOnCost = 500;
export const playOnExtraMoves = 5;
