import { Link } from 'react-router-dom';
import { release as current, type Release, type ReleaseNote } from './releaseNotes';

const groups: { kind: ReleaseNote['kind']; title: string }[] = [
  { kind: 'feature', title: 'Nouveautés' },
  { kind: 'fix', title: 'Correctifs' },
];

/** Encart « Quoi de neuf ? » de l’accueil : nouveautés et correctifs de la dernière version. */
export function ReleaseNotes({ release = current }: { release?: Release }) {
  if (!release.notes.length) return null;
  return (
    <section className="admin-card club-release" aria-labelledby="club-release-title">
      <h3 id="club-release-title">Quoi de neuf ?</h3>
      <p className="admin-hint">
        Version {release.version} · depuis la version {release.previous}
      </p>
      {groups.map((group) => {
        const notes = release.notes.filter((note) => note.kind === group.kind);
        return (
          notes.length > 0 && (
            <section key={group.kind} className="club-release-group" aria-label={group.title}>
              <h4>{group.title}</h4>
              <ul className="club-release-list">
                {notes.map((note) => (
                  <li key={note.title}>
                    {note.text ? <strong>{note.title}</strong> : note.title}
                    {note.text && <> : {note.text}</>}
                    {note.link && (
                      <>
                        {' '}
                        <Link to={note.link.to}>{note.link.label}</Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        );
      })}
    </section>
  );
}
