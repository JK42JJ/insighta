import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DomainPicker } from '@/features/morning-cards/DomainPicker';

describe('DomainPicker', () => {
  it('renders three options and reports the selected key', () => {
    const onChange = vi.fn();
    render(<DomainPicker value="work_practice" onChange={onChange} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    fireEvent.click(screen.getByText('AI 도구'));
    expect(onChange).toHaveBeenCalledWith('ai_tools');
    expect(screen.getByText('업무 실무').getAttribute('aria-selected')).toBe('true');
  });
});
