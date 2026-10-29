import { Icon } from '../auth/components';

// Contenu de l’onglet, à mettre à jour à chaque saison.
const SEASON = '2024-2025';
const FEES = [
  { category: 'Vétérans / Loisirs', price: 160 },
  { category: 'M13 / M15 / M18', price: 200 },
  { category: 'Séniors / M21', price: 220 },
];
const PAYMENTS = [
  { method: 'Par chèque', detail: 'à l’ordre de LSOC Volley' },
  { method: 'Par virement bancaire', detail: 'sur notre HelloAsso' },
];
const STEPS = [
  'Créez votre compte sur myFFvolley, la plateforme de la fédération.',
  'Renseignez les informations demandées pour créer votre licence.',
  'Un doute ? Rapprochez-vous d’un encadrant : il vous guidera dans la marche à suivre.',
];

/** Onglet « Inscriptions » de Notre club : licence en ligne, cotisations et paiement. */
export function ClubRegistrationTab() {
  return (
    <article className="admin-card club-signup" aria-labelledby="club-signup-title">
      <header className="club-signup-intro">
        <span className="club-signup-season">Saison {SEASON}</span>
        <h3 id="club-signup-title">Inscription {SEASON}</h3>
        <p>
          Bienvenue sur la page d’inscription pour la nouvelle saison du club de volley ! Que vous
          soyez un ancien ou un nouveau joueur, voici toutes les informations nécessaires pour
          renouveler ou créer votre licence.
        </p>
      </header>

      <section className="club-signup-news" aria-labelledby="club-signup-news-title">
        <span className="club-signup-badge">Nouveauté</span>
        <h4 id="club-signup-news-title">Ça y est, le LSOC se modernise !</h4>
        <p>
          Nous vous proposons une manière plus simple et plus rapide de vous inscrire pour cette
          nouvelle saison : l’inscription se fait directement en ligne, sur la plateforme de la
          fédération, <strong>myFFvolley</strong>.
        </p>
        <ol className="club-signup-steps">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <div className="club-signup-grid">
        <section aria-labelledby="club-signup-fees-title">
          <h4 id="club-signup-fees-title">Cotisations</h4>
          <ul className="club-signup-fees">
            {FEES.map((fee) => (
              <li key={fee.category}>
                <span>{fee.category}</span>
                <strong>{fee.price} €</strong>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="club-signup-payment-title">
          <h4 id="club-signup-payment-title">Modalités de paiement</h4>
          <ul className="club-signup-payments">
            {PAYMENTS.map((payment) => (
              <li key={payment.method}>
                <Icon name="check" />
                <span>
                  <strong>{payment.method}</strong> {payment.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="club-signup-outro">
        <p>
          Nous sommes impatients de vous voir rejoindre ou continuer l’aventure au sein de notre
          club ! Pour toute question, n’hésitez pas à nous contacter.
        </p>
      </footer>
    </article>
  );
}
