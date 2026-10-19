// The recipe library.
//
// Conventions that the planner and the shopping list depend on:
//   - kcal / protein are PER PORTION, where 1 portion ~= the first person's slot
//     budget. The second eats ~0.68 of a portion from the same pot, derived
//     rather than fixed (see targets.portionRatio).
//   - Ingredient quantities are also PER PORTION, so the shopping list is just
//     qty x (sum of servings across the week). Nothing here is "per 4 people".
//   - Product names are DEUTSCH, because that is what is on the shelf in Rewe /
//     Edeka / Aldi / Lidl. The method is in English, because that is what we read.
//   - minutes = hands-on time from standing in the kitchen to sitting down.
//     Anything over 30 must be tagged 'weekend'.
//
// Nutrition is calculated from standard German supermarket values and rounded to
// the nearest 5 kcal / 1 g. Treat it as +/-10%: the weight log is the real judge.

export const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];
export const CUISINES = ['mediterranean', 'middle-eastern', 'asian', 'northern', 'other'];
export const EQUIPMENT = ['none', 'hob', 'oven', 'airfryer', 'pressure', 'slowcooker', 'sousvide', 'blender', 'mixer'];
export const AISLES = ['produce', 'meat-fish', 'dairy', 'bakery', 'dry-goods', 'frozen', 'pantry', 'drinks'];

export const AISLE_LABEL = {
  produce: 'Obst & Gemüse',
  'meat-fish': 'Fleisch & Fisch',
  dairy: 'Kühlregal & Molkerei',
  bakery: 'Backwaren',
  'dry-goods': 'Trockenware & Konserven',
  frozen: 'Tiefkühl',
  pantry: 'Vorrat & Gewürze',
  drinks: 'Getränke',
};

// Which shop each aisle is worth walking.
//
// The split is not snobbery, it is where the money and the quality actually
// differ: a bag of lentils, a jar of paprika, frozen berries and Cola Zero are
// the same product for a third less at a discounter, while produce, meat, fish
// and cheese are where Rewe and Edeka have a range the discounters do not. Both
// the shops and the aisle-to-shop mapping are editable in Settings.
export const DEFAULT_SHOPS = [
  { id: 'discount', name: 'Aldi / Lidl', aisles: ['dry-goods', 'pantry', 'frozen', 'drinks'] },
  { id: 'super', name: 'Rewe / Edeka', aisles: ['produce', 'meat-fish', 'dairy', 'bakery'] },
];

/** Terse ingredient spec: 'Name|qty|unit|aisle' -> {item, qty, unit, aisle}. */
const ings = (...specs) => specs.map((spec) => {
  const [item, qty, unit, aisle] = spec.split('|');
  return { item, qty: Number(qty), unit, aisle };
});

// ---------------------------------------------------------------- BREAKFAST
const BREAKFASTS = [
  {
    id: 'b-schoko-protein-quark', name: 'Chocolate protein quark (the Nesquik upgrade)',
    slot: 'breakfast', kcal: 450, protein: 43, minutes: 5, cuisine: 'northern',
    equipment: ['blender'], tags: ['habit-nesquik', 'sweet', 'no-cook', 'fast', 'vegetarian'],
    ingredients: ings('Magerquark|250|g|dairy', 'Milch 1,5 %|150|ml|dairy', 'Nesquik|15|g|pantry', 'Banane|100|g|produce', 'Erdnussmus|10|g|pantry'),
    method: [
      'Blend the quark, milk and Nesquik until completely smooth and pourable.',
      'Slice the banana on top and swirl through the peanut butter.',
      'Same chocolate-milk hit as before, but 43 g of protein instead of 8 g.',
    ],
  },
  {
    id: 'b-skyr-beeren-nuss', name: 'Skyr bowl with berries and walnuts',
    slot: 'breakfast', kcal: 420, protein: 33, minutes: 3, cuisine: 'northern',
    equipment: ['none'], tags: ['habit-yoghurt', 'sweet', 'no-cook', 'fast', 'vegetarian'],
    ingredients: ings('Skyr natur|250|g|dairy', 'TK-Beerenmischung|150|g|frozen', 'Walnüsse|20|g|pantry', 'Haferflocken|15|g|dry-goods', 'Honig|5|g|pantry'),
    method: [
      'Tip the frozen berries into the bowl first and let them sit 5 minutes.',
      'Spoon the Skyr over, then the oats, walnuts and a thread of honey.',
      'Frozen berries are cheaper than fresh and just as good buried in yoghurt.',
    ],
  },
  {
    id: 'b-huettenkaese-toast-ei', name: 'Rye toast, Hüttenkäse and fried egg',
    slot: 'breakfast', kcal: 470, protein: 35, minutes: 8, cuisine: 'northern',
    equipment: ['hob'], tags: ['savoury', 'fast', 'vegetarian'],
    ingredients: ings('Vollkornbrot|90|g|bakery', 'Körniger Frischkäse (Hüttenkäse)|100|g|dairy', 'Eier|2|Stk|dairy', 'Tomaten|100|g|produce'),
    method: [
      'Toast the bread while you fry the eggs in a dry non-stick pan.',
      'Spread the Hüttenkäse thickly, top with egg, sliced tomato, salt and pepper.',
    ],
  },
  {
    id: 'b-overnight-oats-apfel', name: 'Overnight oats with apple and cinnamon',
    slot: 'breakfast', kcal: 440, protein: 31, minutes: 5, cuisine: 'northern',
    equipment: ['none'], tags: ['sweet', 'no-cook', 'fast', 'make-ahead', 'vegetarian'],
    ingredients: ings('Haferflocken|60|g|dry-goods', 'Magerquark|150|g|dairy', 'Milch 1,5 %|100|ml|dairy', 'Apfel|120|g|produce', 'Zimt|1|g|pantry'),
    method: [
      'Stir oats, quark, milk and cinnamon together in a jar the night before.',
      'Grate the apple in now or in the morning, whichever you remember.',
      'Make two jars at once — tomorrow morning is then already solved.',
    ],
  },
  {
    id: 'b-menemen-feta', name: 'Menemen with feta',
    slot: 'breakfast', kcal: 560, protein: 34, minutes: 15, cuisine: 'middle-eastern',
    equipment: ['hob'], tags: ['savoury', 'vegetarian'],
    ingredients: ings('Eier|3|Stk|dairy', 'Tomaten|200|g|produce', 'Spitzpaprika|100|g|produce', 'Feta|50|g|dairy', 'Vollkornbrot|45|g|bakery', 'Olivenöl|5|g|pantry'),
    method: [
      'Soften the chopped pepper in the oil, add tomatoes and cook down 5 minutes.',
      'Beat the eggs in and stir gently until just set — take it off early.',
      'Crumble the feta over and mop the pan with the bread.',
    ],
  },
  {
    id: 'b-protein-pancakes', name: 'Protein pancakes',
    slot: 'breakfast', kcal: 520, protein: 56, minutes: 15, cuisine: 'northern',
    equipment: ['mixer', 'hob'], tags: ['sweet', 'weekend', 'vegetarian'],
    ingredients: ings('Haferflocken|40|g|dry-goods', 'Eier|2|Stk|dairy', 'Magerquark|100|g|dairy', 'Whey-Proteinpulver|30|g|pantry', 'TK-Beerenmischung|100|g|frozen', 'Backpulver|3|g|pantry'),
    method: [
      'Blitz oats, eggs, quark, whey and baking powder to a thick batter.',
      'Cook small pancakes in a dry non-stick pan, about 2 minutes a side.',
      'Warm the berries in the microwave to make an instant compote.',
    ],
  },
  {
    id: 'b-harzer-roggenbrot', name: 'Harzer Käse on rye',
    slot: 'breakfast', kcal: 440, protein: 46, minutes: 5, cuisine: 'northern',
    equipment: ['none'], tags: ['savoury', 'no-cook', 'fast', 'vegetarian'],
    ingredients: ings('Harzer Käse|125|g|dairy', 'Vollkornbrot|90|g|bakery', 'Butter|8|g|dairy', 'Radieschen|60|g|produce', 'Schnittlauch|5|g|produce'),
    method: [
      'Butter the bread thinly, layer the Harzer, radishes, chives and pepper.',
      'Harzer is the best protein-per-calorie buy in any German supermarket: 30 g per 100 g at almost no fat.',
    ],
  },
  {
    id: 'b-banane-erdnuss-shake', name: 'Banana peanut protein shake',
    slot: 'breakfast', kcal: 510, protein: 40, minutes: 3, cuisine: 'northern',
    equipment: ['blender'], tags: ['sweet', 'no-cook', 'fast', 'vegetarian'],
    ingredients: ings('Milch 1,5 %|250|ml|dairy', 'Banane|120|g|produce', 'Whey-Proteinpulver|30|g|pantry', 'Erdnussmus|15|g|pantry', 'Haferflocken|20|g|dry-goods'),
    method: [
      'Blend everything for 30 seconds until there are no oat specks left.',
      'This is the "no time at all" breakfast — drink it on the way.',
    ],
  },
  {
    id: 'b-shakshuka-kichererbsen', name: 'Shakshuka with chickpeas',
    slot: 'breakfast', kcal: 555, protein: 39, minutes: 20, cuisine: 'middle-eastern',
    equipment: ['hob'], tags: ['savoury', 'weekend', 'vegetarian'],
    ingredients: ings('Eier|2|Stk|dairy', 'Gehackte Tomaten|200|g|dry-goods', 'Kichererbsen|100|g|dry-goods', 'Körniger Frischkäse (Hüttenkäse)|100|g|dairy', 'Vollkornbrot|45|g|bakery', 'Olivenöl|5|g|pantry', 'Kreuzkümmel|2|g|pantry'),
    method: [
      'Fry the cumin in the oil for 30 seconds, add tomatoes and chickpeas.',
      'Simmer 8 minutes, make two wells, crack in the eggs and cover until set.',
      'Dollop the Hüttenkäse on at the table so it stays cool against the heat.',
    ],
  },
  {
    id: 'b-bircher-skyr', name: 'Bircher muesli with Skyr',
    slot: 'breakfast', kcal: 475, protein: 31, minutes: 5, cuisine: 'northern',
    equipment: ['none'], tags: ['sweet', 'no-cook', 'fast', 'make-ahead', 'vegetarian'],
    ingredients: ings('Haferflocken|50|g|dry-goods', 'Skyr natur|200|g|dairy', 'Apfel|100|g|produce', 'Rosinen|15|g|dry-goods', 'Mandeln|10|g|pantry'),
    method: [
      'Grate the apple, mix everything, leave in the fridge overnight.',
      'Keeps three days, so build the whole week on Sunday evening.',
    ],
  },
  {
    id: 'b-airfryer-ei-muffins', name: 'Air-fryer egg and turkey muffins',
    slot: 'breakfast', kcal: 480, protein: 46, minutes: 5, cuisine: 'northern',
    equipment: ['airfryer'], tags: ['savoury', 'fast', 'make-ahead', 'batch'],
    ingredients: ings('Eier|3|Stk|dairy', 'Putenbrust (Aufschnitt)|60|g|meat-fish', 'TK-Blattspinat|60|g|frozen', 'Gouda leicht, gerieben|30|g|dairy', 'Vollkornbrot|45|g|bakery'),
    method: [
      'Beat the eggs with squeezed-out spinach, chopped turkey and cheese.',
      'Pour into silicone muffin cups, air-fry 12 minutes at 170 °C.',
      'Make a double batch on Sunday: reheating three takes 90 seconds all week.',
    ],
  },
  {
    id: 'b-cilbir-turkish-eggs', name: 'Çılbır — Turkish eggs in yoghurt',
    slot: 'breakfast', kcal: 500, protein: 36, minutes: 15, cuisine: 'middle-eastern',
    equipment: ['hob'], tags: ['savoury', 'weekend', 'vegetarian'],
    ingredients: ings('Griechischer Joghurt 2 %|200|g|dairy', 'Eier|2|Stk|dairy', 'Butter|10|g|dairy', 'Fladenbrot|60|g|bakery', 'Chiliflocken|2|g|pantry', 'Knoblauch|5|g|produce'),
    method: [
      'Stir crushed garlic into the yoghurt and spread it on a warmed plate.',
      'Poach the eggs 3 minutes and slide them onto the yoghurt.',
      'Melt the butter with chilli flakes until it foams, pour over, serve with bread.',
    ],
  },
  {
    id: 'b-protein-porridge-banane', name: 'Protein porridge with banana and peanut butter',
    slot: 'breakfast', kcal: 550, protein: 39, minutes: 8, cuisine: 'northern',
    equipment: ['hob'], tags: ['sweet', 'fast', 'habit-nesquik', 'comfort', 'vegetarian'],
    ingredients: ings('Haferflocken|60|g|dry-goods', 'Milch 1,5 %|200|ml|dairy', 'Whey-Proteinpulver|25|g|pantry', 'Banane|80|g|produce', 'Erdnussmus|10|g|pantry', 'Zimt|2|g|pantry'),
    method: [
      'Oats and milk on the hob, four minutes, stirred. Whey goes in off the heat or it turns to rubber.',
      'Mash half the banana into it and slice the other half on top — it tastes twice as sweet that way.',
      'The hot version of the Nesquik habit: same chocolate-milk comfort, 39 g of protein.',
    ],
  },
  {
    id: 'b-reis-congee-ei', name: 'Savoury rice congee with egg',
    slot: 'breakfast', kcal: 540, protein: 31, minutes: 15, cuisine: 'asian',
    equipment: ['hob'], tags: ['savoury', 'comfort', 'uses-leftovers', 'one-pan'],
    ingredients: ings('Reis (gekocht)|200|g|dry-goods', 'Hühnerbrühe|300|ml|pantry', 'Eier|2|Stk|dairy', 'Putenbrust (Aufschnitt)|60|g|meat-fish', 'Frühlingszwiebel|20|g|produce', 'Sojasauce|10|ml|pantry', 'Ingwer|8|g|produce', 'Sesamöl|5|g|pantry'),
    method: [
      'Leftover rice simmered hard in stock for 12 minutes breaks down into porridge. Fresh rice will not.',
      'Eggs stirred in at the end in a thin stream, off the heat, so they ribbon instead of scrambling.',
      'A savoury breakfast for the mornings when nothing sweet appeals. Ginger and spring onion do the work.',
    ],
  },
  {
    id: 'b-gruener-smoothie-bowl', name: 'Green protein smoothie bowl',
    slot: 'breakfast', kcal: 405, protein: 43, minutes: 5, cuisine: 'northern',
    equipment: ['blender'], tags: ['sweet', 'fast', 'no-cook', 'habit-yoghurt', 'high-protein', 'vegetarian'],
    ingredients: ings('Skyr natur|200|g|dairy', 'TK-Blattspinat|60|g|frozen', 'Banane|80|g|produce', 'Whey-Proteinpulver|15|g|pantry', 'Haferflocken|25|g|dry-goods', 'Milch 1,5 %|80|ml|dairy'),
    method: [
      'Frozen spinach, not fresh — it blends to nothing and you cannot taste it behind the banana.',
      'Thick enough to eat with a spoon, which is the difference between a breakfast and a drink.',
      'The yoghurt-and-fruit habit with 43 g of protein hidden inside it.',
    ],
  },
  {
    id: 'b-kahvalti-teller', name: 'Kahvaltı plate — Turkish breakfast',
    slot: 'breakfast', kcal: 590, protein: 36, minutes: 8, cuisine: 'middle-eastern',
    equipment: ['none'], tags: ['savoury', 'no-cook', 'weekend', 'make-ahead', 'vegetarian'],
    ingredients: ings('Eier|2|Stk|dairy', 'Feta|50|g|dairy', 'Griechischer Joghurt 2 %|100|g|dairy', 'Schwarze Oliven|30|g|dry-goods', 'Tomaten|80|g|produce', 'Gurke|80|g|produce', 'Vollkornbrot|60|g|bakery', 'Olivenöl|5|g|pantry', 'Za’atar|3|g|pantry'),
    method: [
      'Boil the eggs the night before. Everything else is cut, not cooked.',
      'Small amounts of many things on one plate is why this feels like a holiday and a bowl of oats does not.',
      'Tagged for the weekend because eating it properly takes twenty minutes, not eight.',
    ],
  },
  {
    id: 'b-avocado-ei-brot', name: 'Avocado and egg on rye with cress',
    slot: 'breakfast', kcal: 500, protein: 32, minutes: 8, cuisine: 'northern',
    equipment: ['hob'], tags: ['savoury', 'fast', 'vegetarian'],
    ingredients: ings('Roggenvollkornbrot|70|g|bakery', 'Avocado|70|g|produce', 'Eier|2|Stk|dairy', 'Körniger Frischkäse (Hüttenkäse)|80|g|dairy', 'Kresse|10|g|produce', 'Zitrone|10|g|produce', 'Chiliflocken|2|g|pantry'),
    method: [
      'Hüttenkäse under the avocado, not beside it. It takes this from 20 g of protein to 32 and nobody notices.',
      'Lemon on the avocado as you mash it, or it is grey by the time the eggs are done.',
      'Eggs fried hard-edged in a dry non-stick pan; the fat is already on the bread.',
    ],
  },
  {
    id: 'b-airfryer-fruehstuecksteller', name: 'Weekend air-fryer breakfast plate',
    slot: 'breakfast', kcal: 585, protein: 44, minutes: 25, cuisine: 'other',
    equipment: ['airfryer'], tags: ['savoury', 'weekend', 'one-pan', 'comfort'],
    ingredients: ings('Geflügelbratwurst|90|g|meat-fish', 'Eier|2|Stk|dairy', 'Champignons|120|g|produce', 'Kirschtomaten|120|g|produce', 'Weiße Bohnen (Dose)|120|g|dry-goods', 'Roggenvollkornbrot|40|g|bakery', 'Olivenöl|5|g|pantry'),
    method: [
      'Sausages and mushrooms in first at 190 °C, tomatoes and beans in a ramekin alongside after six minutes.',
      'Eggs in a second ramekin for the last seven minutes — they come out somewhere between poached and baked.',
      'The full plate for 585 kcal, because chicken sausage instead of pork is a 300 kcal decision on its own.',
    ],
  },
];

