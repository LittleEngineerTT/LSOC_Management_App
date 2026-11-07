import { useCallback, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { useLoad } from '../admin/data';
import { dateLabel } from '../admin/time';
import { Badge, Empty, LoadState, Notice, PanelHeading } from '../admin/ui';
import { CountBadge, useLiveReload, useUnread } from '../app/unread';
import { useClub } from './context';

/** Demande de contact reçue, vue par les administrateurs. */
export interface ContactRequest {
  id: string;
  email: string | null;
  phone: string | null;
  message: string;
  team_ids: string[];
  status: 'open' | 'resolved';
  handler_id: string | null;
  handler_name: string | null;
  handled_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

const MESSAGE_MAX = 4000;
// Même règle que l’API : chiffres, espaces, points, tirets, parenthèses et « + » initial.
const PHONE = /^\+?[0-9 .()-]{6,30}$/;

/** Application Contact : formulaire pour tous ; les administrateurs y suivent aussi les
 * demandes reçues, à prendre en charge puis à marquer comme résolues. */
export function ContactPage() {
  const { admin } = useClub();
  const [search, setSearch] = useSearchParams();
  const { contacts = 0 } = useUnread();
  const form = !admin || search.get('vue') === 'formulaire';
  return (
    <>
      <PanelHeading
        title="Contact"
        description={
          admin
            ? 'Demandes de contact reçues, à prendre en charge puis à marquer comme résolues, et formulaire de contact du club.'
            : 'Une question pour le club ? Laissez-nous un moyen de vous répondre, votre question et les équipes concernées.'
        }
      />
      {admin && (
        <div className="admin-subtabs" role="group" aria-label="Vue du contact">
          {(
            [
              ['', 'Demandes de contact'],
              ['formulaire', 'Formulaire'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`admin-button${(search.get('vue') ?? '') === id ? ' selected' : ''}`}
              aria-pressed={(search.get('vue') ?? '') === id}
              onClick={() => setSearch(id ? { vue: id } : {})}
            >
              {label}
              {!id && (
                <CountBadge
                  count={contacts}
                  label={['demande non résolue', 'demandes non résolues']}
                />
              )}
            </button>
          ))}
        </div>
      )}
      {form ? <ContactForm /> : <ContactRequests />}
    </>
  );
}

function ContactForm() {
  const { api, account, guest, sections, teams } = useClub();
  const [email, setEmail] = useState(guest ? '' : (account.email ?? ''));
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [invalid, setInvalid] = useState('');
  const [sent, setSent] = useState(false);
  const request = useRequest();
  // Équipes groupées par section, dans l’ordre des sections ; une section sans équipe disparaît.
  const groups = sections
    .map((section) => ({
      section,
      teams: teams
        .filter((team) => team.section_id === section.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((group) => group.teams.length > 0);

  function toggle(id: string) {
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmedPhone = phone.trim();
    if (!email.trim() && !trimmedPhone)
      return setInvalid('Indiquez une adresse e-mail ou un téléphone pour notre réponse.');
    if (trimmedPhone && (!PHONE.test(trimmedPhone) || trimmedPhone.replace(/\D/g, '').length < 6))
      return setInvalid('Le numéro de téléphone est invalide.');
    if (!chosen.size) return setInvalid('Choisissez au moins une équipe concernée.');
    if (!message.trim()) return setInvalid('Écrivez votre question.');
    setInvalid('');
    void request.run(async (signal) => {
      await api.request(
        '/contact',
        'POST',
        {
          email: email.trim() || null,
          phone: trimmedPhone || null,
          message: message.trim(),
          // Ordre des équipes tel qu’affiché.
          team_ids: groups.flatMap((group) =>
            group.teams.filter((team) => chosen.has(team.id)).map((team) => team.id),
          ),
        },
        signal,
      );
      setSent(true);
      setPhone('');
      setMessage('');
      setChosen(new Set());
    });
  }

  if (sent)
    return (
      <section className="admin-card club-contact-sent" aria-label="Demande envoyée">
        <Notice>Merci, votre demande a été envoyée. Le club vous répondra dès que possible.</Notice>
        <button type="button" className="admin-button" onClick={() => setSent(false)}>
          Envoyer une autre demande
        </button>
      </section>
    );
  return (
    <form className="admin-form club-contact" aria-label="Formulaire de contact" onSubmit={submit}>
      <h3>Nous contacter</h3>
      <fieldset className="admin-fields">
        <legend className="admin-hint club-contact-legend">
          Pour notre réponse : une adresse e-mail ou un téléphone, au moins.
        </legend>
        <div className="admin-field">
          <label htmlFor="contact-email">Adresse e-mail</label>
          <input
            id="contact-email"
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(change) => setEmail(change.target.value)}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="contact-phone">Téléphone</label>
          <input
            id="contact-phone"
            type="tel"
            autoComplete="tel"
            maxLength={30}
            value={phone}
            onChange={(change) => setPhone(change.target.value)}
          />
        </div>
      </fieldset>
      <fieldset className="club-contact-teams">
        <legend>Équipes concernées</legend>
        {!groups.length && <Empty>Aucune équipe n’est encore enregistrée.</Empty>}
        {groups.map((group) => (
          <div key={group.section.id} className="club-contact-section">
            <span className="club-contact-section-name">{group.section.name}</span>
            <div className="club-contact-choices">
              {group.teams.map((team) => (
                <label
                  key={team.id}
                  className={`club-contact-choice${chosen.has(team.id) ? ' selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={chosen.has(team.id)}
                    onChange={() => toggle(team.id)}
                  />
                  {team.name}
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>
      <div className="admin-field club-contact-message">
        <label htmlFor="contact-message">Votre question</label>
        <textarea
          id="contact-message"
          rows={6}
          maxLength={MESSAGE_MAX}
          value={message}
          onChange={(change) => setMessage(change.target.value)}
        />
        <span className="admin-hint">
          {message.length} / {MESSAGE_MAX} caractères
        </span>
      </div>
      <ErrorNotice message={invalid || request.error} />
      <div className="admin-actions">
        <button type="submit" className="admin-button primary" disabled={request.pending}>
          {request.pending ? 'Envoi…' : 'Envoyer'}
        </button>
      </div>
    </form>
  );
}

function ContactRequests() {
  const { api, account, teams } = useClub();
  const { refresh } = useUnread();
  const [openOnly, setOpenOnly] = useState(true);
  const [notice, setNotice] = useState('');
  const request = useRequest();
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.list<ContactRequest>(`/contact-requests${openOnly ? '?status=open' : ''}`, false, signal),
    [api, openOnly],
  );
  const result = useLoad(loader);
  useLiveReload(result.refresh);
  const items = result.data ?? [];
  const teamName = (id: string) => teams.find((team) => team.id === id)?.name ?? 'Équipe supprimée';

  function act(item: ContactRequest, action: 'take' | 'resolve' | 'reopen', done: string) {
    setNotice('');
    void request.run(async (signal) => {
      await api.request(`/contact-requests/${item.id}/${action}`, 'POST', {}, signal);
      setNotice(done);
      result.refresh();
      refresh();
    });
  }

  return (
    <section className="admin-card club-contact-requests" aria-label="Demandes de contact">
      <div className="admin-toolbar">
        <label className="club-contact-filter">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(change) => setOpenOnly(change.target.checked)}
          />
          Non résolues uniquement
        </label>
        <button type="button" className="admin-button" onClick={result.reload}>
          Actualiser
        </button>
      </div>
      {notice && <Notice>{notice}</Notice>}
      <ErrorNotice message={request.error} />
      <LoadState result={result} />
      {result.loaded && !result.error && !items.length && (
        <Empty>
          {openOnly ? 'Aucune demande de contact à traiter.' : 'Aucune demande de contact.'}
        </Empty>
      )}
      <ul className="club-plain-list club-contact-list">
        {items.map((item) => {
          const mine = item.handler_id === account.id;
          return (
            <li key={item.id} className={item.status}>
              <div className="club-contact-head">
                <span className="admin-hint">Reçue {dateLabel(item.created_at)}</span>
                <Badge tone={item.status === 'open' ? 'warning' : 'good'}>
                  {item.status === 'open' ? 'À traiter' : 'Résolue'}
                </Badge>
              </div>
              <div className="club-contact-teams-list">
                {item.team_ids.map((id) => (
                  <Badge key={id}>{teamName(id)}</Badge>
                ))}
              </div>
              <p className="club-contact-question">{item.message}</p>
              <p className="club-contact-reply">
                {item.email && <a href={`mailto:${item.email}`}>{item.email}</a>}
                {item.email && item.phone && ' · '}
                {item.phone && (
                  <a href={`tel:${item.phone.replace(/[^\d+]/g, '')}`}>{item.phone}</a>
                )}
              </p>
              <p className="club-contact-handler">
                {item.handler_name ? (
                  <>
                    Prise en charge par <strong>{mine ? 'vous' : item.handler_name}</strong>
                    {item.handled_at && ` · ${dateLabel(item.handled_at)}`}
                    {item.resolved_at && ` · résolue ${dateLabel(item.resolved_at)}`}
                  </>
                ) : (
                  'Pas encore prise en charge'
                )}
              </p>
              <div className="admin-actions">
                {item.status === 'open' && !mine && (
                  <button
                    type="button"
                    className="admin-button"
                    disabled={request.pending}
                    onClick={() => act(item, 'take', 'Demande prise en charge.')}
                  >
                    Prendre en charge
                  </button>
                )}
                {item.status === 'open' && (
                  <button
                    type="button"
                    className="admin-button primary"
                    disabled={request.pending}
                    onClick={() => act(item, 'resolve', 'Demande marquée comme résolue.')}
                  >
                    Marquer comme résolue
                  </button>
                )}
                {item.status === 'resolved' && (
                  <button
                    type="button"
                    className="admin-button"
                    disabled={request.pending}
                    onClick={() => act(item, 'reopen', 'Demande rouverte.')}
                  >
                    Rouvrir
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
