/*
 * Recipe search (FOOD-01).
 *
 * Matches a recipe on its name OR any of its ingredient names, so "what can I
 * do with the aubergine in the fridge" is answerable — searching names alone
 * would not find it.
 *
 * Every term must match something (AND across terms, OR across fields), which
 * is what makes adding a word narrow the results rather than widen them.
 * Case- and accent-insensitive, because "purée" should be findable as "puree".
 */

/** Lower-case and strip diacritics so "purée" and "puree" match. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export interface SearchableRecipe {
  name: string;
  /** Ingredient names for this recipe. */
  ingredientNames: readonly string[];
}

/** True when every term in `query` appears in the name or an ingredient. */
export function matchesRecipeSearch(recipe: SearchableRecipe, query: string): boolean {
  const terms = normalise(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true; // an empty search matches everything

  const haystacks = [normalise(recipe.name), ...recipe.ingredientNames.map(normalise)];
  return terms.every((term) => haystacks.some((h) => h.includes(term)));
}
