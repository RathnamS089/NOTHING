// Catalog of Nothing / CMF audio products. Order matters: most specific first.
// `features` drives which controls the companion window shows.

const NOTHING_OUIS = ['2C:BE:EE']; // Nothing Technology Ltd. MAC prefix

const MODELS = [
  { id: 'ear-1', match: /ear\s*\(1\)/i, name: 'Ear (1)', brand: 'nothing', features: { anc: true, ancLevels: ['light', 'max'], eq: true } },
  { id: 'ear-2', match: /ear\s*\(2\)/i, name: 'Ear (2)', brand: 'nothing', features: { anc: true, ancLevels: ['high', 'mid', 'low', 'adaptive'], eq: true, lowLag: true, dual: true } },
  { id: 'ear-3', match: /ear\s*\(3\)/i, name: 'Ear (3)', brand: 'nothing', features: { anc: true, ancLevels: ['high', 'mid', 'low', 'adaptive'], eq: true, lowLag: true, dual: true, bass: true } },
  { id: 'ear-stick', match: /ear\s*\(stick\)/i, name: 'Ear (stick)', brand: 'nothing', features: { anc: false, eq: true, lowLag: true } },
  { id: 'ear-open', match: /ear\s*\(open\)/i, name: 'Ear (open)', brand: 'nothing', features: { anc: false, eq: true, lowLag: true, dual: true } },
  { id: 'ear-a', match: /ear\s*\(a\)/i, name: 'Ear (a)', brand: 'nothing', features: { anc: true, ancLevels: ['high', 'mid', 'low', 'adaptive'], eq: true, lowLag: true, dual: true, bass: true } },
  { id: 'ear', match: /^(nothing\s+)?ear$/i, name: 'Ear', brand: 'nothing', features: { anc: true, ancLevels: ['high', 'mid', 'low', 'adaptive'], eq: true, lowLag: true, dual: true, bass: true } },
  { id: 'headphone-1', match: /headphone\s*\(1\)/i, name: 'Headphone (1)', brand: 'nothing', kind: 'headphone', features: { anc: true, ancLevels: ['high', 'mid', 'low', 'adaptive'], eq: true, lowLag: true, dual: true, bass: true } },
  { id: 'cmf-buds-2a', match: /cmf\s*buds\s*2a/i, name: 'Buds 2a', brand: 'cmf', features: { anc: true, ancLevels: ['high', 'mid', 'low'], eq: true, lowLag: true, dual: true, bass: true } },
  { id: 'cmf-buds-2-plus', match: /cmf\s*buds\s*2\s*plus/i, name: 'Buds 2 Plus', brand: 'cmf', features: { anc: true, ancLevels: ['high', 'mid', 'low', 'adaptive'], eq: true, lowLag: true, dual: true, bass: true } },
  { id: 'cmf-buds-2', match: /cmf\s*buds\s*2\b/i, name: 'Buds 2', brand: 'cmf', features: { anc: true, ancLevels: ['high', 'mid', 'low', 'adaptive'], eq: true, lowLag: true, dual: true, bass: true } },
  { id: 'cmf-buds-pro-2', match: /cmf\s*buds\s*pro\s*2/i, name: 'Buds Pro 2', brand: 'cmf', features: { anc: true, ancLevels: ['high', 'mid', 'low', 'adaptive'], eq: true, lowLag: true, dual: true, bass: true } },
  { id: 'cmf-buds-pro', match: /cmf\s*buds\s*pro/i, name: 'Buds Pro', brand: 'cmf', features: { anc: true, ancLevels: ['max', 'mid', 'low'], eq: true, lowLag: true, bass: true } },
  { id: 'cmf-buds', match: /cmf\s*buds/i, name: 'Buds', brand: 'cmf', features: { anc: true, ancLevels: ['high', 'mid', 'low'], eq: true, lowLag: true, bass: true } },
  { id: 'cmf-neckband', match: /cmf\s*neckband/i, name: 'Neckband Pro', brand: 'cmf', kind: 'neckband', features: { anc: true, ancLevels: ['high', 'mid', 'low'], eq: true, lowLag: true, bass: true } },
];

const GENERIC_NOTHING = { id: 'nothing-generic', name: 'Nothing audio', brand: 'nothing', features: { anc: true, ancLevels: ['high', 'mid', 'low'], eq: true, lowLag: true } };
const GENERIC_CMF = { ...GENERIC_NOTHING, id: 'cmf-generic', name: 'CMF audio', brand: 'cmf' };

const NAME_HINT = /\b(nothing|cmf)\b|^ear\s*(\(|$)|^headphone\s*\(/i;

function normaliseAddress(addr = '') {
  const hex = addr.replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.length === 12 ? hex.match(/../g).join(':') : addr.toUpperCase();
}

function isNothingDevice(name = '', address = '') {
  const addr = normaliseAddress(address);
  return NAME_HINT.test(name.trim()) || NOTHING_OUIS.some((oui) => addr.startsWith(oui));
}

function identify(name = '') {
  const clean = name.trim();
  const model = MODELS.find((m) => m.match.test(clean));
  if (model) return model;
  return /cmf/i.test(clean) ? GENERIC_CMF : GENERIC_NOTHING;
}

module.exports = { isNothingDevice, identify, normaliseAddress, MODELS };
