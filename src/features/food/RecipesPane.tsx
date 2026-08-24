import { useMemo, useState } from 'react';
import { Badge, Pill, Button, QueryBoundary } from '@/components/ui';
import { Icon } from '@/components/Icon';
import {
  useRecipes,
  useRecipeIngredients,
  useRecipeSteps,
  useCuisines,
  type Recipe,
  type RecipeIngredient,
  type RecipeStep,
} from '@/data/reference';
import { useBasket, useToggleBasket } from '@/data/user';

const MEAL_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'batch', label: 'Make-ahead' },
] as const;

const HEAT_ICONS = ['', '🌶', '🌶🌶', '🌶🌶🌶'];

/** Map our meal_type values to a readable label */
const MEAL_LABEL: Record<string, string> = {
  dinner: 'Dinner',
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  batch: 'Make-ahead',
  snack: 'Snack',
};

/** ---- Phone: expandable card (unchanged behaviour) ---- */
function RecipeCard({
  recipe,
  ingredients,
  steps,
  inBasket,
  onToggleBasket,
}: {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  inBasket: boolean;
  onToggleBasket: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-start gap-3 p-4">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex-1 text-left"
        >
          <span className="font-display text-data font-bold text-text">{recipe.name}</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {recipe.meal_type && (
              <Badge tone="food">{MEAL_LABEL[recipe.meal_type] ?? recipe.meal_type}</Badge>
            )}
            <Badge tone={recipe.diet_tag === 'veg' ? 'accent' : 'neutral'}>{recipe.diet_tag}</Badge>
            <Badge>{recipe.time_minutes} min</Badge>
            {recipe.heat_level > 0 && (
              <Badge tone="danger">{HEAT_ICONS[recipe.heat_level]}</Badge>
            )}
            {inBasket && (
              <span className="text-meta text-accent">In basket</span>
            )}
          </div>
        </button>
        <button
          onClick={onToggleBasket}
          aria-pressed={inBasket}
          title={inBasket ? 'In basket' : 'Add to basket'}
          className={`flex h-tap w-tap shrink-0 items-center justify-center rounded-md border transition-colors duration-fast ${
            inBasket
              ? 'border-accent bg-accent text-accent-ink'
              : 'border-border bg-surface text-text-muted hover:text-text'
          }`}
        >
          {inBasket ? (
            <Icon name="check_circle" size={18} fill label="In basket" />
          ) : (
            <Icon name="add" size={18} label="Add to basket" />
          )}
        </button>
      </div>

      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 text-body-sm">
          <RecipeDetail
            recipe={recipe}
            ingredients={ingredients}
            steps={steps}
            inBasket={inBasket}
            onToggleBasket={onToggleBasket}
          />
        </div>
      )}
    </div>
  );
}

