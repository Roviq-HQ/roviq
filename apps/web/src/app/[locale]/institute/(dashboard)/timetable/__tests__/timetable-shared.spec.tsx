import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { useTranslations } from 'next-intl';
import { describe, expect, it } from 'vitest';
import enTimetable from '../../../../../../../messages/en/timetable.json';
import hiTimetable from '../../../../../../../messages/hi/timetable.json';
import { mapError } from '../timetable-shared';

function Message({ err }: { err: unknown }) {
  const t = useTranslations('timetable');
  return <p>{mapError(err, t)}</p>;
}

const withCode = (code: string) =>
  new CombinedGraphQLErrors({ errors: [{ message: 'raw server text', extensions: { code } }] });

describe('mapError', () => {
  it('shows the translated copy for a timetable code', () => {
    renderWithProviders(<Message err={withCode('TIMETABLE_TEACHER_CONFLICT')} />);
    expect(screen.getByText(enTimetable.errors.TIMETABLE_TEACHER_CONFLICT)).toBeInTheDocument();
  });

  it('shows the generic copy, never the server text, for an unknown code', () => {
    renderWithProviders(<Message err={withCode('SOMETHING_NEW')} />);
    expect(screen.getByText(enTimetable.errors.generic)).toBeInTheDocument();
    expect(screen.queryByText('raw server text')).not.toBeInTheDocument();
  });

  it.each([
    'TIMETABLE_SECTION_DUPLICATE',
    'TIMETABLE_PERIOD_LABEL_DUPLICATE',
    'TIMETABLE_DAY_OVERRIDE_DUPLICATE',
  ] as const)('shows the translated copy for a repeated value, %s (ROV-358)', (code) => {
    renderWithProviders(<Message err={withCode(code)} />);
    expect(screen.getByText(enTimetable.errors[code])).toBeInTheDocument();
    expect(screen.queryByText('raw server text')).not.toBeInTheDocument();
  });

  it('shows the copy for a repeated period label in Hindi (ROV-358)', () => {
    renderWithProviders(<Message err={withCode('TIMETABLE_PERIOD_LABEL_DUPLICATE')} />, {
      locale: 'hi',
    });
    expect(
      screen.getByText(hiTimetable.errors.TIMETABLE_PERIOD_LABEL_DUPLICATE),
    ).toBeInTheDocument();
  });
});
