/*
 * Shopping-list aggregation — SPEC §7.4. This is the most-used feature and it
 * has regressed before; the algorithm is ported verbatim from legacy
 * `parseQty` / `combineQty` and covered by wide table-driven tests.
 *
 * Given basket recipes (plus optionally the week's planned dinners), produce one
 * row per distinct (ingredient_name, category_code), summing quantities where
 * units match. Rules preserved from the legacy app:
 *   - Combine like units (400 g + 200 g -> 600 g).
 *   - Keep unlike units separate, listed as "a + b".
 *   - Spoons are interchangeable: fold tsp into tbsp (1 tbsp + 2 tsp = 1.67 tbsp).
 *     (This is real legacy behaviour and differs from the SPEC §7.4 prose example,
 *     which the source-of-truth app overrides.)
 *   - Fractional quantities ("1/2") and compound units parse.
 *   - Unparseable quantities ("to taste") pass through as text via "a + b" join,
 *     never coerced to zero and never throwing.
 *   - Output grouped by ingredient_categories.sort_order, staples last per group.
 *
 * Always display `quantity_text`; the parsed value/unit are only for summing.
 */
import { pluralise, singular } from './pluralise';

export interface Ingredient {
  ingredient_name: string;
  quantity_text: string;
  category_code: string;
}

export interface RecipeWithIngredients {
  slug: string;
  name: string;
  ingredients: Ingredient[];
}

export interface Staple {
  ingredient_name: string;
  quantity_text: string;
  category_code: string;
}

export interface Category {
  code: string;
  label: string;
  sort_order: number;
}

export interface ShoppingItem {
  /**
   * Stable key matching `shopping_checks.item_key`: normalised
   * 'name|category_code' for recipe lines, prefixed 'staple:' for pantry
   * staples so the two never share a tick (SHOP-01).
   */
  item_key: string;
  ingredient_name: string;
  category_code: string;
  /** Combined, display-ready quantity string. */
  quantity_text: string;
  /** Recipe names this item came from (empty for staples). */
  from: string[];
  is_staple: boolean;
}

export interface ShoppingGroup {
  code: string;
  label: string;
  items: ShoppingItem[];
}

interface ParsedQty {
  n: number;
  unit: string;
}

/** Parse a quantity string to a number + singular unit, or null if unparseable. */
export function parseQty(q: string, exceptions: readonly string[]): ParsedQty | null {
  const m = String(q)
    .trim()
    .match(/^(\d+\/\d+|\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return null;
  let n: number;
  if (m[1].indexOf('/') !== -1) {
    const p = m[1].split('/');
    n = Number(p[0]) / Number(p[1]);
  } else {
    n = parseFloat(m[1]);
  }
  return { n, unit: singular((m[2] || '').trim().toLowerCase(), exceptions) };
}

/** Combine a list of quantity strings, summing matching units. */
export function combineQty(list: string[], exceptions: readonly string[]): string {
  const parsed = list.map((q) => parseQty(q, exceptions));
  // Any unparseable entry (e.g. "to taste") -> pass everything through as text.
  if (parsed.some((p) => !p)) return list.join(' + ');
  let items = parsed as ParsedQty[];

  // Spoons are interchangeable: fold tsp into tbsp so 1 tbsp + 2 tsp = 1.67 tbsp.
  const spoons = items.every((p) => p.unit === 'tsp' || p.unit === 'tbsp');
  if (spoons && !items.every((p) => p.unit === items[0].unit)) {
    items = items.map((p) => ({ n: p.unit === 'tsp' ? p.n / 3 : p.n, unit: 'tbsp' }));
  }

  const unit = items[0].unit;
  if (!items.every((p) => p.unit === unit)) return list.join(' + ');

  let total = items.reduce((a, p) => a + p.n, 0);
  total = Math.round(total * 100) / 100;
  return total + (unit ? ' ' + pluralise(unit, total, exceptions) : '');
}

/** Normalised key matching `shopping_checks.item_key` ('name|category_code'). */
export function itemKey(name: string, categoryCode: string): string {
  return name.toLowerCase() + '|' + categoryCode;
}

interface AggInput {
  recipes: RecipeWithIngredients[];
  staples?: Staple[];
  categories: Category[];
  exceptions: readonly string[];
}

/**
 * Aggregate basket recipes (and optional staples) into category-grouped rows.
 * Groups follow `categories` sort_order; within a group, recipe items sort
 * alphabetically and staples come last.
 */
export function aggregate({
  recipes,
  staples = [],
  categories,
  exceptions,
}: AggInput): ShoppingGroup[] {
  interface Acc {
    name: string;
    category_code: string;
    quantities: string[];
    from: string[];
    is_staple: boolean;
  }
  const acc = new Map<string, Acc>();
  // The map key IS the emitted item_key (SHOP-01): staples carry a 'staple:'
  // namespace so a recipe's eggs and the pantry staple eggs are separately
  // checkable. Re-deriving the key from name+category here would collapse them.

  for (const r of recipes) {
    for (const ing of r.ingredients) {
      const key = itemKey(ing.ingredient_name, ing.category_code);
      let entry = acc.get(key);
      if (!entry) {
        entry = {
          name: ing.ingredient_name,
          category_code: ing.category_code,
          quantities: [],
          from: [],
          is_staple: false,
        };
        acc.set(key, entry);
      }
      entry.quantities.push(ing.quantity_text);
      entry.from.push(r.name);
    }
  }

  // Staples are keyed separately so they never merge with a recipe line.
  for (const st of staples) {
    const key = 'staple:' + itemKey(st.ingredient_name, st.category_code);
    acc.set(key, {
      name: st.ingredient_name,
      category_code: st.category_code,
      quantities: [st.quantity_text],
      from: [],
      is_staple: true,
    });
  }

  const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order);

  return sortedCats
    .map((cat) => {
      const items: ShoppingItem[] = [...acc.entries()]
        .filter(([, e]) => e.category_code === cat.code)
        .sort(
          ([, a], [, b]) =>
            (a.is_staple ? 1 : 0) - (b.is_staple ? 1 : 0) || a.name.localeCompare(b.name),
        )
        .map(([key, e]) => ({
          item_key: key,
          ingredient_name: e.name,
          category_code: e.category_code,
          quantity_text: e.is_staple ? e.quantities[0] : combineQty(e.quantities, exceptions),
          from: e.from,
          is_staple: e.is_staple,
        }));
      return { code: cat.code, label: cat.label, items };
    })
    .filter((g) => g.items.length > 0);
}
