import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { describe, expect, it } from 'vitest';
import { useRoleName } from '../use-role-name';

function RoleLabel({ name }: { name: Record<string, string> | null }) {
  const roleName = useRoleName();
  return <span>{roleName(name)}</span>;
}

describe('useRoleName', () => {
  it('translates a system role key', () => {
    renderWithProviders(<RoleLabel name={{ en: 'class_teacher' }} />);

    expect(screen.getByText('Class teacher')).toBeInTheDocument();
  });

  it('translates a system role key into Hindi', () => {
    renderWithProviders(<RoleLabel name={{ en: 'institute_admin' }} />, { locale: 'hi' });

    expect(screen.getByText('संस्थान व्यवस्थापक')).toBeInTheDocument();
  });

  it('shows a role the institute named itself as written, in the current language', () => {
    renderWithProviders(<RoleLabel name={{ en: 'Head of Science', hi: 'विज्ञान प्रमुख' }} />, {
      locale: 'hi',
    });

    expect(screen.getByText('विज्ञान प्रमुख')).toBeInTheDocument();
  });

  it('shows nothing for a missing name', () => {
    const { container } = renderWithProviders(<RoleLabel name={null} />);

    expect(container.textContent).toBe('');
  });
});
