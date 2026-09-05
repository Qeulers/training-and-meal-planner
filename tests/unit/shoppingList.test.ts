import { describe, it, expect } from 'vitest';
import {
  parseQty,
  combineQty,
  aggregate,
  itemKey,
  type Category,
  type RecipeWithIngredients,
} from '@/domain/shoppingList';
import { singular, pluralise } from '@/domain/pluralise';
import exceptionsJson from '../../data/pluralisation_exceptions.json';
import categoriesJson from '../../data/ingredient_categories.json';

const EX = exceptionsJson as string[];
const CATS = categoriesJson as Category[];

describe('parseQty', () => {
  const vectors: Array<[string, ReturnType<typeof parseQty>]> = [
    ['400 g', { n: 400, unit: 'g' }],
    ['3 cloves', { n: 3, unit: 'clove' }],
    ['1/2 lemon', { n: 0.5, unit: 'lemon' }],
    ['2.5 tbsp', { n: 2.5, unit: 'tbsp' }],
    ['1 bunch each', { n: 1, unit: 'bunch each' }],
    ['to taste', null],
    ['a pinch', null],
  ];
  it.each(vectors)('%s', (input, expected) => {
    expect(parseQty(input, EX)).toEqual(expected);
  });
});

describe('combineQty — SPEC §7.4', () => {
  const vectors: Array<[string[], string]> = [
    [['400 g', '200 g'], '600 g'], // like units sum
    [['3 cloves', '2 cloves'], '5 cloves'], // counted noun pluralises
    [['1 clove'], '1 clove'], // single stays singular
    [['1/2 lemon', '1/2 lemon'], '1 lemon'], // fractions sum
    [['1 tbsp', '2 tsp'], '1.67 tbsp'], // spoons interchangeable (legacy behaviour)
    [['2 tbsp', '1 tbsp'], '3 tbsp'],
    [['to taste', '1 tsp'], 'to taste + 1 tsp'], // unparseable passes through
    [['1 handful', '2 handfuls'], '3 handfuls'],
    [['200 g', '1 tin'], '200 g + 1 tin'], // unlike units listed separately
  ];
  it.each(vectors)('%j -> %s', (input, expected) => {
    expect(combineQty(input, EX)).toBe(expected);
  });
});

describe('pluralise / singular', () => {
  it('inflects counted nouns', () => {
    expect(pluralise('clove', 3, EX)).toBe('cloves');
    expect(pluralise('berry', 2, EX)).toBe('berries');
    expect(pluralise('box', 2, EX)).toBe('boxes');
    expect(pluralise('bunch each', 2, EX)).toBe('bunches each');
  });
  it('respects the exception list and singular counts', () => {
    expect(pluralise('g', 400, EX)).toBe('g');
    expect(pluralise('tbsp', 3, EX)).toBe('tbsp');
    expect(pluralise('clove', 1, EX)).toBe('clove');
  });
  it('singular folds back', () => {
    expect(singular('cloves', EX)).toBe('clove');
    expect(singular('berries', EX)).toBe('berry');
    expect(singular('g', EX)).toBe('g');
  });
});

describe('aggregate — SPEC §6.5 / §7.4', () => {
  const recipe = (slug: string, name: string, garlicQty: string): RecipeWithIngredients => ({
    slug,
    name,
    ingredients: [
      { ingredient_name: 'Garlic', quantity_text: garlicQty, category_code: 'F' },
      { ingredient_name: 'Tofu', quantity_text: '200 g', category_code: 'P' },
    ],
  });

  it('combines the same ingredient across recipes into one row', () => {
    const groups = aggregate({
      recipes: [
        recipe('a', 'Stir-fry', '2 cloves'),
        recipe('b', 'Curry', '3 cloves'),
        recipe('c', 'Dahl', '1 clove'),
      ],
      categories: CATS,
      exceptions: EX,
    });
    const fresh = groups.find((g) => g.code === 'F');
    expect(fresh?.label).toBe('Fresh aromatics & herbs');
    const garlic = fresh?.items.filter((i) => i.ingredient_name === 'Garlic');
    expect(garlic).toHaveLength(1);
    expect(garlic![0].quantity_text).toBe('6 cloves');
    expect(garlic![0].from).toEqual(['Stir-fry', 'Curry', 'Dahl']);
    expect(garlic![0].item_key).toBe(itemKey('Garlic', 'F'));
  });

  it('groups by ingredient_categories.sort_order (Protein before Fresh)', () => {
    const groups = aggregate({
      recipes: [recipe('a', 'Stir-fry', '2 cloves')],
      categories: CATS,
      exceptions: EX,
    });
    expect(groups.map((g) => g.code)).toEqual(['P', 'F']);
  });

  it('lists staples last within a group and never merges them with recipe lines', () => {
    const groups = aggregate({
      recipes: [recipe('a', 'Stir-fry', '2 cloves')],
      staples: [{ ingredient_name: 'Garlic', quantity_text: '1 bulb', category_code: 'F' }],
      categories: CATS,
      exceptions: EX,
    });
    const fresh = groups.find((g) => g.code === 'F')!;
    expect(fresh.items.map((i) => i.is_staple)).toEqual([false, true]);
    expect(fresh.items).toHaveLength(2); // recipe garlic + staple garlic, unmerged
  });

  // SHOP-01: the two rows above used to emit the SAME item_key, so ticking the
  // recipe garlic silently ticked the pantry staple too.
  it('gives a staple and its recipe twin distinct, namespaced item_keys', () => {
    const groups = aggregate({
      recipes: [recipe('a', 'Stir-fry', '2 cloves')],
      staples: [{ ingredient_name: 'Garlic', quantity_text: '1 bulb', category_code: 'F' }],
      categories: CATS,
      exceptions: EX,
    });
    const fresh = groups.find((g) => g.code === 'F')!;
    const [recipeRow, stapleRow] = fresh.items;

    expect(recipeRow.item_key).toBe(itemKey('Garlic', 'F'));
    expect(stapleRow.item_key).toBe('staple:' + itemKey('Garlic', 'F'));
    expect(new Set(fresh.items.map((i) => i.item_key)).size).toBe(fresh.items.length);
  });

  it('keeps every emitted item_key unique across the whole list', () => {
    const groups = aggregate({
      recipes: [recipe('a', 'Stir-fry', '2 cloves'), recipe('b', 'Curry', '1 clove')],
      staples: [
        { ingredient_name: 'Garlic', quantity_text: '1 bulb', category_code: 'F' },
        { ingredient_name: 'Eggs', quantity_text: '6', category_code: 'P' },
      ],
      categories: CATS,
      exceptions: EX,
    });
    const keys = groups.flatMap((g) => g.items.map((i) => i.item_key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('returns no empty category groups', () => {
    const groups = aggregate({
      recipes: [
        { slug: 'x', name: 'X', ingredients: [{ ingredient_name: 'Rice', quantity_text: '100 g', category_code: 'N' }] },
      ],
      categories: CATS,
      exceptions: EX,
    });
    expect(groups.map((g) => g.code)).toEqual(['N']);
  });
});
