import { Navigate, useLocation } from 'react-router-dom';
import { Success } from '../components';

type Flow = 'activate' | 'reset-password';
const results: Record<Flow, { title: string; description: string }> = {
  activate: {
    title: 'Votre compte est activé.',
    description:
      'Vous pouvez maintenant vous connecter avec votre identifiant et votre mot de passe.',
  },
  'reset-password': {
    title: 'Votre mot de passe est modifié.',
    description:
      'Vous pouvez maintenant vous connecter avec votre nouveau mot de passe. Vos anciennes sessions ont été déconnectées.',
  },
};

export function AuthSuccessPage({ flow }: { flow: Flow }) {
  const { state } = useLocation();
  if (typeof state !== 'object' || state === null || state.authResult !== flow)
    return <Navigate to="/login" replace />;
  const result = results[flow];
  return (
    <Success title={result.title}>
      <p>{result.description}</p>
    </Success>
  );
}
