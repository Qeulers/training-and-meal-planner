import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TabScaffold } from '@/components/TabScaffold';
import { Card, Eyebrow, Heading, Badge, Button, Chip, QueryBoundary } from '@/components/ui';
import { Icon } from '@/components/Icon';
import {
  usePhases,
  useSessionTemplates,
  useSessionItems,
  useSaunaTypes,
  useSaunaSchedule,
  useExercises,
  useRecipes,
} from '@/data/reference';
import {
  useRaces,
  useUserSettings,
  useWorkoutLogs,
  useSaunaLogs,
  useMealPlan,
  useAllSets,
} from '@/data/user';
import { formatDate, daysBetween } from '@/domain/dates';
import { phase, type PhaseOverride, type PhaseSlug } from '@/domain/phase';
import { sessionsFor, type SessionTemplate } from '@/domain/schedule';
import { saunaFor } from '@/domain/sauna';
import { WorkoutLogger } from './WorkoutLogger';
import { LogSaunaButton, AdHocSaunaLog } from './SaunaLog';

const HEAT_ICONS = ['', '🌶', '🌶🌶', '🌶🌶🌶'];

export function TodayPage() {
  const today = formatDate(new Date());
  const now = new Date();
  const longDate = now
    .toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    .toUpperCase();

  const phases = usePhases();
  const templates = useSessionTemplates();
  const items = useSessionItems();
  const saunaTypes = useSaunaTypes();
  const saunaSchedule = useSaunaSchedule();
  const exercises = useExercises();
  const races = useRaces();
  const settings = useUserSettings();
  const workoutLogs = useWorkoutLogs();
  const saunaLogs = useSaunaLogs();
  const recipes = useRecipes();
  const mealPlan = useMealPlan();
  const allSets = useAllSets();

  const [logging, setLogging] = useState<SessionTemplate | null>(null);

  return (
    <TabScaffold title="Today" hideTitle>
      <QueryBoundary
        queries={[
          phases,
          templates,
          items,
          saunaTypes,
          saunaSchedule,
          exercises,
          races,
          settings,
          workoutLogs,
          saunaLogs,
          recipes,
          mealPlan,
          allSets,
        ]}
      >
        {([
          phaseList,
          templateList,
          itemList,
          typeList,
          scheduleList,
          exerciseList,
          raceList,
          userSettings,
          logList,
          saunaLogList,
          recipeList,
          mealPlanList,
          setList,
        ]) => {
          const target = raceList.find((r) => r.is_target) ?? null;
          const raceDate = target?.race_date ?? null;
          const override: PhaseOverride | null =
            userSettings?.phase_override && userSettings.phase_override_from
              ? { phase: userSettings.phase_override as PhaseSlug, from: userSettings.phase_override_from }
              : null;

          const ph = phase(today, raceDate, override);
          const meta = phaseList.find((p) => p.slug === ph);
          const sessions = sessionsFor(today, { raceDate, templates: templateList, override });
          const slots = saunaFor(today, { raceDate, schedule: scheduleList, override });
          const typeBy = new Map(typeList.map((t) => [t.slug, t]));
          const countdown = raceDate ? daysBetween(today, raceDate) : null;

          // Tonight's planned dinner (glance into the meal plan; no new data).
          const tonightEntry = mealPlanList.find((e) => e.plan_date === today);
          const tonightRecipe = tonightEntry
            ? (recipeList.find((r) => r.slug === tonightEntry.recipe_slug) ?? null)
            : null;

          if (logging) {
            return (
              <WorkoutLogger
                session={logging}
                items={itemList.filter((i) => i.session_template_slug === logging.slug)}
                exercises={exerciseList}
                phaseSlug={ph}
                onClose={() => setLogging(null)}
              />
            );
          }

          return (
            <div className="space-y-6">
              {/* Hero: phase + date + countdown (SPEC §6.1) */}
              <header>
                <div className="flex items-center gap-2">
                  {meta && <Badge tone="accent">{meta.short_label}</Badge>}
                  {meta?.name && (
                    <span className="truncate text-body-sm text-text-muted">{meta.name}</span>
                  )}
                </div>
                <p className="mt-3 font-display text-label font-semibold uppercase tracking-label text-text-dim">
                  {longDate}
                </p>
                <div className="mt-1 flex items-baseline gap-3">
                  <span
                    className="font-body text-display-xl font-bold leading-none text-text"
                    aria-label={countdown === null ? 'no A race set' : `${countdown} days to race`}
                  >
                    {countdown === null ? '—' : countdown < 0 ? '✓' : countdown}
                  </span>
                  <span className="text-body-sm text-text-muted">
                    {countdown === null
                      ? 'no A race set'
                      : countdown < 0
                        ? `${target?.name} is done`
                        : `days to ${target?.name}`}
                  </span>
                </div>
                {!raceDate && (
                  <p className="mt-2 text-meta text-text-dim">
                    Add an A race in Plan to anchor the countdown and phase boundaries.
                  </p>
                )}
              </header>

              {/* Today's strength session */}
              {sessions.length === 0 ? (
                <div>
                  <Eyebrow bullet>Today's strength</Eyebrow>
                  <Card className="mt-1">
                    <p className="text-body-sm text-text-muted">
                      No strength session today — a running or rest day.
                    </p>
                  </Card>
                </div>
              ) : (
                sessions.map((s) => {
                  const todayLog = logList.find(
                    (l) => l.logged_on === today && l.session_key === s.session_key,
                  );
                  const doneToday = !!todayLog;
                  const recap = todayLog
                    ? setList.filter((st) => st.workout_log_id === todayLog.id)
                    : [];
                  const exs = itemList.filter((i) => i.session_template_slug === s.slug);
                  const chips = exs.slice(0, 4);
                  const moreCount = exs.length - chips.length;
                  return (
                    <Card key={s.slug}>
                      <Eyebrow bullet meta={`${s.duration_label} · ${exs.length} moves`}>
                        Today's strength
                      </Eyebrow>
                      <Heading className="mt-2 text-[26px]">{s.name}</Heading>
                      {s.brief && <p className="mt-2 text-body-sm text-text-muted">{s.brief}</p>}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {chips.map((i) => {
                          const name =
                            exerciseList.find((e) => e.slug === i.exercise_slug)?.name ??
                            i.exercise_slug;
                          return (
                            <Chip key={i.id}>
                              {name}
                              <span className="ml-1 text-text-dim">{i.prescription}</span>
                            </Chip>
                          );
                        })}
                        {moreCount > 0 && <Chip>+{moreCount} more</Chip>}
                      </div>
                      <div className="mt-4">
                        {doneToday ? (
                          <div>
                            <p className="flex items-center gap-1.5 text-body-sm font-bold text-success">
                              <Icon name="check_circle" size={18} fill /> Logged today
                            </p>
                            {recap.length > 0 && (
                              <ul className="mt-2 space-y-1 border-t border-border pt-2">
                                {exs.map((it) => {
                                  const name =
                                    exerciseList.find((e) => e.slug === it.exercise_slug)?.name ??
                                    it.exercise_slug;
                                  const exSets = recap
                                    .filter((st) => st.exercise_slug === it.exercise_slug)
                                    .sort((a, b) => a.set_no - b.set_no);
                                  if (!exSets.length) return null;
                                  const summary = exSets
                                    .map((st) => `${st.weight_kg}×${st.reps}`)
                                    .join(', ');
                                  return (
                                    <li
                                      key={it.id}
                                      className="flex items-baseline justify-between gap-3 text-body-sm"
                                    >
                                      <span className="min-w-0 truncate text-text">{name}</span>
                                      <span className="shrink-0 tabular-nums text-text-dim">
                                        {summary}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                            <button
                              type="button"
                              onClick={() => setLogging(s)}
                              className="mt-3 text-body-sm font-bold text-accent transition-opacity hover:opacity-70"
                            >
                              Log again
                            </button>
                          </div>
                        ) : (
                          <Button full onClick={() => setLogging(s)}>
                            Start session <Icon name="north_east" size={18} />
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })
              )}

              {/* Today's sauna */}
              {slots.length > 0 &&
                slots.map((slot) => {
                  const t = typeBy.get(slot.sauna_type_slug);
                  const doneToday = saunaLogList.some(
                    (l) => l.logged_on === today && l.sauna_type_slug === slot.sauna_type_slug,
                  );
                  return (
                    <Card key={slot.slot_key}>
                      <div className="flex items-start gap-3">
                        <Icon
                          name="local_fire_department"
                          size={26}
                          fill
                          className="mt-0.5 text-warning"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Heading>{t?.name}</Heading>
                            {slot.is_optional ? (
                              <Badge tone="warning">optional</Badge>
                            ) : (
                              <Badge tone="accent">planned</Badge>
                            )}
                          </div>
                          {t && (
                            <p className="mt-0.5 text-body-sm text-text-muted">
                              {t.duration_label} · {t.temp_label}
                              {slot.note ? ` · ${slot.note}` : ''}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-3">
                        <LogSaunaButton saunaTypeSlug={slot.sauna_type_slug} done={doneToday} />
                      </div>
                    </Card>
                  );
                })}

              {/* Ad-hoc sauna logging — always available, scheduled or not */}
              <div>
                {slots.length === 0 && (
                  <Eyebrow bullet className="mb-1">
                    Sauna
                  </Eyebrow>
                )}
                <AdHocSaunaLog types={typeList} />
              </div>

              {/* Tonight's dinner — links into Food */}
              {tonightRecipe && (
                <div>
                  <Eyebrow bullet className="mb-1">
                    Tonight
                  </Eyebrow>
                  <Link
                    to="/food"
                    className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong"
                  >
                    <Icon name="restaurant" size={22} className="shrink-0 text-food" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-body font-bold text-text">
                        {tonightRecipe.name}
                      </p>
                      <p className="text-meta text-text-dim">
                        {tonightRecipe.time_minutes} min · {tonightRecipe.diet_tag}
                        {tonightRecipe.heat_level > 0
                          ? ` ${HEAT_ICONS[tonightRecipe.heat_level]}`
                          : ''}
                      </p>
                    </div>
                    <Icon name="chevron_right" size={20} className="shrink-0 text-text-dim" />
                  </Link>
                </div>
              )}
            </div>
          );
        }}
      </QueryBoundary>
    </TabScaffold>
  );
}
