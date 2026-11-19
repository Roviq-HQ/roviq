import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { StoredImage } from '../stored-image';

const FILE = {
  url: 'https://files.example/a/md.webp',
  width: 512,
  height: 384,
  placeholder: 'data:image/webp;base64,AAAA',
};

describe('StoredImage', () => {
  it('should show the image with its description', () => {
    render(<StoredImage file={FILE} alt="Asha Verma" />);

    expect(screen.getByRole('img', { name: 'Asha Verma' })).toHaveAttribute('src', FILE.url);
  });

  it('should reserve the image shape and show the blurred preview behind it', () => {
    render(<StoredImage file={FILE} alt="Asha Verma" testId="photo" />);

    const box = screen.getByTestId('photo');
    expect(box.style.aspectRatio).toBe('512 / 384');
    expect(box.style.backgroundImage).toContain(FILE.placeholder);
  });

  it('should show the fallback when there is no image', () => {
    render(<StoredImage file={null} alt="Asha Verma" fallback={<span>AV</span>} />);

    expect(screen.getByText('AV')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('should show the fallback when the file has no link', () => {
    render(
      <StoredImage file={{ ...FILE, url: null }} alt="Asha Verma" fallback={<span>AV</span>} />,
    );

    expect(screen.getByText('AV')).toBeInTheDocument();
  });

  it('should switch to the fallback when the image fails to load', () => {
    render(<StoredImage file={FILE} alt="Asha Verma" fallback={<span>AV</span>} />);

    fireEvent.error(screen.getByRole('img', { name: 'Asha Verma' }));

    expect(screen.getByText('AV')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
