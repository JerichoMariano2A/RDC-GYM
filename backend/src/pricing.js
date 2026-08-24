const TYPE_PRICES = {
  'Member - Per Session': 50,
  'Member - Monthly': 700,
  'Member - Yearly': 500,
  'Non-Member - Per Session': 70,
  'Non-Member - Student': 60,
  'Non-Member - Monthly': 1100,
  'Walk-in': 70,
  'CI': 0,
  'Member': 0,
}

function priceForType(type) {
  return TYPE_PRICES[type] ?? 0
}

function isMemberType(type) {
  const value = String(type || '')
  return value === 'Member' || (value.startsWith('Member') && !value.startsWith('Non-Member'))
}

function visitPrice(type) {
  if (type === 'Member - Monthly' || type === 'Member - Yearly' || type === 'Member') return 0
  return priceForType(type)
}

module.exports = { TYPE_PRICES, priceForType, isMemberType, visitPrice }
