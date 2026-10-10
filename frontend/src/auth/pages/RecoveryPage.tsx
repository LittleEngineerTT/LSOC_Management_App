import { BackLink, Heading } from '../components';

export function RecoveryPage() {
  return (
    <>
      <BackLink />
      <Heading
        eyebrow="ON VOUS AIDE À REVENIR"
        title="Mot de passe oublié ?"
        description="Contactez un administrateur du club pour obtenir un lien de réinitialisation."
      />
      <p className="form-footnote">
        L’administrateur vous transmet un lien personnel, valable une heure. Ouvrez-le pour choisir
        un nouveau mot de passe.
      </p>
    </>
  );
}
