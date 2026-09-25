import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bereinigeProduktname, normalisiereBarcode, barcodeVarianten } from '../server/services/titel.js';

test('Händler-Produktnamen werden zu Suchbegriffen bereinigt', () => {
  assert.equal(bereinigeProduktname('Super Mario Odyssey - [Nintendo Switch] USK 6'), 'Super Mario Odyssey');
  assert.equal(bereinigeProduktname('FIFA 23 - PS4 - Standard Edition'), 'FIFA 23');
  assert.equal(bereinigeProduktname('The Legend of Zelda: Breath of the Wild (Nintendo Switch)'), 'The Legend of Zelda: Breath of the Wild');
  assert.equal(bereinigeProduktname('Gran Turismo 7 PS5 USK 0'), 'Gran Turismo 7');
});

test('Barcodes werden normalisiert und geprüft', () => {
  assert.equal(normalisiereBarcode('4 005209 101123'), '4005209101123');
  assert.equal(normalisiereBarcode('12345'), null);
  assert.deepEqual(barcodeVarianten('045496590420'), ['045496590420', '0045496590420']);
});
