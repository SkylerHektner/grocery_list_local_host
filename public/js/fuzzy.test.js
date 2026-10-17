import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normalize, search, matchText, segments, typoDistance, TIER } from './fuzzy.js';

/** Builds item-like candidates: 'Name' or ['Name', {aliases, use_count, last_used}]. */
function items(...specs) {
  return specs.map((spec, i) => {
    const [name, extra = {}] = Array.isArray(spec) ? spec : [spec];
    return { id: i + 1, name, aliases: [], use_count: 0, last_used: 0, ...extra };
  });
}

const names = (results) => results.map((r) => r.item.name);
const top = (query, candidates) => search(query, candidates)[0]?.item.name;

// A realistic catalog: the demo items (src/demo.rs) plus the SPEC examples and confusers.
const CATALOG = items(
  'Bananas', 'Avocados', 'Lemons', 'Limes', 'Yellow onions', ['Garlic', { staple: true }],
  ['Scallions', { aliases: ['Green onions'] }], ['Cilantro', { aliases: ['Coriander'] }],
  'Tomatoes', 'Tomato', 'Tomato paste', 'Broccoli', 'Bell peppers', 'Carrots',
  'Sourdough bread', 'Corn tortillas', ['Parmigiano Reggiano', { aliases: ['Parmesan'] }],
  ['Sharp cheddar', { aliases: ['Cheddar'] }], 'Ground beef', 'Chicken thighs', 'Bacon', 'Eggs',
  'Milk', 'Almond milk', 'Butter', 'Greek Yogurt', 'Heavy Cream', 'Sour cream', 'Cream cheese',
  'Crème fraîche', 'Frozen peas', ['Vanilla ice cream', { aliases: ['Ice cream'] }],
  ['Olive oil', { aliases: ['EVOO'] }], ['Salt', { aliases: ['Kosher salt'] }], 'Black pepper',
  'Spaghetti', 'Basmati Rice', 'Rice vinegar', 'Licorice', 'Soy sauce', 'Black beans',
  'BBQ sauce', 'Chicken stock', 'Tortilla chips', 'Coffee beans', 'Sparkling water',
  'Paper towels', 'Toothpaste', 'Taco seasoning', 'Birthday candles', 'Gravy', 'Grapes',
  'Parsley', 'Pasta', 'Mint', 'Mozzarella', 'Muffins', 'Half-and-half', "Ben & Jerry's",
  'Jalapeño', 'Mild salsa',
);

describe('normalize', () => {
  test('lowercases and strips diacritics', () => {
    assert.equal(normalize('Crème Brûlée'), 'creme brulee');
    assert.equal(normalize('JALAPEÑO'), 'jalapeno');
    assert.equal(normalize('Parmesan'), 'parmesan');
    assert.equal(normalize(''), '');
  });

  test('folds letters NFD keeps, drops apostrophes, collapses punctuation', () => {
    assert.equal(normalize('Smørrebrød'), 'smorrebrod');
    assert.equal(normalize('Weißwurst'), 'weisswurst');
    assert.equal(normalize("Ben & Jerry's"), 'ben jerrys');
    assert.equal(normalize('Jerry’s'), 'jerrys');
    assert.equal(normalize('  Half-and-half  '), 'half and half');
    assert.equal(normalize('Crème'), 'creme', 'decomposed input');
    assert.equal(normalize(null), '');
  });
});