// ------------------------------------------------------------------- LUNCH
const LUNCHES = [
  {
    id: 'l-huhn-bulgur-salat', name: 'Chicken and bulgur salad jar',
    slot: 'lunch', kcal: 460, protein: 36, minutes: 15, cuisine: 'mediterranean',
    equipment: ['hob'], tags: ['packable', 'make-ahead'],
    ingredients: ings('Hähnchenbrust|120|g|meat-fish', 'Bulgur|60|g|dry-goods', 'Tomaten|100|g|produce', 'Gurke|80|g|produce', 'Olivenöl|10|g|pantry', 'Zitrone|20|g|produce', 'Petersilie|10|g|produce'),
    method: [
      'Pour boiling water over the bulgur, cover, and leave 12 minutes.',
      'Pan-fry the chicken while it swells, then slice it across the grain.',
      'Layer dressing at the bottom of the jar and leaves at the top so nothing wilts.',
    ],
  },
  {
    id: 'l-thunfisch-bohnen-salat', name: 'Tuna and white bean salad',
    slot: 'lunch', kcal: 430, protein: 45, minutes: 8, cuisine: 'mediterranean',
    equipment: ['none'], tags: ['packable', 'no-cook', 'fast', 'storecupboard'],
    ingredients: ings('Thunfisch in Wasser|150|g|dry-goods', 'Cannellini-Bohnen|150|g|dry-goods', 'Rote Zwiebel|40|g|produce', 'Olivenöl|10|g|pantry', 'Zitrone|20|g|produce', 'Petersilie|10|g|produce'),
    method: [
      'Rinse the beans well, then fork them together with the drained tuna.',
      'Soak the sliced onion in the lemon juice for 5 minutes to take the edge off.',
      'Entirely from the storecupboard — the meal for a week you failed to shop for.',
    ],
  },
  {
    id: 'l-halloumi-linsen-salat', name: 'Halloumi and beluga lentil salad',
    slot: 'lunch', kcal: 460, protein: 33, minutes: 10, cuisine: 'mediterranean',
    equipment: ['hob'], tags: ['vegetarian', 'packable'],
    ingredients: ings('Halloumi|80|g|dairy', 'Beluga-Linsen (Dose)|150|g|dry-goods', 'Rucola|40|g|produce', 'Tomaten|100|g|produce', 'Balsamico|10|g|pantry'),
    method: [
      'Dry-fry the halloumi slices until deeply golden on both sides.',
      'Toss the warm lentils with balsamico first, then fold in the rocket.',
    ],
  },
  {
    id: 'l-vollkorn-sandwich-pute', name: 'Turkey and Hüttenkäse sandwich',
    slot: 'lunch', kcal: 555, protein: 45, minutes: 8, cuisine: 'northern',
    equipment: ['none'], tags: ['packable', 'no-cook', 'fast'],
    ingredients: ings('Vollkornbrot|90|g|bakery', 'Putenbrust (Aufschnitt)|100|g|meat-fish', 'Körniger Frischkäse (Hüttenkäse)|80|g|dairy', 'Kopfsalat|30|g|produce', 'Senf|10|g|pantry', 'Mandeln|25|g|pantry'),
    method: [
      'Hüttenkäse instead of butter or mayo: same creaminess, ten times the protein.',
      'Mustard on both slices, turkey, lettuce, press together, wrap in paper.',
    ],
  },
  {
    id: 'l-griechischer-kichererbsen-salat', name: 'Greek chickpea and chicken salad',
    slot: 'lunch', kcal: 570, protein: 43, minutes: 12, cuisine: 'mediterranean',
    equipment: ['hob'], tags: ['packable'],
    ingredients: ings('Kichererbsen|150|g|dry-goods', 'Feta|50|g|dairy', 'Hähnchenbrust|100|g|meat-fish', 'Gurke|100|g|produce', 'Tomaten|100|g|produce', 'Schwarze Oliven|20|g|dry-goods', 'Olivenöl|10|g|pantry', 'Oregano|2|g|pantry'),
    method: [
      'Cube everything roughly the same size so each forkful has a bit of all of it.',
      'Dress while the chicken is still warm — the chickpeas drink it up.',
    ],
  },
  {
    id: 'l-miso-lachs-reisbowl', name: 'Miso salmon rice bowl',
    slot: 'lunch', kcal: 620, protein: 39, minutes: 15, cuisine: 'asian',
    equipment: ['airfryer'], tags: ['packable', 'make-ahead'],
    ingredients: ings('Lachsfilet|120|g|meat-fish', 'Reis|60|g|dry-goods', 'TK-Edamame|80|g|frozen', 'Gurke|80|g|produce', 'Miso-Paste|15|g|pantry', 'Sojasauce|10|ml|pantry', 'Sesam|5|g|pantry'),
    method: [
      'Brush the salmon with miso and air-fry 9 minutes at 190 °C.',
      'Cook the rice, cool it fast, and pack the salmon on top cold.',
      'Cold miso salmon on rice is genuinely better than reheated — no microwave needed.',
    ],
  },
  {
    id: 'l-haehnchen-wrap', name: 'Leftover chicken wrap with garlic Skyr',
    slot: 'lunch', kcal: 480, protein: 45, minutes: 8, cuisine: 'middle-eastern',
    equipment: ['none'], tags: ['packable', 'no-cook', 'fast', 'uses-leftovers'],
    ingredients: ings('Vollkorn-Wrap|60|g|bakery', 'Hähnchenbrust (gegart)|120|g|meat-fish', 'Skyr natur|60|g|dairy', 'Knoblauch|5|g|produce', 'Kopfsalat|50|g|produce', 'Mandeln|20|g|pantry'),
    method: [
      'Beat crushed garlic, salt and lemon into the Skyr to make the sauce.',
      'Sauce, leaves, then chicken; roll tight and cut on the diagonal.',
    ],
  },
  {
    id: 'l-linsensuppe-harzer-brot', name: 'Red lentil soup with Harzer on rye',
    slot: 'lunch', kcal: 520, protein: 38, minutes: 25, cuisine: 'middle-eastern',
    equipment: ['pressure'], tags: ['batch', 'make-ahead', 'vegetarian', 'packable'],
    ingredients: ings('Rote Linsen|90|g|dry-goods', 'Möhren|80|g|produce', 'Zwiebel|50|g|produce', 'Gemüsebrühe|400|ml|pantry', 'Kreuzkümmel|2|g|pantry', 'Vollkornbrot|45|g|bakery', 'Harzer Käse|40|g|dairy'),
    method: [
      'Sweat the onion and carrot, add lentils, stock and cumin, 8 minutes under pressure.',
      'Blend smooth, season hard with lemon and salt — lentils need more than you think.',
      'Make six portions at once; it freezes and reheats better than almost anything.',
    ],
  },
  {
    id: 'l-piyaz-weisse-bohnen-ei', name: 'Piyaz — Turkish white bean salad with egg',
    slot: 'lunch', kcal: 590, protein: 31, minutes: 12, cuisine: 'middle-eastern',
    equipment: ['hob'], tags: ['packable', 'vegetarian', 'storecupboard'],
    ingredients: ings('Weiße Bohnen (Dose)|200|g|dry-goods', 'Eier|2|Stk|dairy', 'Rote Zwiebel|50|g|produce', 'Petersilie|15|g|produce', 'Sumach|2|g|pantry', 'Olivenöl|10|g|pantry', 'Vollkornbrot|45|g|bakery'),
    method: [
      'Boil the eggs 8 minutes, cool them under the tap, quarter them.',
      'Dress the rinsed beans with oil, lemon and sumach, then fold in onion and parsley.',
    ],
  },
  {
    id: 'l-raeucherlachs-bagel', name: 'Smoked salmon and Hüttenkäse bagel',
    slot: 'lunch', kcal: 470, protein: 39, minutes: 5, cuisine: 'northern',
    equipment: ['none'], tags: ['packable', 'no-cook', 'fast'],
    ingredients: ings('Vollkorn-Bagel|85|g|bakery', 'Körniger Frischkäse (Hüttenkäse)|100|g|dairy', 'Räucherlachs|80|g|meat-fish', 'Gurke|50|g|produce', 'Dill|5|g|produce', 'Kapern|10|g|pantry'),
    method: [
      'Toast the bagel halves so they hold up under the topping.',
      'Hüttenkäse, salmon, cucumber ribbons, dill, capers, a lot of black pepper.',
    ],
  },
  {
    id: 'l-thai-glasnudelsalat-rind', name: 'Thai glass noodle salad with beef',
    slot: 'lunch', kcal: 510, protein: 29, minutes: 15, cuisine: 'asian',
    equipment: ['hob'], tags: ['packable'],
    ingredients: ings('Glasnudeln|70|g|dry-goods', 'Rindersteak|120|g|meat-fish', 'Limette|20|g|produce', 'Chili|5|g|produce', 'Koriander|10|g|produce', 'Fischsauce|10|ml|pantry', 'Erdnüsse|15|g|pantry', 'Möhren|60|g|produce'),
    method: [
      'Soak the noodles in hot water 4 minutes, then rinse them cold.',
      'Sear the steak hard 2 minutes a side, rest it, slice thin.',
      'Dressing is lime, fish sauce and chilli in roughly equal parts — taste and adjust.',
    ],
  },
  {
    id: 'l-falafel-bowl', name: 'Air-fryer falafel bowl',
    slot: 'lunch', kcal: 665, protein: 33, minutes: 15, cuisine: 'middle-eastern',
    equipment: ['airfryer'], tags: ['vegetarian', 'packable'],
    ingredients: ings('Falafel (TK oder frisch)|100|g|frozen', 'Couscous|50|g|dry-goods', 'Griechischer Joghurt 2 %|100|g|dairy', 'Feta|30|g|dairy', 'Tomaten|100|g|produce', 'Zitrone|20|g|produce'),
    method: [
      'Air-fry the falafel 10 minutes at 190 °C — no oil needed, and they stay crisp.',
      'Pour boiling water over the couscous, cover 5 minutes, fork it through.',
      'Thin the yoghurt with lemon juice and water so it pours.',
    ],
  },
  {
    id: 'l-eiersalat-roggenbrot', name: 'Skyr egg salad on rye',
    slot: 'lunch', kcal: 515, protein: 32, minutes: 12, cuisine: 'northern',
    equipment: ['hob'], tags: ['packable', 'vegetarian', 'fast'],
    ingredients: ings('Eier|3|Stk|dairy', 'Skyr natur|40|g|dairy', 'Senf|8|g|pantry', 'Roggenvollkornbrot|90|g|bakery', 'Kresse|10|g|produce', 'Apfel|120|g|produce'),
    method: [
      'Boil the eggs 9 minutes so the yolks are set but not chalky.',
      'Mash with Skyr and mustard instead of mayonnaise — saves about 180 kcal.',
      'Pile onto the rye, cress on top, apple on the side.',
    ],
  },
  {
    id: 'l-caprese-protein-teller', name: 'Caprese protein plate',
    slot: 'lunch', kcal: 450, protein: 33, minutes: 5, cuisine: 'mediterranean',
    equipment: ['none'], tags: ['vegetarian', 'no-cook', 'fast'],
    ingredients: ings('Mozzarella light|125|g|dairy', 'Tomaten|200|g|produce', 'Basilikum|10|g|produce', 'Olivenöl|10|g|pantry', 'Vollkornbrot|45|g|bakery'),
    method: [
      'Slice tomato and mozzarella, salt the tomato five minutes ahead.',
      'Light mozzarella has more protein and half the fat of the standard ball.',
    ],
  },
  {
    id: 'l-poke-bowl-thunfisch', name: 'Tuna poke-style bowl',
    slot: 'lunch', kcal: 575, protein: 44, minutes: 12, cuisine: 'asian',
    equipment: ['none'], tags: ['packable', 'no-cook'],
    ingredients: ings('Reis|60|g|dry-goods', 'Thunfischsteak|120|g|meat-fish', 'TK-Edamame|80|g|frozen', 'Avocado|50|g|produce', 'Sojasauce|15|ml|pantry', 'Sesam|5|g|pantry', 'Frühlingszwiebel|20|g|produce'),
    method: [
      'Marinate the diced raw tuna in soy and sesame for 10 minutes.',
      'Build on cooled rice; add the avocado only just before eating.',
      'Use sushi-grade tuna and eat it the same day, or swap in seared tuna.',
    ],
  },
  {
    id: 'l-linsen-rote-bete-feta', name: 'Lentil, beetroot and feta salad',
    slot: 'lunch', kcal: 660, protein: 49, minutes: 10, cuisine: 'mediterranean',
    equipment: ['none'], tags: ['packable', 'no-cook', 'make-ahead', 'uses-leftovers'],
    ingredients: ings('Beluga-Linsen (Dose)|180|g|dry-goods', 'Rote Bete|150|g|produce', 'Feta|50|g|dairy', 'Hähnchenbrust (gegart)|80|g|meat-fish', 'Rucola|40|g|produce', 'Walnüsse|10|g|pantry', 'Balsamico|10|g|pantry', 'Olivenöl|5|g|pantry'),
    method: [
      'Tinned beluga lentils and vacuum-packed beetroot: this is a ten-minute lunch that looks like an hour.',
      'Dress the lentils while you build it, not in the morning — rocket in a dressed box is soup by one o\'clock.',
      'The leftover roast chicken lunch. Beetroot stains everything purple, which is half the pleasure.',
    ],
  },
  {
    id: 'l-bulgur-kichererbsen-zaatar', name: 'Bulgur and chickpea salad with za’atar chicken',
    slot: 'lunch', kcal: 640, protein: 47, minutes: 15, cuisine: 'middle-eastern',
    equipment: ['hob'], tags: ['packable', 'make-ahead', 'uses-leftovers'],
    ingredients: ings('Bulgur|60|g|dry-goods', 'Kichererbsen|120|g|dry-goods', 'Hähnchenbrust (gegart)|100|g|meat-fish', 'Gurke|80|g|produce', 'Kirschtomaten|100|g|produce', 'Petersilie|15|g|produce', 'Zitrone|20|g|produce', 'Za’atar|4|g|pantry', 'Olivenöl|8|g|pantry'),
    method: [
      'Bulgur in boiling water, lid on, off the heat, 12 minutes. It cannot be overcooked this way.',
      'Everything cold into the box, lemon and za’atar in a separate lid so the parsley stays green.',
      'Holds three days, which means Sunday evening buys you Monday, Tuesday and Wednesday.',
    ],
  },
  {
    id: 'l-erdnuss-nudeln-edamame', name: 'Peanut noodles with edamame',
    slot: 'lunch', kcal: 645, protein: 33, minutes: 12, cuisine: 'asian',
    equipment: ['hob'], tags: ['packable', 'make-ahead', 'vegetarian'],
    ingredients: ings('Vollkornpasta|70|g|dry-goods', 'TK-Edamame|180|g|frozen', 'Erdnussmus|20|g|pantry', 'Sojasauce|15|ml|pantry', 'Limette|15|g|produce', 'Möhren|80|g|produce', 'Weißkohl|80|g|produce', 'Frühlingszwiebel|20|g|produce', 'Chiliflocken|2|g|pantry'),
    method: [
      'Peanut butter, soy, lime and three spoons of the pasta water make the sauce. Nothing else is needed.',
      'Carrot and cabbage shredded raw go in cold, so there is crunch left on day two.',
      'Eaten cold or at room temperature, so no microwave queue at the office.',
    ],
  },
  {
    id: 'l-miso-huhn-glasnudelsalat', name: 'Miso chicken glass noodle salad',
    slot: 'lunch', kcal: 605, protein: 44, minutes: 15, cuisine: 'asian',
    equipment: ['hob'], tags: ['packable', 'make-ahead', 'uses-leftovers'],
    ingredients: ings('Glasnudeln|60|g|dry-goods', 'Hähnchenbrust (gegart)|130|g|meat-fish', 'Miso-Paste|15|g|pantry', 'Gurke|100|g|produce', 'Möhren|80|g|produce', 'Zuckerschoten|60|g|produce', 'Sesam|6|g|pantry', 'Sesamöl|6|g|pantry', 'Limette|15|g|produce'),
    method: [
      'Glass noodles need boiling water poured over them and four minutes. No pan.',
      'Miso, lime and sesame oil whisked cold is the dressing — miso is already salty enough to need no soy.',
      'Mangetout raw, cucumber in ribbons. It travels better than any leaf salad.',
    ],
  },
  {
    id: 'l-ofengemuese-couscous-halloumi', name: 'Roast vegetable couscous with halloumi',
    slot: 'lunch', kcal: 670, protein: 32, minutes: 20, cuisine: 'mediterranean',
    equipment: ['oven'], tags: ['packable', 'make-ahead', 'vegetarian', 'uses-leftovers'],
    ingredients: ings('Couscous|60|g|dry-goods', 'Halloumi|60|g|dairy', 'Kichererbsen|100|g|dry-goods', 'Zucchini|120|g|produce', 'Spitzpaprika|100|g|produce', 'Aubergine|100|g|produce', 'Olivenöl|8|g|pantry', 'Zitrone|15|g|produce', 'Petersilie|10|g|produce'),
    method: [
      'This is really a leftovers recipe: last night\'s tray of roast vegetables, cold, on couscous.',
      'Couscous takes boiling water and five minutes under a plate. It is the only grain that needs no attention at all.',
      'Halloumi cubed and dry-fried while the couscous sits. Chickpeas carry the protein that the cheese cannot.',
    ],
  },
  {
    id: 'l-raeucherlachs-kartoffelsalat', name: 'Smoked salmon potato salad with dill',
    slot: 'lunch', kcal: 476, protein: 41, minutes: 15, cuisine: 'northern',
    equipment: ['hob'], tags: ['packable', 'make-ahead', 'uses-leftovers'],
    ingredients: ings('Räucherlachs|100|g|meat-fish', 'Kartoffeln|250|g|produce', 'Skyr natur|120|g|dairy', 'Senf|8|g|pantry', 'Dill|10|g|produce', 'Radieschen|60|g|produce', 'Frühlingszwiebel|20|g|produce', 'Kapern|8|g|pantry'),
    method: [
      'Dress the potatoes warm — that is when they absorb the skyr instead of sitting in it.',
      'Salmon torn in at the end, not mixed, or it disappears into the dressing.',
      '476 kcal and 41 g of protein, and it is better on day two than on day one.',
    ],
  },
  {
    id: 'l-harzer-nudelsalat-bohnen', name: 'Harzer pasta salad with green beans',
    slot: 'lunch', kcal: 540, protein: 42, minutes: 15, cuisine: 'northern',
    equipment: ['hob'], tags: ['packable', 'make-ahead', 'vegetarian', 'high-protein'],
    ingredients: ings('Vollkornpasta|70|g|dry-goods', 'Harzer Käse|100|g|dairy', 'Grüne Bohnen|150|g|produce', 'Kirschtomaten|100|g|produce', 'Senf|10|g|pantry', 'Balsamico|10|g|pantry', 'Olivenöl|8|g|pantry', 'Schnittlauch|10|g|produce'),
    method: [
      'Beans into the pasta water for the last four minutes, then both into cold water together.',
      'Harzer diced instead of mozzarella: 30 g of protein for 125 kcal, and it does not go rubbery cold.',
      'Mustard in the dressing is what stops it tasting like a canteen pasta salad.',
    ],
  },
  {
    id: 'l-thunfisch-quinoa-avocado', name: 'Tuna quinoa bowl with avocado',
    slot: 'lunch', kcal: 540, protein: 39, minutes: 10, cuisine: 'other',
    equipment: ['none'], tags: ['packable', 'no-cook', 'make-ahead', 'storecupboard'],
    ingredients: ings('Thunfisch in Wasser|120|g|dry-goods', 'Quinoa|60|g|dry-goods', 'Avocado|70|g|produce', 'Kirschtomaten|100|g|produce', 'Gurke|80|g|produce', 'Limette|15|g|produce', 'Rucola|30|g|produce', 'Olivenöl|5|g|pantry'),
    method: [
      'Cook a week of quinoa on Sunday — it is the one grain that is as good cold on Thursday as on Monday.',
      'Lime over the avocado first, before anything else touches it, and it will still be green at one o\'clock.',
      'Everything but the avocado comes out of a cupboard, which is why this is the no-shopping lunch.',
    ],
  },
  {
    id: 'l-bohnen-mais-bowl', name: 'Black-pepper bean and corn bowl',
    slot: 'lunch', kcal: 600, protein: 33, minutes: 12, cuisine: 'other',
    equipment: ['none'], tags: ['packable', 'no-cook', 'make-ahead', 'vegetarian', 'storecupboard'],
    ingredients: ings('Kidneybohnen|180|g|dry-goods', 'Mais (Dose)|80|g|dry-goods', 'Reis|60|g|dry-goods', 'Passata|60|g|dry-goods', 'Paprika|80|g|produce', 'Rote Zwiebel|30|g|produce', 'Limette|15|g|produce', 'Koriander|10|g|produce', 'Chilipulver|3|g|pantry', 'Körniger Frischkäse (Hüttenkäse)|100|g|dairy'),
    method: [
      'Microwave rice or Sunday rice, cold. Beans, corn and passata stirred through with chilli and lime.',
      'Hüttenkäse on top instead of soured cream: the same cold-white-creamy job for 13 g of protein.',
      'Entirely tins and a cupboard, so it is the lunch for the week the shopping did not happen.',
    ],
  },
  {
    id: 'l-ramen-suppe-im-glas', name: 'Chicken miso noodle soup in a jar',
    slot: 'lunch', kcal: 520, protein: 41, minutes: 10, cuisine: 'asian',
    equipment: ['none'], tags: ['packable', 'no-cook', 'make-ahead', 'uses-leftovers'],
    ingredients: ings('Glasnudeln|50|g|dry-goods', 'Hähnchenbrust (gegart)|120|g|meat-fish', 'Miso-Paste|20|g|pantry', 'Hühnerbrühe|400|ml|pantry', 'Pak Choi|100|g|produce', 'Frühlingszwiebel|20|g|produce', 'Ingwer|8|g|produce', 'Sojasauce|10|ml|pantry', 'Sesamöl|5|g|pantry'),
    method: [
      'Build it dry in a jar the night before: miso at the bottom, noodles, chicken, vegetables on top.',
      'At work, boiling water to the top, lid on, four minutes. The broth powder goes in dry with the miso.',
      'The answer to a cold grey day when the canteen is shut and a sandwich will not do.',
    ],
  },
  {
    id: 'l-koefte-wrap-joghurt', name: 'Köfte wrap with yoghurt sauce',
    slot: 'lunch', kcal: 455, protein: 46, minutes: 20, cuisine: 'middle-eastern',
    equipment: ['hob'], tags: ['packable', 'make-ahead', 'high-protein'],
    ingredients: ings('Putenhackfleisch|130|g|meat-fish', 'Vollkorn-Wrap|80|g|bakery', 'Griechischer Joghurt 2 %|80|g|dairy', 'Kopfsalat|50|g|produce', 'Tomaten|60|g|produce', 'Rote Zwiebel|25|g|produce', 'Kreuzkümmel|3|g|pantry', 'Petersilie|10|g|produce', 'Sumach|2|g|pantry'),
    method: [
      'Turkey mince with cumin, grated onion and parsley, shaped into fingers. Six minutes in a dry pan.',
      'Make twelve at once and freeze them cooked. They defrost in a lunchbox by midday.',
      'Yoghurt with sumac goes in a small pot, not on the wrap, or the bread is wet by eleven.',
    ],
  },

  // --- v5: converted from akispetretzikis.com source data. Quantities are
  // per-portion grams for this composition and the macros are computed from
  // them, because the source panel omits its unquantified ingredients.
  {
    id: 'l-spinat-tortilla-pute', name: 'Spinach tortilla with turkey and cottage cheese',
    slot: 'lunch', kcal: 510, protein: 49, minutes: 20, cuisine: 'other',
    equipment: ['hob', 'blender'],
    tags: ['packable', 'make-ahead', 'high-protein'],
    ingredients: ings(
      'Eier|2|Stk|dairy', 'Körniger Frischkäse (Hüttenkäse)|120|g|dairy',
      'Putenbrust (Aufschnitt)|80|g|meat-fish', 'Möhren|60|g|produce', 'Gurke|60|g|produce',
      'Blattspinat (frisch)|40|g|produce', 'Haferflocken|15|g|dry-goods', 'Limette|15|g|produce',
      'Olivenöl|6|g|pantry'
    ),
    method: [
      'Blitz eggs, spinach and oats into a green batter and cook it like a thin pancake.',
      'It is a wrap made of egg, so it rolls cold and holds all morning in a box.',
      'Cottage cheese inside rather than mayonnaise, which is where the protein comes from.',
    ],
  },
  {
    id: 'l-huhn-avocado-burrito', name: 'Chicken and avocado burrito',
    slot: 'lunch', kcal: 625, protein: 53, minutes: 20, cuisine: 'other',
    equipment: ['hob'],
    tags: ['packable', 'high-protein', 'comfort'],
    ingredients: ings(
      'Hähnchenbrust|140|g|meat-fish', 'Vollkorn-Wrap|70|g|bakery', 'Avocado|60|g|produce',
      'Griechischer Joghurt 2 %|60|g|dairy', 'Gouda leicht, gerieben|25|g|dairy',
      'Pesto|12|g|pantry', 'Koriander|6|g|produce'
    ),
    method: [
      'Roll it tight while the chicken is still warm so the cheese glues the seam shut.',
      'Pesto thinned with yoghurt goes on the tortilla, not the filling — it stops it soaking.',
      'Toast the rolled burrito seam-down for two minutes; it then survives a rucksack.',
    ],
  },
  {
    id: 'l-huhn-avocado-tacos', name: 'Chicken and avocado tacos',
    slot: 'lunch', kcal: 640, protein: 50, minutes: 25, cuisine: 'other',
    equipment: ['hob'],
    tags: ['packable', 'high-protein'],
    ingredients: ings(
      'Hähnchenbrust|150|g|meat-fish', 'Mais-Tortillas|75|g|bakery', 'Avocado|50|g|produce',
      'Griechischer Joghurt 2 %|70|g|dairy', 'Tomaten|60|g|produce', 'Zwiebel|40|g|produce',
      'Olivenöl|8|g|pantry', 'Sojasauce|8|ml|pantry', 'Paprikapulver|3|g|pantry',
      'Koriander|6|g|produce'
    ),
    method: [
      'Soy in the chicken marinade does what salt does, plus it browns in half the time.',
      'Pack the fillings separately and build at the desk, or the tortillas go limp.',
      'Char the tortillas dry in the pan — thirty seconds a side, no oil.',
    ],
  },
  {
    id: 'l-chef-salat-leicht', name: 'Light chef salad',
    slot: 'lunch', kcal: 575, protein: 64, minutes: 15, cuisine: 'northern',
    equipment: ['hob'],
    tags: ['packable', 'make-ahead', 'high-protein', 'high-volume'],
    ingredients: ings(
      'Kopfsalat|150|g|produce', 'Rucola|60|g|produce', 'Kirschtomaten|100|g|produce',
      'Gurke|100|g|produce', 'Putenbrust (Aufschnitt)|100|g|meat-fish', 'Gouda leicht|60|g|dairy',
      'Eier|2|Stk|dairy', 'Griechischer Joghurt 2 %|80|g|dairy', 'Ketchup|15|g|pantry',
      'Honig|8|g|pantry', 'Weissweinessig|8|ml|pantry'
    ),
    method: [
      'Yoghurt, ketchup, honey and vinegar make a thousand-island dressing without the oil.',
      'Boil the eggs seven minutes for a set-but-not-chalky yolk, then straight into cold water.',
      'Dressing in the bottom of the jar, leaves at the top; it keeps overnight that way.',
    ],
  },
  {
    id: 'l-huhn-salat-joghurt-dressing', name: 'Chicken salad with yoghurt and rosemary dressing',
    slot: 'lunch', kcal: 515, protein: 50, minutes: 20, cuisine: 'mediterranean',
    equipment: ['hob'],
    tags: ['packable', 'make-ahead', 'high-protein'],
    ingredients: ings(
      'Hähnchenbrust|150|g|meat-fish', 'Kopfsalat|120|g|produce', 'Tomaten|80|g|produce',
      'Vollkornbrot|50|g|bakery', 'Griechischer Joghurt 2 %|100|g|dairy', 'Olivenöl|10|g|pantry',
      'Honig|10|g|pantry', 'Limette|20|g|produce', 'Knoblauch|4|g|produce', 'Rosmarin|3|g|produce'
    ),
    method: [
      'Bruise the rosemary into the yoghurt and leave it ten minutes before dressing anything.',
      'Cube the bread and crisp it in the chicken pan afterwards — no extra fat needed.',
      'The dressing is thick enough to coat, so the salad does not sit in a puddle.',
    ],
  },
  {
    id: 'l-huhn-salat-sesam-scharf', name: 'Spicy sesame chicken salad from leftovers',
    slot: 'lunch', kcal: 575, protein: 55, minutes: 10, cuisine: 'asian',
    equipment: ['none'],
    tags: ['no-cook', 'packable', 'uses-leftovers', 'fast', 'high-protein'],
    ingredients: ings(
      'Hähnchenbrust (gegart)|150|g|meat-fish', 'Kopfsalat|100|g|produce',
      'Kirschtomaten|100|g|produce', 'Vollkornbrot|40|g|bakery', 'Senf|15|g|pantry',
      'Honig|10|g|pantry', 'Olivenöl|10|g|pantry', 'Sesam|10|g|pantry', 'Zitrone|20|g|produce',
      'Chiliflocken|3|g|pantry'
    ),
    method: [
      'Shred cold roast chicken with two forks; chopping it makes it taste dry.',
      'Mustard, honey, chilli and lemon shaken in a jar — no blender, no board.',
      'Toast the sesame in a dry pan if you have the two minutes; it is worth them.',
    ],
  },
  {
    id: 'l-coronation-huhn-sandwich', name: 'Coronation chicken on wholegrain',
    slot: 'lunch', kcal: 560, protein: 60, minutes: 10, cuisine: 'northern',
    equipment: ['none'],
    tags: ['no-cook', 'packable', 'uses-leftovers', 'fast', 'high-protein'],
    ingredients: ings(
      'Hähnchenbrust (gegart)|140|g|meat-fish', 'Vollkornbrot|80|g|bakery',
      'Griechischer Joghurt 2 %|90|g|dairy', 'Rosinen|20|g|dry-goods', 'Zwiebel|30|g|produce',
      'Currypulver|4|g|pantry', 'Limette|15|g|produce', 'Koriander|5|g|produce'
    ),
    method: [
      'Greek yoghurt instead of mayonnaise; the curry powder is what you actually taste anyway.',
      'Bloom the curry powder in a splash of hot water first or it stays powdery.',
      'Raisins are not optional — they are the whole reason this works cold.',
    ],
  },
  {
    id: 'l-huhn-gurken-tzatziki-salat', name: 'Chicken and cucumber tzatziki salad',
    slot: 'lunch', kcal: 515, protein: 56, minutes: 25, cuisine: 'mediterranean',
    equipment: ['hob'],
    tags: ['packable', 'make-ahead', 'high-protein', 'high-volume'],
    ingredients: ings(
      'Hähnchenbrust|170|g|meat-fish', 'Gurke|200|g|produce',
      'Griechischer Joghurt 2 %|120|g|dairy', 'Vollkornbrot|50|g|bakery', 'Olivenöl|10|g|pantry',
      'Zitrone|20|g|produce', 'Knoblauch|6|g|produce', 'Dill|8|g|produce'
    ),
    method: [
      'Half the cucumber grated into the yoghurt, half left in chunks for something to bite.',
      'Salt the grated half and wring it out in a tea towel before it goes anywhere near the yoghurt.',
      'Better on day two, which makes it the Sunday-night job for a Monday lunch.',
    ],
  },
  {
    id: 'l-caesar-huhn-joghurt', name: 'Caesar salad with yoghurt dressing',
    slot: 'lunch', kcal: 520, protein: 57, minutes: 18, cuisine: 'other',
    equipment: ['hob'],
    tags: ['packable', 'high-protein', 'high-volume'],
    ingredients: ings(
      'Hähnchenbrust|160|g|meat-fish', 'Römersalat|150|g|produce',
      'Griechischer Joghurt 2 %|80|g|dairy', 'Parmesan|20|g|dairy', 'Vollkornbrot|40|g|bakery',
      'Olivenöl|8|g|pantry', 'Senf|8|g|pantry', 'Zitrone|20|g|produce', 'Knoblauch|4|g|produce'
    ),
    method: [
      'Yoghurt, mustard, lemon, garlic and grated parmesan: a Caesar with no egg and no oil slick.',
      'Cube the bread and bake it dry in the chicken\'s pan rather than frying it in butter.',
      'Dress it at the last moment. Romaine in dressing overnight is a different, sadder salad.',
    ],
  },
  {
    id: 'l-pute-apfel-joghurt-salat', name: 'Turkey, apple and celery salad',
    slot: 'lunch', kcal: 520, protein: 45, minutes: 15, cuisine: 'northern',
    equipment: ['none'],
    tags: ['no-cook', 'packable', 'make-ahead', 'fast', 'high-protein'],
    ingredients: ings(
      'Putenbrust (Aufschnitt)|140|g|meat-fish', 'Apfel|120|g|produce',
      'Griechischer Joghurt 2 %|100|g|dairy', 'Vollkornbrot|50|g|bakery', 'Sellerie|80|g|produce',
      'Walnüsse|15|g|pantry', 'Senf|10|g|pantry', 'Zitrone|15|g|produce'
    ),
    method: [
      'Lemon on the apple the moment it is cut, then the yoghurt goes on top of that.',
      'Celery is what keeps it crisp for a day; leave the strings on the stalk, not in the bowl.',
      'No pan, no board beyond one apple — this is the lunch for a morning that went wrong.',
    ],
  },
  {
    id: 'l-garnelen-bohnen-salat', name: 'Prawn and green bean salad',
    slot: 'lunch', kcal: 475, protein: 43, minutes: 25, cuisine: 'mediterranean',
    equipment: ['hob'],
    tags: ['packable', 'make-ahead', 'high-protein', 'high-volume'],
    ingredients: ings(
      'Garnelen|180|g|meat-fish', 'Grüne Bohnen|200|g|produce', 'Kartoffeln|150|g|produce',
      'Kirschtomaten|100|g|produce', 'Olivenöl|12|g|pantry', 'Zitrone|25|g|produce',
      'Knoblauch|5|g|produce', 'Petersilie|8|g|produce'
    ),
    method: [
      'Beans and potatoes in the same pan of salted water, beans lifted out four minutes early.',
      'Dress the potatoes while they are hot — cold potato takes nothing on.',
      'Prawns go in the residual heat of the pan for two minutes and no longer.',
    ],
  },
  {
    id: 'l-zitronen-huehnersuppe-reis', name: 'Lemon chicken and rice soup',
    slot: 'lunch', kcal: 535, protein: 53, minutes: 25, cuisine: 'mediterranean',
    equipment: ['pressure'],
    tags: ['packable', 'batch', 'freezes', 'comfort', 'high-protein'],
    ingredients: ings(
      'Hähnchenbrust|170|g|meat-fish', 'Hühnerbrühe|350|ml|pantry', 'Rundkornreis|50|g|dry-goods',
      'Möhren|100|g|produce', 'Sellerie|60|g|produce', 'Zwiebel|50|g|produce', 'Eier|1|Stk|dairy',
      'Zitrone|35|g|produce', 'Dill|8|g|produce'
    ),
    method: [
      'Temper the beaten egg with ladles of hot broth before it goes in, or it scrambles.',
      'The pot must be off the heat when the egg and lemon go in. This is the whole technique.',
      'Travels in a thermos, but the egg means it will not reheat twice — make it for one day.',
    ],
  },
  {
    id: 'l-spanakorizo', name: 'Spanakorizo with feta and egg',
    slot: 'lunch', kcal: 660, protein: 30, minutes: 25, cuisine: 'mediterranean',
    equipment: ['pressure'],
    tags: ['packable', 'vegetarian', 'batch', 'leftover-ok', 'comfort'],
    ingredients: ings(
      'Blattspinat (frisch)|300|g|produce', 'Rundkornreis|60|g|dry-goods',
      'Frühlingszwiebel|60|g|produce', 'Zwiebel|50|g|produce', 'Feta|50|g|dairy',
      'Eier|1|Stk|dairy', 'Olivenöl|14|g|pantry', 'Zitrone|30|g|produce', 'Knoblauch|5|g|produce',
      'Dill|12|g|produce'
    ),
    method: [
      'Three hundred grams of spinach looks absurd and cooks down to almost nothing. Use all of it.',
      'Short-grain rice, and barely enough water: this should be sticky, not soupy.',
      'Feta and a soft-boiled egg on top are not a garnish — they are why this clears a lunch target.',
    ],
  },
  {
    id: 'l-fasolada', name: 'Fasoláda — Greek white bean soup',
    slot: 'lunch', kcal: 640, protein: 28, minutes: 45, cuisine: 'mediterranean',
    equipment: ['pressure'],
    tags: ['weekend', 'packable', 'vegetarian', 'batch', 'freezes', 'leftover-ok'],
    ingredients: ings(
      'Weiße Bohnen (Dose)|250|g|dry-goods', 'Möhren|120|g|produce', 'Sellerie|70|g|produce',
      'Zwiebel|60|g|produce', 'Feta|40|g|dairy', 'Tomatenmark|20|g|pantry',
      'Gemüsebrühe|300|ml|pantry', 'Olivenöl|16|g|pantry', 'Knoblauch|8|g|produce',
      'Rosmarin|3|g|produce', 'Lorbeerblatt|1|g|pantry'
    ),
    method: [
      'Sweat the carrot, celery and onion properly — fifteen minutes, no colour. That is the soup.',
      'Tinned beans need twenty minutes, not the hour dried ones want; mash a ladleful to thicken it.',
      'The olive oil goes in raw at the end as well as at the start. In Greece that is not optional.',
    ],
  },
  {
    id: 'l-fakes-linsensuppe', name: 'Fakés — Greek lentil soup',
    slot: 'lunch', kcal: 625, protein: 29, minutes: 30, cuisine: 'mediterranean',
    equipment: ['pressure'],
    tags: ['packable', 'vegetarian', 'batch', 'freezes', 'leftover-ok', 'storecupboard'],
    ingredients: ings(
      'Braune Linsen|70|g|dry-goods', 'Möhren|100|g|produce', 'Sellerie|60|g|produce',
      'Zwiebel|60|g|produce', 'Passata|150|g|dry-goods', 'Feta|40|g|dairy',
      'Gemüsebrühe|350|ml|pantry', 'Olivenöl|14|g|pantry', 'Knoblauch|8|g|produce',
      'Kreuzkümmel|3|g|pantry', 'Rotweinessig|8|ml|pantry', 'Lorbeerblatt|1|g|pantry'
    ),
    method: [
      'Dried lentils, straight in, no soaking — twelve minutes at pressure and they are done.',
      'Red wine vinegar at the table, not in the pot. It is the difference between brown and good.',
      'Bay and cumin together; feta crumbled over turns a side dish into a lunch.',
    ],
  },
  {
    id: 'l-kuerbis-bohnen-suppe', name: 'Pumpkin and red bean soup with smoked ham',
    slot: 'lunch', kcal: 655, protein: 37, minutes: 30, cuisine: 'mediterranean',
    equipment: ['pressure'],
    tags: ['packable', 'batch', 'freezes', 'leftover-ok', 'comfort', 'high-volume'],
    ingredients: ings(
      'Kidneybohnen|200|g|dry-goods', 'Hokkaido-Kürbis|250|g|produce', 'Passata|150|g|dry-goods',
      'Zwiebel|70|g|produce', 'Räucherschinken|60|g|meat-fish', 'Gemüsebrühe|300|ml|pantry',
      'Olivenöl|10|g|pantry', 'Knoblauch|8|g|produce', 'Kreuzkümmel|4|g|pantry',
      'Apfelessig|10|ml|pantry'
    ),
    method: [
      'Hokkaido skin stays on; it breaks down completely and saves ten minutes of peeling.',
      'Blend only half, then stir it back — all-smooth pumpkin soup is baby food.',
      'Beans and smoked ham are what make this a meal; plain pumpkin soup is 53 calories a bowl.',
    ],
  },

  // ---- Shiba's Kitchen, October 2026 --------------------------------------
  // Three packable salads. Lunch was the thinnest slot for meatless options -
  // 13 of 42 - and these are all cold, which is what the office box wants.
  {
    id: 'l-couscous-salat-orientalisch', name: 'Oriental couscous salad',
    slot: 'lunch', kcal: 720, protein: 31, minutes: 20, cuisine: 'middle-eastern',
    equipment: ['hob'], tags: ['packable', 'vegetarian', 'make-ahead', 'leftover-ok', 'high-volume'],
    ingredients: ings('Couscous|60|g|dry-goods', 'Kichererbsen|150|g|dry-goods', 'Kirschtomaten|80|g|produce', 'Gurke|80|g|produce', 'Paprika|60|g|produce', 'Rote Zwiebel|30|g|produce', 'Feta|60|g|dairy', 'Granatapfelkerne|30|g|produce', 'Minze|8|g|produce', 'Petersilie|10|g|produce', 'Zitrone|15|g|produce', 'Honig|5|g|pantry', 'Paprikapulver|2|g|pantry', 'Olivenöl|10|g|pantry'),
    method: [
      'Couscous with stock powder, boiling water over, covered 10 minutes, forked.',
      'Chickpeas tossed in oil and paprika and browned 5 minutes - do not skip this.',
      'Vegetables diced small, herbs chopped fine, nothing in large pieces.',
      'Dressing is oil, lemon and honey, balanced until it tastes sharp.',
      'Feta and pomegranate on top, dressing packed separately if it travels.',
    ],
  },
  {
    id: 'l-kichererbsen-salat-tzatziki', name: 'Chickpea salad with tzatziki',
    slot: 'lunch', kcal: 495, protein: 34, minutes: 10, cuisine: 'mediterranean',
    equipment: ['none'], tags: ['packable', 'vegetarian', 'no-cook', 'make-ahead', 'high-protein', 'high-volume'],
    ingredients: ings('Kichererbsen|220|g|dry-goods', 'Griechischer Joghurt 2 %|150|g|dairy', 'Gurke|180|g|produce', 'Knoblauch|5|g|produce', 'Frühlingszwiebel|20|g|produce', 'Minze|8|g|produce', 'Dill|8|g|produce', 'Zitrone|12|g|produce', 'Honig|4|g|pantry', 'Olivenöl|10|g|pantry'),
    method: [
      'Dressing built in the bowl: yoghurt, grated garlic, lemon, oil, honey.',
      'Chickpeas drained properly and dried - wet chickpeas thin the dressing.',
      'Cucumber halved lengthwise then cut thick, not grated, so it stays crunchy.',
      'Dill and mint folded through last. Better after an hour in the fridge.',
      'No heat anywhere in this one. Ten minutes, 34 g of protein.',
    ],
  },
  {
    id: 'l-glasnudelsalat-tofu', name: 'Asian glass noodle salad with smoked tofu',
    slot: 'lunch', kcal: 670, protein: 31, minutes: 15, cuisine: 'asian',
    equipment: ['none'], tags: ['packable', 'vegetarian', 'make-ahead', 'leftover-ok', 'no-cook'],
    ingredients: ings('Glasnudeln|40|g|dry-goods', 'Räuchertofu|120|g|dairy', 'Weißkohl|80|g|produce', 'Gurke|80|g|produce', 'Möhren|60|g|produce', 'Frühlingszwiebel|20|g|produce', 'Erdnüsse|20|g|pantry', 'Erdnussmus|12|g|pantry', 'Sojasauce|12|ml|pantry', 'Reisessig|10|ml|pantry', 'Sesamöl|5|g|pantry', 'Honig|5|g|pantry', 'Limette|10|g|produce', 'Ingwer|6|g|produce', 'Knoblauch|5|g|produce', 'Koriander|8|g|produce', 'Minze|5|g|produce'),
    method: [
      'Smoked tofu instead of roasting plain tofu for 35 minutes - same job, no oven.',
      'Boiling water over the noodles, 4 minutes, rinsed cold and drained hard.',
      'Cabbage, cucumber and carrot all cut into thin strips, not chunks.',
      'Dressing shaken in a jar: peanut butter, soy, vinegar, sesame, honey, ginger.',
      'Tossed through, peanuts and lime kept back until the lid comes off.',
    ],
  },
];

