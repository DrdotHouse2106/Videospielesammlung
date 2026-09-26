import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ladeAffiliateKonfiguration, domainErlaubt } from '../server/services/affiliate.js';
import { AFFILIATE_STANDARD } from '../server/affiliate-konfiguration.js';

test('Standard-Partner-IDs gelten nur auf freigegebenen Domains', () => {
  const vorher = structuredClone(AFFILIATE_STANDARD);
  try {
    Object.assign(AFFILIATE_STANDARD, { domains: ['sammlung.example.de'] });
    AFFILIATE_STANDARD.amazon.tag = 'projekt-21';
    AFFILIATE_STANDARD.ebay.campid = '5338000000';

    assert.equal(domainErlaubt('sammlung.example.de'), true);
    assert.equal(domainErlaubt('neu.sammlung.example.de'), true);
    assert.equal(domainErlaubt('fremde-sammlung.example.de'), false);

    const eigeneSeite = ladeAffiliateKonfiguration({ PUBLIC_URL: 'https://www.sammlung.example.de' });
    assert.equal(eigeneSeite.amazonTag, 'projekt-21');
    assert.equal(eigeneSeite.amazonQuelle, 'standard');
    assert.equal(eigeneSeite.ebayCampid, '5338000000');

    // Fremde Installation oder ohne PUBLIC_URL: keine fremden IDs
    for (const env of [{ PUBLIC_URL: 'https://andere-seite.de' }, {}]) {
      const k = ladeAffiliateKonfiguration(env);
      assert.equal(k.amazonTag, '');
      assert.equal(k.ebayCampid, '');
      assert.equal(k.amazonQuelle, 'keine');
    }

    // Eigene IDs des Betreibers haben immer Vorrang; leere Werte zählen als „nicht gesetzt“
    const eigen = ladeAffiliateKonfiguration({ PUBLIC_URL: 'https://andere-seite.de', AFFILIATE_AMAZON_TAG: 'betreiber-21', AFFILIATE_EBAY_CAMPID: '' });
    assert.equal(eigen.amazonTag, 'betreiber-21');
    assert.equal(eigen.amazonQuelle, 'eigen');
    assert.equal(eigen.ebayQuelle, 'keine');
    assert.equal(ladeAffiliateKonfiguration({ AFFILIATE_LINKS: 'false' }).aktiv, false);
  } finally {
    Object.assign(AFFILIATE_STANDARD, vorher);
  }
});
