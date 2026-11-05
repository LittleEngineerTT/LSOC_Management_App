import { useEffect, useId, useMemo } from 'react';
import { Icon } from '../auth/components';

/** Formats et taille acceptés par l’API pour la photo d’un entraîneur. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Message d’erreur d’une photo refusée avant l’envoi, sinon null. */
export function photoError(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return 'La photo doit être une image JPEG, PNG ou WebP.';
  if (file.size > MAX_PHOTO_BYTES) return 'La photo dépasse 5 Mo.';
  return null;
}

/** Adresse locale d’aperçu d’un fichier choisi, libérée quand il change. */
export function usePreview(file: File | null): string | null {
  // Absent de certains environnements (tests) : pas d’aperçu.
  const url = useMemo(
    () => (file && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

/** Aperçu de la photo et bouton de choix d’un fichier image. */
export function CoachPhotoPicker({
  label,
  preview,
  disabled = false,
  onPick,
}: {
  label: string;
  /** Adresse de la photo actuelle ou choisie ; vide : emplacement vide. */
  preview?: string | null;
  disabled?: boolean;
  onPick: (file: File) => void;
}) {
  const hint = useId();
  return (
    <div className="coach-photo">
      {preview ? (
        <img className="coach-photo-preview" src={preview} alt="Aperçu de la photo" />
      ) : (
        <div className="coach-photo-preview empty" aria-hidden="true">
          <Icon name="camera" />
        </div>
      )}
      <div>
        <label className={`admin-button admin-file${disabled ? ' disabled' : ''}`}>
          {label}
          <input
            type="file"
            accept={PHOTO_TYPES.join(',')}
            disabled={disabled}
            aria-describedby={hint}
            onChange={(change) => {
              const file = change.target.files?.[0];
              change.target.value = '';
              if (file) onPick(file);
            }}
          />
        </label>
        <p className="admin-hint" id={hint}>
          Facultative. JPEG, PNG ou WebP, 5 Mo au plus. Elle est présentée à tous, invités compris,
          dans les dirigeants de Notre club.
        </p>
      </div>
    </div>
  );
}