// ------------------------------------------------------------------ DINNER
const DINNERS = [
  {
    id: 'd-blech-huhn-kartoffel-brokkoli', name: 'Sheet-pan chicken, potatoes and broccoli',
    slot: 'dinner', kcal: 645, protein: 43, minutes: 30, cuisine: 'northern',
    equipment: ['oven'], tags: ['leftover-ok', 'one-pan'],
    ingredients: ings('Hähnchenschenkel ohne Haut|150|g|meat-fish', 'Kartoffeln|250|g|produce', 'Brokkoli|200|g|produce', 'Olivenöl|10|g|pantry', 'Feta|30|g|dairy', 'Paprikapulver|3|g|pantry'),
    method: [
      'Potatoes in first at 220 °C for 10 minutes, they need the head start.',
      'Add chicken and broccoli, roast 20 minutes more, crumble feta over at the end.',
      'Cook the whole tray: what is left is tomorrow lunch with no extra work.',
    ],
  },
  {
    id: 'd-airfryer-lachs-suesskartoffel', name: 'Air-fryer salmon, sweet potato and green beans',
    slot: 'dinner', kcal: 620, protein: 37, minutes: 25, cuisine: 'northern',
    equipment: ['airfryer'], tags: ['leftover-ok', 'one-pan'],
    ingredients: ings('Lachsfilet|150|g|meat-fish', 'Süßkartoffel|250|g|produce', 'Grüne Bohnen|150|g|produce', 'Olivenöl|5|g|pantry', 'Zitrone|20|g|produce'),
    method: [
      'Sweet potato cubes air-fry 18 minutes at 200 °C, shaking once.',
      'Add the salmon and beans for the last 9 minutes — do not overshoot, salmon dries fast.',
    ],
  },
  {
    id: 'd-puten-chili', name: 'Turkey chilli',
    slot: 'dinner', kcal: 625, protein: 49, minutes: 30, cuisine: 'other',
    equipment: ['pressure'], tags: ['leftover-ok', 'batch', 'freezes'],
    ingredients: ings('Putenhackfleisch|150|g|meat-fish', 'Kidneybohnen|150|g|dry-goods', 'Gehackte Tomaten|200|g|dry-goods', 'Paprika|100|g|produce', 'Zwiebel|50|g|produce', 'Reis|45|g|dry-goods', 'Chilipulver|3|g|pantry', 'Kreuzkümmel|3|g|pantry'),
    method: [
      'Brown the mince properly before anything else goes in — that is the whole flavour.',
      'Everything else in, 12 minutes under pressure, natural release.',
      'Double it. Chilli is better on day two and freezes perfectly.',
    ],
  },
  {
    id: 'd-thai-gruenes-curry-huhn', name: 'Thai green chicken curry',
    slot: 'dinner', kcal: 540, protein: 44, minutes: 25, cuisine: 'asian',
    equipment: ['hob'], tags: ['leftover-ok'],
    ingredients: ings('Hähnchenbrust|150|g|meat-fish', 'Kokosmilch light|120|ml|dry-goods', 'Zuckerschoten|100|g|produce', 'Paprika|100|g|produce', 'Reis|45|g|dry-goods', 'Grüne Currypaste|20|g|pantry', 'Fischsauce|10|ml|pantry'),
    method: [
      'Fry the paste in a spoon of the thick coconut cream until it smells strong.',
      'Chicken in, then the rest of the coconut milk, simmer 8 minutes, veg for the last 3.',
      'Light coconut milk saves about 120 kcal a portion and nobody notices in a curry.',
    ],
  },
  {
    id: 'd-kabeljau-tomaten-oliven-orzo', name: 'Baked cod with tomatoes, olives and orzo',
    slot: 'dinner', kcal: 525, protein: 41, minutes: 25, cuisine: 'mediterranean',
    equipment: ['oven'], tags: ['leftover-ok', 'one-pan'],
    ingredients: ings('Kabeljaufilet|180|g|meat-fish', 'Kirschtomaten|200|g|produce', 'Schwarze Oliven|25|g|dry-goods', 'Orzo|60|g|dry-goods', 'Olivenöl|10|g|pantry', 'Knoblauch|8|g|produce', 'Oregano|2|g|pantry'),
    method: [
      'Roast tomatoes, olives, garlic and oil at 200 °C for 12 minutes until they burst.',
      'Lay the cod on top, back in for 10 minutes until it flakes.',
      'Boil the orzo separately and stir it through the pan juices.',
    ],
  },
  {
    id: 'd-rind-brokkoli-nudeln', name: 'Beef and broccoli noodles',
    slot: 'dinner', kcal: 610, protein: 47, minutes: 20, cuisine: 'asian',
    equipment: ['hob'], tags: ['leftover-ok'],
    ingredients: ings('Rindersteak|150|g|meat-fish', 'Brokkoli|200|g|produce', 'Eiernudeln|80|g|dry-goods', 'Sojasauce|20|ml|pantry', 'Ingwer|10|g|produce', 'Knoblauch|8|g|produce', 'Sesamöl|5|g|pantry'),
    method: [
      'Slice the beef thin against the grain and sear it in one layer, 90 seconds.',
      'Out of the pan, broccoli and aromatics in, splash of water, lid on 3 minutes.',
      'Beef back in with the noodles and soy for 30 seconds only, or it toughens.',
    ],
  },
  {
    id: 'd-haehnchen-shawarma-blech', name: 'Chicken shawarma tray with flatbread',
    slot: 'dinner', kcal: 470, protein: 43, minutes: 30, cuisine: 'middle-eastern',
    equipment: ['oven'], tags: ['leftover-ok', 'one-pan'],
    ingredients: ings('Hähnchenschenkel ohne Haut|150|g|meat-fish', 'Shawarma-Gewürz|5|g|pantry', 'Fladenbrot|60|g|bakery', 'Tomaten|75|g|produce', 'Gurke|75|g|produce', 'Skyr natur|80|g|dairy', 'Knoblauch|5|g|produce', 'Olivenöl|5|g|pantry'),
    method: [
      'Toss the chicken in spice and oil — 10 minutes marinating is enough.',
      'Roast at 220 °C for 22 minutes until the edges char, then slice.',
      'Garlic Skyr instead of tahini or mayo keeps this near 470 kcal.',
    ],
  },
  {
    id: 'd-sousvide-huhn-quinoa-karotten', name: 'Sous-vide chicken, herb quinoa, roast carrots',
    slot: 'dinner', kcal: 580, protein: 51, minutes: 30, cuisine: 'mediterranean',
    equipment: ['sousvide', 'oven'], tags: ['leftover-ok'],
    ingredients: ings('Hähnchenbrust|180|g|meat-fish', 'Quinoa|60|g|dry-goods', 'Möhren|200|g|produce', 'Olivenöl|10|g|pantry', 'Petersilie|15|g|produce', 'Zitrone|20|g|produce'),
    method: [
      'Chicken breast sous-vide at 63 °C for 60 minutes — start it before you do anything else.',
      'Carrots roast at 200 °C while the quinoa simmers 15 minutes.',
      'Sear the bagged breast 45 seconds a side at the end for colour.',
      'Bag four breasts at once: sous-vide chicken keeps five days and makes every lunch easy.',
    ],
  },
  {
    id: 'd-bratwurst-linsen-grunkohl', name: 'Chicken sausage with lentils and kale',
    slot: 'dinner', kcal: 560, protein: 45, minutes: 25, cuisine: 'northern',
    equipment: ['hob'], tags: ['leftover-ok', 'one-pan'],
    ingredients: ings('Geflügelbratwurst|150|g|meat-fish', 'Braune Linsen (Dose)|150|g|dry-goods', 'Grünkohl|150|g|produce', 'Zwiebel|50|g|produce', 'Senf|10|g|pantry', 'Olivenöl|5|g|pantry'),
    method: [
      'Brown the sausages, take them out, soften the onion in the fat.',
      'Lentils and kale in with a splash of water, lid on 5 minutes until the kale collapses.',
      'Stir the mustard through off the heat and slice the sausage back in.',
    ],
  },
  {
    id: 'd-airfryer-schnitzel-kartoffelsalat', name: 'Air-fryer schnitzel with light potato salad',
    slot: 'dinner', kcal: 615, protein: 56, minutes: 30, cuisine: 'northern',
    equipment: ['airfryer'], tags: ['comfort'],
    ingredients: ings('Hähnchenbrust|150|g|meat-fish', 'Paniermehl|30|g|dry-goods', 'Eier|1|Stk|dairy', 'Kartoffeln|250|g|produce', 'Skyr natur|60|g|dairy', 'Gurke|100|g|produce', 'Senf|8|g|pantry'),
    method: [
      'Flatten the breast to 1 cm, egg, then breadcrumbs, spray lightly with oil.',
      'Air-fry 12 minutes at 200 °C, turning once — crisp with about a tenth of the fat.',
      'Dress warm boiled potatoes with Skyr, mustard, cucumber and lots of pepper.',
    ],
  },
  {
    id: 'd-miso-lachs-reis-pakchoi', name: 'Miso-glazed salmon with rice and pak choi',
    slot: 'dinner', kcal: 625, protein: 40, minutes: 20, cuisine: 'asian',
    equipment: ['airfryer'], tags: ['leftover-ok'],
    ingredients: ings('Lachsfilet|150|g|meat-fish', 'Reis|55|g|dry-goods', 'Pak Choi|200|g|produce', 'Miso-Paste|15|g|pantry', 'Honig|5|g|pantry', 'Sesam|5|g|pantry'),
    method: [
      'Mix miso and honey, brush half on, air-fry 9 minutes at 190 °C, brush the rest on.',
      'Steam the pak choi over the rice pot for the last 4 minutes.',
    ],
  },
  {
    id: 'd-koefte-bulgur-joghurt', name: 'Köfte with bulgur pilaf and yoghurt',
    slot: 'dinner', kcal: 555, protein: 49, minutes: 25, cuisine: 'middle-eastern',
    equipment: ['hob'], tags: ['leftover-ok'],
    ingredients: ings('Rinderhackfleisch 5 %|150|g|meat-fish', 'Bulgur|60|g|dry-goods', 'Griechischer Joghurt 2 %|100|g|dairy', 'Zwiebel|50|g|produce', 'Petersilie|15|g|produce', 'Kreuzkümmel|3|g|pantry', 'Olivenöl|5|g|pantry', 'Kopfsalat|100|g|produce'),
    method: [
      'Work grated onion, parsley and cumin into the mince for a full two minutes — that is what makes it köfte and not a burger.',
      'Shape into fingers and fry 4 minutes a side in a dry pan.',
      'Bulgur takes 12 minutes covered off the heat in boiling stock.',
    ],
  },
  {
    id: 'd-spaghetti-thunfisch-kapern', name: 'Spaghetti with tuna, capers and tomato',
    slot: 'dinner', kcal: 610, protein: 49, minutes: 20, cuisine: 'mediterranean',
    equipment: ['hob'], tags: ['leftover-ok', 'storecupboard'],
    ingredients: ings('Vollkornspaghetti|90|g|dry-goods', 'Thunfisch in Wasser|150|g|dry-goods', 'Passata|200|g|dry-goods', 'Kapern|15|g|pantry', 'Olivenöl|10|g|pantry', 'Knoblauch|8|g|produce', 'Chiliflocken|2|g|pantry'),
    method: [
      'Garlic and chilli in the oil, passata in, reduce hard for 8 minutes.',
      'Tuna and capers in at the very end so the tuna stays in flakes.',
      'Finish the pasta in the sauce with a ladle of its water.',
    ],
  },
  {
    id: 'd-slowcooker-marokkanisches-huhn', name: 'Slow-cooker Moroccan chicken and chickpeas',
    slot: 'dinner', kcal: 670, protein: 46, minutes: 20, cuisine: 'middle-eastern',
    equipment: ['slowcooker'], tags: ['leftover-ok', 'batch', 'freezes', 'hands-off'],
    ingredients: ings('Hähnchenschenkel ohne Haut|150|g|meat-fish', 'Kichererbsen|150|g|dry-goods', 'Getrocknete Aprikosen|20|g|dry-goods', 'Couscous|50|g|dry-goods', 'Zwiebel|50|g|produce', 'Ras el Hanout|5|g|pantry', 'Olivenöl|5|g|pantry', 'Gemüsebrühe|200|ml|pantry'),
    method: [
      'Twenty minutes of work in the morning, then it is done when you walk in.',
      'Brown the chicken and onion first if you have five minutes; it is worth it.',
      'Everything into the slow cooker on low for 6 hours; couscous takes 5 minutes at the end.',
    ],
  },
  {
    id: 'd-airfryer-halloumi-gemuese-couscous', name: 'Air-fryer halloumi and vegetable traybake',
    slot: 'dinner', kcal: 680, protein: 38, minutes: 25, cuisine: 'mediterranean',
    equipment: ['airfryer'], tags: ['leftover-ok', 'vegetarian', 'one-pan'],
    ingredients: ings('Halloumi|90|g|dairy', 'Zucchini|150|g|produce', 'Paprika|150|g|produce', 'Couscous|60|g|dry-goods', 'Griechischer Joghurt 2 %|100|g|dairy', 'Olivenöl|5|g|pantry', 'Za’atar|3|g|pantry'),
    method: [
      'Vegetables air-fry 12 minutes at 200 °C, halloumi added for the last 6.',
      'Couscous under a lid with boiling stock for 5 minutes, then forked.',
      'Yoghurt thinned with lemon spooned over, za’atar on top.',
    ],
  },
  {
    id: 'd-oyakodon-huhn-ei-reis', name: 'Oyakodon — chicken and egg rice bowl',
    slot: 'dinner', kcal: 640, protein: 48, minutes: 25, cuisine: 'asian',
    equipment: ['hob'], tags: ['comfort'],
    ingredients: ings('Hähnchenschenkel ohne Haut|150|g|meat-fish', 'Eier|2|Stk|dairy', 'Zwiebel|80|g|produce', 'Sojasauce|20|ml|pantry', 'Mirin|15|ml|pantry', 'Reis|55|g|dry-goods', 'Frühlingszwiebel|20|g|produce'),
    method: [
      'Simmer onion in soy, mirin and a splash of water for 4 minutes.',
      'Chicken in for 6 minutes, then pour the beaten egg over and cover for 90 seconds.',
      'The egg should still be soft when it hits the rice — that is the whole dish.',
    ],
  },
  {
    id: 'd-schweinefilet-sauerkraut-kartoffeln', name: 'Pork tenderloin with sauerkraut and potatoes',
    slot: 'dinner', kcal: 520, protein: 42, minutes: 25, cuisine: 'northern',
    equipment: ['hob'], tags: ['leftover-ok', 'comfort'],
    ingredients: ings('Schweinefilet|160|g|meat-fish', 'Sauerkraut|200|g|dry-goods', 'Apfel|80|g|produce', 'Kartoffeln|250|g|produce', 'Olivenöl|5|g|pantry', 'Kümmel|2|g|pantry'),
    method: [
      'Sear the medallions 3 minutes a side and let them rest — pork tenderloin is ruined by five.',
      'Warm the sauerkraut with grated apple and caraway; the apple is what makes it good.',
    ],
  },
  {
    id: 'd-garnelen-zoodles-aglio-olio', name: 'Prawn aglio e olio with courgette noodles',
    slot: 'dinner', kcal: 500, protein: 47, minutes: 20, cuisine: 'mediterranean',
    equipment: ['hob'], tags: ['low-carb', 'fast'],
    ingredients: ings('Garnelen|200|g|meat-fish', 'Zucchini|300|g|produce', 'Olivenöl|15|g|pantry', 'Knoblauch|10|g|produce', 'Chiliflocken|2|g|pantry', 'Petersilie|15|g|produce', 'Vollkornbrot|45|g|bakery'),
    method: [
      'Sizzle the sliced garlic and chilli gently in the oil — do not let it brown.',
      'Prawns 90 seconds a side, courgette ribbons in for one minute only.',
      'Salt the courgette in a colander 10 minutes first or the pan floods.',
    ],
  },
  {
    id: 'd-dal-spinat-reis', name: 'Red lentil dal with spinach',
    slot: 'dinner', kcal: 675, protein: 41, minutes: 25, cuisine: 'asian',
    equipment: ['pressure'], tags: ['leftover-ok', 'batch', 'vegetarian', 'freezes'],
    ingredients: ings('Rote Linsen|120|g|dry-goods', 'TK-Blattspinat|150|g|frozen', 'Gehackte Tomaten|100|g|dry-goods', 'Zwiebel|50|g|produce', 'Garam Masala|5|g|pantry', 'Ingwer|10|g|produce', 'Reis|30|g|dry-goods', 'Griechischer Joghurt 2 %|50|g|dairy'),
    method: [
      'Bloom the spices in oil with ginger and onion until fragrant, about 2 minutes.',
      'Lentils, tomatoes and 500 ml water, 8 minutes under pressure.',
      'Spinach stirred in at the end off the heat, yoghurt on top.',
    ],
  },
  {
    id: 'd-puten-hackbaellchen-mozzarella', name: 'Turkey meatballs baked with mozzarella',
    slot: 'dinner', kcal: 550, protein: 55, minutes: 30, cuisine: 'mediterranean',
    equipment: ['oven'], tags: ['leftover-ok', 'comfort'],
    ingredients: ings('Putenhackfleisch|150|g|meat-fish', 'Passata|200|g|dry-goods', 'Mozzarella light|60|g|dairy', 'Vollkornpasta|60|g|dry-goods', 'Basilikum|10|g|produce', 'Knoblauch|8|g|produce'),
    method: [
      'Roll small meatballs, brown them in a pan for colour, then sit them in the passata.',
      'Mozzarella over the top, 15 minutes at 200 °C until blistered.',
      'Bake it in the dish you serve from and there is one pan to wash.',
    ],
  },
  {
    id: 'd-huehner-ramen', name: 'Quick chicken ramen',
    slot: 'dinner', kcal: 500, protein: 44, minutes: 20, cuisine: 'asian',
    equipment: ['hob'], tags: ['fast', 'comfort'],
    ingredients: ings('Hähnchenbrust|120|g|meat-fish', 'Ramen-Nudeln|70|g|dry-goods', 'Hühnerbrühe|500|ml|pantry', 'Eier|1|Stk|dairy', 'Pak Choi|100|g|produce', 'Möhren|50|g|produce', 'Miso-Paste|10|g|pantry', 'Frühlingszwiebel|20|g|produce'),
    method: [
      'Poach the chicken in the broth for 12 minutes, lift out and shred it.',
      'Egg in boiling water for exactly 6.5 minutes for a jammy yolk.',
      'Whisk the miso into the broth off the boil, never in it, or it goes grainy.',
    ],
  },
  {
    id: 'd-blech-kichererbsen-kabeljau', name: 'Sheet-pan paprika chickpeas with cod',
    slot: 'dinner', kcal: 515, protein: 47, minutes: 25, cuisine: 'mediterranean',
    equipment: ['oven'], tags: ['leftover-ok', 'one-pan'],
    ingredients: ings('Kabeljaufilet|180|g|meat-fish', 'Kichererbsen|200|g|dry-goods', 'Paprika|150|g|produce', 'Olivenöl|10|g|pantry', 'Geräuchertes Paprikapulver|4|g|pantry', 'Knoblauch|8|g|produce', 'Zitrone|20|g|produce'),
    method: [
      'Toss drained chickpeas and peppers with oil and smoked paprika, roast 15 minutes at 210 °C.',
      'Cod on top, 10 minutes more, lemon squeezed over at the table.',
      'Roasting the chickpeas until some split is the point — they go nutty.',
    ],
  },
  {
    id: 'd-rinderspiesse-gemuese-fladenbrot', name: 'Beef skewers with grilled vegetables',
    slot: 'dinner', kcal: 500, protein: 46, minutes: 25, cuisine: 'middle-eastern',
    equipment: ['airfryer'], tags: ['leftover-ok'],
    ingredients: ings('Rindersteak|150|g|meat-fish', 'Zucchini|100|g|produce', 'Paprika|100|g|produce', 'Zwiebel|50|g|produce', 'Fladenbrot|60|g|bakery', 'Griechischer Joghurt 2 %|80|g|dairy', 'Olivenöl|5|g|pantry', 'Sumach|3|g|pantry'),
    method: [
      'Thread beef and vegetables alternately; air-fry 10 minutes at 200 °C.',
      'Warm the flatbread on top of the basket for the last minute.',
      'Yoghurt with sumach and lemon as the sauce.',
    ],
  },
  {
    id: 'd-bibimbap-rind-ei', name: 'Bibimbap-style beef and egg rice bowl',
    slot: 'dinner', kcal: 600, protein: 40, minutes: 25, cuisine: 'asian',
    equipment: ['hob'], tags: ['comfort'],
    ingredients: ings('Rinderhackfleisch 5 %|120|g|meat-fish', 'Reis|55|g|dry-goods', 'TK-Blattspinat|100|g|frozen', 'Möhren|100|g|produce', 'Eier|1|Stk|dairy', 'Gochujang|20|g|pantry', 'Sesamöl|5|g|pantry', 'Sesam|5|g|pantry'),
    method: [
      'Cook the mince hard with a spoon of gochujang until the edges crisp.',
      'Keep the carrot, spinach and mince in separate piles on the rice — mixing at the table is half the pleasure.',
      'Fried egg on top, sesame oil over everything.',
    ],
  },
  {
    id: 'd-skyr-haehnchen-pilze-pasta', name: 'Creamy Skyr chicken and mushroom pasta',
    slot: 'dinner', kcal: 590, protein: 61, minutes: 25, cuisine: 'northern',
    equipment: ['hob'], tags: ['leftover-ok', 'comfort'],
    ingredients: ings('Hähnchenbrust|150|g|meat-fish', 'Champignons|200|g|produce', 'Skyr natur|100|g|dairy', 'Vollkornpasta|80|g|dry-goods', 'Knoblauch|8|g|produce', 'Petersilie|10|g|produce', 'Olivenöl|5|g|pantry'),
    method: [
      'Brown the mushrooms in a dry hot pan until they squeak, then add oil and garlic.',
      'Chicken in, cooked through, pan OFF the heat before the Skyr goes in.',
      'Skyr splits if it boils. Off the heat, loosened with pasta water, it is a cream sauce for 60 kcal.',
    ],
  },
  {
    id: 'd-gefuellte-paprika-pute', name: 'Stuffed peppers with turkey and feta',
    slot: 'dinner', kcal: 480, protein: 42, minutes: 30, cuisine: 'mediterranean',
    equipment: ['oven'], tags: ['leftover-ok'],
    ingredients: ings('Paprika|240|g|produce', 'Putenhackfleisch|150|g|meat-fish', 'Reis|30|g|dry-goods', 'Feta|30|g|dairy', 'Passata|100|g|dry-goods', 'Zwiebel|50|g|produce', 'Oregano|2|g|pantry'),
    method: [
      'Mix raw mince with part-cooked rice, onion, passata and oregano.',
      'Fill the halved peppers, feta on top, 25 minutes at 200 °C covered with foil.',
      'Uncover for the last 5 minutes so the tops colour.',
    ],
  },
  {
    id: 'd-fischtacos-airfryer', name: 'Air-fryer fish tacos with slaw',
    slot: 'dinner', kcal: 455, protein: 48, minutes: 20, cuisine: 'other',
    equipment: ['airfryer'], tags: ['fast'],
    ingredients: ings('Seelachsfilet|180|g|meat-fish', 'Mais-Tortillas|75|g|bakery', 'Weißkohl|120|g|produce', 'Skyr natur|80|g|dairy', 'Limette|25|g|produce', 'Avocado|40|g|produce', 'Kreuzkümmel|3|g|pantry'),
    method: [
      'Dust the fish with cumin and paprika, air-fry 8 minutes at 200 °C.',
      'Shred the cabbage fine and dress it with Skyr, lime and salt — that is the slaw.',
      'Warm the tortillas 30 seconds in the basket at the end.',
    ],
  },
  {
    id: 'd-postfootball-huhn-reis-bowl', name: 'Football-night chicken rice bowl (reheat only)',
    slot: 'dinner', kcal: 530, protein: 43, minutes: 5, cuisine: 'asian',
    equipment: ['none'], tags: ['post-football', 'leftover-ok', 'make-ahead', 'no-cook'],
    ingredients: ings('Hähnchenbrust (gegart)|150|g|meat-fish', 'Reis (gekocht)|200|g|dry-goods', 'Ofengemüse (Reste)|200|g|produce', 'Sojasauce|15|ml|pantry', 'Sesamöl|5|g|pantry', 'Frühlingszwiebel|20|g|produce'),
    method: [
      'Assemble this on THURSDAY and leave it in the fridge in the bowl you will eat from.',
      'Friday 22:00: three minutes in the microwave, soy and sesame over the top.',
      'The whole plan lives or dies on this one. A cooked meal waiting beats every takeaway.',
    ],
  },
  {
    id: 'd-postfootball-rind-graupen-eintopf', name: 'Football-night beef and barley stew (made ahead)',
    slot: 'dinner', kcal: 465, protein: 39, minutes: 8, cuisine: 'northern',
    equipment: ['pressure'], tags: ['post-football', 'leftover-ok', 'make-ahead', 'batch', 'freezes'],
    ingredients: ings('Rindfleisch (Gulasch)|150|g|meat-fish', 'Graupen|60|g|dry-goods', 'Möhren|100|g|produce', 'Sellerie|50|g|produce', 'Zwiebel|50|g|produce', 'Rinderbrühe|400|ml|pantry', 'Tomatenmark|15|g|pantry'),
    method: [
      'Make it any earlier day of the week: 35 minutes under pressure, then it just sits.',
      'Friday: reheat one portion in a pan for 8 minutes while you shower.',
      'Barley keeps its bite for days, unlike pasta or potato in a stew.',
    ],
  },
  {
    id: 'd-postfootball-protein-toastie-suppe', name: 'Football-night protein toastie and tomato soup',
    slot: 'dinner', kcal: 595, protein: 50, minutes: 8, cuisine: 'northern',
    equipment: ['hob'], tags: ['post-football', 'fast', 'comfort'],
    ingredients: ings('Vollkornbrot|90|g|bakery', 'Gouda leicht|60|g|dairy', 'Putenbrust (Aufschnitt)|100|g|meat-fish', 'Tomatensuppe|300|ml|dry-goods', 'Senf|8|g|pantry'),
    method: [
      'Mustard, turkey, cheese, dry pan, weight on top, 3 minutes a side.',
      'Soup in a mug alongside while the toastie presses.',
      'This is the honest answer to bread-and-cheese cravings: same food, 50 g of protein.',
    ],
  },
  {
    id: 'd-postfootball-chili-con-carne', name: 'Football-night chilli con carne (slow cooker, made ahead)',
    slot: 'dinner', kcal: 620, protein: 44, minutes: 7, cuisine: 'other',
    equipment: ['slowcooker'], tags: ['post-football', 'leftover-ok', 'make-ahead', 'batch', 'freezes', 'comfort'],
    ingredients: ings('Rinderhackfleisch 5 %|140|g|meat-fish', 'Kidneybohnen|120|g|dry-goods', 'Mais (Dose)|60|g|dry-goods', 'Passata|150|g|dry-goods', 'Zwiebel|50|g|produce', 'Paprika|80|g|produce', 'Chili|3|g|produce', 'Kreuzkümmel|3|g|pantry', 'Reis|50|g|dry-goods'),
    method: [
      'Everything but the rice into the slow cooker on a day you are home: 6 hours on low, no attention.',
      'Portion it into boxes the same evening. Friday 22:00 it is five minutes in the microwave with the rice.',
      'Chilli is better on day three than on day one, which makes it the one dish that pays you for being early.',
    ],
  },
  {
    id: 'd-postfootball-haehnchen-duerum', name: 'Football-night chicken dürüm (assemble only)',
    slot: 'dinner', kcal: 590, protein: 58, minutes: 6, cuisine: 'middle-eastern',
    equipment: ['none'], tags: ['post-football', 'fast', 'no-cook', 'make-ahead'],
    ingredients: ings('Hähnchenbrust (gegart)|140|g|meat-fish', 'Fladenbrot|100|g|bakery', 'Magerquark|80|g|dairy', 'Knoblauch|4|g|produce', 'Weißkohl|60|g|produce', 'Tomaten|60|g|produce', 'Rote Zwiebel|20|g|produce', 'Sumach|2|g|pantry'),
    method: [
      'Cook the chicken earlier in the week — sous vide at 63 °C, or just poached — and shred it cold.',
      'Quark, crushed garlic and sumac is the sauce. Thirty seconds, and it tastes like the shop.',
      'Warm the flatbread 40 seconds, pile it up, roll it tight. The dönerbude order with the protein tripled.',
    ],
  },
  {
    id: 'd-postfootball-lachs-kartoffelsalat', name: 'Football-night sous-vide salmon with potato salad (cold)',
    slot: 'dinner', kcal: 635, protein: 42, minutes: 5, cuisine: 'northern',
    equipment: ['sousvide'], tags: ['post-football', 'leftover-ok', 'make-ahead', 'no-cook'],
    ingredients: ings('Lachsfilet|150|g|meat-fish', 'Kartoffeln|250|g|produce', 'Skyr natur|60|g|dairy', 'Senf|8|g|pantry', 'Dill|8|g|produce', 'Gurke|60|g|produce', 'Rote Zwiebel|20|g|produce', 'Olivenöl|8|g|pantry'),
    method: [
      'Salmon sous vide at 45 °C for 40 minutes on any earlier day, then into the fridge still in the bag.',
      'Dress the boiled potatoes with skyr, mustard and dill while they are warm — warm potato drinks it up.',
      'Friday: open the fridge, put it on a plate. Cold on purpose, so nothing can go wrong at 22:00.',
    ],
  },
  {
    id: 'd-postfootball-rote-linsen-dal', name: 'Football-night red lentil dal (pressure cooker, made ahead)',
    slot: 'dinner', kcal: 600, protein: 37, minutes: 8, cuisine: 'asian',
    equipment: ['pressure'], tags: ['post-football', 'leftover-ok', 'make-ahead', 'batch', 'freezes', 'vegetarian'],
    ingredients: ings('Rote Linsen|80|g|dry-goods', 'Kokosmilch light|80|ml|pantry', 'Passata|100|g|dry-goods', 'Zwiebel|50|g|produce', 'Ingwer|8|g|produce', 'Knoblauch|6|g|produce', 'Garam Masala|4|g|pantry', 'Magerquark|100|g|dairy', 'Reis|40|g|dry-goods'),
    method: [
      'Twelve minutes under pressure earlier in the week, then it sits in the fridge thickening.',
      'Friday: reheat with a splash of water and stir the cold quark through off the heat — protein and tang at once.',
      'The vegetarian football dinner, because five meat dinners a week is how the shopping bill escapes.',
    ],
  },
  {
    id: 'd-postfootball-airfryer-haehnchen-pommes', name: 'Football-night air-fryer chicken and sweet potato fries (from frozen)',
    slot: 'dinner', kcal: 555, protein: 51, minutes: 10, cuisine: 'other',
    equipment: ['airfryer'], tags: ['post-football', 'fast', 'zero-effort', 'storecupboard'],
    ingredients: ings('TK-Hähnchenbrust|180|g|frozen', 'TK-Süßkartoffel-Pommes|180|g|frozen', 'Magerquark|80|g|dairy', 'Paprikapulver|3|g|pantry', 'Senf|8|g|pantry', 'Schnittlauch|8|g|produce'),
    method: [
      'This one needs nothing prepared in advance, which is why it is here: some weeks Thursday does not happen.',
      'Air fryer at 200 °C, chicken and fries together. Ten minutes of hands-on, the rest unattended while you shower.',
      'Quark, paprika, mustard and chives as the dip. The emergency option that is still not a pizza.',
    ],
  },
  {
    id: 'd-blumenkohl-huhn-curry', name: 'Cauliflower and chicken curry with rice',
    slot: 'dinner', kcal: 540, protein: 46, minutes: 25, cuisine: 'asian',
    equipment: ['hob'], tags: ['leftover-ok', 'one-pan', 'freezes'],
    ingredients: ings('Hähnchenbrust|160|g|meat-fish', 'Blumenkohl|200|g|produce', 'Kokosmilch light|100|ml|pantry', 'Garam Masala|5|g|pantry', 'Zwiebel|50|g|produce', 'Ingwer|8|g|produce', 'Reis|60|g|dry-goods', 'Koriander|8|g|produce'),
    method: [
      'Onion, ginger and garam masala in the dry pan first — 60 seconds is the whole difference between curry and soup.',
      'Chicken, cauliflower, coconut milk, lid on for 15 minutes while the rice cooks.',
      'Cauliflower drinks up sauce in a way that potato does not, for a third of the calories.',
    ],
  },
  {
    id: 'd-lauch-lachs-gratin', name: 'Leek and salmon bake with potatoes',
    slot: 'dinner', kcal: 675, protein: 55, minutes: 30, cuisine: 'northern',
    equipment: ['oven'], tags: ['leftover-ok', 'one-pan', 'comfort'],
    ingredients: ings('Lachsfilet|150|g|meat-fish', 'Lauch|150|g|produce', 'Kartoffeln|250|g|produce', 'Skyr natur|80|g|dairy', 'Senf|8|g|pantry', 'Gouda leicht, gerieben|25|g|dairy', 'Dill|8|g|produce'),
    method: [
      'Slice the potatoes thin — 3 mm — or they will still be raw when the salmon is done.',
      'Skyr and mustard instead of cream: same job, a third of the fat, and it does not split in the oven.',
      '25 minutes at 200 °C, the cheese on top for the last five.',
    ],
  },
  {
    id: 'd-kuerbis-linsen-eintopf', name: 'Hokkaido squash and lentil stew with chicken',
    slot: 'dinner', kcal: 525, protein: 47, minutes: 30, cuisine: 'northern',
    equipment: ['pressure'], tags: ['leftover-ok', 'batch', 'freezes', 'one-pan', 'hands-off'],
    ingredients: ings('Hähnchenschenkel ohne Haut|150|g|meat-fish', 'Hokkaido-Kürbis|250|g|produce', 'Braune Linsen (Dose)|150|g|dry-goods', 'Zwiebel|50|g|produce', 'Möhren|80|g|produce', 'Hühnerbrühe|300|ml|pantry', 'Geräuchertes Paprikapulver|4|g|pantry'),
    method: [
      'Hokkaido skin stays on — it softens completely, and peeling a squash is ten minutes you will not spend.',
      'Twelve minutes under pressure, then shred the thigh meat back through it.',
      'Makes four portions from one pot and freezes flat. The autumn answer to the Thursday question.',
    ],
  },
  {
    id: 'd-rosenkohl-hack-kartoffeln', name: 'Air-fryer sprouts with beef mince and potatoes',
    slot: 'dinner', kcal: 590, protein: 43, minutes: 25, cuisine: 'northern',
    equipment: ['airfryer'], tags: ['leftover-ok', 'one-pan', 'low-carb'],
    ingredients: ings('Rinderhackfleisch 5 %|150|g|meat-fish', 'Rosenkohl|200|g|produce', 'Kartoffeln|250|g|produce', 'Zwiebel|50|g|produce', 'Senf|10|g|pantry', 'Olivenöl|8|g|pantry'),
    method: [
      'Halve the sprouts and the cut faces caramelise — this is the version that converts people who hate sprouts.',
      'Potatoes in first for 10 minutes, then sprouts and mince on top for 12 more.',
      'Mustard stirred through at the end, off the heat.',
    ],
  },
  {
    id: 'd-fenchel-kabeljau-ofen', name: 'Baked cod with fennel and white beans',
    slot: 'dinner', kcal: 450, protein: 45, minutes: 30, cuisine: 'mediterranean',
    equipment: ['oven'], tags: ['one-pan', 'low-carb'],
    ingredients: ings('Kabeljaufilet|180|g|meat-fish', 'Fenchel|200|g|produce', 'Weiße Bohnen (Dose)|150|g|dry-goods', 'Kirschtomaten|120|g|produce', 'Zitrone|20|g|produce', 'Olivenöl|10|g|pantry', 'Oregano|2|g|pantry'),
    method: [
      'Fennel sliced thin, beans and tomatoes around it, 15 minutes at 200 °C on its own.',
      'Cod on top for the last 10 — any longer and it goes from flaking to chalky.',
      '450 kcal with 45 g of protein, which is the lightest honest dinner in the book.',
    ],
  },
  {
    id: 'd-gochujang-schwein-pak-choi', name: 'Gochujang pork with rice and pak choi',
    slot: 'dinner', kcal: 505, protein: 44, minutes: 25, cuisine: 'asian',
    equipment: ['hob'], tags: ['fast', 'one-pan'],
    ingredients: ings('Schweinefilet|160|g|meat-fish', 'Pak Choi|200|g|produce', 'Reis|60|g|dry-goods', 'Gochujang|20|g|pantry', 'Sojasauce|12|ml|pantry', 'Ingwer|8|g|produce', 'Sesam|5|g|pantry', 'Frühlingszwiebel|20|g|produce'),
    method: [
      'Pork tenderloin in 1 cm coins, hot pan, two minutes a side and out. It is lean enough to go dry in three.',
      'Gochujang, soy and ginger into the same pan, pak choi in, lid on for two minutes.',
      'Back in with the pork, sesame over it. The pan does all four things in order.',
    ],
  },
  {
    id: 'd-mercimek-koeftesi', name: 'Mercimek köftesi — red lentil balls with salad',
    slot: 'dinner', kcal: 610, protein: 43, minutes: 25, cuisine: 'middle-eastern',
    equipment: ['hob'], tags: ['leftover-ok', 'make-ahead', 'vegetarian', 'no-cook'],
    ingredients: ings('Rote Linsen|90|g|dry-goods', 'Bulgur|50|g|dry-goods', 'Zwiebel|50|g|produce', 'Tomatenmark|20|g|pantry', 'Petersilie|15|g|produce', 'Zitrone|20|g|produce', 'Kopfsalat|60|g|produce', 'Magerquark|120|g|dairy', 'Kreuzkümmel|4|g|pantry'),
    method: [
      'Lentils soft, bulgur stirred in off the heat, lid on 15 minutes — the bulgur cooks in the steam.',
      'Shape cold with wet hands. They keep four days and are eaten cold, in lettuce leaves.',
      'Quark alongside takes it from 28 g of protein to 43, which is what makes it a dinner and not a side.',
    ],
  },
  {
    id: 'd-haehnchen-shish-rote-bete', name: 'Chicken shish with beetroot and walnut salad',
    slot: 'dinner', kcal: 585, protein: 57, minutes: 25, cuisine: 'middle-eastern',
    equipment: ['airfryer'], tags: ['leftover-ok', 'fast'],
    ingredients: ings('Hähnchenbrust|170|g|meat-fish', 'Rote Bete|180|g|produce', 'Griechischer Joghurt 2 %|100|g|dairy', 'Walnüsse|15|g|pantry', 'Fladenbrot|60|g|bakery', 'Za’atar|4|g|pantry', 'Zitrone|15|g|produce'),
    method: [
      'Vacuum-packed cooked beetroot is the whole trick here — raw beetroot is a 50-minute vegetable.',
      'Chicken in the air fryer at 200 °C, 14 minutes, za’atar on after not before so it does not burn.',
      'Grate the beetroot, fold in yoghurt, lemon and crushed walnuts. Purple, sharp, and done before the chicken.',
    ],
  },
  {
    id: 'd-lahmacun-blech', name: 'Sheet-pan lahmacun',
    slot: 'dinner', kcal: 495, protein: 48, minutes: 25, cuisine: 'middle-eastern',
    equipment: ['oven'], tags: ['fast', 'one-pan'],
    ingredients: ings('Putenhackfleisch|150|g|meat-fish', 'Fladenbrot|100|g|bakery', 'Passata|60|g|dry-goods', 'Zwiebel|50|g|produce', 'Petersilie|15|g|produce', 'Spitzpaprika|80|g|produce', 'Sumach|3|g|pantry', 'Zitrone|15|g|produce', 'Rucola|40|g|produce'),
    method: [
      'Blitz the raw mince with onion, pepper, passata and parsley to a paste, spread it paper-thin on the flatbread.',
      '240 °C, 9 minutes, straight on the hot tray. Thin is the entire point.',
      'Rocket, lemon and sumac on at the table, then roll it up. Turkey mince keeps it at 495 kcal.',
    ],
  },
  {
    id: 'd-fasulye-bulgur', name: 'Turkish white beans (fasulye) with bulgur and yoghurt',
    slot: 'dinner', kcal: 680, protein: 37, minutes: 25, cuisine: 'middle-eastern',
    equipment: ['pressure'], tags: ['leftover-ok', 'batch', 'freezes', 'vegetarian', 'storecupboard'],
    ingredients: ings('Weiße Bohnen (Dose)|200|g|dry-goods', 'Passata|120|g|dry-goods', 'Zwiebel|50|g|produce', 'Möhren|80|g|produce', 'Bulgur|50|g|dry-goods', 'Griechischer Joghurt 2 %|120|g|dairy', 'Olivenöl|10|g|pantry', 'Petersilie|10|g|produce', 'Feta|30|g|dairy'),
    method: [
      'Tinned beans, so this is a 25-minute dish pretending to be a four-hour one.',
      'Onion and carrot soft, passata in, beans in, ten minutes under pressure to make them taste simmered.',
      'The whole-cupboard dinner: nothing in it needs to be bought fresh except the parsley.',
    ],
  },
  {
    id: 'd-thai-huhn-blumenkohlreis', name: 'Thai chicken salad with cauliflower rice',
    slot: 'dinner', kcal: 480, protein: 52, minutes: 20, cuisine: 'asian',
    equipment: ['hob'], tags: ['leftover-ok', 'make-ahead', 'low-carb', 'fast'],
    ingredients: ings('Hähnchenbrust|180|g|meat-fish', 'Blumenkohl|250|g|produce', 'Limette|20|g|produce', 'Fischsauce|12|ml|pantry', 'Erdnüsse|20|g|pantry', 'Chili|4|g|produce', 'Koriander|10|g|produce', 'Gurke|80|g|produce', 'Möhren|60|g|produce', 'Sesamöl|8|g|pantry'),
    method: [
      'Grate the cauliflower on the coarse side and dry-fry it four minutes — raw it tastes like raw cauliflower.',
      'Lime, fish sauce, chilli and a little sesame oil is the dressing. No sugar, and you will not miss it.',
      'Better on day two, which makes it the lunch that happens by accident.',
    ],
  },
  {
    id: 'd-ofen-frittata-spinat', name: 'Oven frittata with spinach and potato',
    slot: 'dinner', kcal: 635, protein: 53, minutes: 30, cuisine: 'other',
    equipment: ['oven'], tags: ['leftover-ok', 'make-ahead', 'vegetarian', 'one-pan', 'batch'],
    ingredients: ings('Eier|4|Stk|dairy', 'Blattspinat (frisch)|150|g|produce', 'Kartoffeln|200|g|produce', 'Gouda leicht, gerieben|30|g|dairy', 'Magerquark|80|g|dairy', 'Zwiebel|50|g|produce', 'Kresse|10|g|produce'),
    method: [
      'Boiled potatoes from the night before are what this is really for — cold, sliced, straight in.',
      'Quark whisked into the eggs keeps it soft when it is reheated, which a plain frittata never is.',
      '22 minutes at 180 °C. Eaten hot, cold, or out of the fridge at midnight.',
    ],
  },
  {
    id: 'd-sonntagshuhn-blech', name: 'Sunday roast chicken with root vegetables',
    slot: 'dinner', kcal: 670, protein: 51, minutes: 75, cuisine: 'northern',
    equipment: ['oven'], tags: ['weekend', 'leftover-ok', 'batch', 'one-pan', 'hands-off'],
    ingredients: ings('Hähnchen (ganz)|300|g|meat-fish', 'Kartoffeln|250|g|produce', 'Möhren|150|g|produce', 'Lauch|100|g|produce', 'Zitrone|30|g|produce', 'Olivenöl|10|g|pantry', 'Rosmarin|4|g|produce'),
    method: [
      'Lemon in the cavity, vegetables under the bird, 70 minutes at 190 °C. Ten minutes of work, sixty of nothing.',
      'Carve the breasts off for the week before you sit down, or they will be eaten tonight.',
      'This is the recipe that stocks the fridge: the cooked chicken in the Friday dürüm and the leftover wrap comes from here.',
    ],
  },
  {
    id: 'd-pulled-chicken-wochenstart', name: 'Weekend pulled chicken for the week (slow cooker)',
    slot: 'dinner', kcal: 525, protein: 53, minutes: 40, cuisine: 'other',
    equipment: ['slowcooker'], tags: ['weekend', 'leftover-ok', 'batch', 'freezes', 'make-ahead', 'hands-off'],
    ingredients: ings('Hähnchenbrust|200|g|meat-fish', 'Passata|100|g|dry-goods', 'Zwiebel|50|g|produce', 'Geräuchertes Paprikapulver|5|g|pantry', 'Honig|8|g|pantry', 'Senf|10|g|pantry', 'Kartoffeln|250|g|produce', 'Weißkohl|100|g|produce'),
    method: [
      'Four hours on low, then two forks. The slow cooker is the only appliance that rewards leaving the house.',
      'Make a triple batch: it is the cooked chicken for the wraps, the rice bowl and the Friday dürüm.',
      'Cabbage slaw raw alongside, dressed with the mustard. Sweet, smoky, sharp, and 525 kcal.',
    ],
  },
  {
    id: 'd-auberginen-hack-auflauf', name: 'Aubergine and turkey bake',
    slot: 'dinner', kcal: 590, protein: 65, minutes: 50, cuisine: 'mediterranean',
    equipment: ['oven'], tags: ['weekend', 'leftover-ok', 'batch', 'freezes', 'comfort'],
    ingredients: ings('Putenhackfleisch|160|g|meat-fish', 'Aubergine|250|g|produce', 'Kartoffeln|200|g|produce', 'Passata|150|g|dry-goods', 'Skyr natur|100|g|dairy', 'Gouda leicht, gerieben|30|g|dairy', 'Zwiebel|50|g|produce', 'Knoblauch|6|g|produce', 'Zimt|2|g|pantry'),
    method: [
      'Aubergine slices dry in the oven at 220 °C for 12 minutes instead of fried in oil — 300 kcal saved, same texture.',
      'A pinch of cinnamon in the mince is the thing that makes people ask what is in it.',
      'Skyr and grated cheese as the top layer, 25 minutes at 190 °C. Four portions, and it reheats better than it bakes.',
    ],
  },

  // --- v5: converted from akispetretzikis.com source data. Quantities are
  // per-portion grams for this composition and the macros are computed from
  // them, because the source panel omits its unquantified ingredients.
  {
    id: 'd-zitronen-pfeffer-huhn-spiesse', name: 'Lemon-pepper chicken skewers with potatoes',
    slot: 'dinner', kcal: 500, protein: 45, minutes: 25, cuisine: 'mediterranean',
    equipment: ['airfryer', 'oven'],
    tags: ['leftover-ok', 'one-pan', 'high-protein', 'fast'],
    ingredients: ings(
      'Hähnchenbrust|110|g|meat-fish', 'Hähnchenschenkel ohne Haut|80|g|meat-fish',
      'Kartoffeln|200|g|produce', 'Zitrone|30|g|produce', 'Olivenöl|10|g|pantry',
      'Schwarzer Pfeffer|3|g|pantry', 'Meersalz|2|g|pantry'
    ),
    method: [
      'Mix breast and thigh on the same skewer: the thigh keeps the breast from drying out.',
      'Coarse pepper and zest go on before the oil, so they stick rather than slide off.',
      'Potatoes into the air fryer first, skewers on top for the last 12 minutes.',
    ],
  },
  {
    id: 'd-huhn-souvlaki-paprika', name: 'Chicken souvlaki with peppers and rocket',
    slot: 'dinner', kcal: 565, protein: 39, minutes: 25, cuisine: 'mediterranean',
    equipment: ['oven', 'hob'],
    tags: ['leftover-ok', 'one-pan', 'high-protein'],
    ingredients: ings(
      'Hähnchenschenkel ohne Haut|170|g|meat-fish', 'Paprika|200|g|produce',
      'Kartoffeln|150|g|produce', 'Rucola|30|g|produce', 'Olivenöl|12|g|pantry',
      'Knoblauch|6|g|produce', 'Rosmarin|3|g|produce', 'Thymian|3|g|produce', 'Oregano|2|g|pantry'
    ),
    method: [
      'Thigh meat, cubed, takes a dry herb rub better than breast and forgives a late plate.',
      'Peppers and potatoes share the tray; the chicken goes on the rack above them.',
      'Rocket on at the end, off the heat, so it wilts rather than cooks.',
    ],
  },
  {
    id: 'd-huhn-kebab-bbq', name: 'Chicken kebabs with smoky barbecue glaze',
    slot: 'dinner', kcal: 610, protein: 51, minutes: 22, cuisine: 'other',
    equipment: ['airfryer', 'hob'],
    tags: ['leftover-ok', 'high-protein', 'fast', 'comfort'],
    ingredients: ings(
      'Hähnchenbrust|180|g|meat-fish', 'Paprika|150|g|produce', 'Zwiebel|60|g|produce',
      'Reis|60|g|dry-goods', 'BBQ-Sauce|40|g|pantry', 'Speck|15|g|meat-fish',
      'Geräuchertes Paprikapulver|4|g|pantry', 'Petersilie|5|g|produce'
    ),
    method: [
      'Thread a strip of bacon between the chicken cubes; it bastes the lot as it renders.',
      'Keep half the glaze back and brush it on in the last three minutes or it burns.',
      'Rice goes on at the same time as the skewers and is done when they are.',
    ],
  },
  {
    id: 'd-huhn-ananas-grillspiesse', name: 'Pineapple chicken skewers with rice',
    slot: 'dinner', kcal: 560, protein: 47, minutes: 28, cuisine: 'asian',
    equipment: ['airfryer', 'hob'],
    tags: ['leftover-ok', 'high-protein'],
    ingredients: ings(
      'Hähnchenbrust|180|g|meat-fish', 'Ananas|120|g|produce', 'Reis|60|g|dry-goods',
      'Limette|20|g|produce', 'Senf|8|g|pantry', 'Olivenöl|8|g|pantry', 'Chiliflocken|2|g|pantry',
      'Petersilie|5|g|produce'
    ),
    method: [
      'Pineapple tenderises raw chicken fast, so marinate twenty minutes and no longer.',
      'Alternate chicken and fruit so the sugar caramelises against the meat.',
      'Reduce the leftover marinade in a small pan and spoon it over the rice.',
    ],
  },
  {
    id: 'd-huhn-souvlaki-curry', name: 'Curried chicken souvlaki with cucumber',
    slot: 'dinner', kcal: 605, protein: 50, minutes: 25, cuisine: 'asian',
    equipment: ['airfryer', 'hob'],
    tags: ['leftover-ok', 'high-protein', 'make-ahead'],
    ingredients: ings(
      'Hähnchenbrust|180|g|meat-fish', 'Reis|60|g|dry-goods', 'Gurke|100|g|produce',
      'Olivenöl|10|g|pantry', 'Sojasauce|15|ml|pantry', 'Honig|8|g|pantry',
      'Zitrone|25|g|produce', 'Sesam|6|g|pantry', 'Currypulver|5|g|pantry', 'Oregano|2|g|pantry'
    ),
    method: [
      'Toast the curry powder dry in the pan for thirty seconds before it meets the oil.',
      'Soy and honey in the marinade mean it colours quickly — watch the last few minutes.',
      'Raw cucumber and toasted sesame are the whole garnish; the spice does the rest.',
    ],
  },
  {
    id: 'd-schwein-souvlaki-paprika', name: 'Pork souvlaki with peppers and flatbread',
    slot: 'dinner', kcal: 580, protein: 46, minutes: 18, cuisine: 'mediterranean',
    equipment: ['hob'],
    tags: ['leftover-ok', 'fast', 'high-protein'],
    ingredients: ings(
      'Schweinefilet|170|g|meat-fish', 'Paprika|150|g|produce', 'Zwiebel|60|g|produce',
      'Tomaten|100|g|produce', 'Fladenbrot|60|g|bakery', 'Olivenöl|12|g|pantry',
      'Weisswein|30|ml|pantry', 'Weissweinessig|8|ml|pantry', 'Oregano|3|g|pantry'
    ),
    method: [
      'Tenderloin cubes need four minutes a side, no more: it goes dry before it goes tough.',
      'Deglaze the pan with the wine and vinegar and pour that over, not fresh oil.',
      'Warm the flatbread in the same pan to pick up what is left.',
    ],
  },
  {
    id: 'd-fischstaebchen-selbst', name: 'Air-fryer fish fingers with lemon skyr',
    slot: 'dinner', kcal: 705, protein: 60, minutes: 28, cuisine: 'northern',
    equipment: ['airfryer'],
    tags: ['leftover-ok', 'comfort', 'freezes', 'high-protein'],
    ingredients: ings(
      'Seelachsfilet|200|g|meat-fish', 'Kartoffeln|200|g|produce', 'Paniermehl|40|g|dry-goods',
      'Eier|1|Stk|dairy', 'Mehl|15|g|dry-goods', 'Skyr natur|60|g|dairy', 'Olivenöl|8|g|pantry',
      'Zitrone|20|g|produce', 'Oregano|2|g|pantry'
    ),
    method: [
      'Cut the fillet into fingers across the grain so they hold together in the basket.',
      'Flour, then egg, then crumbs mixed with the oil — oiled crumbs are what browns.',
      'Freeze the breaded fingers raw on a tray; they air-fry from frozen in eighteen minutes.',
    ],
  },
  {
    id: 'd-thunfisch-burger', name: 'Tuna burgers with dill and capers',
    slot: 'dinner', kcal: 700, protein: 59, minutes: 25, cuisine: 'northern',
    equipment: ['hob'],
    tags: ['leftover-ok', 'storecupboard', 'freezes', 'high-protein'],
    ingredients: ings(
      'Thunfisch in Wasser|160|g|dry-goods', 'Kartoffeln|150|g|produce',
      'Vollkorn-Bagel|70|g|bakery', 'Paniermehl|15|g|dry-goods', 'Eier|1|Stk|dairy',
      'Frühlingszwiebel|30|g|produce', 'Kapern|10|g|pantry', 'Dill|5|g|produce',
      'Petersilie|5|g|produce', 'Zitrone|20|g|produce', 'Olivenöl|8|g|pantry',
      'Kopfsalat|30|g|produce', 'Tomaten|50|g|produce'
    ),
    method: [
      'Drain the tuna hard and mash it into warm potato; cold potato will not bind.',
      'Chill the patties ten minutes before they go in the pan or they fall apart.',
      'Capers and dill stand in for a sauce, which keeps this a tin-and-a-potato dinner.',
    ],
  },
  {
    id: 'd-fish-and-chips-airfryer', name: 'Air-fryer fish and chips with caper skyr',
    slot: 'dinner', kcal: 635, protein: 51, minutes: 30, cuisine: 'northern',
    equipment: ['airfryer'],
    tags: ['leftover-ok', 'comfort', 'high-protein'],
    ingredients: ings(
      'Kabeljaufilet|200|g|meat-fish', 'Kartoffeln|250|g|produce', 'Mehl|30|g|dry-goods',
      'Bier|40|ml|pantry', 'Skyr natur|60|g|dairy', 'Olivenöl|12|g|pantry',
      'Zitrone|25|g|produce', 'Kapern|8|g|pantry', 'Backpulver|3|g|pantry',
      'Petersilie|5|g|produce'
    ),
    method: [
      'A thin beer batter with baking powder crisps in the air fryer; a thick one stays raw.',
      'Chips first at full heat, then the fish on top for the last ten minutes.',
      'Skyr with capers and lemon is the tartare sauce, at a fifth of the calories.',
    ],
  },
  {
    id: 'd-parmesan-fisch-ofen', name: 'Parmesan-crusted baked fish',
    slot: 'dinner', kcal: 570, protein: 54, minutes: 25, cuisine: 'mediterranean',
    equipment: ['oven'],
    tags: ['leftover-ok', 'one-pan', 'hands-off', 'high-protein'],
    ingredients: ings(
      'Seelachsfilet|200|g|meat-fish', 'Kartoffeln|200|g|produce', 'Parmesan|35|g|dairy',
      'Kopfsalat|60|g|produce', 'Olivenöl|10|g|pantry', 'Zitrone|20|g|produce',
      'Paprikapulver|3|g|pantry', 'Petersilie|5|g|produce'
    ),
    method: [
      'Grated parmesan alone is the crust: no crumb, so it browns into a sheet rather than a coat.',
      'Press it onto the dry side of the fillet and do not turn the fish.',
      'Potatoes go in ten minutes ahead so everything finishes together.',
    ],
  },
  {
    id: 'd-huhn-a-la-creme', name: 'Chicken à la crème with mushrooms and rice',
    slot: 'dinner', kcal: 660, protein: 55, minutes: 22, cuisine: 'other',
    equipment: ['hob'],
    tags: ['leftover-ok', 'comfort', 'one-pan', 'high-protein'],
    ingredients: ings(
      'Hähnchenbrust|180|g|meat-fish', 'Champignons|200|g|produce', 'Reis|60|g|dry-goods',
      'Zwiebel|60|g|produce', 'Crème légère|50|g|dairy', 'Weisswein|40|ml|pantry',
      'Olivenöl|8|g|pantry', 'Knoblauch|6|g|produce', 'Estragon|2|g|pantry'
    ),
    method: [
      'Brown the mushrooms in a dry pan until they squeak before any fat goes in.',
      'Reduce the wine almost to nothing, then the cream off the heat so it cannot split.',
      'Tarragon is the whole point of this sauce — add it last, it fades fast.',
    ],
  },
  {
    id: 'd-huhn-creme-pfanne', name: 'One-pan creamy chicken and mushroom pasta',
    slot: 'dinner', kcal: 615, protein: 55, minutes: 20, cuisine: 'other',
    equipment: ['hob'],
    tags: ['leftover-ok', 'one-pan', 'comfort', 'fast', 'high-protein'],
    ingredients: ings(
      'Hähnchenbrust|170|g|meat-fish', 'Champignons|180|g|produce',
      'Vollkornspaghetti|60|g|dry-goods', 'Crème légère|60|g|dairy', 'Olivenöl|10|g|pantry',
      'Knoblauch|5|g|produce', 'Thymian|3|g|produce', 'Petersilie|5|g|produce'
    ),
    method: [
      'Everything cooks in one pan, pasta included: it drinks the mushroom liquor.',
      'Keep a ladle of the starchy water back — it is what makes the sauce cling.',
      'Finish off the heat so the cream stays glossy instead of grainy.',
    ],
  },
  {
    id: 'd-huhn-weisswein-champignons', name: 'Chicken in white wine with mushrooms',
    slot: 'dinner', kcal: 635, protein: 53, minutes: 28, cuisine: 'other',
    equipment: ['hob'],
    tags: ['leftover-ok', 'comfort', 'one-pan', 'high-protein'],
    ingredients: ings(
      'Hähnchenbrust|180|g|meat-fish', 'Champignons|200|g|produce', 'Reis|55|g|dry-goods',
      'Zwiebel|60|g|produce', 'Weisswein|50|ml|pantry', 'Olivenöl|10|g|pantry',
      'Senf|10|g|pantry', 'Honig|8|g|pantry', 'Mehl|6|g|dry-goods', 'Thymian|3|g|produce'
    ),
    method: [
      'Dust the chicken with the flour, not the pan: it thickens the sauce as it sears.',
      'Mustard and honey go in with the wine so they cook down rather than taste raw.',
      'Let it sit five minutes off the heat; the sauce tightens on its own.',
    ],
  },
  {
    id: 'd-huhn-cacciatore', name: 'Chicken cacciatore with wholewheat spaghetti',
    slot: 'dinner', kcal: 695, protein: 63, minutes: 26, cuisine: 'mediterranean',
    equipment: ['hob'],
    tags: ['leftover-ok', 'batch', 'freezes', 'one-pan', 'comfort'],
    ingredients: ings(
      'Hähnchenbrust|170|g|meat-fish', 'Paprika|150|g|produce', 'Champignons|150|g|produce',
      'Passata|150|g|dry-goods', 'Vollkornspaghetti|60|g|dry-goods', 'Zwiebel|50|g|produce',
      'Gouda leicht, gerieben|20|g|dairy', 'Olivenöl|12|g|pantry', 'Knoblauch|6|g|produce',
      'Thymian|3|g|produce', 'Basilikum|5|g|produce'
    ),
    method: [
      'Sear the chicken, lift it out, and build the sauce in the fond it leaves behind.',
      'Return the chicken only once the passata has thickened, so it poaches rather than boils.',
      'Doubles cleanly and freezes well; the pasta is better cooked fresh each time.',
    ],
  },
  {
    id: 'd-garnelen-souvlaki', name: 'Prawn souvlaki with avocado and flatbread',
    slot: 'dinner', kcal: 575, protein: 42, minutes: 15, cuisine: 'mediterranean',
    equipment: ['hob'],
    tags: ['fast', 'high-protein'],
    ingredients: ings(
      'Garnelen|180|g|meat-fish', 'Avocado|70|g|produce', 'Fladenbrot|60|g|bakery',
      'Limette|25|g|produce', 'Zwiebel|40|g|produce', 'Olivenöl|12|g|pantry',
      'Oregano|3|g|pantry', 'Chiliflocken|2|g|pantry'
    ),
    method: [
      'Prawns need three minutes total; skewer them so they all turn at once.',
      'Mash the avocado with lime straight onto the warm flatbread.',
      'Fifteen minutes start to finish, with nothing to chop beyond an onion.',
    ],
  },
  {
    id: 'd-garnelen-speck-spiesse', name: 'Bacon-wrapped prawn skewers with paprika yoghurt',
    slot: 'dinner', kcal: 595, protein: 54, minutes: 22, cuisine: 'mediterranean',
    equipment: ['airfryer'],
    tags: ['leftover-ok', 'high-protein', 'one-pan'],
    ingredients: ings(
      'Garnelen|200|g|meat-fish', 'Kartoffeln|200|g|produce', 'Speck|25|g|meat-fish',
      'Griechischer Joghurt 2 %|80|g|dairy', 'Limette|20|g|produce', 'Olivenöl|10|g|pantry',
      'Paprikapulver|4|g|pantry', 'Kreuzkümmel|2|g|pantry', 'Koriander|5|g|produce'
    ),
    method: [
      'Half a rasher per two prawns is enough; more and the bacon stops the prawns colouring.',
      'Potatoes go in first and the skewers join them for the last six minutes.',
      'Smoked paprika yoghurt, not aioli — it carries the same smoke for a tenth of the fat.',
    ],
  },
  {
    id: 'd-garnelen-kokos-kurkuma', name: 'Turmeric coconut prawns with rice',
    slot: 'dinner', kcal: 630, protein: 45, minutes: 18, cuisine: 'asian',
    equipment: ['hob'],
    tags: ['fast', 'leftover-ok', 'one-pan', 'high-protein'],
    ingredients: ings(
      'Garnelen|200|g|meat-fish', 'Kokosmilch light|100|ml|dry-goods', 'Reis|60|g|dry-goods',
      'Zwiebel|60|g|produce', 'Olivenöl|8|g|pantry', 'Ingwer|10|g|produce',
      'Knoblauch|6|g|produce', 'Kurkuma|5|g|pantry', 'Limette|20|g|produce',
      'Koriander|5|g|produce'
    ),
    method: [
      'Fry the turmeric in the oil with the ginger until it smells of earth, not dust.',
      'The prawns go in at the very end — the sauce should already taste finished.',
      'Lime off the heat; cooked lime turns bitter in coconut.',
    ],
  },
  {
    id: 'd-garnelen-kokos-ingwer', name: 'Prawns in coconut ginger broth',
    slot: 'dinner', kcal: 570, protein: 49, minutes: 22, cuisine: 'asian',
    equipment: ['hob'],
    tags: ['leftover-ok', 'one-pan', 'high-protein', 'fast'],
    ingredients: ings(
      'Garnelen|220|g|meat-fish', 'Kokosmilch light|100|ml|dry-goods', 'Fischbrühe|150|ml|pantry',
      'Zwiebel|70|g|produce', 'Rundkornreis|55|g|dry-goods', 'Limette|25|g|produce',
      'Ingwer|12|g|produce', 'Chili|5|g|produce', 'Koriander|8|g|produce', 'Rohrzucker|5|g|pantry'
    ),
    method: [
      'Built for prawns rather than mussels: fresh mussels are not a weeknight shop here.',
      'Simmer the broth down by a third before the prawns go anywhere near it.',
      'Serve it wet, over rice, and spoon the broth rather than draining it.',
    ],
  },
  {
    id: 'd-garnelen-pasta-protein', name: 'Prawn and spinach protein pasta',
    slot: 'dinner', kcal: 625, protein: 69, minutes: 17, cuisine: 'mediterranean',
    equipment: ['hob'],
    tags: ['fast', 'high-protein', 'one-pan'],
    ingredients: ings(
      'Garnelen|200|g|meat-fish', 'High-Protein-Pasta|70|g|dry-goods',
      'Frischkäse leicht|60|g|dairy', 'Blattspinat (frisch)|80|g|produce', 'Tahini|10|g|pantry',
      'Parmesan|10|g|dairy', 'Limette|20|g|produce', 'Knoblauch|4|g|produce', 'Minze|4|g|produce',
      'Chiliflocken|2|g|pantry'
    ),
    method: [
      'Tahini and cream cheese together make a sauce that does not need any cream.',
      'Wilt the spinach in the pasta water for the last thirty seconds and lift both out.',
      'Mint with prawns reads as odd and tastes right; use it raw and torn.',
    ],
  },
  {
    id: 'd-wolfsbarsch-frikassee', name: 'Sea bass fricassée with spinach and orange',
    slot: 'dinner', kcal: 455, protein: 43, minutes: 20, cuisine: 'mediterranean',
    equipment: ['hob'],
    tags: ['fast', 'one-pan', 'high-protein', 'low-carb'],
    ingredients: ings(
      'Wolfsbarschfilet|180|g|meat-fish', 'Blattspinat (frisch)|200|g|produce',
      'Lauch|80|g|produce', 'Zwiebel|50|g|produce', 'Weisswein|40|ml|pantry',
      'Olivenöl|12|g|pantry', 'Zitrone|25|g|produce', 'Orange|30|g|produce', 'Honig|10|g|pantry',
      'Knoblauch|5|g|produce'
    ),
    method: [
      'Sweat the leek slowly until it collapses; that sweetness is the base of the dish.',
      'Lay the fillets on top of the greens and lid the pan — they steam in four minutes.',
      'Orange and lemon together, because lemon alone makes this sharp rather than round.',
    ],
  },
  {
    id: 'd-wolfsbarsch-linsen', name: 'Sea bass with lentils and mustard yoghurt',
    slot: 'dinner', kcal: 530, protein: 53, minutes: 25, cuisine: 'mediterranean',
    equipment: ['hob'],
    tags: ['leftover-ok', 'one-pan', 'high-protein', 'storecupboard'],
    ingredients: ings(
      'Wolfsbarschfilet|170|g|meat-fish', 'Braune Linsen (Dose)|150|g|dry-goods',
      'Paprika|150|g|produce', 'Griechischer Joghurt 2 %|60|g|dairy', 'Olivenöl|10|g|pantry',
      'Senf|6|g|pantry', 'Petersilie|8|g|produce'
    ),
    method: [
      'Tinned lentils only need warming through; cook them again and they go to paste.',
      'Score the skin and start the fish skin-down in a dry hot pan, then oil it.',
      'Mustard whisked into yoghurt is the sauce, spooned under the fish not over it.',
    ],
  },
  {
    id: 'd-lachs-zitronen-spiesse', name: 'Lemon salmon skewers with potatoes',
    slot: 'dinner', kcal: 620, protein: 40, minutes: 20, cuisine: 'northern',
    equipment: ['airfryer'],
    tags: ['fast', 'leftover-ok', 'one-pan', 'high-protein'],
    ingredients: ings(
      'Lachsfilet|170|g|meat-fish', 'Kartoffeln|200|g|produce', 'Zitrone|40|g|produce',
      'Olivenöl|10|g|pantry', 'Senf|8|g|pantry', 'Sojasauce|8|ml|pantry', 'Knoblauch|5|g|produce',
      'Petersilie|6|g|produce'
    ),
    method: [
      'Thread lemon slices between the salmon cubes so the acid sits against the fish.',
      'Mustard and soy in the marinade give the outside something to caramelise.',
      'Twelve minutes in the air fryer; salmon is done when it flakes at a push, not before.',
    ],
  },
  {
    id: 'd-huhn-ofengemuese-bohnen', name: 'Tray-roast chicken with beans and squash',
    slot: 'dinner', kcal: 715, protein: 60, minutes: 30, cuisine: 'mediterranean',
    equipment: ['oven'],
    tags: ['leftover-ok', 'batch', 'one-pan', 'hands-off', 'high-protein'],
    ingredients: ings(
      'Hähnchenbrust|180|g|meat-fish', 'Cannellini-Bohnen|150|g|dry-goods',
      'Möhren|100|g|produce', 'Hokkaido-Kürbis|120|g|produce', 'Brokkoli|100|g|produce',
      'Paprika|100|g|produce', 'Zwiebel|50|g|produce', 'Olivenöl|14|g|pantry',
      'Zitrone|25|g|produce', 'Honig|10|g|pantry', 'Thymian|3|g|produce'
    ),
    method: [
      'Roots and squash get a fifteen-minute head start; broccoli and beans join late.',
      'The beans go in dry and crisp slightly at the edges — that is the best bit.',
      'Honey and lemon whisked together after roasting, poured over hot, not before.',
    ],
  },
  {
    id: 'd-rind-paprika-quinoa', name: 'Beef with peppers and quinoa',
    slot: 'dinner', kcal: 645, protein: 49, minutes: 28, cuisine: 'other',
    equipment: ['hob'],
    tags: ['leftover-ok', 'one-pan', 'high-protein'],
    ingredients: ings(
      'Rindersteak|170|g|meat-fish', 'Quinoa|60|g|dry-goods', 'Paprika|200|g|produce',
      'Zwiebel|50|g|produce', 'Rinderbrühe|150|ml|pantry', 'Olivenöl|10|g|pantry',
      'Knoblauch|5|g|produce', 'Thymian|3|g|produce', 'Petersilie|6|g|produce'
    ),
    method: [
      'Sear the steak whole and slice it after resting; strips cooked loose go grey.',
      'Quinoa cooks in the beef stock in the same pan the peppers softened in.',
      'Any juice from the resting board goes back in — it is the seasoning.',
    ],
  },
  {
    id: 'd-huhn-gemuese-pasta-dill', name: 'Greek chicken and carrot pasta with dill',
    slot: 'dinner', kcal: 640, protein: 52, minutes: 25, cuisine: 'mediterranean',
    equipment: ['hob'],
    tags: ['leftover-ok', 'one-pan', 'comfort', 'high-protein'],
    ingredients: ings(
      'Hähnchenbrust|170|g|meat-fish', 'Vollkornspaghetti|70|g|dry-goods', 'Möhren|120|g|produce',
      'Zwiebel|50|g|produce', 'Olivenöl|12|g|pantry', 'Zitrone|30|g|produce',
      'Mehl|8|g|dry-goods', 'Knoblauch|5|g|produce', 'Dill|10|g|produce'
    ),
    method: [
      'Grate the carrot rather than dicing it: it melts into a sauce in ten minutes.',
      'A spoon of flour cooked in the oil first turns the lemon and stock into a velouté.',
      'Dill goes in by the handful at the end. Half this much and you cannot taste it.',
    ],
  },
  {
    id: 'd-schwein-souvlaki-ofen', name: 'Oven pork souvlaki with lemon potatoes',
    slot: 'dinner', kcal: 505, protein: 45, minutes: 30, cuisine: 'mediterranean',
    equipment: ['oven'],
    tags: ['leftover-ok', 'one-pan', 'hands-off', 'high-protein'],
    ingredients: ings(
      'Schweinefilet|180|g|meat-fish', 'Kartoffeln|200|g|produce', 'Zwiebel|50|g|produce',
      'Olivenöl|12|g|pantry', 'Zitrone|30|g|produce', 'Knoblauch|6|g|produce',
      'Oregano|3|g|pantry'
    ),
    method: [
      'Potatoes in with lemon juice and a splash of water; they steam first, then roast.',
      'The pork goes on top for the last twelve minutes and drips into them.',
      'Rest it off the tray for five minutes — tenderloin keeps cooking after it comes out.',
    ],
  },
  {
    id: 'd-huhn-gyros-tzatziki', name: 'Chicken gyros with tzatziki',
    slot: 'dinner', kcal: 690, protein: 49, minutes: 20, cuisine: 'mediterranean',
    equipment: ['hob'],
    tags: ['leftover-ok', 'fast', 'comfort', 'high-protein'],
    ingredients: ings(
      'Hähnchenschenkel ohne Haut|170|g|meat-fish', 'Fladenbrot|70|g|bakery',
      'Griechischer Joghurt 2 %|80|g|dairy', 'Gurke|80|g|produce', 'Tomaten|60|g|produce',
      'Zwiebel|40|g|produce', 'Olivenöl|12|g|pantry', 'Zitrone|25|g|produce',
      'Geräuchertes Paprikapulver|4|g|pantry', 'Koriandersamen|3|g|pantry',
      'Knoblauch|6|g|produce'
    ),
    method: [
      'Salt the grated cucumber and squeeze it dry, or the tzatziki turns to soup by morning.',
      'Crushed coriander seed is what makes this taste like a gyros rather than a kebab.',
      'Slice the thigh meat thin off the heat and pile it on warm flatbread.',
    ],
  },
  {
    id: 'd-wolfsbarsch-papillote', name: 'Sea bass en papillote with courgette and olives',
    slot: 'dinner', kcal: 520, protein: 45, minutes: 30, cuisine: 'mediterranean',
    equipment: ['oven'],
    tags: ['leftover-ok', 'one-pan', 'hands-off', 'high-protein'],
    ingredients: ings(
      'Wolfsbarschfilet|200|g|meat-fish', 'Kartoffeln|150|g|produce',
      'Kirschtomaten|120|g|produce', 'Zucchini|120|g|produce', 'Schwarze Oliven|25|g|dry-goods',
      'Olivenöl|12|g|pantry', 'Zitrone|30|g|produce', 'Kapern|12|g|pantry', 'Dill|6|g|produce'
    ),
    method: [
      'Parboil the potato slices five minutes first; everything else cooks in the time the fish needs.',
      'Seal the parcel properly — the steam inside is the cooking, so a leak means dry fish.',
      'Open it at the table. The juice in the bottom is the sauce, do not pour it away.',
    ],
  },
  {
    id: 'd-fisch-acqua-pazza', name: 'Cod acqua pazza with olives',
    slot: 'dinner', kcal: 570, protein: 45, minutes: 25, cuisine: 'mediterranean',
    equipment: ['hob'],
    tags: ['leftover-ok', 'one-pan', 'high-protein', 'fast'],
    ingredients: ings(
      'Kabeljaufilet|200|g|meat-fish', 'Kirschtomaten|150|g|produce', 'Zucchini|120|g|produce',
      'Fladenbrot|50|g|bakery', 'Schwarze Oliven|30|g|dry-goods', 'Olivenöl|14|g|pantry',
      'Weisswein|50|ml|pantry', 'Knoblauch|6|g|produce', 'Petersilie|8|g|produce'
    ),
    method: [
      'Burst the tomatoes in hot oil until they give up their liquid; that liquid is the dish.',
      'Wine, then the fish laid on top, lid on, seven minutes and do not touch it.',
      'Bread on the side purely to mop — there is more sauce here than looks likely.',
    ],
  },
  {
    id: 'd-kabeljau-tomaten-brokkoli', name: 'Cod in spiced tomato sauce with broccoli',
    slot: 'dinner', kcal: 530, protein: 49, minutes: 18, cuisine: 'mediterranean',
    equipment: ['hob'],
    tags: ['leftover-ok', 'one-pan', 'fast', 'high-protein', 'storecupboard'],
    ingredients: ings(
      'Kabeljaufilet|200|g|meat-fish', 'Brokkoli|200|g|produce', 'Passata|150|g|dry-goods',
      'Kartoffeln|150|g|produce', 'Zwiebel|50|g|produce', 'Olivenöl|12|g|pantry',
      'Knoblauch|6|g|produce', 'Kreuzkümmel|3|g|pantry', 'Chiliflocken|2|g|pantry'
    ),
    method: [
      'Cumin and chilli bloom in the oil before the onion; thirty seconds, no browning.',
      'Broccoli sits in the sauce rather than on the side, so it takes the flavour.',
      'Cod goes in last and needs six minutes under a lid. Overcooked cod is the only risk here.',
    ],
  },
  {
    id: 'd-kabeljau-knusprig-tartare', name: 'Crispy cod with caper tartare',
    slot: 'dinner', kcal: 650, protein: 58, minutes: 28, cuisine: 'northern',
    equipment: ['airfryer'],
    tags: ['leftover-ok', 'comfort', 'high-protein'],
    ingredients: ings(
      'Kabeljaufilet|200|g|meat-fish', 'Kartoffeln|200|g|produce', 'Paniermehl|35|g|dry-goods',
      'Eier|1|Stk|dairy', 'Griechischer Joghurt 2 %|70|g|dairy', 'Olivenöl|8|g|pantry',
      'Kapern|10|g|pantry', 'Zitrone|25|g|produce', 'Dill|6|g|produce'
    ),
    method: [
      'Pat the cod properly dry first; wet fish steams the crumb off instead of crisping it.',
      'Mix the oil into the crumbs rather than spraying the basket — it browns evenly that way.',
      'Tartare is yoghurt, chopped capers, dill and lemon. Make it while the fish cooks.',
    ],
  },
  {
    id: 'd-garnelen-oregano-parmesan', name: 'Oregano and parmesan prawns',
    slot: 'dinner', kcal: 655, protein: 56, minutes: 22, cuisine: 'mediterranean',
    equipment: ['oven'],
    tags: ['leftover-ok', 'one-pan', 'fast', 'high-protein'],
    ingredients: ings(
      'Garnelen|200|g|meat-fish', 'Kirschtomaten|120|g|produce', 'Fladenbrot|50|g|bakery',
      'Parmesan|25|g|dairy', 'Paniermehl|25|g|dry-goods', 'Olivenöl|12|g|pantry',
      'Knoblauch|6|g|produce', 'Zitrone|25|g|produce', 'Oregano|3|g|pantry'
    ),
    method: [
      'Crumbs, parmesan and oregano mixed with the oil, scattered over — not a coating, a lid.',
      'Eight minutes under a hot grill is all of it; the prawns cook as the top browns.',
      'Use the tomatoes raw underneath so they collapse into the oil and stay juicy.',
    ],
  },
  {
    id: 'd-schweinefilet-spinat-feta', name: 'Pork tenderloin with spinach and feta',
    slot: 'dinner', kcal: 620, protein: 56, minutes: 30, cuisine: 'mediterranean',
    equipment: ['hob', 'oven'],
    tags: ['leftover-ok', 'one-pan', 'high-protein'],
    ingredients: ings(
      'Schweinefilet|180|g|meat-fish', 'Blattspinat (frisch)|200|g|produce',
      'Kartoffeln|180|g|produce', 'Feta|40|g|dairy', 'Zwiebel|50|g|produce',
      'Olivenöl|12|g|pantry', 'Knoblauch|6|g|produce', 'Zitrone|20|g|produce'
    ),
    method: [
      'Sear the tenderloin whole, then finish it in the oven — slicing it first wastes the juice.',
      'Wilt the spinach in the searing pan so it picks up the browned bits.',
      'Crumble the feta over while everything is hot; it should soften, not melt.',
    ],
  },
  {
    id: 'd-huhn-paprika-kebab', name: 'Chicken and pepper kebabs',
    slot: 'dinner', kcal: 575, protein: 50, minutes: 20, cuisine: 'middle-eastern',
    equipment: ['airfryer'],
    tags: ['leftover-ok', 'fast', 'one-pan', 'high-protein'],
    ingredients: ings(
      'Hähnchenbrust|180|g|meat-fish', 'Paprika|180|g|produce', 'Fladenbrot|60|g|bakery',
      'Zwiebel|60|g|produce', 'Olivenöl|12|g|pantry', 'Zitrone|25|g|produce',
      'Geräuchertes Paprikapulver|4|g|pantry', 'Oregano|3|g|pantry'
    ),
    method: [
      'Cut the peppers to the same size as the chicken or one of the two will be wrong.',
      'Smoked paprika and lemon do the work of a marinade in the ten minutes you have.',
      'Flatbread into the air fryer for the last minute to warm and blister.',
    ],
  },
  {
    id: 'd-lamm-souvlaki-joghurt-minze', name: 'Lamb souvlaki with yoghurt, mint and tahini',
    slot: 'dinner', kcal: 735, protein: 50, minutes: 25, cuisine: 'middle-eastern',
    equipment: ['airfryer'],
    tags: ['leftover-ok', 'high-protein', 'make-ahead'],
    ingredients: ings(
      'Lammkeule ohne Knochen|170|g|meat-fish', 'Fladenbrot|60|g|bakery',
      'Griechischer Joghurt 2 %|80|g|dairy', 'Tahini|10|g|pantry', 'Olivenöl|10|g|pantry',
      'Honig|8|g|pantry', 'Ingwer|8|g|produce', 'Knoblauch|6|g|produce', 'Kreuzkümmel|3|g|pantry',
      'Minze|5|g|produce'
    ),
    method: [
      'The yoghurt marinade tenderises as well as flavours; give it four hours if you can.',
      'Wipe most of the marinade off before cooking or it steams instead of charring.',
      'Tahini stirred into the rest of the yoghurt is the sauce. Mint goes in raw at the end.',
    ],
  },
  {
    id: 'd-lamm-kebab-giaourtlou', name: 'Lamb giaourtlou with yoghurt and tomato',
    slot: 'dinner', kcal: 790, protein: 45, minutes: 40, cuisine: 'middle-eastern',
    equipment: ['hob', 'oven'],
    tags: ['weekend', 'leftover-ok', 'batch', 'freezes', 'comfort'],
    ingredients: ings(
      'Lammhackfleisch|150|g|meat-fish', 'Fladenbrot|60|g|bakery', 'Tomaten|120|g|produce',
      'Griechischer Joghurt 2 %|90|g|dairy', 'Zwiebel|60|g|produce', 'Paniermehl|15|g|dry-goods',
      'Olivenöl|10|g|pantry', 'Petersilie|10|g|produce', 'Kreuzkümmel|3|g|pantry',
      'Paprikapulver|3|g|pantry', 'Zimt|2|g|pantry'
    ),
    method: [
      'Grate the onion rather than chopping it — the juice is what keeps minced lamb soft.',
      'Work the mince only until it comes together; past that it goes springy.',
      'Tear the flatbread into the tray, sauce over, kebabs on top, yoghurt at the table.',
    ],
  },
  {
    id: 'd-lamm-frikassee-schnellkochtopf', name: 'Pressure-cooker lamb fricassée',
    slot: 'dinner', kcal: 625, protein: 49, minutes: 55, cuisine: 'mediterranean',
    equipment: ['pressure'],
    tags: ['weekend', 'leftover-ok', 'batch', 'hands-off', 'comfort'],
    ingredients: ings(
      'Lammkeule ohne Knochen|180|g|meat-fish', 'Kopfsalat|200|g|produce',
      'Frühlingszwiebel|100|g|produce', 'Hühnerbrühe|250|ml|pantry', 'Eier|1|Stk|dairy',
      'Olivenöl|12|g|pantry', 'Weisswein|30|ml|pantry', 'Zitrone|40|g|produce',
      'Kreuzkümmel|3|g|pantry', 'Dill|12|g|produce'
    ),
    method: [
      'Brown the lamb in the open pot first; pressure cooking alone gives you grey meat.',
      'Thirty-five minutes at pressure, then release and add the lettuce for the last five.',
      'Avgolemono goes in off the heat, tempered — the whole dish stands on that one step.',
    ],
  },
  {
    id: 'd-lammkeule-ofen-senf', name: 'Roast leg of lamb with mustard and herbs',
    slot: 'dinner', kcal: 740, protein: 47, minutes: 90, cuisine: 'mediterranean',
    equipment: ['oven'],
    tags: ['weekend', 'leftover-ok', 'batch', 'hands-off', 'one-pan'],
    ingredients: ings(
      'Lammkeule ohne Knochen|200|g|meat-fish', 'Kartoffeln|220|g|produce',
      'Zwiebel|60|g|produce', 'Senf|20|g|pantry', 'Olivenöl|14|g|pantry', 'Orange|40|g|produce',
      'Rotweinessig|15|ml|pantry', 'Knoblauch|8|g|produce', 'Rosmarin|4|g|produce',
      'Thymian|4|g|produce'
    ),
    method: [
      'Mustard, vinegar and herbs into a paste and rub it in the night before if you remember.',
      'Hot oven for twenty minutes to colour it, then down to 160 °C for the rest.',
      'Rest it twenty minutes under foil. Carving early costs you all the juice.',
    ],
  },
  {
    id: 'd-soutzoukakia-airfryer', name: 'Soutzoukakia in cumin tomato sauce',
    slot: 'dinner', kcal: 770, protein: 50, minutes: 30, cuisine: 'mediterranean',
    equipment: ['airfryer', 'hob'],
    tags: ['leftover-ok', 'batch', 'freezes', 'comfort'],
    ingredients: ings(
      'Rinderhackfleisch 5 %|90|g|meat-fish', 'Schweinehackfleisch|70|g|meat-fish',
      'Reis|45|g|dry-goods', 'Passata|180|g|dry-goods', 'Vollkornbrot|30|g|bakery',
      'Milch 1,5 %|30|ml|dairy', 'Eier|1|Stk|dairy', 'Zwiebel|50|g|produce',
      'Tomatenmark|15|g|pantry', 'Olivenöl|8|g|pantry', 'Kreuzkümmel|4|g|pantry',
      'Zimt|2|g|pantry', 'Minze|4|g|produce'
    ),
    method: [
      'Bread soaked in milk, not breadcrumbs: that is what makes these soft rather than bouncy.',
      'Cumin and a little cinnamon are the signature — be braver with the cumin than feels right.',
      'Air-fry the ovals ten minutes, then finish them five minutes in the sauce so they drink it.',
    ],
  },

  // ---- Shiba's Kitchen, October 2026 --------------------------------------
  // Pakistani and Palestinian home cooking, re-expressed as our own rows. Two
  // things changed on the way in. The source cooks for 4 at restaurant
  // portions, so quantities are re-cut per portion against the first person's
  // dinner budget. And almost every vegetarian dish there is vegetables plus
  // starch, which lands around 15 g of protein -- short of our own 25 g dinner
  // floor -- so each one gained a legume, paneer, tofu or dairy. Those
  // additions are ours, not the source's.
  {
    id: 'd-palak-paneer', name: 'Palak paneer',
    slot: 'dinner', kcal: 665, protein: 34, minutes: 25, cuisine: 'asian',
    equipment: ['hob', 'blender'], tags: ['leftover-ok', 'vegetarian', 'high-protein'],
    ingredients: ings('Paneer|125|g|dairy', 'TK-Blattspinat|200|g|frozen', 'Gehackte Tomaten|75|g|dry-goods', 'Zwiebel|40|g|produce', 'Knoblauch|8|g|produce', 'Ingwer|8|g|produce', 'Kochsahne 15 %|30|ml|dairy', 'Reis|40|g|dry-goods', 'Garam Masala|3|g|pantry', 'Kreuzkümmel|2|g|pantry', 'Olivenöl|8|g|pantry'),
    method: [
      'Cube the paneer, colour it in oil on all sides, lift it out and keep it.',
      'Same pan: cumin 30 seconds, then onion, garlic and ginger 4 minutes.',
      'Spinach in from frozen with a splash of water, lid on 5 minutes to collapse.',
      'Blend that with the tomatoes to a smooth sauce, back in with the spices.',
      'Cream through, paneer returned for 3 minutes. Rice alongside.',
    ],
  },
  {
    id: 'd-blumenkohl-spinat-curry', name: 'Roast cauliflower and spinach curry',
    slot: 'dinner', kcal: 580, protein: 34, minutes: 20, cuisine: 'asian',
    equipment: ['oven', 'hob'], tags: ['leftover-ok', 'vegetarian', 'freezes', 'high-volume'],
    ingredients: ings('Blumenkohl|250|g|produce', 'TK-Blattspinat|125|g|frozen', 'Rote Linsen|70|g|dry-goods', 'Kokosmilch light|50|ml|dry-goods', 'Gehackte Tomaten|100|g|dry-goods', 'Zwiebel|40|g|produce', 'Knoblauch|8|g|produce', 'Ingwer|8|g|produce', 'Griechischer Joghurt 2 %|60|g|dairy', 'Garam Masala|3|g|pantry', 'Kurkuma|2|g|pantry', 'Olivenöl|8|g|pantry'),
    method: [
      'Florets tossed with oil and turmeric, single layer, 20 minutes at 200 °C.',
      'Meanwhile sweat the onion, then garlic, ginger and garam masala 40 seconds.',
      'Lentils, tomatoes and coconut milk in, lid on, 12 minutes until the lentils go.',
      'Spinach stirred through at the end, roast cauliflower folded in last.',
      'Yoghurt on top at the table, not in the pan - it splits.',
    ],
  },
  {
    id: 'd-rettich-spinat-curry', name: 'Radish and spinach curry',
    slot: 'dinner', kcal: 550, protein: 30, minutes: 25, cuisine: 'asian',
    equipment: ['hob'], tags: ['leftover-ok', 'vegetarian', 'high-volume'],
    ingredients: ings('Weisser Rettich|200|g|produce', 'TK-Blattspinat|150|g|frozen', 'Kichererbsen|150|g|dry-goods', 'Gehackte Tomaten|100|g|dry-goods', 'Zwiebel|40|g|produce', 'Knoblauch|8|g|produce', 'Ingwer|8|g|produce', 'Butter|10|g|dairy', 'Griechischer Joghurt 2 %|80|g|dairy', 'Reis|40|g|dry-goods', 'Garam Masala|3|g|pantry', 'Paprikapulver|2|g|pantry'),
    method: [
      'Peel and slice the radish into coins - it loses the raw bite entirely.',
      'Onion in butter, then garlic and ginger, then the ground spices 50 seconds.',
      'Tomatoes hard on high heat, then lid on low for 3 minutes.',
      'Radish in, coloured all over, salted, lid on 8 minutes until soft.',
      'Spinach and chickpeas folded through, 3 minutes. Yoghurt and rice to serve.',
    ],
  },
  {
    id: 'd-kohlrabi-kichererbsen-curry', name: 'Kohlrabi and chickpea curry',
    slot: 'dinner', kcal: 585, protein: 36, minutes: 20, cuisine: 'asian',
    equipment: ['hob'], tags: ['leftover-ok', 'vegetarian', 'one-pan', 'high-protein'],
    ingredients: ings('Kohlrabi|150|g|produce', 'Kichererbsen|200|g|dry-goods', 'TK-Blattspinat|125|g|frozen', 'Passata|100|g|dry-goods', 'Tomatenmark|15|g|pantry', 'Zwiebel|50|g|produce', 'Knoblauch|8|g|produce', 'Cashewkerne|20|g|pantry', 'Griechischer Joghurt 2 %|60|g|dairy', 'Butter|8|g|dairy', 'Garam Masala|3|g|pantry', 'Paprikapulver|2|g|pantry'),
    method: [
      'Kohlrabi peeled and diced small - small enough that 15 minutes is enough.',
      'Onion in butter, garlic and ground spices 30 seconds, tomato paste fried off.',
      'Kohlrabi in, then passata and 150 ml water, seasoned, lid on 15 minutes.',
      'Chickpeas and spinach stirred through at the end, cashews over the top.',
      'Yoghurt at the table. The cashews are the texture - do not skip them.',
    ],
  },
  {
    id: 'd-weisskohl-kartoffel-curry', name: 'White cabbage and potato curry',
    slot: 'dinner', kcal: 585, protein: 30, minutes: 25, cuisine: 'asian',
    equipment: ['hob'], tags: ['leftover-ok', 'vegetarian', 'freezes', 'batch', 'high-volume'],
    ingredients: ings('Weißkohl|180|g|produce', 'Kartoffeln|150|g|produce', 'Rote Linsen|60|g|dry-goods', 'TK-Erbsen|60|g|frozen', 'Gehackte Tomaten|100|g|dry-goods', 'Zwiebel|40|g|produce', 'Knoblauch|8|g|produce', 'Ingwer|6|g|produce', 'Griechischer Joghurt 2 %|60|g|dairy', 'Garam Masala|3|g|pantry', 'Kreuzkümmel|2|g|pantry', 'Olivenöl|8|g|pantry'),
    method: [
      'Cumin seeds 30 seconds in the oil, then onion until it softens.',
      'Garlic, ginger and garam masala briefly, then the tomatoes.',
      'Potatoes, cabbage and lentils in, salted, 100 ml water, lid on.',
      'Medium-low 20 minutes - unattended, which is the whole point of it.',
      'Peas in near the end, yoghurt at the table.',
    ],
  },
  {
    id: 'd-paprika-bohnen-polenta', name: 'Peppers and white beans on soft polenta',
    slot: 'dinner', kcal: 800, protein: 31, minutes: 40, cuisine: 'middle-eastern',
    equipment: ['hob'], tags: ['weekend', 'vegetarian', 'comfort'],
    ingredients: ings('Polenta|65|g|dry-goods', 'Gemüsebrühe|300|ml|pantry', 'Parmesan|30|g|dairy', 'Butter|6|g|dairy', 'Paprika|180|g|produce', 'Weiße Bohnen (Dose)|150|g|dry-goods', 'Zwiebel|60|g|produce', 'Knoblauch|8|g|produce', 'Gehackte Tomaten|80|g|dry-goods', 'Kapern|15|g|pantry', 'Pinienkerne|10|g|pantry', 'Basilikum|8|g|produce', 'Olivenöl|8|g|pantry'),
    method: [
      'Onion and whole garlic cloves in oil, medium, 12 minutes until sweet.',
      'Pepper strips in for 10 minutes - this is the part that cannot be hurried.',
      'Tomatoes, capers and beans in, uncovered 6 minutes, basil folded in last.',
      'Polenta into the simmering stock, stirred until it thickens, butter and Parmesan.',
      'Polenta down first, peppers over, pine nuts and oil on top.',
    ],
  },
  {
    id: 'd-zucchini-boote-feta', name: 'Stuffed zucchini boats with feta and couscous',
    slot: 'dinner', kcal: 750, protein: 35, minutes: 20, cuisine: 'mediterranean',
    equipment: ['oven', 'hob'], tags: ['leftover-ok', 'vegetarian', 'comfort', 'hands-off'],
    ingredients: ings('Zucchini|300|g|produce', 'Couscous|50|g|dry-goods', 'Feta|70|g|dairy', 'Mozzarella light|40|g|dairy', 'Tomatenmark|15|g|pantry', 'Zwiebel|40|g|produce', 'Knoblauch|8|g|produce', 'Schwarze Oliven|20|g|dry-goods', 'Getrocknete Tomaten|15|g|dry-goods', 'Pinienkerne|10|g|pantry', 'Petersilie|15|g|produce', 'Olivenöl|8|g|pantry'),
    method: [
      'Couscous with a little stock powder, boiling water over, covered 10 minutes.',
      'Zucchini halved lengthwise, flesh scooped out and chopped into the pan.',
      'Onion, garlic and tomato paste fried off 3 minutes with the scooped flesh.',
      'Mix into the couscous with feta, olives, dried tomatoes, pine nuts, parsley.',
      'Fill the shells, half the mozzarella on, 35 minutes at 200 °C, rest on at halfway.',
    ],
  },
  {
    id: 'd-kuerbis-pasta-cremig', name: 'Creamy roast pumpkin pasta',
    slot: 'dinner', kcal: 705, protein: 29, minutes: 15, cuisine: 'mediterranean',
    equipment: ['oven', 'hob', 'blender'], tags: ['leftover-ok', 'vegetarian', 'comfort', 'hands-off'],
    ingredients: ings('Hokkaido-Kürbis|300|g|produce', 'Vollkornpasta|70|g|dry-goods', 'Ricotta|60|g|dairy', 'Parmesan|25|g|dairy', 'Zwiebel|40|g|produce', 'Knoblauch|10|g|produce', 'Chiliflocken|2|g|pantry', 'Petersilie|8|g|produce', 'Olivenöl|10|g|pantry'),
    method: [
      'Hokkaido needs no peeling. Chunk it with the onion and unpeeled garlic.',
      'Oiled, seasoned, 28 minutes at 200 °C while the rest of the evening happens.',
      'Garlic squeezed out of its skins, everything blended with the ricotta.',
      'Pasta in salted water, sauce and pasta tossed with a ladle of the water.',
      'Parmesan, chilli flakes and parsley over. Loosen with more pasta water.',
    ],
  },
  {
    id: 'd-ofengemuese-feta-block', name: 'Sheet pan vegetables with a block of feta',
    slot: 'dinner', kcal: 730, protein: 32, minutes: 15, cuisine: 'mediterranean',
    equipment: ['oven'], tags: ['leftover-ok', 'vegetarian', 'one-pan', 'hands-off', 'high-volume'],
    ingredients: ings('Aubergine|120|g|produce', 'Paprika|120|g|produce', 'Zucchini|120|g|produce', 'Hokkaido-Kürbis|100|g|produce', 'Rote Zwiebel|60|g|produce', 'Knoblauch|10|g|produce', 'Kichererbsen|120|g|dry-goods', 'Feta|100|g|dairy', 'Pinienkerne|10|g|pantry', 'Senf|5|g|pantry', 'Apfelessig|5|ml|pantry', 'Thymian|3|g|produce', 'Minze|5|g|produce', 'Olivenöl|12|g|pantry'),
    method: [
      'Shake oil, mustard and vinegar together - that dressing is the whole seasoning.',
      'Everything in 2.5 cm pieces, chickpeas dried off, garlic cloves left in their skins.',
      'Tossed, one layer, 35 minutes at 210 °C, stirred once halfway.',
      'Feta set in whole, oil over it, back in 8 minutes until it softens and browns.',
      'Mint and pine nuts at the end. Break the feta through at the table.',
    ],
  },
  {
    id: 'd-ofenkartoffel-bohnen-curry', name: 'Jacket potatoes with white bean curry',
    slot: 'dinner', kcal: 710, protein: 33, minutes: 20, cuisine: 'other',
    equipment: ['oven', 'hob'], tags: ['weekend', 'vegetarian', 'leftover-ok', 'comfort'],
    ingredients: ings('Kartoffeln|300|g|produce', 'Weiße Bohnen (Dose)|200|g|dry-goods', 'Kokosmilch light|40|ml|dry-goods', 'Mozzarella light|50|g|dairy', 'Tomatenmark|12|g|pantry', 'Rote Zwiebel|40|g|produce', 'Knoblauch|8|g|produce', 'Chili|5|g|produce', 'Limette|10|g|produce', 'Koriander|8|g|produce', 'Paprikapulver|3|g|pantry', 'Olivenöl|8|g|pantry'),
    method: [
      'Potatoes pricked, oiled, salted, 60 minutes at 210 °C. Hands off the whole time.',
      'Onion and garlic softened, spices 30 seconds, tomato paste fried off.',
      '150 ml hot water in, 6 minutes, then beans and coconut milk, 6 more.',
      'Finished with lime juice and salt until it tastes sharp, not flat.',
      'Potatoes halved and fluffed, curry spooned in, cheese and chilli on, 18 minutes.',
    ],
  },
  {
    id: 'd-weisse-bohnen-kokos-curry', name: 'White bean coconut curry',
    slot: 'dinner', kcal: 655, protein: 30, minutes: 15, cuisine: 'asian',
    equipment: ['hob'], tags: ['leftover-ok', 'vegetarian', 'freezes', 'batch', 'storecupboard', 'fast'],
    ingredients: ings('Weiße Bohnen (Dose)|280|g|dry-goods', 'Kokosmilch light|60|ml|dry-goods', 'Tomatenmark|15|g|pantry', 'Rote Zwiebel|50|g|produce', 'Knoblauch|8|g|produce', 'Limette|15|g|produce', 'Koriander|8|g|produce', 'Reis|45|g|dry-goods', 'Griechischer Joghurt 2 %|50|g|dairy', 'Paprikapulver|3|g|pantry', 'Kurkuma|2|g|pantry', 'Olivenöl|8|g|pantry'),
    method: [
      'Onion softened, garlic a minute, spices 30 seconds in the oil.',
      'Tomato paste fried off properly, then 200 ml hot water, 6 minutes.',
      'Beans and coconut milk in, another 6 minutes to thicken.',
      'Lime zest and juice and a pinch of sugar at the end - it needs the sharpness.',
      'Everything from the cupboard except the onion. Doubles as a jacket potato filling.',
    ],
  },
  {
    id: 'd-gebratener-reis-ei', name: 'Egg fried rice with vegetables',
    slot: 'dinner', kcal: 650, protein: 30, minutes: 20, cuisine: 'asian',
    equipment: ['hob'], tags: ['leftover-ok', 'vegetarian', 'uses-leftovers', 'one-pan', 'fast'],
    ingredients: ings('Reis|60|g|dry-goods', 'Eier|3|Stk|dairy', 'Paprika|100|g|produce', 'Möhren|60|g|produce', 'TK-Erbsen|50|g|frozen', 'Zwiebel|40|g|produce', 'Frühlingszwiebel|25|g|produce', 'Sojasauce|15|ml|pantry', 'Sesamöl|8|g|pantry'),
    method: [
      'The rice has to be cooked the day before and cold, or it turns to paste.',
      'Hot pan: onion and the white of the spring onion, then pepper and carrot.',
      'Rice in, 6 minutes, pressed against the pan so it catches in places.',
      'Rice pushed aside, eggs scrambled in the clear space, then folded through.',
      'Soy and sesame oil off the heat, green of the spring onion last.',
    ],
  },
  {
    id: 'd-tikka-masala-huhn', name: 'Chicken tikka masala',
    slot: 'dinner', kcal: 645, protein: 55, minutes: 25, cuisine: 'asian',
    equipment: ['hob'], tags: ['weekend', 'leftover-ok', 'high-protein', 'comfort'],
    ingredients: ings('Hähnchenbrust|180|g|meat-fish', 'Griechischer Joghurt 2 %|60|g|dairy', 'Passata|120|g|dry-goods', 'Kochsahne 15 %|40|ml|dairy', 'Zwiebel|60|g|produce', 'Knoblauch|10|g|produce', 'Ingwer|8|g|produce', 'Reis|50|g|dry-goods', 'Zitrone|10|g|produce', 'Koriander|8|g|produce', 'Garam Masala|4|g|pantry', 'Paprikapulver|3|g|pantry', 'Butter|8|g|dairy'),
    method: [
      'Chicken in yoghurt, garlic, lemon and half the spices for 35 minutes.',
      'Weekend only because of that wait - the cooking itself is 25 minutes.',
      'Seared hard in a dry-ish pan for colour and deliberately left underdone.',
      'Onion, garlic and ginger down, rest of the spices 90 seconds, passata in.',
      'Reduced 12 minutes, cream in, chicken back for 5. Coriander and rice.',
    ],
  },
  {
    id: 'd-lachs-spargel-tagliatelle', name: 'Salmon and green asparagus tagliatelle',
    slot: 'dinner', kcal: 760, protein: 43, minutes: 25, cuisine: 'mediterranean',
    equipment: ['hob'], tags: ['leftover-ok', 'comfort', 'one-pan'],
    ingredients: ings('Lachsfilet|120|g|meat-fish', 'Grüner Spargel|120|g|produce', 'Vollkornpasta|70|g|dry-goods', 'Kochsahne 15 %|50|ml|dairy', 'Gemüsebrühe|100|ml|pantry', 'Rote Zwiebel|40|g|produce', 'Knoblauch|8|g|produce', 'Parmesan|15|g|dairy', 'Zitrone|8|g|produce', 'Dill|10|g|produce', 'Olivenöl|8|g|pantry'),
    method: [
      'Snap the woody ends off the asparagus and cut it into 3 cm lengths.',
      'Onion and garlic in oil, then stock and cream, brief reduction, seasoned.',
      'Salmon cubes, lemon zest and dill in, gentle simmer 4 minutes - no stirring.',
      'Asparagus goes into the pasta water for its last 3 minutes.',
      'Both drained into the sauce with two ladles of pasta water and the Parmesan.',
    ],
  },
];