describe('tiers (matchText)', () => {
  test('1 exact name, case- and diacritic-insensitive', () => {
    assert.deepEqual(matchText('milk', 'Milk'), { tier: TIER.EXACT, quality: 0, ranges: [[0, 4]] });
    assert.equal(matchText('MILK', 'milk').tier, TIER.EXACT);
    assert.equal(matchText('creme fraiche', 'Crème fraîche').tier, TIER.EXACT);
    assert.equal(matchText('half and half', 'Half-and-half').tier, TIER.EXACT);
    assert.equal(matchText('  milk  ', 'Milk').tier, TIER.EXACT, 'query is trimmed');
  });

  test('2 name starts with query', () => {
    assert.deepEqual(matchText('mil', 'Milk'), { tier: TIER.PREFIX, quality: 0, ranges: [[0, 3]] });
    assert.equal(matchText('heavy cr', 'Heavy Cream').tier, TIER.PREFIX);
  });

  test('3 a word starts with query: rice -> Basmati Rice', () => {
    assert.deepEqual(matchText('rice', 'Basmati Rice'), {
      tier: TIER.WORD_PREFIX,
      quality: 0,
      ranges: [[8, 12]],
    });
    assert.equal(matchText('ice cr', 'Vanilla ice cream').tier, TIER.WORD_PREFIX);
    assert.equal(matchText('jerr', "Ben & Jerry's").tier, TIER.WORD_PREFIX);
  });

  test('4 every token is a word prefix, any order: cream hea -> Heavy Cream', () => {
    const m = matchText('cream hea', 'Heavy Cream');
    assert.equal(m.tier, TIER.TOKENS);
    assert.deepEqual(m.ranges, [[0, 3], [6, 11]]);
    assert.equal(matchText('pep bl', 'Black pepper').tier, TIER.TOKENS);
    assert.equal(matchText('cream cream', 'Heavy Cream'), null, 'each token needs its own word');
  });

  test('5 contiguous substring', () => {
    assert.deepEqual(matchText('ilk', 'Milk'), { tier: TIER.SUBSTRING, quality: 0, ranges: [[1, 4]] });
    assert.equal(matchText('il', 'Milk').tier, TIER.SUBSTRING, 'two characters are enough');
  });

  test('6 acronym / subsequence: gy -> Greek Yogurt, pmsn -> Parmesan', () => {
    const gy = matchText('gy', 'Greek Yogurt');
    assert.equal(gy.tier, TIER.SUBSEQUENCE);
    assert.deepEqual(gy.ranges, [[0, 1], [6, 7]]);
    const pmsn = matchText('pmsn', 'Parmesan');
    assert.equal(pmsn.tier, TIER.SUBSEQUENCE);
    assert.deepEqual(pmsn.ranges, [[0, 1], [3, 4], [5, 6], [7, 8]]);
    assert.equal(matchText('hvy crm', 'Heavy Cream').tier, TIER.SUBSEQUENCE);
  });

  test('6 subsequence must start at a word start', () => {
    assert.equal(matchText('lk', 'Milk')?.tier, TIER.SUBSTRING);
    assert.equal(matchText('ik', 'Mild kale'), null, 'no word starts with "i"');
    assert.equal(matchText('ie', 'Milk bread'), null, '"i" is mid-word');
  });

  test('6 prefers acronym-like alignments', () => {
    const acronym = matchText('gy', 'Greek Yogurt');
    const scattered = matchText('gy', 'Gravy');
    assert.equal(scattered.tier, TIER.SUBSEQUENCE);
    assert.ok(acronym.quality > scattered.quality);
    // Picks word starts over the first occurrence: "tt" -> T(ortilla) T(omatoes).
    assert.deepEqual(matchText('tt', 'Tortilla tomatoes').ranges, [[0, 1], [9, 10]]);
  });

  test('7 typo-tolerant word match: the SPEC examples', () => {
    assert.equal(matchText('parmesian', 'Parmesan').tier, TIER.TYPO);
    assert.equal(matchText('tomatoe', 'Tomato').tier, TIER.TYPO);
    assert.equal(matchText('mlik', 'Milk').tier, TIER.TYPO, 'transposition counts as one edit');
    assert.equal(matchText('heavy craem', 'Heavy Cream').tier, TIER.TYPO);
    assert.deepEqual(matchText('tomatoe', 'Tomato').ranges, [[0, 6]]);
    // A dropped letter is still a subsequence, which ranks better than a typo.
    assert.equal(matchText('brocoli', 'Broccoli').tier, TIER.SUBSEQUENCE);
  });

  test('7 typo budget: 1 edit for 4-7 chars, 2 for 8+, none below 4', () => {
    assert.equal(matchText('mulk', 'Milk').tier, TIER.TYPO, '4 chars, 1 edit');
    assert.equal(matchText('mul', 'Milk'), null, '3 chars never get typos');
    assert.equal(matchText('bonanus', 'Bananas'), null, '7 chars, 2 edits');
    assert.equal(matchText('strowbarry', 'Strawberry').tier, TIER.TYPO, '10 chars, 2 edits');
    assert.equal(matchText('strowbarru', 'Strawberry'), null, '10 chars, 3 edits');
    assert.equal(matchText('xqzw', 'Milk'), null);
  });

  test('7 the last token may be a typo of a word prefix (still typing)', () => {
    const m = matchText('strawv', 'Strawberries');
    assert.equal(m.tier, TIER.TYPO);
    assert.deepEqual(m.ranges, [[0, 6]]);
    assert.equal(matchText('bonana', 'Bananas').tier, TIER.TYPO);
    assert.equal(matchText('jam strawv', 'Strawberry jam').tier, TIER.TYPO);
    // Earlier tokens are finished words: no prefix typos for them.
    assert.equal(matchText('strawv jam', 'Strawberry jam'), null);
    assert.equal(matchText('broccolo beef', 'Broccoli beef').tier, TIER.TYPO);
    // 4-letter tokens are too ambiguous for prefix typos ("taco" is not "baco-n").
    assert.equal(matchText('taco', 'Bacon'), null);
    assert.equal(matchText('crea', 'Sourdough bread'), null);
  });

  test('empty, blank and punctuation-only queries match nothing', () => {
    assert.equal(matchText('', 'Milk'), null);
    assert.equal(matchText('   ', 'Milk'), null);
    assert.equal(matchText(',,', 'Milk'), null);
    assert.equal(matchText('milk', ''), null);
  });

  test('a single character only matches at word starts', () => {
    assert.equal(matchText('m', 'Milk').tier, TIER.PREFIX);
    assert.equal(matchText('m', 'Almond milk').tier, TIER.WORD_PREFIX);
    assert.equal(matchText('k', 'Milk'), null);
  });
});

