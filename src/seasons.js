// Seasonality, German calendar.
//
// Why it is done at the INGREDIENT level and not the recipe level: tagging 77
// recipes with months would be 77 chances to be wrong, and it would go stale the
// moment a recipe changes. Tagging the twenty-odd items that actually have a
// German season is one small table that stays true, and a recipe's score falls
// out of its own ingredient list.
//
// Honest about what "out of season" means here: nothing is unavailable in a
// German supermarket in January. Out-of-season produce is imported — dearer,
// travelled further, and it tastes like it. So the penalty is a nudge that
// reorders equally-good options, never a rule that blocks a meal.

/** item name (exactly as written in recipes.js) -> months it is in season, 1-12. */
export const SEASON = {
  // --- leaf and brassica
  'Grünkohl': [11, 12, 1, 2],
  'Weißkohl': [7, 8, 9, 10, 11, 12, 1, 2, 3],
  'Brokkoli': [6, 7, 8, 9, 10],
  'Kopfsalat': [5, 6, 7, 8, 9, 10],
  'Rucola': [4, 5, 6, 7, 8, 9, 10],
  'Römersalat': [5, 6, 7, 8, 9, 10],
  'Sellerie': [8, 9, 10, 11, 12, 1, 2, 3],
  // --- summer fruiting vegetables: the big honest swing of the year
  'Tomaten': [7, 8, 9, 10],
  'Kirschtomaten': [7, 8, 9, 10],
  'Zucchini': [6, 7, 8, 9, 10],
  'Paprika': [7, 8, 9, 10],
  'Spitzpaprika': [7, 8, 9, 10],
  'Gurke': [5, 6, 7, 8, 9, 10],
  'Grüne Bohnen': [7, 8, 9, 10],
  'Zuckerschoten': [6, 7, 8, 9],
  'Radieschen': [4, 5, 6, 7, 8, 9, 10],
  'Frühlingszwiebel': [4, 5, 6, 7, 8, 9, 10],
  // --- roots, bulbs and winter brassica (ranges include the months they are sold
  // from store, which is how the shop actually behaves)
  'Blumenkohl': [6, 7, 8, 9, 10, 11],
  'Rosenkohl': [10, 11, 12, 1, 2],
  'Lauch': [6, 7, 8, 9, 10, 11, 12, 1, 2, 3],
  'Fenchel': [6, 7, 8, 9, 10, 11],
  'Rote Bete': [7, 8, 9, 10, 11, 12, 1, 2, 3],
  'Hokkaido-Kürbis': [8, 9, 10, 11],
  'Blattspinat (frisch)': [3, 4, 5, 9, 10],
  'Kohlrabi': [5, 6, 7, 8, 9, 10],
  'Weisser Rettich': [6, 7, 8, 9, 10, 11],
  // The shortest window in the table, and the one most worth respecting: outside
  // it the shop is selling Peruvian asparagus at twice the price.
  'Grüner Spargel': [4, 5, 6],
  // --- fruit
  'Apfel': [9, 10, 11, 12, 1, 2, 3, 4],
  'Weintrauben': [8, 9, 10],
  // --- herbs (open ground; a pot on the windowsill is year-round, hence mild)
  'Basilikum': [5, 6, 7, 8, 9],
  'Dill': [5, 6, 7, 8, 9, 10],
  'Schnittlauch': [4, 5, 6, 7, 8, 9, 10],
  'Petersilie': [4, 5, 6, 7, 8, 9, 10, 11],
  'Koriander': [5, 6, 7, 8, 9, 10],
  'Rosmarin': [5, 6, 7, 8, 9, 10],
  'Thymian': [5, 6, 7, 8, 9, 10],
  'Minze': [5, 6, 7, 8, 9, 10],
};

/**
 * Produce the app buys that deliberately has no German season.
 *
 * Three honest reasons, none of which is "we forgot":
 *   - imported all year, so there is no German month to prefer;
 *   - grown here but stored and sold flat all year, so a March penalty would be a lie;
 *   - grown indoors, where the calendar does not reach.
 *
 * The list exists so that every produce item has to be a decision. A test fails if an
 * item is in neither table, because SEASON is keyed on the exact string and a new
 * spelling would otherwise lose its seasonality without saying anything.
 */
export const NO_GERMAN_SEASON = new Set([
  // Imported all year.
  'Banane', 'Zitrone', 'Limette', 'Orange', 'Avocado', 'Ananas', 'Ingwer', 'Süßkartoffel', 'Chili', 'Aubergine',
  // German crops that are stored: the same price and the same quality in March as in October.
  'Kartoffeln', 'Zwiebel', 'Rote Zwiebel', 'Knoblauch', 'Möhren',
  // Sold as ready-picked tubs all year; the fruit itself is imported anyway.
  'Granatapfelkerne',
  // Grown indoors.
  'Champignons', 'Kresse', 'Pak Choi',
  // Not shopped for at all: it is last night tray, already in the fridge.
  'Ofengemüse (Reste)',
]);

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** How hard to push. Kept small on purpose: fit to budget still decides. */
export const SEASON_PENALTY = 0.30;
export const SEASON_BONUS = 0.10;

export const currentMonth = (date = new Date()) => date.getMonth() + 1;

export const isMonth = (m) => Number.isInteger(m) && m >= 1 && m <= 12;

/**
 * true / false / null, where null means "nothing to say" — either the item has
 * no German season, or seasonality is switched off (month = null). Guarding the
 * month here is what makes the off switch actually off: without it, every
 * seasonal ingredient would read as out of season and be penalised.
 */
export function inSeason(item, month) {
  const months = SEASON[item];
  if (!months || !isMonth(month)) return null;
  return months.includes(month);
}

/** The seasonal produce in a recipe, split by whether it is in season now. */
export function seasonSplit(recipe, month) {
  const now = [];
  const off = [];
  for (const ing of recipe?.ingredients ?? []) {
    const verdict = inSeason(ing.item, month);
    if (verdict === null) continue;
    (verdict ? now : off).push(ing.item);
  }
  return { now, off };
}

/**
 * Added to a recipe's fit score, so positive is worse.
 * A recipe with no seasonal produce at all scores 0 — neither rewarded nor punished.
 */
export function seasonPenalty(recipe, month) {
  const { now, off } = seasonSplit(recipe, month);
  const total = now.length + off.length;
  if (total === 0) return 0;
  return (off.length / total) * SEASON_PENALTY - (now.length / total) * SEASON_BONUS;
}

/** One line for the meal detail, or null when there is nothing worth saying. */
export function seasonNote(recipe, month) {
  if (!isMonth(month)) return null;
  const { now, off } = seasonSplit(recipe, month);
  if (off.length === 0 && now.length === 0) return null;
  const name = MONTHS[month - 1];
  if (off.length === 0) return `In season in ${name}: ${now.join(', ')}.`;
  const lead = `Out of season in ${name}: ${off.join(', ')} — it will be imported, dearer and less sweet.`;
  return now.length ? `${lead} In season: ${now.join(', ')}.` : lead;
}

/** For the Why tab: what is actually good this month, whether or not it is planned. */
export function peakThisMonth(month) {
  if (!isMonth(month)) return [];
  return Object.keys(SEASON).filter((item) => SEASON[item].includes(month)).sort((a, b) => a.localeCompare(b, 'de'));
}
