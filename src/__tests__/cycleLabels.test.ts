import { essentialsCycleLabel } from '@/utils/cycleLabels';

describe('essentialsCycleLabel — fallback behaviour', () => {
  it('returns the essentials_label when set', () => {
    expect(
      essentialsCycleLabel({ cycle_name: 'Breakfast', essentials_label: 'Morning' }),
    ).toBe('Morning');
  });

  it('falls back to cycle_name when essentials_label is null', () => {
    expect(
      essentialsCycleLabel({ cycle_name: 'Breakfast', essentials_label: null }),
    ).toBe('Breakfast');
  });

  it('falls back to cycle_name when essentials_label is undefined', () => {
    expect(
      essentialsCycleLabel({ cycle_name: 'Lunch', essentials_label: undefined as unknown as null }),
    ).toBe('Lunch');
  });

  it('falls back to cycle_name when essentials_label is empty string', () => {
    expect(
      essentialsCycleLabel({ cycle_name: 'Snacks', essentials_label: '' }),
    ).toBe('Snacks');
  });

  it('falls back to cycle_name when essentials_label is whitespace only', () => {
    expect(
      essentialsCycleLabel({ cycle_name: 'Dinner', essentials_label: '   ' }),
    ).toBe('Dinner');
  });

  it('uses essentials_label even with surrounding whitespace (trimmed value preserved)', () => {
    // Note: the label returned is the trimmed-content from .trim() check, but the
    // function returns the trimmed value via the conditional — actually it returns
    // the *original* trimmed string for the truthiness check, then returns the
    // trimmed copy. Behavior: 'Morning'.
    expect(
      essentialsCycleLabel({ cycle_name: 'Breakfast', essentials_label: '  Morning  ' }),
    ).toBe('Morning');
  });
});