// ------------------------------------------------------------------- SNACK
// `when` steers the planner: 'afternoon', 'evening', or 'any'.
const SNACKS = [
  {
    id: 's-schoko-quark-mousse', name: 'Chocolate quark mousse', slot: 'snack',
    kcal: 175, protein: 28, minutes: 3, cuisine: 'northern', when: 'evening',
    equipment: ['blender'], tags: ['sweet', 'no-cook', 'high-protein', 'vegetarian'],
    ingredients: ings('Magerquark|200|g|dairy', 'Backkakao|5|g|pantry', 'Süßstoff|2|g|pantry', 'TK-Himbeeren|50|g|frozen'),
    method: ['Whip the quark with cocoa and sweetener until it lightens and holds peaks.', 'Fold the still-frozen raspberries through so it turns cold and streaky.'],
  },
  {
    id: 's-skyr-zartbitter', name: 'Skyr with a square of 85 % chocolate', slot: 'snack',
    kcal: 215, protein: 18, minutes: 1, cuisine: 'northern', when: 'evening',
    equipment: ['none'], tags: ['sweet', 'no-cook', 'zero-effort', 'vegetarian'],
    ingredients: ings('Skyr natur|150|g|dairy', 'Zartbitterschokolade 85 %|20|g|pantry'),
    method: ['Chop the chocolate into the Skyr rather than eating it separately — it lasts four times as long.'],
  },
  {
    id: 's-harzer-gurken', name: 'Harzer Käse with gherkins', slot: 'snack',
    kcal: 170, protein: 38, minutes: 2, cuisine: 'northern', when: 'evening',
    equipment: ['none'], tags: ['savoury', 'no-cook', 'zero-effort', 'high-protein', 'vegetarian'],
    ingredients: ings('Harzer Käse|125|g|dairy', 'Gewürzgurken|80|g|dry-goods', 'Kümmel|2|g|pantry'),
    method: ['38 g of protein for 170 kcal — nothing else in the supermarket does this.'],
  },
  {
    id: 's-popcorn', name: 'Air-popped popcorn', slot: 'snack',
    kcal: 115, protein: 3, minutes: 5, cuisine: 'other', when: 'evening',
    equipment: ['hob'], tags: ['savoury', 'high-volume', 'vegetarian'],
    ingredients: ings('Popcorn-Mais|30|g|dry-goods', 'Meersalz|2|g|pantry'),
    method: ['Pop in a dry covered pan, shaking, then salt hard — no oil needed.', 'A whole large bowl for 115 kcal. This is the crisps replacement that actually works.'],
  },
  {
    id: 's-edamame', name: 'Salted edamame', slot: 'snack',
    kcal: 100, protein: 9, minutes: 5, cuisine: 'asian', when: 'evening',
    equipment: ['hob'], tags: ['savoury', 'high-volume', 'vegetarian'],
    ingredients: ings('TK-Edamame|80|g|frozen', 'Meersalz|3|g|pantry'),
    method: ['Boil from frozen for 4 minutes, drain, throw with flaky salt.', 'Podding them one by one slows you down, which is most of the point.'],
  },
  {
    id: 's-protein-kakao', name: 'Hot protein chocolate', slot: 'snack',
    kcal: 180, protein: 23, minutes: 3, cuisine: 'northern', when: 'evening',
    equipment: ['none'], tags: ['sweet', 'no-cook', 'high-protein', 'vegetarian'],
    ingredients: ings('Milch 1,5 %|200|ml|dairy', 'Whey-Proteinpulver Schoko|20|g|pantry', 'Backkakao|3|g|pantry'),
    method: ['Heat the milk, let it cool below boiling, THEN whisk in the whey or it curdles.', 'The 22:00 answer: hot, sweet, chocolate, and it actually fills you up.'],
  },
  {
    id: 's-apfel-erdnussmus', name: 'Apple with peanut butter', slot: 'snack',
    kcal: 170, protein: 4, minutes: 2, cuisine: 'other', when: 'afternoon',
    equipment: ['none'], tags: ['sweet', 'no-cook', 'zero-effort', 'vegetarian'],
    ingredients: ings('Apfel|150|g|produce', 'Erdnussmus|15|g|pantry'),
    method: ['Slice the apple and dip. Weigh the peanut butter once and you will never guess it again.'],
  },
  {
    id: 's-huettenkaese-knaecke', name: 'Hüttenkäse on Knäckebrot', slot: 'snack',
    kcal: 175, protein: 15, minutes: 3, cuisine: 'northern', when: 'afternoon',
    equipment: ['none'], tags: ['savoury', 'no-cook', 'vegetarian'],
    ingredients: ings('Körniger Frischkäse (Hüttenkäse)|100|g|dairy', 'Knäckebrot|20|g|bakery', 'Schnittlauch|5|g|produce'),
    method: ['Spoon on just before eating or the Knäckebrot goes soft within minutes.'],
  },
  {
    id: 's-mandeln', name: 'A weighed handful of almonds', slot: 'snack',
    kcal: 150, protein: 5, minutes: 1, cuisine: 'other', when: 'any',
    equipment: ['none'], tags: ['savoury', 'no-cook', 'zero-effort', 'vegetarian'],
    ingredients: ings('Mandeln|25|g|pantry'),
    method: ['Weigh 25 g into a bowl and put the bag away before you start eating.'],
  },
  {
    id: 's-banane-milch', name: 'Banana and milk (pre-match)', slot: 'snack',
    kcal: 200, protein: 8, minutes: 2, cuisine: 'other', when: 'afternoon',
    equipment: ['none'], tags: ['sweet', 'no-cook', 'pre-football', 'zero-effort', 'vegetarian'],
    ingredients: ings('Banane|120|g|produce', 'Milch 1,5 %|200|ml|dairy'),
    method: ['Eat this about 90 minutes before kick-off: fast carbs plus a little protein.', 'Turning up to football underfed is why the 22:00 crash happens.'],
  },
  {
    id: 's-skyr-beeren-eis', name: 'Skyr berry "ice cream"', slot: 'snack',
    kcal: 175, protein: 22, minutes: 3, cuisine: 'northern', when: 'evening',
    equipment: ['blender'], tags: ['sweet', 'no-cook', 'high-protein', 'vegetarian'],
    ingredients: ings('Skyr natur|200|g|dairy', 'TK-Beerenmischung|120|g|frozen'),
    method: ['Blitz frozen berries and Skyr together — it seizes into soft-scoop ice cream.', 'Eat it straight away; it sets hard in the freezer.'],
  },
  {
    id: 's-puten-kaese-roellchen', name: 'Turkey and cheese roll-ups', slot: 'snack',
    kcal: 165, protein: 26, minutes: 2, cuisine: 'northern', when: 'evening',
    equipment: ['none'], tags: ['savoury', 'no-cook', 'zero-effort', 'high-protein'],
    ingredients: ings('Putenbrust (Aufschnitt)|80|g|meat-fish', 'Gouda leicht|30|g|dairy', 'Senf|5|g|pantry'),
    method: ['Smear mustard, lay the cheese on the turkey, roll, eat with your hands.'],
  },
  {
    id: 's-reiswaffel-huettenkaese', name: 'Rice cakes with Hüttenkäse and tomato', slot: 'snack',
    kcal: 165, protein: 14, minutes: 3, cuisine: 'other', when: 'afternoon',
    equipment: ['none'], tags: ['savoury', 'no-cook', 'vegetarian'],
    ingredients: ings('Reiswaffeln|20|g|dry-goods', 'Körniger Frischkäse (Hüttenkäse)|100|g|dairy', 'Tomaten|50|g|produce'),
    method: ['Salt and pepper the tomato properly or the whole thing tastes of nothing.'],
  },
  {
    id: 's-gemuesesticks-hummus', name: 'Vegetable sticks with hummus', slot: 'snack',
    kcal: 210, protein: 6, minutes: 5, cuisine: 'middle-eastern', when: 'afternoon',
    equipment: ['none'], tags: ['savoury', 'no-cook', 'high-volume', 'vegetarian'],
    ingredients: ings('Möhren|100|g|produce', 'Paprika|100|g|produce', 'Hummus|60|g|dairy'),
    method: ['Cut the sticks on Sunday and keep them in water in the fridge; they stay crisp all week.'],
  },
  {
    id: 's-protein-pudding', name: 'High-protein pudding (bought)', slot: 'snack',
    kcal: 150, protein: 20, minutes: 1, cuisine: 'northern', when: 'evening',
    equipment: ['none'], tags: ['sweet', 'no-cook', 'zero-effort', 'high-protein', 'vegetarian'],
    ingredients: ings('High-Protein-Pudding|200|g|dairy'),
    method: ['Keep four in the fridge at all times. This is the emergency brake for a bad night.'],
  },
  {
    id: 's-gekochte-eier', name: 'Two boiled eggs with salt', slot: 'snack',
    kcal: 145, protein: 13, minutes: 2, cuisine: 'other', when: 'evening',
    equipment: ['hob'], tags: ['savoury', 'zero-effort', 'make-ahead', 'vegetarian'],
    ingredients: ings('Eier|2|Stk|dairy', 'Meersalz|2|g|pantry'),
    method: ['Boil six on Sunday and they are a two-minute snack for the rest of the week.'],
  },
  {
    id: 's-gefrorene-weintrauben', name: 'Frozen grapes', slot: 'snack',
    kcal: 100, protein: 1, minutes: 1, cuisine: 'other', when: 'evening',
    equipment: ['none'], tags: ['sweet', 'no-cook', 'zero-effort', 'high-volume', 'vegetarian'],
    ingredients: ings('Weintrauben|150|g|produce'),
    method: ['Freeze them the day you buy them; they eat like sorbet and take ages.'],
  },
  {
    id: 's-mini-wrap-pute', name: 'Mini turkey wrap', slot: 'snack',
    kcal: 190, protein: 17, minutes: 5, cuisine: 'other', when: 'afternoon',
    equipment: ['none'], tags: ['savoury', 'no-cook'],
    ingredients: ings('Vollkorn-Wrap|40|g|bakery', 'Putenbrust (Aufschnitt)|60|g|meat-fish', 'Kopfsalat|30|g|produce', 'Senf|5|g|pantry'),
    method: ['Roll it tight and cut it in half so it feels like more than it is.'],
  },
  {
    id: 's-huettenkaese-ananas', name: 'Hüttenkäse with pineapple', slot: 'snack',
    kcal: 200, protein: 20, minutes: 2, cuisine: 'other', when: 'evening',
    equipment: ['none'], tags: ['sweet', 'no-cook', 'zero-effort', 'high-protein', 'vegetarian'],
    ingredients: ings('Körniger Frischkäse (Hüttenkäse)|150|g|dairy', 'Ananas|100|g|produce'),
    method: ['Sweet and savoury at once, which is exactly the craving this is for.'],
  },
  {
    id: 's-zartbitter-cola-zero', name: 'Two squares of chocolate and a Cola Zero', slot: 'snack',
    kcal: 120, protein: 2, minutes: 1, cuisine: 'other', when: 'evening',
    equipment: ['none'], tags: ['sweet', 'no-cook', 'zero-effort', 'vegetarian'],
    ingredients: ings('Zartbitterschokolade 85 %|20|g|pantry', 'Cola Zero|330|ml|drinks'),
    method: ['This is in the plan on purpose. A budgeted 120 kcal beats a guilty 600 kcal.'],
  },
  {
    id: 's-prefootball-reiswaffeln-quark', name: 'Rice cakes with quark and honey (pre-match)', slot: 'snack',
    kcal: 250, protein: 20, minutes: 3, cuisine: 'northern', when: 'afternoon',
    equipment: ['none'], tags: ['sweet', 'no-cook', 'pre-football', 'zero-effort', 'high-protein', 'vegetarian'],
    ingredients: ings('Reiswaffeln|30|g|dry-goods', 'Magerquark|150|g|dairy', 'Honig|10|g|pantry', 'Zimt|2|g|pantry'),
    method: ['Quark on the rice cakes, honey over the top, cinnamon last.', 'Fast carbs with 20 g of protein behind them, about 90 minutes before kick-off.'],
  },
  {
    id: 's-prefootball-datteln-erdnussmus', name: 'Dates with peanut butter (pre-match)', slot: 'snack',
    kcal: 205, protein: 6, minutes: 2, cuisine: 'other', when: 'afternoon',
    equipment: ['none'], tags: ['sweet', 'no-cook', 'pre-football', 'zero-effort', 'storecupboard', 'vegetarian'],
    ingredients: ings('Getrocknete Datteln|40|g|dry-goods', 'Erdnussmus|15|g|pantry'),
    method: ['Split the dates, a dab of peanut butter in each.', 'Keeps in the cupboard forever, which is the point: this is the one that is always there.'],
  },
  {
    id: 's-prefootball-haferriegel', name: 'Made-ahead oat and protein bar (pre-match)', slot: 'snack',
    kcal: 310, protein: 17, minutes: 8, cuisine: 'northern', when: 'afternoon',
    equipment: ['oven'], tags: ['sweet', 'pre-football', 'make-ahead', 'batch', 'freezes', 'vegetarian'],
    ingredients: ings('Haferflocken|35|g|dry-goods', 'Whey-Proteinpulver|12|g|pantry', 'Erdnussmus|10|g|pantry', 'Honig|8|g|pantry', 'Banane|50|g|produce'),
    method: [
      'Mash, mix, press into a tin, 18 minutes at 180 °C. Make eight at once on a Sunday.',
      'The minutes here are the hands-on share of a batch, not one bar at a time.',
      'Wrapped in the bag with the boots, so the pre-match snack happens even on the way out of the door.',
    ],
  },
  {
    id: 's-prefootball-honig-zimt-toast', name: 'Honey cinnamon toast with skyr (pre-match)', slot: 'snack',
    kcal: 245, protein: 18, minutes: 4, cuisine: 'northern', when: 'afternoon',
    equipment: ['none'], tags: ['sweet', 'pre-football', 'fast', 'high-protein', 'vegetarian'],
    ingredients: ings('Vollkornbrot|60|g|bakery', 'Skyr natur|120|g|dairy', 'Honig|8|g|pantry', 'Zimt|2|g|pantry'),
    method: ['Toast, skyr spread thick like butter, honey and cinnamon over it.', 'Warm bread and cold skyr is better than either on its own, and it is 18 g of protein.'],
  },
  {
    id: 's-geroestete-kichererbsen', name: 'Air-fryer crispy chickpeas', slot: 'snack',
    kcal: 195, protein: 9, minutes: 10, cuisine: 'middle-eastern', when: 'evening',
    equipment: ['airfryer'], tags: ['savoury', 'make-ahead', 'batch', 'storecupboard', 'vegetarian'],
    ingredients: ings('Kichererbsen|120|g|dry-goods', 'Geräuchertes Paprikapulver|3|g|pantry', 'Olivenöl|5|g|pantry', 'Meersalz|2|g|pantry'),
    method: [
      'Dry them on a tea towel first. Wet chickpeas steam and stay soft; dry ones go like crisps.',
      '200 °C for 14 minutes, shaken twice. Spices on after, so they do not burn.',
      'The crunchy savoury craving answered for 195 kcal. Make a jar on Sunday.',
    ],
  },
  {
    id: 's-gurken-lachs-roellchen', name: 'Cucumber and smoked salmon rolls', slot: 'snack',
    kcal: 185, protein: 22, minutes: 5, cuisine: 'northern', when: 'evening',
    equipment: ['none'], tags: ['savoury', 'no-cook', 'high-protein', 'low-carb'],
    ingredients: ings('Räucherlachs|60|g|meat-fish', 'Gurke|120|g|produce', 'Körniger Frischkäse (Hüttenkäse)|60|g|dairy', 'Dill|5|g|produce', 'Zitrone|10|g|produce'),
    method: [
      'Cucumber in long ribbons with the peeler, Hüttenkäse and dill along one end, roll up.',
      'Feels like something from a tray at a party, costs 185 kcal and gives back 22 g of protein.',
    ],
  },
  {
    id: 's-miso-bruehe-edamame', name: 'Miso broth with edamame', slot: 'snack',
    kcal: 180, protein: 13, minutes: 3, cuisine: 'asian', when: 'evening',
    equipment: ['hob'], tags: ['savoury', 'fast', 'high-volume', 'storecupboard', 'vegetarian'],
    ingredients: ings('Miso-Paste|20|g|pantry', 'Gemüsebrühe|350|ml|pantry', 'Frühlingszwiebel|20|g|produce', 'TK-Edamame|80|g|frozen', 'Sesam|4|g|pantry'),
    method: [
      'Miso stirred into hot — not boiling — stock, edamame straight from the freezer.',
      'A large hot salty bowl is the thing that actually stops the 23:00 kitchen walk. Soup takes time to drink.',
    ],
  },
  {
    id: 's-skyr-erdnuss-schoko', name: 'Skyr with peanut butter and dark chocolate', slot: 'snack',
    kcal: 250, protein: 23, minutes: 2, cuisine: 'northern', when: 'evening',
    equipment: ['none'], tags: ['sweet', 'no-cook', 'zero-effort', 'high-protein', 'vegetarian'],
    ingredients: ings('Skyr natur|180|g|dairy', 'Erdnussmus|12|g|pantry', 'Zartbitterschokolade 85 %|10|g|pantry', 'Süßstoff|2|g|pantry'),
    method: [
      'Peanut butter rippled through rather than stirred in, so some spoonfuls are better than others.',
      'Chocolate chopped fine, not grated. This is the one that tastes like a dessert and is not.',
    ],
  },
  {
    id: 's-apfelchips-zimt', name: 'Air-fryer cinnamon apple crisps', slot: 'snack',
    kcal: 105, protein: 1, minutes: 10, cuisine: 'other', when: 'evening',
    equipment: ['airfryer'], tags: ['sweet', 'high-volume', 'make-ahead', 'batch', 'vegetarian'],
    ingredients: ings('Apfel|200|g|produce', 'Zimt|3|g|pantry'),
    method: [
      'Sliced 2 mm on a mandolin or the slicer attachment, 160 °C for 18 minutes, turned once.',
      'A whole large apple becomes a bowl that takes twenty minutes to eat, for 105 kcal.',
      'They go soft in a day, so make them the evening you want them.',
    ],
  },
  {
    id: 's-thunfisch-dip-gemuese', name: 'Tuna quark dip with vegetable sticks', slot: 'snack',
    kcal: 230, protein: 38, minutes: 5, cuisine: 'other', when: 'evening',
    equipment: ['none'], tags: ['savoury', 'no-cook', 'high-protein', 'high-volume', 'storecupboard'],
    ingredients: ings('Thunfisch in Wasser|100|g|dry-goods', 'Magerquark|100|g|dairy', 'Zitrone|10|g|produce', 'Schnittlauch|8|g|produce', 'Möhren|100|g|produce', 'Gurke|100|g|produce', 'Senf|5|g|pantry'),
    method: [
      'Drained tuna mashed into quark with mustard and lemon until it is a dip, not a salad.',
      '38 g of protein for 230 kcal, and the carrot sticks make it last. The savoury night craving, solved.',
    ],
  },

  // --- v5: converted from akispetretzikis.com source data. Quantities are
  // per-portion grams for this composition and the macros are computed from
  // them, because the source panel omits its unquantified ingredients.
  {
    id: 's-tzatziki-gemuesesticks', name: 'Tzatziki with vegetable sticks',
    slot: 'snack', kcal: 255, protein: 19, minutes: 10, cuisine: 'mediterranean',
    when: 'evening',
    equipment: ['none'],
    tags: ['savoury', 'no-cook', 'make-ahead', 'vegetarian', 'high-volume'],
    ingredients: ings(
      'Griechischer Joghurt 2 %|180|g|dairy', 'Gurke|100|g|produce', 'Möhren|80|g|produce',
      'Paprika|80|g|produce', 'Olivenöl|5|g|pantry', 'Knoblauch|4|g|produce', 'Dill|5|g|produce'
    ),
    method: [
      'Grate the cucumber, salt it, wait five minutes and squeeze. Skip that and it separates.',
      'One clove, grated not chopped, and let it sit an hour before you decide it needs more.',
      'Half a kilo of food for 250 calories, which is what a savoury night craving actually wants.',
    ],
  },
  {
    id: 's-thunfisch-brot-schnell', name: 'Tuna on rye, two minutes flat',
    slot: 'snack', kcal: 220, protein: 30, minutes: 7, cuisine: 'northern',
    when: 'evening',
    equipment: ['none'],
    tags: ['savoury', 'no-cook', 'fast', 'storecupboard', 'high-protein'],
    ingredients: ings(
      'Thunfisch in Wasser|100|g|dry-goods', 'Roggenvollkornbrot|40|g|bakery',
      'Griechischer Joghurt 2 %|30|g|dairy', 'Frühlingszwiebel|15|g|produce',
      'Zitrone|10|g|produce', 'Schwarzer Pfeffer|1|g|pantry'
    ),
    method: [
      'Drain the tin properly and fork the tuna with yoghurt rather than mayonnaise.',
      'Thirty grams of protein from a cupboard, which is the point of keeping tins at all.',
      'Lemon and a lot of black pepper; it needs the sharpness to not taste like a tin.',
    ],
  },

  // ---- Shiba's Kitchen, October 2026 --------------------------------------
  {
    id: 's-moehren-sesam-salat', name: 'Carrot ribbons with ginger sesame dressing',
    slot: 'snack', kcal: 195, protein: 4, minutes: 10, cuisine: 'asian', when: 'afternoon',
    equipment: ['none'], tags: ['savoury', 'no-cook', 'make-ahead', 'vegetarian', 'high-volume'],
    ingredients: ings('Möhren|150|g|produce', 'Frühlingszwiebel|15|g|produce', 'Sesam|8|g|pantry', 'Sojasauce|10|ml|pantry', 'Reisessig|10|ml|pantry', 'Honig|6|g|pantry', 'Sesamöl|6|g|pantry', 'Zitrone|8|g|produce', 'Ingwer|3|g|produce', 'Knoblauch|3|g|produce', 'Chiliflocken|1|g|pantry'),
    method: [
      'Peel the carrots, then keep peeling them into ribbons with the same peeler.',
      'Dressing shaken in a jar, carrots and spring onion turned through it.',
      'Ten minutes minimum to marinate - the ribbons go from raw to silky.',
      'Sesame stirred in just before eating so it stays crisp.',
    ],
  },
];

