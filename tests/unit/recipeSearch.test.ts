import { describe, it, expect } from 'vitest';
import { matchesRecipeSearch } from '@/domain/recipeSearch';

const dahl = {
  name: 'Tarka dahl with spinach',
  ingredientNames: ['Red lentils', 'Spinach', 'Garlic', 'Cumin seeds'],
};

describe('matchesRecipeSearch (FOOD-01)', () => {
  it('matches everything on an empty or blank query', () => {
    expect(matchesRecipeSearch(dahl, '')).toBe(true);
    expect(matchesRecipeSearch(dahl, '   ')).toBe(true);
  });

  it('matches on the recipe name', () => {
    expect(matchesRecipeSearch(dahl, 'dahl')).toBe(true);
    expect(matchesRecipeSearch(dahl, 'tarka')).toBe(true);
  });

  it('matches on an ingredient — the point of the feature', () => {
    // "what can I do with the spinach in the fridge"
    expect(matchesRecipeSearch(dahl, 'lentils')).toBe(true);
    expect(matchesRecipeSearch(dahl, 'cumin')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesRecipeSearch(dahl, 'DAHL')).toBe(true);
    expect(matchesRecipeSearch(dahl, 'GaRliC')).toBe(true);
  });

  it('ignores accents in both directions', () => {
    const puree = { name: 'Tomato purée pasta', ingredientNames: ['Tomato purée'] };
    expect(matchesRecipeSearch(puree, 'puree')).toBe(true);
    expect(matchesRecipeSearch(dahl, 'gárlic')).toBe(true);
  });

  it('matches partial words', () => {
    expect(matchesRecipeSearch(dahl, 'spin')).toBe(true);
  });

  it('requires every term to match something, so extra words narrow', () => {
    expect(matchesRecipeSearch(dahl, 'dahl spinach')).toBe(true);
    expect(matchesRecipeSearch(dahl, 'dahl chicken')).toBe(false);
  });

  it('lets terms match across different fields', () => {
    // "dahl" is in the name, "garlic" only in the ingredients.
    expect(matchesRecipeSearch(dahl, 'dahl garlic')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesRecipeSearch(dahl, 'salmon')).toBe(false);
  });

  it('tolerates a recipe with no ingredients listed', () => {
    expect(matchesRecipeSearch({ name: 'Toast', ingredientNames: [] }, 'toast')).toBe(true);
    expect(matchesRecipeSearch({ name: 'Toast', ingredientNames: [] }, 'butter')).toBe(false);
  });

  it('collapses repeated whitespace between terms', () => {
    expect(matchesRecipeSearch(dahl, '  dahl    spinach  ')).toBe(true);
  });
});
