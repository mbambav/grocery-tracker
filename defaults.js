// Cold-start reference data: typical shelf life (in days) by category.
// Used ONLY as a fallback before the app has enough purchase history of its own
// to infer real lasting-durations for a specific household.
// Source: general USDA / FoodSafety.gov storage guidance, rounded to sane defaults.

export const CATEGORIES = [
  { id: 'produce-leafy', label: 'Leafy greens & herbs', perishable: true, shelfLifeDays: 5 },
  { id: 'produce-soft-fruit', label: 'Soft fruit (berries, stone fruit)', perishable: true, shelfLifeDays: 5 },
  { id: 'produce-hard-fruit', label: 'Hard fruit (apples, citrus)', perishable: true, shelfLifeDays: 21 },
  { id: 'produce-root', label: 'Root veg & squash', perishable: true, shelfLifeDays: 21 },
  { id: 'produce-other-veg', label: 'Other fresh vegetables', perishable: true, shelfLifeDays: 9 },
  { id: 'dairy-milk', label: 'Milk & cream', perishable: true, shelfLifeDays: 7 },
  { id: 'dairy-cheese-soft', label: 'Soft cheese', perishable: true, shelfLifeDays: 10 },
  { id: 'dairy-cheese-hard', label: 'Hard cheese', perishable: true, shelfLifeDays: 30 },
  { id: 'dairy-yogurt', label: 'Yogurt', perishable: true, shelfLifeDays: 14 },
  { id: 'eggs', label: 'Eggs', perishable: true, shelfLifeDays: 28 },
  { id: 'meat-fresh', label: 'Fresh meat & poultry', perishable: true, shelfLifeDays: 3 },
  { id: 'meat-frozen', label: 'Frozen meat & poultry', perishable: true, shelfLifeDays: 120 },
  { id: 'seafood-fresh', label: 'Fresh seafood', perishable: true, shelfLifeDays: 2 },
  { id: 'bread', label: 'Bread & bakery', perishable: true, shelfLifeDays: 6 },
  { id: 'pantry-dry', label: 'Pantry / dry goods', perishable: false, shelfLifeDays: 270 },
  { id: 'pantry-canned', label: 'Canned goods', perishable: false, shelfLifeDays: 540 },
  { id: 'frozen-other', label: 'Other frozen', perishable: false, shelfLifeDays: 180 },
  { id: 'condiments', label: 'Condiments & sauces', perishable: false, shelfLifeDays: 120 },
  { id: 'snacks', label: 'Snacks', perishable: false, shelfLifeDays: 60 },
  { id: 'beverages', label: 'Beverages', perishable: false, shelfLifeDays: 90 },
  { id: 'household', label: 'Household / non-food', perishable: false, shelfLifeDays: 365 },
  { id: 'other', label: 'Other', perishable: false, shelfLifeDays: 30 },
];

export function categoryDefault(categoryId) {
  return CATEGORIES.find(c => c.id === categoryId) || CATEGORIES[CATEGORIES.length - 1];
}