export const RECIPES = [...BREAKFASTS, ...LUNCHES, ...DINNERS, ...SNACKS];

// ------------------------------------------------------------ user recipes
//
// A recipe the user typed in has to behave exactly like a built-in one: the
// planner must pick it, the shopping list must buy for it, the swap engine must
// offer it. Threading a "plus these extras" argument through planner, swap and
// shopping would touch every function in the app for a feature that is, in the
// end, "the library is a bit longer". So the library is a small mutable registry
// instead, set ONCE at boot from the store (and by tests), and every lookup goes
// through it. The built-in array is never modified, so a bad custom recipe can
// always be removed without collateral damage.

let custom = [];
let index = new Map(RECIPES.map((r) => [r.id, r]));

const reindex = () => { index = new Map([...RECIPES, ...custom].map((r) => [r.id, r])); };

/** Everything the planner may choose from: built-ins plus the user's own. */
export const allRecipes = () => (custom.length ? [...RECIPES, ...custom] : RECIPES);
export const customRecipes = () => custom;
export const isCustomRecipe = (id) => custom.some((r) => r.id === id);

/** Replace the user's recipe library. Invalid entries are dropped, not half-loaded. */
export function setCustomRecipes(list) {
  custom = (Array.isArray(list) ? list : [])
    .map((r) => validateRecipe(r))
    .filter((v) => v.ok)
    .map((v) => v.recipe)
    // Ids must be unique, because the index and the shopping list both key on
    // them: a duplicate would make one recipe unreachable while the list bought
    // for it. Two recipes with the same name and calories collide, so the second
    // one gets a suffix rather than being silently dropped.
    .reduce((acc, r) => {
      let id = r.id;
      for (let n = 2; acc.taken.has(id); n++) id = `${r.id}-${n}`;
      acc.taken.add(id);
      acc.out.push(id === r.id ? r : { ...r, id });
      return acc;
    }, { taken: new Set(RECIPES.map((b) => b.id)), out: [] }).out;
  reindex();
  return custom;
}

