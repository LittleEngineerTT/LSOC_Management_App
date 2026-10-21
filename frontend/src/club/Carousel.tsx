import { useEffect, useState, type ReactNode } from 'react';

/** Encart générique qui fait défiler des informations, une à la fois.
 *
 * Le défilement automatique (toutes les 5 secondes par défaut) s’arrête au survol, quand le
 * focus clavier est dans l’encart, ou avec le bouton pause ; précédent, suivant et les points
 * permettent de naviguer à la main.
 */
export function Carousel({
  label,
  slides,
  interval = 5000,
  pausable = true,
}: {
  label: string;
  slides: ReactNode[];
  /** Délai entre deux informations, en millisecondes. */
  interval?: number;
  /** Bouton « Mettre en pause » ; le survol et le focus suspendent toujours le défilement. */
  pausable?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Survol et focus séparés : un texte déplié au clic reste affiché quand la souris sort.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const count = slides.length;
  const current = count ? index % count : 0;
  useEffect(() => {
    if (count < 2 || paused || held) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % count), interval);
    return () => window.clearInterval(timer);
  }, [count, paused, held, interval]);
  if (!count) return null;
  const go = (next: number) => setIndex((next + count) % count);
  return (
    <div
      className="club-carousel"
      role="group"
      aria-roledescription="carrousel"
      aria-label={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div
        className="club-carousel-slide"
        role="group"
        aria-roledescription="diapositive"
        aria-label={`${current + 1} sur ${count}`}
        // Annoncé seulement quand l’utilisateur navigue : un défilement automatique resterait muet.
        aria-live={paused || held ? 'polite' : 'off'}
      >
        {slides[current]}
      </div>
      {count > 1 && (
        <div className="club-carousel-controls">
          <button
            type="button"
            className="admin-button"
            aria-label="Information précédente"
            onClick={() => go(current - 1)}
          >
            ‹
          </button>
          <span className="club-carousel-dots">
            {slides.map((_, position) => (
              <button
                key={position}
                type="button"
                className={`club-carousel-dot${position === current ? ' active' : ''}`}
                aria-label={`Information ${position + 1}`}
                aria-current={position === current ? 'true' : undefined}
                onClick={() => go(position)}
              />
            ))}
          </span>
          <button
            type="button"
            className="admin-button"
            aria-label="Information suivante"
            onClick={() => go(current + 1)}
          >
            ›
          </button>
          {pausable && (
            <button
              type="button"
              className="admin-button"
              aria-pressed={paused}
              onClick={() => setPaused(!paused)}
            >
              {paused ? 'Reprendre le défilement' : 'Mettre en pause'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
