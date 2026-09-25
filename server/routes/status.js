import { Router } from 'express';
import {
  ARTIKELTYPEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, REGIONEN, PLATTFORMEN, MEDIENARTEN, SICHTBARKEITEN,
} from '../../shared/konstanten.js';

export function statusRouter({ igdb, barcode, preise, konfiguration, version }) {
  const router = Router();

  router.get('/status', (_req, res) => {
    res.json({
      status: 'ok',
      version,
      igdbKonfiguriert: igdb.konfiguriert,
      barcodeAnbieter: barcode.aktiveAnbieter,
      priceChartingAktiv: preise.aktiv,
      registrierungOffen: konfiguration.konten.registrierungOffen,
      zweiFaktorPflicht: konfiguration.konten.zweiFaktorPflicht,
      medienTeilenErlaubt: konfiguration.medienTeilenErlaubt,
      maxUploadMb: konfiguration.maxUploadMb,
      maxMedienMb: konfiguration.maxMedienMb,
    });
  });

  router.get('/meta', (_req, res) => {
    res.json({ ARTIKELTYPEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, REGIONEN, PLATTFORMEN, MEDIENARTEN, SICHTBARKEITEN });
  });

  return router;
}