describe('typoDistance', () => {
  test('optimal string alignment distance with a cap', () => {
    assert.deepEqual(typoDistance('milk', 'milk', 1), { dist: 0, len: 4 });
    assert.deepEqual(typoDistance('mlik', 'milk', 1), { dist: 1, len: 4 });
    assert.deepEqual(typoDistance('parmesian', 'parmesan', 2), { dist: 1, len: 8 });
    assert.equal(typoDistance('bonanus', 'bananas', 1), null);
    assert.equal(typoDistance('milk', 'milkshake', 1), null, 'length differs by more than k');
    assert.deepEqual(typoDistance('milk', 'milkshake', 1, true), { dist: 0, len: 4 });
    assert.deepEqual(typoDistance('brocol', 'broccoli', 1, true), { dist: 1, len: 7 });
  });
});

describe('search ranking', () => {
  test('SPEC examples come out on top of a realistic catalog', () => {
    assert.equal(top('cream hea', CATALOG), 'Heavy Cream');
    assert.equal(top('gy', CATALOG), 'Greek Yogurt');
    assert.equal(top('pmsn', CATALOG), 'Parmigiano Reggiano');
    assert.equal(top('parmesian', CATALOG), 'Parmigiano Reggiano');
    assert.equal(top('brocoli', CATALOG), 'Broccoli');
    assert.equal(top('tomatoe', items('Tomato', 'Tomato paste', 'Potatoes')), 'Tomato');
    assert.equal(top('creme', CATALOG), 'Crème fraîche');
    assert.equal(top('jalapeno', CATALOG), 'Jalapeño');
  });

  test('rice: name prefix, then word prefix, then substring', () => {
    const results = search('rice', CATALOG);
    assert.deepEqual(names(results.slice(0, 3)), ['Rice vinegar', 'Basmati Rice', 'Licorice']);
    assert.deepEqual(results.slice(0, 3).map((r) => r.tier), [TIER.PREFIX, TIER.WORD_PREFIX, TIER.SUBSTRING]);
    // Anything after that is a one-edit typo ("rice" -> "ice").
    assert.ok(results.slice(3).every((r) => r.tier === TIER.TYPO));
  });

  test('results are ordered by tier', () => {
    for (const query of ['m', 'mi', 'cr', 'cream', 'gy', 'tom', 'brocol', 'pa', 'ch']) {
      const tiers = search(query, CATALOG).map((r) => r.tier);
      assert.deepEqual(tiers, tiers.slice().sort((a, b) => a - b), query);
    }
  });

  test('tier beats usage', () => {
    const results = search('cream', items(['Ice cream sandwich', { use_count: 99 }], 'Cream cheese'));
    assert.deepEqual(names(results), ['Cream cheese', 'Ice cream sandwich']);
  });

  test('ties: use_count, then last_used, then shorter name, then alphabetical', () => {
    const tied = items(
      ['Mango', { use_count: 1, last_used: 100 }],
      ['Maple syrup', { use_count: 5, last_used: 1 }],
      ['Matcha', { use_count: 1, last_used: 900 }],
      ['Mayo', { use_count: 0 }],
      ['Malt', { use_count: 0 }],
      ['Marshmallows', { use_count: 0 }],
    );
    assert.deepEqual(names(search('ma', tied)), [
      'Maple syrup', // most used
      'Matcha', // same use_count as Mango, used more recently
      'Mango',
      'Malt', // unused: shorter first, then alphabetical
      'Mayo',
      'Marshmallows',
    ]);
  });

  test('typing milk letter by letter keeps Milk on top once plausible', () => {
    const catalog = items(
      ['Milk', { use_count: 3 }], ['Almond milk', { use_count: 9 }], 'Mint', 'Mozzarella',
      'Muffins', 'Lemons', 'Ham', 'Mild salsa', 'Millet',
    );
    for (const query of ['m', 'mi', 'mil', 'milk']) assert.equal(top(query, catalog), 'Milk', query);
    assert.equal(top('milk', catalog), 'Milk');
    assert.equal(search('milk', catalog)[1].item.name, 'Almond milk');
  });

  test('typing broccoli with a typo keeps Broccoli on top', () => {
    const catalog = items('Broccoli', 'Brown sugar', 'Brownies', 'Bread', 'Bacon');
    for (const query of ['broc', 'broco', 'brocol', 'brocoli', 'brocci', 'broccoli']) {
      assert.equal(top(query, catalog), 'Broccoli', query);
    }
  });

  test('short queries do not trigger typo or mid-word matches', () => {
    assert.deepEqual(names(search('k', CATALOG)), ['Salt'], 'only via the alias "Kosher salt"');
    assert.deepEqual(names(search('mul', items('Milk', 'Mule'))), ['Mule']);
    assert.ok(!names(search('mil', CATALOG)).includes('Mint'));
  });

  test('junk queries match nothing in a realistic catalog', () => {
    for (const junk of ['xqz', 'zzzz', 'qwerty', 'kjhg', 'xylophone', 'pfffft', '12345']) {
      assert.deepEqual(names(search(junk, CATALOG)), [], junk);
    }
  });

  test('limit, custom getters and non-item candidates', () => {
    assert.equal(search('a', CATALOG, { limit: 3 }).length, 3);
    assert.deepEqual(search('a', CATALOG, { limit: 0 }), []);
    const recipes = [{ id: 1, name: 'Tacos', ingredients: [] }, { id: 2, name: 'Stir Fry', ingredients: [] }];
    assert.deepEqual(names(search('sf', recipes)), ['Stir Fry']);
    const rows = [{ label: 'Dairy & Eggs' }, { label: 'Deli & Cheese' }];
    const byLabel = search('de', rows, { name: (r) => r.label, aliases: () => [] });
    assert.deepEqual(byLabel.map((r) => r.item.label), ['Deli & Cheese', 'Dairy & Eggs']);
    assert.deepEqual(search('x', [{ name: null }, {}]), []);
  });

  test('empty query returns no results', () => {
    assert.deepEqual(search('', CATALOG), []);
    assert.deepEqual(search('  ', CATALOG), []);
    assert.deepEqual(search(undefined, CATALOG), []);
  });
});

