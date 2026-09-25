import { Router } from 'express';
import {
  ARTIKELTYPEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, REGIONEN, MEDIENARTEN, PRUEFSTATUS, ROLLEN, PREISARTEN, PREISQUELLEN,
} from '../../shared/konstanten.js';

export function statusRouter({ igdb, barcode, preise, affiliate, plattformen, ebay, konfiguration, version }) {
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
      oeffentlicherKatalog: konfiguration.oeffentlicherKatalog,
      affiliateAktiv: affiliate.aktiv,
      ebayAktiv: ebay.konfiguriert,
      maxUploadMb: konfiguration.maxUploadMb,
      maxMedienMb: konfiguration.maxMedienMb,
    });
  });

  router.get('/meta', (_req, res) => {
    res.json({
      ARTIKELTYPEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, REGIONEN, MEDIENARTEN, PRUEFSTATUS, ROLLEN, PREISARTEN, PREISQUELLEN,
      PLATTFORMEN: plattformen.alle(),
    });
  });

  return router;
}
