import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrudFeedback } from './CrudFeedback';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CrudFeedback', () => {
  it('shows a bottom success message with a five-second filling bar, then dismisses it', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<CrudFeedback message="Added Moon." tone="success" onDismiss={onDismiss} />);

    expect(screen.getByRole('status').textContent).toContain('Added Moon.');
    expect(screen.getByTestId('crud-feedback').getAttribute('style')).toContain('position: fixed');
    expect((screen.getByTestId('crud-feedback-progress') as HTMLDivElement).style.width).toBe('0%');
    expect((screen.getByTestId('crud-feedback-progress') as HTMLDivElement).style.transition).toBe('width 5000ms linear');

    act(() => vi.advanceTimersByTime(0));
    expect((screen.getByTestId('crud-feedback-progress') as HTMLDivElement).style.width).toBe('100%');
    act(() => vi.advanceTimersByTime(4999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('announces mutation errors as alerts', () => {
    render(<CrudFeedback message="Could not update Moon: invalid mass." tone="error" onDismiss={() => {}} />);
    expect(screen.getByRole('alert').textContent).toContain('invalid mass');
  });
});