describe('aliases', () => {
  test('an alias match says which alias matched and highlights inside it', () => {
    const [r] = search('parmesan', CATALOG);
    assert.equal(r.item.name, 'Parmigiano Reggiano');
    assert.equal(r.tier, TIER.EXACT);
    assert.equal(r.field, 'alias');
    assert.equal(r.alias, 'Parmesan');
    assert.equal(r.text, 'Parmesan');
    assert.deepEqual(r.ranges, [[0, 8]]);
  });

  test('the best tier over name and aliases wins; one result per candidate', () => {
    const results = search('ice', CATALOG);
    const vanilla = results.filter((r) => r.item.name === 'Vanilla ice cream');
    assert.equal(vanilla.length, 1);
    assert.equal(vanilla[0].tier, TIER.PREFIX);
    assert.equal(vanilla[0].alias, 'Ice cream');
    assert.equal(top('evoo', CATALOG), 'Olive oil');
    assert.equal(top('coriander', CATALOG), 'Cilantro');
  });

  test('the name wins over an alias on the same tier', () => {
    const [r] = search('chee', items(['Cheese', { aliases: ['Cheese curds'] }]));
    assert.equal(r.field, 'name');
    assert.equal(r.alias, null);
    assert.equal(r.text, 'Cheese');
  });

  test('typos match aliases too, preferring the closer text', () => {
    const [r] = search('parmesian', CATALOG);
    assert.equal(r.alias, 'Parmesan');
    assert.equal(r.tier, TIER.TYPO);
  });
});

