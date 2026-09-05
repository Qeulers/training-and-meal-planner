/*
 * Tab semantics for the segmented control (A11Y-01).
 *
 * It always carried role="tablist" / role="tab", but none of the behaviour
 * those roles promise: every tab was tabbable, arrows did nothing, and no tab
 * pointed at a panel.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Segmented, TabPanel } from '@/components/ui';

const OPTIONS = [
  { key: 'fuel', label: 'Fuel' },
  { key: 'recipes', label: 'Recipes' },
  { key: 'planner', label: 'Planner' },
  { key: 'shop', label: 'Shop' },
];

function setup(value = 'fuel') {
  const onChange = vi.fn();
  render(
    <>
      <Segmented
        options={OPTIONS}
        value={value}
        onChange={onChange}
        ariaLabel="Food section"
        panelId="food-panel"
      />
      <TabPanel id="food-panel" tabKey={value}>
        <p>panel content</p>
      </TabPanel>
    </>,
  );
  return { onChange };
}

describe('Segmented — roving tabindex', () => {
  it('puts exactly one tab in the tab order', () => {
    setup();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(tabs.filter((t) => t.getAttribute('tabindex') === '-1')).toHaveLength(3);
  });

  it('makes the selected tab the focusable one', () => {
    setup('planner');
    expect(screen.getByRole('tab', { name: 'Planner' })).toHaveAttribute('tabindex', '0');
  });

  it('reaches the group with a single Tab press', async () => {
    const user = userEvent.setup();
    setup();
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Fuel' })).toHaveFocus();
  });
});

describe('Segmented — arrow keys', () => {
  it('moves right', async () => {
    const user = userEvent.setup();
    const { onChange } = setup('fuel');
    screen.getByRole('tab', { name: 'Fuel' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('recipes');
  });

  it('moves left', async () => {
    const user = userEvent.setup();
    const { onChange } = setup('recipes');
    screen.getByRole('tab', { name: 'Recipes' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith('fuel');
  });

  it('wraps at both ends, as the tab pattern expects', async () => {
    const user = userEvent.setup();
    const first = setup('fuel');
    screen.getByRole('tab', { name: 'Fuel' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(first.onChange).toHaveBeenCalledWith('shop');
  });

  it('jumps to the ends with Home and End', async () => {
    const user = userEvent.setup();
    const { onChange } = setup('recipes');
    screen.getByRole('tab', { name: 'Recipes' }).focus();
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenCalledWith('fuel');
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenCalledWith('shop');
  });

  it('ignores other keys', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    screen.getByRole('tab', { name: 'Fuel' }).focus();
    await user.keyboard('{ArrowDown}a');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Segmented — the tab/panel relationship', () => {
  it('points each tab at the panel it controls', () => {
    setup();
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-controls', 'food-panel');
    }
  });

  it('labels the panel with its selected tab', () => {
    setup('shop');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'food-panel-tab-shop');
    expect(screen.getByRole('tab', { name: 'Shop' })).toHaveAttribute('id', 'food-panel-tab-shop');
  });

  it('marks exactly one tab selected', () => {
    setup('planner');
    const selected = screen.getAllByRole('tab').filter(
      (t) => t.getAttribute('aria-selected') === 'true',
    );
    expect(selected.map((t) => t.textContent)).toEqual(['Planner']);
  });

  it('names the group for assistive tech', () => {
    setup();
    expect(screen.getByRole('tablist')).toHaveAccessibleName('Food section');
  });
});