export const recipeById = (id) => index.get(id);
export const bySlot = (slot) => allRecipes().filter((r) => r.slot === slot);
export const byTag = (tag) => allRecipes().filter((r) => r.tags.includes(tag));

// ------------------------------------------------------- recipe validation
const UNITS = ['g', 'ml', 'Stk'];
export const INGREDIENT_UNITS = UNITS;

export const slugify = (s) => String(s).toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/**
 * What one portion can plausibly hold. Over `warn` we say something and carry on;
 * over `max` we refuse, because at that point it is not a preference, it is a typo.
 */
export const INGREDIENT_LIMITS = {
  g: { warn: 800, max: 3000 },
  ml: { warn: 1000, max: 3000 },
  Stk: { warn: 12, max: 50 },
};

// Energy density is physics rather than opinion: pure fat is 9 kcal/g and watery
// vegetables bottom out near 0.1. Outside that band, a digit is in the wrong place.
const DENSITY = { min: 0.1, max: 9, warnMin: 0.3, warnMax: 6 };
// Pieces have no mass, so one `Stk` anywhere means the mass we can see is not the
// whole dish and the ratio means nothing. Three eggs and a pinch of salt is a real
// recipe that simply cannot be checked this way; those lean on the per-unit ceiling.
const hasPieces = (ingredients) => ingredients.some((i) => i.unit === 'Stk');