/** ---- Shared detail body (used by both phone-expand and right pane) ---- */
function RecipeDetail({
  recipe,
  ingredients,
  steps,
  inBasket,
  onToggleBasket,
  onPlanForDay,
}: {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  inBasket: boolean;
  onToggleBasket: () => void;
  onPlanForDay?: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Header badges */}
      <div className="flex flex-wrap gap-1.5">
        {recipe.meal_type && (
          <Badge tone="food">{MEAL_LABEL[recipe.meal_type] ?? recipe.meal_type}</Badge>
        )}
        {recipe.cost_band && <Badge tone="accent">{recipe.cost_band}</Badge>}
        {recipe.heat_level > 0 && (
          <Badge tone="danger">Heat {HEAT_ICONS[recipe.heat_level]}</Badge>
        )}
        <Badge>{recipe.time_minutes} min</Badge>
        <Badge>Serves {recipe.serves}</Badge>
      </div>

      {/* Description */}
      {recipe.description && (
        <p className="text-body-sm text-text-muted">{recipe.description}</p>
      )}

      {/* Two-column ingredients / method */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 font-display text-label font-semibold uppercase tracking-label text-text-dim">
            Ingredients
          </h4>
          <ul className="space-y-1">
            {ingredients.map((i) => (
              <li key={i.id} className="flex justify-between gap-4 text-body-sm">
                <span className="text-text-muted">{i.ingredient_name}</span>
                <span className="shrink-0 text-text-dim">{i.quantity_text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-2 font-display text-label font-semibold uppercase tracking-label text-text-dim">
            Method
          </h4>
          <ol className="space-y-2 pl-0">
            {steps.map((s) => (
              <li key={s.step_no} className="flex gap-2 text-body-sm text-text-muted">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-meta font-bold text-text-dim">
                  {s.step_no}
                </span>
                <span>{s.instruction}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Spice note */}
      {recipe.spice_note && (
        <div className="rounded-md border border-border bg-surface-raised px-3 py-2 text-body-sm">
          <span className="font-semibold text-danger">Your bowl only — </span>
          <span className="text-text-muted">{recipe.spice_note}</span>
        </div>
      )}

      {/* Tip */}
      {recipe.tip && (
        <p className="text-body-sm text-text-muted">
          <span className="font-semibold text-accent">Tip: </span>
          {recipe.tip}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant={inBasket ? 'ghost' : 'primary'} onClick={onToggleBasket}>
          {inBasket ? 'Remove from basket' : 'Add to basket'}
        </Button>
        {onPlanForDay && (
          <Button variant="ghost" onClick={onPlanForDay}>
            Plan for a day
          </Button>
        )}
      </div>
    </div>
  );
}

/** ---- Left pane: recipe list row (lg+ only) ---- */
function RecipeRow({
  recipe,
  inBasket,
  selected,
  onSelect,
}: {
  recipe: Recipe;
  inBasket: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'w-full border-b border-border px-4 py-3 text-left transition-colors duration-fast',
        'hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        selected
          ? 'border-l-2 border-l-accent bg-surface-raised'
          : 'border-l-2 border-l-transparent',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-display text-body-sm font-bold text-text leading-tight">
          {recipe.name}
        </span>
        {inBasket && (
          <Icon
            name="check_circle"
            size={16}
            fill
            className="mt-0.5 shrink-0 text-accent"
            label="In basket"
          />
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {recipe.meal_type && (
          <span className="text-meta text-text-dim">
            {MEAL_LABEL[recipe.meal_type] ?? recipe.meal_type}
          </span>
        )}
        <span className="text-meta text-text-dim">·</span>
        <span className="text-meta text-text-dim">{recipe.diet_tag}</span>
        <span className="text-meta text-text-dim">·</span>
        <span className="text-meta text-text-dim">{recipe.time_minutes} min</span>
        {recipe.heat_level > 0 && (
          <>
            <span className="text-meta text-text-dim">·</span>
            <span className="text-meta">{HEAT_ICONS[recipe.heat_level]}</span>
          </>
        )}
        {inBasket && (
          <>
            <span className="text-meta text-text-dim">·</span>
            <span className="text-meta text-accent">in basket</span>
          </>
        )}
      </div>
    </button>
  );
}

export function RecipesPane() {
  const [meal, setMeal] = useState<(typeof MEAL_FILTERS)[number]['key']>('all');
  const [cuisine, setCuisine] = useState('all');

  const recipes = useRecipes();
  const ingredients = useRecipeIngredients();
  const steps = useRecipeSteps();
  const cuisines = useCuisines();
  const basket = useBasket();
  const toggleBasket = useToggleBasket();

  return (
    <QueryBoundary queries={[recipes, ingredients, steps, cuisines, basket]}>
      {([recipeList, ingList, stepList, cuisineList, basketList]) => (
        <RecipesInner
          recipes={recipeList}
          ingredients={ingList}
          steps={stepList}
          cuisines={cuisineList}
          basketSlugs={new Set(basketList.map((b) => b.recipe_slug))}
          onToggleBasket={(recipe_slug, inBasket) =>
            toggleBasket.mutate({ recipe_slug, inBasket })
          }
          meal={meal}
          setMeal={setMeal}
          cuisine={cuisine}
          setCuisine={setCuisine}
        />
      )}
    </QueryBoundary>
  );
}

function RecipesInner({
  recipes,
  ingredients,
  steps,
  cuisines,
  basketSlugs,
  onToggleBasket,
  meal,
  setMeal,
  cuisine,
  setCuisine,
}: {
  recipes: Recipe[];
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  cuisines: { code: string; label: string }[];
  basketSlugs: Set<string>;
  onToggleBasket: (slug: string, inBasket: boolean) => void;
  meal: string;
  setMeal: (m: (typeof MEAL_FILTERS)[number]['key']) => void;
  cuisine: string;
  setCuisine: (c: string) => void;
}) {
  const ingByRecipe = useMemo(() => {
    const m = new Map<string, RecipeIngredient[]>();
    for (const i of ingredients)
      (m.get(i.recipe_slug) ?? m.set(i.recipe_slug, []).get(i.recipe_slug)!).push(i);
    return m;
  }, [ingredients]);

  const stepsByRecipe = useMemo(() => {
    const m = new Map<string, RecipeStep[]>();
    for (const s of steps)
      (m.get(s.recipe_slug) ?? m.set(s.recipe_slug, []).get(s.recipe_slug)!).push(s);
    return m;
  }, [steps]);

  const shown = recipes.filter(
    (r) =>
      (meal === 'all' || r.meal_type === meal) &&
      (cuisine === 'all' || r.cuisine_code === cuisine),
  );

  // Desktop: selected recipe state (defaults to first in list)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const effectiveSelected = selectedSlug ?? shown[0]?.slug ?? null;
  const selectedRecipe = shown.find((r) => r.slug === effectiveSelected) ?? shown[0] ?? null;

  const filterBar = (
    <>
      {/* Meal filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {MEAL_FILTERS.map((f) => (
          <Pill
            key={f.key}
            active={meal === f.key}
            onClick={() => {
              setMeal(f.key);
              setSelectedSlug(null);
            }}
          >
            {f.label}
          </Pill>
        ))}
      </div>
      {/* Cuisine filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Pill
          active={cuisine === 'all'}
          onClick={() => {
            setCuisine('all');
            setSelectedSlug(null);
          }}
        >
          All
        </Pill>
        {cuisines.map((c) => (
          <Pill
            key={c.code}
            active={cuisine === c.code}
            onClick={() => {
              setCuisine(c.code);
              setSelectedSlug(null);
            }}
          >
            {c.label}
          </Pill>
        ))}
      </div>
    </>
  );

  return (
    <>
      {/* ---- Phone layout (below lg) ---- */}
      <div className="lg:hidden space-y-3">
        <div className="space-y-2 mb-4">{filterBar}</div>
        <p className="text-body-sm text-text-dim">{shown.length} recipes</p>
        {shown.map((r) => (
          <RecipeCard
            key={r.slug}
            recipe={r}
            ingredients={ingByRecipe.get(r.slug) ?? []}
            steps={stepsByRecipe.get(r.slug) ?? []}
            inBasket={basketSlugs.has(r.slug)}
            onToggleBasket={() => onToggleBasket(r.slug, basketSlugs.has(r.slug))}
          />
        ))}
      </div>

      {/* ---- Desktop two-pane layout (lg+) ---- */}
      <div className="hidden lg:flex lg:gap-0 lg:rounded-lg lg:border lg:border-border lg:bg-surface lg:overflow-hidden" style={{ minHeight: '70vh' }}>
        {/* Left pane: filter + recipe list */}
        <div className="flex w-72 shrink-0 flex-col border-r border-border xl:w-80">
          {/* Filter pills */}
          <div className="space-y-2 border-b border-border p-3">
            {filterBar}
          </div>
          {/* Recipe count */}
          <div className="px-4 py-2 text-meta text-text-dim border-b border-border">
            {shown.length} recipes
          </div>
          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto">
            {shown.map((r) => (
              <RecipeRow
                key={r.slug}
                recipe={r}
                inBasket={basketSlugs.has(r.slug)}
                selected={r.slug === effectiveSelected}
                onSelect={() => setSelectedSlug(r.slug)}
              />
            ))}
            {shown.length === 0 && (
              <p className="p-4 text-body-sm text-text-dim">No recipes match the current filter.</p>
            )}
          </div>
        </div>

        {/* Right pane: recipe detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedRecipe ? (
            <div className="p-6">
              {/* Recipe title */}
              <h2 className="mb-3 font-display text-[22px] font-bold leading-tight text-text">
                {selectedRecipe.name}
              </h2>
              <RecipeDetail
                recipe={selectedRecipe}
                ingredients={ingByRecipe.get(selectedRecipe.slug) ?? []}
                steps={stepsByRecipe.get(selectedRecipe.slug) ?? []}
                inBasket={basketSlugs.has(selectedRecipe.slug)}
                onToggleBasket={() =>
                  onToggleBasket(selectedRecipe.slug, basketSlugs.has(selectedRecipe.slug))
                }
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-body-sm text-text-dim">
              Select a recipe to see details.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
