import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';

import Field from './Field';

const { screen } = testingLibrary;

describe('Field - markdown', () => {
  // Cocloset: MarkdownField used to destructure only `content`/`components`, silently
  // dropping `className` - every `<Field data={markdown} className={...} />` call site
  // across the app rendered unstyled. Found 2026-09-14 via a real browser's computed
  // styles while chasing a report that a section's body copy didn't match its design.
  it('applies className to a wrapper around the rendered markdown', () => {
    render(
      <Field
        data={{ fieldType: 'markdown', content: 'Hello world!' }}
        className="my-class"
      />
    );

    const p = screen.getByText('Hello world!');
    expect(p.parentElement).toHaveClass('my-class');
  });

  it('renders markdown with no extra wrapper when no className is given', () => {
    const { container } = render(
      <Field data={{ fieldType: 'markdown', content: 'Hello world!' }} />
    );

    // No wrapping div: the render container's own child IS the <p>.
    const p = screen.getByText('Hello world!');
    expect(container.firstChild).toBe(p);
  });
});
