import { Router } from 'express';
import { ARTIKELTYPEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, REGIONEN, PLATTFORMEN } from '../../shared/konstanten.js';

export function statusRouter({ igdb, barcode, konfiguration, version }) {
  const router = Router();

  router.get('/status', (_req, res) => {
    res.json({
      status: 'ok',
      version,
      igdbKonfiguriert: igdb.konfiguriert,
      barcodeAnbieter: barcode.aktiveAnbieter,
      zugangsschutz: Boolean(konfiguration.auth.benutzer && konfiguration.auth.passwort),
      maxUploadMb: konfiguration.maxUploadMb,
    });
  });

  router.get('/meta', (_req, res) => {
    res.json({ ARTIKELTYPEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, REGIONEN, PLATTFORMEN });
  });

  return router;
}
