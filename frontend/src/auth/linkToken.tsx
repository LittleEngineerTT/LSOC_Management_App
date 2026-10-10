import { Link, useSearchParams } from 'react-router-dom';
import { BackLink, Heading, Icon } from './components';

export function LinkMissing({ invitation = false }: { invitation?: boolean }) {
  return (
    <>
      <Heading
        eyebrow="LIEN D’ACCÈS"
        title="Ce lien est incomplet."
        description="Ouvrez le lien complet transmis par votre administrateur."
      />
      {invitation ? (
        <p className="form-footnote">
          Demandez à l’administrateur du club un nouveau lien d’invitation.
        </p>
      ) : (
        <Link className="button primary" to="/forgot-password">
          Demander un nouveau lien
          <Icon name="arrow" />
        </Link>
      )}
      <BackLink />
    </>
  );
}

export function useLinkToken() {
  const [search] = useSearchParams();
  const token = search.get('token') ?? '';
  return {
    token,
    valid: token.length >= 20 && token.length <= 200,
  };
}
