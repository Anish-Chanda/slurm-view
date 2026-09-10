/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EMPTY_FILTERS, JobsFilters } from '../../src/client/features/jobs/JobsFilters';

function renderFilters(onFiltersChange: jest.Mock = jest.fn()) {
  return {
    onFiltersChange,
    ...render(
      <JobsFilters
        filters={EMPTY_FILTERS}
        partitions={['nova', 'gpu']}
        partitionsUnavailable={false}
        partitionsStale={false}
        onPartitionsRetry={() => {}}
        onFiltersChange={onFiltersChange}
      />
    ),
  };
}

describe('JobsFilters', () => {
  test('selector defaults to Job ID like the old UI', () => {
    renderFilters();
    expect((screen.getByLabelText('Filter field') as HTMLSelectElement).value).toBe('id');
  });

  test('compound input disables and dims the field selector', async () => {
    renderFilters();
    const user = userEvent.setup();
    const select = screen.getByLabelText('Filter field') as HTMLSelectElement;
    const input = screen.getByLabelText('Filter value') as HTMLInputElement;

    expect(select.disabled).toBe(false);
    await user.type(input, 'user:alice partition:nova');
    await waitFor(() => expect(select.disabled).toBe(true));

    await user.clear(input);
    await waitFor(() => expect(select.disabled).toBe(false));
  });

  test('selector mode commits the chosen field on Enter', async () => {
    const { onFiltersChange } = renderFilters();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Filter field'), 'user');
    await user.type(screen.getByLabelText('Filter value'), 'alice');
    expect(onFiltersChange).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, user: 'alice' })
    );
  });

  test('accepting a suggestion edits the draft only; a second Enter commits', async () => {
    const { onFiltersChange } = renderFilters();
    const user = userEvent.setup();
    const input = screen.getByLabelText('Filter value') as HTMLInputElement;

    await user.selectOptions(screen.getByLabelText('Filter field'), 'state');
    await user.type(input, 'run');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    // Draft updated, nothing committed yet.
    await waitFor(() => expect(input.value).toBe('RUNNING'));
    expect(onFiltersChange).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, state: 'RUNNING' })
    );
  });

  test('Escape dismisses suggestions without committing', async () => {
    const { onFiltersChange } = renderFilters();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Filter value'), 'part');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onFiltersChange).not.toHaveBeenCalled();
  });

  test('Apply button label reflects compound vs single input', async () => {
    renderFilters();
    const user = userEvent.setup();

    expect(screen.getByRole('button', { name: 'Add Filter' })).toBeTruthy();
    await user.type(screen.getByLabelText('Filter value'), 'user:alice');
    expect(screen.getByRole('button', { name: 'Add Filters' })).toBeTruthy();
  });

  test('successfully committed input clears the draft', async () => {
    renderFilters();
    const user = userEvent.setup();
    const input = screen.getByLabelText('Filter value') as HTMLInputElement;

    await user.type(input, 'user:alice');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(input.value).toBe(''));
  });

  test('id: spelling disables the selector like jobid:', async () => {
    renderFilters();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Filter value'), 'id:12345');
    await waitFor(() =>
      expect((screen.getByLabelText('Filter field') as HTMLSelectElement).disabled).toBe(true)
    );
    expect(screen.getByRole('button', { name: 'Add Filters' })).toBeTruthy();
  });

  test('selector State normalizes lowercase input to canonical form', async () => {
    const { onFiltersChange } = renderFilters();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Filter field'), 'state');
    await user.type(screen.getByLabelText('Filter value'), 'running');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, state: 'RUNNING' })
    );
  });

  test('selector State rejects unknown values with a hint and commits nothing', async () => {
    const { onFiltersChange } = renderFilters();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Filter field'), 'state');
    await user.type(screen.getByLabelText('Filter value'), 'bananas');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(/Invalid State "bananas"/)).toBeTruthy());
    expect(onFiltersChange).not.toHaveBeenCalled();
  });

  test('compound state: values validate case-insensitively', async () => {
    const { onFiltersChange } = renderFilters();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Filter value'), 'state:pending');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, state: 'PENDING' })
    );
  });

  test('compound mode with an invalid state hints and commits nothing', async () => {
    const { onFiltersChange } = renderFilters();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Filter value'), 'user:alice state:bananas');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(/Invalid State "bananas"/)).toBeTruthy());
    expect(onFiltersChange).not.toHaveBeenCalled();
  });
});
