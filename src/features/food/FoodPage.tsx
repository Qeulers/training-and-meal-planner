import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TabScaffold } from '@/components/TabScaffold';
import { Segmented } from '@/components/ui';
import { useBasket } from '@/data/user';
import { DayPicker } from './DayPicker';
import { FuelPane } from './FuelPane';
import { RecipesPane } from './RecipesPane';
import { PlannerPane } from './PlannerPane';
import { ShopPane } from './ShopPane';

const PANES = [
  { key: 'fuel', label: 'Fuel' },
  { key: 'recipes', label: 'Recipes' },
  { key: 'planner', label: 'Planner' },
  { key: 'shop', label: 'Shop' },
] as const;
type Pane = (typeof PANES)[number]['key'];

/**
 * Food segments live in ?pane= so the shopping list is linkable (SPEC §9), and
 * Recipes additionally keeps ?recipe= and ?q= so a single recipe can be
 * deep-linked from Today (FOOD-01).
 */
export function FoodPage() {
  const [params, setParams] = useSearchParams();
  const pane = (PANES.find((p) => p.key === params.get('pane'))?.key ?? 'fuel') as Pane;
  const basket = useBasket();
  const basketCount = basket.data?.length ?? 0;
  // Which recipe is being planned onto a day (null = picker closed).
  const [planning, setPlanning] = useState<string | null>(null);

  // Switching pane drops the recipe-specific params rather than carrying a
  // stale ?recipe= onto the shopping list.
  const goToPane = (key: Pane) => setParams({ pane: key });

  return (
    <TabScaffold title="Food" wide>
      {/* Top bar: segmented control + basket chip */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <Segmented
            options={PANES.map((p) => ({ key: p.key, label: p.label }))}
            value={pane}
            onChange={goToPane}
            ariaLabel="Food section"
          />
        </div>
        {basketCount > 0 && (
          <button
            onClick={() => goToPane('shop')}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-accent bg-accent px-3 py-1.5 font-display text-label font-semibold uppercase tracking-label text-accent-ink transition-opacity duration-fast hover:opacity-90"
            aria-label={`Basket: ${basketCount} recipe${basketCount !== 1 ? 's' : ''}`}
          >
            Basket
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-ink text-[10px] font-bold text-accent">
              {basketCount}
            </span>
          </button>
        )}
      </div>

      {pane === 'fuel' && (
        <div className="mx-auto max-w-content">
          <FuelPane />
        </div>
      )}
      {pane === 'recipes' && <RecipesPane onPlanForDay={setPlanning} />}
      {pane === 'planner' && (
        <div className="mx-auto max-w-content">
          <PlannerPane />
        </div>
      )}
      {pane === 'shop' && (
        <div className="mx-auto max-w-content">
          <ShopPane />
        </div>
      )}

      {/* Dinner-only day picker, wired from a recipe's "Plan for a day". */}
      {planning && (
        <DayPicker
          recipeSlug={planning}
          onClose={() => setPlanning(null)}
          onPlanned={() => {
            setPlanning(null);
            goToPane('planner');
          }}
        />
      )}
    </TabScaffold>
  );
}