// Half the floor and double the ceiling of the band the built-in library is held to:
// loose enough that a real Sunday roast is not nagged, tight enough to catch a pot.
const SLOT_KCAL_WARN = {
  breakfast: [125, 1200], lunch: [175, 1500], dinner: [200, 1800], snack: [40, 640],
};

const limitFor = (unit) => INGREDIENT_LIMITS[unit] ?? null;

/** Weighed-or-poured mass only. Pieces have no mass, so they cannot be counted here. */
const weighedMass = (ingredients) => ingredients
  .filter((i) => i.unit === 'g' || i.unit === 'ml')
  .reduce((sum, i) => sum + Number(i.qty), 0);

/**
 * Parse the ingredient textarea: one line of `Name | qty | unit | aisle`.
 * Aisle may be omitted and defaults to the catch-all shelf.
 *
 * Returns `warnings` as well as `errors`: an amount can be suspicious without being
 * wrong, and refusing to save someone's real recipe is the worse failure.
 */
export function parseIngredientLines(text) {
  const items = [];
  const errors = [];
  const warnings = [];
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, n) => {
    const parts = line.split('|').map((x) => x.trim());
    const [item, qtyRaw, unit, aisle] = parts;
    if (parts.length < 3) {
      errors.push(`Line ${n + 1}: needs at least Name | amount | unit (e.g. Magerquark | 250 | g).`);
      return;
    }
    const qty = Number(String(qtyRaw).replace(',', '.'));
    if (!item) errors.push(`Line ${n + 1}: no ingredient name.`);
    if (!Number.isFinite(qty) || qty <= 0) errors.push(`Line ${n + 1}: "${qtyRaw}" is not an amount.`);
    if (!UNITS.includes(unit)) errors.push(`Line ${n + 1}: unit must be one of ${UNITS.join(', ')}.`);
    const shelf = aisle && AISLES.includes(aisle) ? aisle : 'pantry';
    if (aisle && !AISLES.includes(aisle)) errors.push(`Line ${n + 1}: "${aisle}" is not an aisle. Using Vorrat.`);

    const lim = Number.isFinite(qty) ? limitFor(unit) : null;
    const absurd = lim && qty > lim.max;
    if (absurd) {
      errors.push(`Line ${n + 1}: ${qty} ${unit} in one portion is not possible. This is per portion, not per pot.`);
    } else if (lim && qty > lim.warn) {
      warnings.push(`Line ${n + 1}: ${qty} ${unit} is a lot for one portion — check it is not the whole pot.`);
    }

    if (item && Number.isFinite(qty) && qty > 0 && UNITS.includes(unit) && !absurd) {
      items.push({ item, qty, unit, aisle: shelf });
    }
  });
  if (!lines.length) errors.push('Add at least one ingredient, or the shopping list will not buy for this.');
  // Lines were typed and not one survived. The caller needs to know, because
  // "it needs an ingredient" is the wrong thing to say to someone who typed one.
  return { items, errors, warnings, rejected: lines.length > 0 && items.length === 0 };
}

