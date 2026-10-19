import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ClubMark } from '../auth/components';
import { useSession } from '../auth/session';

/**
 * Information des personnes (art. 13 RGPD). Les durées affichées doivent rester alignées
 * avec backend/app/services/privacy.py.
 */
export function PrivacyPage() {
  const { account, guest } = useSession();
  useEffect(() => {
    document.title = 'Confidentialité · LSO Colombes Volley';
  }, []);
  return (
    <main className="privacy-page">
      <header>
        <Link to={account || guest ? '/app' : '/login'} aria-label="Retour à l’espace club">
          <ClubMark compact />
        </Link>
        <Link to={account || guest ? '/app' : '/login'} className="privacy-back">
          {account || guest ? 'Retour à l’espace club' : 'Retour à la connexion'}
        </Link>
      </header>
      <article>
        <h1>Politique de confidentialité</h1>
        <p className="privacy-lead">
          Comment l’espace club du LSO Colombes Volley utilise vos données personnelles, et comment
          exercer vos droits.
        </p>

        <h2>Responsable du traitement</h2>
        <p>
          L’association LSO Colombes Volley, qui gère cet espace. Pour toute question ou pour
          exercer vos droits, écrivez aux administrateurs par la messagerie de l’application ou
          adressez-vous au bureau du club. L’association n’a pas désigné de délégué à la protection
          des données, ce qui n’est pas obligatoire pour son activité.
        </p>

        <h2>Données traitées</h2>
        <ul>
          <li>
            Identité : identifiant (numéro de licence), prénom, initiale du nom, catégorie et rôles
            dans le club.
          </li>
          <li>Vie sportive : équipes, statut de licence, inscriptions, événements suivis.</li>
          <li>Licence : le PDF de votre licence de la saison, déposé par un administrateur.</li>
          <li>
            Échanges : questions privées aux administrateurs, demandes de modification ou
            d’événement, notifications, historique des modifications que vous faites.
          </li>
          <li>Contact : adresse e-mail, facultative, utilisée seulement pour les notifications.</li>
          <li>
            Sécurité : mot de passe (stocké haché, jamais lisible), sessions de connexion et
            compteurs anti-abus calculés à partir d’une empreinte de l’adresse IP.
          </li>
        </ul>
        <p>
          Aucune date de naissance, adresse postale, numéro de téléphone ni donnée de santé n’est
          collectée.
        </p>

        <h2>Finalités et bases légales</h2>
        <ul>
          <li>
            Organiser la vie du club (planning, inscriptions, licences, messagerie) : exécution de
            votre adhésion (article 6.1.b du RGPD).
          </li>
          <li>
            Sécuriser l’application (sessions, limitation des tentatives de connexion) : intérêt
            légitime du club (article 6.1.f).
          </li>
          <li>
            Vous envoyer des e-mails de notification : votre choix, modifiable à tout moment dans
            votre profil (article 6.1.a).
          </li>
        </ul>

        <h2>Qui voit vos données</h2>
        <p>
          Les administrateurs du club. Les coachs voient, pour les équipes dont ils sont référents
          ou coachs, la fiche de compte des membres (prénom, initiale, catégorie, rôles, équipes)
          ainsi que le statut et le PDF de leur licence. Les autres adhérents ne voient que votre
          prénom lorsque vous êtes référent d’un événement. Les matchs FFVB proviennent des
          calendriers publics de la fédération. Les prestataires techniques du club (hébergement,
          stockage des PDF, envoi des e-mails) traitent les données pour son compte uniquement.
          Aucune donnée n’est vendue ni utilisée à des fins publicitaires.
        </p>

        <h2>Durées de conservation</h2>
        <ul>
          <li>Compte : effacé automatiquement après 2 ans sans connexion.</li>
          <li>Notifications lues : 6 mois ; notifications non lues : 2 ans.</li>
          <li>
            Messages privés, historique des modifications, demandes traitées et inscriptions : 2 ans
            après le dernier message, la décision ou l’événement.
          </li>
          <li>
            Sessions, liens d’invitation ou de réinitialisation : effacés à leur expiration. E-mails
            envoyés : retirés de la file d’envoi après 7 jours ; e-mails en échec : 30 jours après
            le dernier essai.
          </li>
          <li>
            Licences : leur statut repart de zéro chaque 1er août, les licences étant à refaire à
            chaque saison, et le PDF de la saison passée est supprimé. Votre numéro et votre compte
            sont conservés.
          </li>
        </ul>

        <h2>Cookies et stockage</h2>
        <p>
          Seuls deux cookies strictement nécessaires sont utilisés : <code>lsoc_session</code>{' '}
          (votre connexion) et <code>lsoc_csrf</code> (protection contre les requêtes frauduleuses).
          Le mode invité est mémorisé dans l’onglet du navigateur le temps de la visite. Il n’y a ni
          mesure d’audience, ni publicité, ni ressource externe : aucun consentement n’est donc
          demandé.
        </p>

        <h2>Vos droits</h2>
        <ul>
          <li>
            Accès et portabilité : <strong>Mon profil › Télécharger mes données</strong> fournit
            toutes vos données au format JSON.
          </li>
          <li>
            Rectification : vos préférences se modifient dans votre profil ; pour le reste,
            contactez un administrateur.
          </li>
          <li>
            Effacement : <strong>Mon profil › Supprimer mon compte</strong>, immédiatement et
            définitivement.
          </li>
          <li>Opposition et limitation : sur demande auprès des administrateurs.</li>
        </ul>
        <p>
          Pour un adhérent mineur, ces droits peuvent être exercés par ses représentants légaux. Si
          vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à
          la CNIL (cnil.fr).
        </p>

        <h2>Sécurité</h2>
        <p>
          Mots de passe hachés, cookies de session inaccessibles aux scripts, contenu des e-mails
          chiffré en base, accès réservé selon les rôles. Le PDF de licence est stocké sous un nom
          aléatoire de 64 caractères, impossible à deviner : seul ce lien, donné aux personnes
          autorisées, permet de l’ouvrir. Ne le transférez pas.
        </p>
      </article>
    </main>
  );
}
