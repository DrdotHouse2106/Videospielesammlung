import { PRUEFSTATUS, beschriftung } from '../../../shared/konstanten.js';

const FARBEN = {
  privat: 'text-leise',
  eingereicht: 'text-warnung',
  freigegeben: 'text-erfolg',
  abgelehnt: 'text-gefahr',
};

export default function StatusAbzeichen({ status, className = '' }) {
  if (!status) return null;
  return (
    <span className={`abzeichen ${FARBEN[status] ?? ''} ${className}`} title={PRUEFSTATUS.find((s) => s.value === status)?.beschreibung}>
      {beschriftung(PRUEFSTATUS, status)}
    </span>
  );
}