describe('match ranges and segments', () => {
  test('ranges index into the original text, diacritics included', () => {
    const [r] = search('creme', CATALOG);
    assert.equal(r.text, 'Crème fraîche');
    assert.deepEqual(r.ranges, [[0, 5]]);
    assert.deepEqual(matchText('fraiche', 'Crème fraîche').ranges, [[6, 13]]);
    // Decomposed input: the combining grave accent stays inside the highlight.
    assert.deepEqual(matchText('cre', 'Crème').ranges, [[0, 4]]);
    // Letters that expand when folded map back to the one original character.
    assert.deepEqual(matchText('weiss', 'Weißwurst').ranges, [[0, 4]]);
    assert.deepEqual(matchText('jerrys', "Ben & Jerry's").ranges, [[6, 13]]);
  });

  test('segments split text into plain and highlighted runs', () => {
    assert.deepEqual(segments('Basmati Rice', [[8, 12]]), [
      { text: 'Basmati ', match: false },
      { text: 'Rice', match: true },
    ]);
    assert.deepEqual(segments('Greek Yogurt', [[0, 1], [6, 7]]), [
      { text: 'G', match: true },
      { text: 'reek ', match: false },
      { text: 'Y', match: true },
      { text: 'ogurt', match: false },
    ]);
    assert.deepEqual(segments('Milk', []), [{ text: 'Milk', match: false }]);
    assert.deepEqual(segments('Milk', [[2, 4], [0, 2]]), [{ text: 'Milk', match: true }]);
    assert.deepEqual(segments('Milk', [[1, 3], [2, 9], [-4, 0]]), [
      { text: 'M', match: false },
      { text: 'ilk', match: true },
    ]);
    assert.deepEqual(segments('', [[0, 1]]), []);
    assert.deepEqual(segments('<b>&', [[0, 3]]), [
      { text: '<b>', match: true },
      { text: '&', match: false },
    ]);
  });

  test('every search result range is within its text', () => {
    for (const query of ['a', 'cr', 'pmsn', 'brocol', 'cream hea', 'jerrys', 'half and']) {
      for (const r of search(query, CATALOG)) {
        assert.ok(r.ranges.length > 0, `${query} -> ${r.text}`);
        for (const [a, b] of r.ranges) assert.ok(a >= 0 && b <= r.text.length && a < b);
      }
    }
  });
});

describe('performance', () => {
  test('2,000 items x 50 queries: under 5 ms per query on average', () => {
    // Deterministic pseudo-random catalog.
    let seed = 42;
    const rand = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const adjectives = ['Organic', 'Frozen', 'Smoked', 'Fresh', 'Whole', 'Low-fat', 'Spicy',
      'Sweet', 'Roasted', 'Wild', 'Baby', 'Sharp', 'Unsalted', 'Crème', 'Golden', 'Red', 'Green'];
    const nouns = ['milk', 'cheddar', 'salmon', 'spinach', 'almonds', 'bread', 'yogurt', 'peppers',
      'tomatoes', 'butter', 'coffee', 'rice', 'beans', 'broccoli', 'parmesan', 'tortillas',
      'chicken', 'apples', 'onions', 'garlic', 'pasta', 'cereal', 'cookies', 'juice', 'tea'];
    const big = [];
    for (let i = 0; i < 2000; i++) {
      const name = `${adjectives[rand(adjectives.length)]} ${nouns[rand(nouns.length)]} ${i}`;
      const aliases = i % 4 === 0 ? [`${nouns[rand(nouns.length)]} ${i}`] : [];
      big.push({ id: i, name, aliases, use_count: rand(20), last_used: rand(1000) });
    }
    const queries = ['m', 'mi', 'mil', 'milk', 'sm', 'smok', 'smoked salm', 'gy', 'pmsn',
      'parmesian', 'brocoli', 'tomatoe', 'cream hea', 'xqz', 'organic', 'org mil', 'frzn',
      'creme', 'baby spin', 'spinch', 'red pep', 'chedar', 'yougurt', 'alm', '12', '1999', 'tea',
      'ric', 'bns', 'garlik', 'onoins', 'golden apl', 'wild', 'sweet tea', 'cof', 'cofee',
      'juice', 'jucie', 'past', 'pasta 4', 'cerael', 'cooki', 'butte', 'unsalted butter',
      'low fat', 'lowfat', 'roasted pep', 'sharp ched', 'tortila', 'apples 7'];
    assert.equal(queries.length, 50);

    search('warm up', big); // fills the prepared-text cache and warms the JIT
    const t0 = performance.now();
    let total = 0;
    for (const q of queries) total += search(q, big, { limit: 10 }).length;
    const avg = (performance.now() - t0) / queries.length;
    assert.ok(total > 0);
    assert.ok(avg < 5, `average ${avg.toFixed(2)} ms per query`);
  });
});