/**
 * Check and normalise a user-authored recipe.
 *
 * `opts.amountsChecked` says the ingredients already came through
 * `parseIngredientLines`, which warns about big amounts with a line number. Pass it
 * and the per-ingredient warning is left to the parser, so the form does not say the
 * same thing twice. The matching *error* still runs here either way: a draft built
 * in code rather than typed has had nothing checked at all.
 *
 * Two tags are added silently, because without them the planner would accept the
 * recipe and then never choose it — a silent failure is worse than a surprise:
 *   - a lunch needs `packable` (the lunch pool only takes packable or no-cook)
 *   - anything over 30 minutes needs `weekend` (the weekday cap is a hard rule)
 *
 * Errors block the save. Warnings do not: "unusual" and "wrong" are different, and
 * only the person who cooked it knows which one this is.
 *
 * `opts.ingredientsRejected` says the caller already refused every ingredient line
 * and explained why, so the complaint here points at those messages instead of
 * claiming an ingredient is missing. Pass `parseIngredientLines(...).rejected`.
 */
export function validateRecipe(draft, opts = {}) {
  const errors = [];
  const warnings = [];
  const d = draft ?? {};
  const name = String(d.name ?? '').trim();
  const slot = d.slot;
  const kcal = Math.round(Number(d.kcal));
  const protein = Math.round(Number(d.protein));
  const minutes = Math.round(Number(d.minutes));

  if (name.length < 2) errors.push('Give it a name.');
  if (!SLOT_ORDER.includes(slot)) errors.push('Pick which meal it is.');
  if (!Number.isFinite(kcal) || kcal < 20 || kcal > 2000) errors.push('Calories per portion must be between 20 and 2000.');
  if (!Number.isFinite(protein) || protein < 0 || protein > 200) errors.push('Protein per portion must be between 0 and 200 g.');
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) errors.push('Minutes must be between 1 and 240.');

  // Protein costs 4 kcal per gram whether or not the label admits it, so protein
  // that outweighs the whole recipe is not a judgement call.
  if (Number.isFinite(kcal) && Number.isFinite(protein) && protein * 4 > kcal) {
    errors.push(`${protein} g of protein is ${protein * 4} kcal on its own, which will not fit inside ${kcal} kcal. One of the two numbers is wrong.`);
  }

  const raw = Array.isArray(d.ingredients) ? d.ingredients : [];
  const ingredients = [];
  for (const i of raw) {
    const qty = Number(i?.qty);
    if (!i || !i.item || !Number.isFinite(qty) || qty <= 0 || !UNITS.includes(i.unit)) continue;
    const lim = limitFor(i.unit);
    if (lim && qty > lim.max) {
      errors.push(`${qty} ${i.unit} of ${i.item} in one portion is not possible — check the amount.`);
      continue;
    }
    if (lim && qty > lim.warn && !opts.amountsChecked) {
      warnings.push(`${qty} ${i.unit} of ${i.item} is a lot for one portion — check it is not the whole pot.`);
    }
    ingredients.push(i);
  }
  if (!ingredients.length) {
    errors.push(opts.ingredientsRejected
      ? 'None of the ingredient lines could be used — fix the amounts above and try again.'
      : 'It needs at least one ingredient.');
  }

  // Everything is weighed or poured, so the mass on the page is the whole dish and
  // the ratio is real at any scale -- 9 kcal/g is pure fat whether it is 12 g or 1.2 kg.
  const mass = weighedMass(ingredients);
  if (Number.isFinite(kcal) && kcal > 0 && mass > 0 && !hasPieces(ingredients)) {
    const perG = kcal / mass;
    const shown = perG >= 1 ? perG.toFixed(1) : perG.toFixed(2);
    if (perG > DENSITY.max) {
      errors.push(`${kcal} kcal from ${Math.round(mass)} g is ${shown} kcal per gram. Pure fat is 9, so either the calories or an amount has a digit too many.`);
    } else if (perG < DENSITY.min) {
      errors.push(`${kcal} kcal from ${Math.round(mass)} g is only ${shown} kcal per gram, which no food manages. Either the calories or an amount has a digit too many.`);
    } else if (perG > DENSITY.warnMax) {
      warnings.push(`${shown} kcal per gram is very rich for a whole dish — worth a second look.`);
    } else if (perG < DENSITY.warnMin) {
      warnings.push(`${shown} kcal per gram is very light for a whole dish — worth a second look.`);
    }
  }

  const band = SLOT_KCAL_WARN[slot];
  if (band && Number.isFinite(kcal) && (kcal < band[0] || kcal > band[1])) {
    warnings.push(`${kcal} kcal is unusual for a ${slot} — check it is per portion, not per pot.`);
  }

  const tags = new Set((Array.isArray(d.tags) ? d.tags : []).map((t) => String(t).trim()).filter(Boolean));
  tags.add('custom');
  if (slot === 'lunch') tags.add('packable');
  if (Number.isFinite(minutes) && minutes > 30) tags.add('weekend');
  // Nobody is asked for tags, so without this a recipe of your own is invisible
  // on a vegetarian day -- the planner accepts it and then never serves it, which
  // looks exactly like it was lost. The aisle is the only machine-readable thing
  // we have: a recipe that buys nothing from the meat-and-fish counter is
  // meatless. Only ever ADDS the tag. Removing one would overrule a person who
  // filed tofu or halloumi under `meat-fish` because that is where their shop
  // keeps it, and they know what is in their own dinner.
  if (ingredients.every((i) => i.aisle !== 'meat-fish')) tags.add('vegetarian');

  if (errors.length) return { ok: false, errors, warnings, recipe: null };

  const id = d.id && String(d.id).startsWith('u-') ? d.id : `u-${slugify(name)}-${String(kcal)}`;
  return {
    ok: true,
    errors: [],
    warnings,
    recipe: {
      id, name, slot, kcal, protein, minutes,
      cuisine: CUISINES.includes(d.cuisine) ? d.cuisine : 'other',
      equipment: (Array.isArray(d.equipment) ? d.equipment : []).filter((e) => EQUIPMENT.includes(e)),
      tags: [...tags],
      ingredients: ingredients.map((i) => ({
        item: String(i.item).trim(), qty: Number(i.qty), unit: i.unit,
        aisle: AISLES.includes(i.aisle) ? i.aisle : 'pantry',
      })),
      method: (Array.isArray(d.method) ? d.method : String(d.method ?? '').split(/\r?\n/))
        .map((m) => String(m).trim()).filter(Boolean),
      ...(d.when === 'afternoon' || d.when === 'evening' ? { when: d.when } : {}),
    },
  };
}

// ------------------------------------------------------------- bulk import

// `Name:` through `Protein:` are single-line headers; the other two open a block
// that runs to the next header. Aliases exist because nobody remembers which word
// this app chose, and being told "unknown field: Calories" is a pointless defeat.
const BLOCK_FIELDS = {
  name: 'name', title: 'name', recipe: 'name',
  meal: 'slot', slot: 'slot', course: 'slot',
  cuisine: 'cuisine', kitchen: 'cuisine',
  minutes: 'minutes', time: 'minutes', mins: 'minutes',
  kcal: 'kcal', calories: 'kcal', cals: 'kcal',
  protein: 'protein',
  ingredients: 'ingredients', ingredient: 'ingredients',
  method: 'method', steps: 'method', instructions: 'method',
  equipment: 'equipment', tags: 'tags', when: 'when',
};
const MULTILINE = new Set(['ingredients', 'method', 'equipment', 'tags']);

const SLOT_WORDS = {
  breakfast: 'breakfast', fruehstueck: 'breakfast',
  lunch: 'lunch', mittag: 'lunch', mittagessen: 'lunch',
  dinner: 'dinner', abendessen: 'dinner', supper: 'dinner',
  snack: 'snack', snacks: 'snack',
};

/** Split a pasted blob into one record of raw strings per `---`-separated block. */
function splitBlocks(text) {
  const lines = String(text).split(/\r?\n/);
  const blocks = [];
  let current = null;

  const open = (lineNo) => { current = { at: lineNo, fields: {}, lineOf: {} }; blocks.push(current); };

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    if (/^\s*-{3,}\s*$/.test(raw)) { current = null; return; }

    const header = raw.match(/^\s*([A-Za-z]+)\s*:\s*(.*)$/);
    const key = header && BLOCK_FIELDS[header[1].toLowerCase()];
    if (key) {
      if (!current) open(lineNo);
      current.field = key;
      current.lineOf[key] = lineNo;
      current.fields[key] = header[2].trim();
      return;
    }
    // Not a header: it belongs to whichever block field is open.
    if (!current || !current.field) return;
    if (!MULTILINE.has(current.field)) return;
    if (!raw.trim()) return;
    current.fields[current.field] = `${current.fields[current.field] ?? ''}\n${raw.trim()}`.replace(/^\n/, '');
  });

  return blocks.filter((b) => Object.keys(b.fields).length);
}

/** Pull recipes out of an export file or a bare array of recipe objects. */
function fromJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const own = data.memory?.custom ?? data.custom ?? data.recipes;
    if (Array.isArray(own)) return own;
    return [];   // valid JSON, just not ours -- say so rather than guess
  }
  return [];
}

/**
 * Turn a pasted blob into validated recipes.
 *
 * Accepts the `Name: … Meal: … Ingredients: …` text format, `---` between
 * recipes, or a JSON file this app exported. Returns everything that was good
 * *and* everything that was wrong, named and located, because the alternative
 * -- `setCustomRecipes` silently dropping invalid rows -- is a paste of twelve
 * recipes that quietly becomes nine.
 */
export function parseRecipeBlocks(text) {
  const raw = String(text ?? '');
  const recipes = [];
  const errors = [];
  const warnings = [];

  if (!raw.trim()) {
    return { recipes, errors: ['Nothing pasted. Copy your recipes in first.'], warnings };
  }

  const json = raw.trim().startsWith('{') || raw.trim().startsWith('[') ? fromJson(raw) : null;
  if (json) {
    if (!json.length) {
      return { recipes, errors: ['That file is readable, but there are no recipes in it.'], warnings };
    }
    json.forEach((r, n) => {
      const label = r?.name ? `"${r.name}"` : `recipe ${n + 1}`;
      const res = validateRecipe(r);
      if (!res.ok) { errors.push(...res.errors.map((e) => `${label}: ${e}`)); return; }
      warnings.push(...res.warnings.map((w) => `${label}: ${w}`));
      recipes.push(res.recipe);
    });
    return { recipes, errors, warnings };
  }

  const blocks = splitBlocks(raw);
  if (!blocks.length) {
    return {
      recipes,
      errors: ['Nothing in that paste looked like a recipe. Each one needs at least a "Name:" line — see the example above.'],
      warnings,
    };
  }

  blocks.forEach((b, n) => {
    const f = b.fields;
    // Named if we can, numbered if we cannot, and always locatable in the paste.
    const label = f.name ? `"${f.name}"` : `recipe ${n + 1}`;
    const where = `line ${b.at}`;
    const say = (list, msg) => list.push(`${label} (${where}): ${msg}`);

    const slotWord = String(f.slot ?? '').toLowerCase().trim();
    const slot = SLOT_WORDS[slotWord] ?? slotWord;
    const parsed = parseIngredientLines(f.ingredients ?? '');
    const ingLine = b.lineOf.ingredients ?? b.at;
    // The parser numbers lines from its own first line; shift them to the paste.
    const shift = (m) => m.replace(/^Line (\d+):/, (_, d) => `line ${ingLine + Number(d)}:`);
    parsed.errors.forEach((e) => say(errors, shift(e)));
    parsed.warnings.forEach((w) => say(warnings, shift(w)));

    const res = validateRecipe({
      name: f.name,
      slot,
      cuisine: f.cuisine,
      minutes: Number(f.minutes),
      kcal: Number(f.kcal),
      protein: Number(f.protein),
      equipment: (f.equipment ?? '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean),
      tags: (f.tags ?? '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean),
      when: f.when,
      ingredients: parsed.items,
      method: f.method ?? '',
    }, { amountsChecked: true, ingredientsRejected: parsed.rejected });

    res.errors.forEach((e) => say(errors, e));
    res.warnings.forEach((w) => say(warnings, w));
    if (res.ok && !parsed.errors.length) recipes.push(res.recipe);
  });

  return { recipes, errors, warnings };
}
