import { useState } from 'react';
import { Carousel } from './Carousel';
import { clubInfos, type ClubInfo } from './clubInfos';

// Au-delà, le texte est tronqué dans l’encart et se déplie avec « Voir plus ».
const SHORT = 220;

function InfoSlide({ info }: { info: ClubInfo }) {
  const [open, setOpen] = useState(false);
  const long = info.content.length > SHORT;
  return (
    <article className="club-info">
      {info.image && <img className="club-info-image" src={info.image.src} alt={info.image.alt} />}
      <div className="club-info-body">
        <h4>{info.title}</h4>
        <p
          id={`info-${info.id}`}
          className={long && !open ? 'club-info-text clamped' : 'club-info-text'}
        >
          {info.content}
        </p>
        {long && (
          <button
            type="button"
            className="admin-button"
            aria-expanded={open}
            aria-controls={`info-${info.id}`}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Voir moins' : 'Voir plus'}
          </button>
        )}
      </div>
    </article>
  );
}

/** Encart défilant des informations générales du club. */
export function ClubInfos({ infos = clubInfos }: { infos?: ClubInfo[] }) {
  if (!infos.length) return null;
  return (
    <section className="admin-card club-infos" aria-label="Informations du club">
      <h3>Informations du club</h3>
      <Carousel
        label="Informations"
        pausable={false}
        slides={infos.map((info) => (
          <InfoSlide key={info.id} info={info} />
        ))}
      />
    </section>
  );
}
