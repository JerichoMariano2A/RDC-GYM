const TYPE_PRICES = {
  'Member - Session': 50,
  'Member - Monthly': 700,
  'Member - Yearly': 500,
  'Non-Member - Session': 70,
  'Non-Member - Student': 60,
  'Non-Member - Monthly': 1100,
  'Walk-in': 70,
  'CI': 0,
  'Member': 0,
}

const MEMBERSHIP_JOIN_FEE = 500

const COACHING_RATES = {
  daily: { regular: 249, student: 219 },
  monthly: { regular: 3499, student: 3199 },
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
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

function monthsBetween(fromISO, toISO) {
  const from = new Date(`${fromISO}T00:00:00`)
  const to = new Date(`${toISO}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 1
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  if (to.getDate() < from.getDate()) months -= 1
  return Math.max(1, months)
}

function normalizeCoaching(coaching) {
  const key = String(coaching || '').toLowerCase()
  return COACHING_RATES[key] ? key : 'none'
}

function computeQuote({ type, subscribedOn, expiresOn, coaching, isStudent, sessions, joinFee, typePrice, coachingRate, typeQuantity }) {
  const coachingKey = normalizeCoaching(coaching)
  const months = monthsBetween(subscribedOn, expiresOn)
  const membershipFee = round2(joinFee || 0)
  const multiplier = String(type || '').toLowerCase().includes('monthly') ? Math.max(1, Number(typeQuantity) || 1) : 1
  const membershipTypePrice = round2((typePrice != null ? Number(typePrice) : priceForType(type)) * multiplier)
  const defaultRate = coachingKey === 'none' ? 0 : (isStudent ? COACHING_RATES[coachingKey].student : COACHING_RATES[coachingKey].regular)
  const rate = coachingKey === 'none' ? 0 : (coachingRate != null ? Number(coachingRate) : defaultRate)
  const units = Math.max(1, Number(sessions) || 1)
  const coachingTotal = round2(rate * units)
  return {
    months,
    membershipFee,
    membershipTypePrice,
    membershipTypeMultiplier: multiplier,
    coachingType: coachingKey,
    coachingRate: rate,
    coachingUnits: units,
    coachingTotal,
    total: round2(membershipFee + membershipTypePrice + coachingTotal),
  }
}

function applyPaymentPlan(quote, plan) {
  if (plan === 'installment' && quote.coachingTotal > 0) {
    const amountDueNow = round2(quote.total - quote.coachingTotal + quote.coachingTotal / 2)
    return { plan: 'installment', amountDueNow, balance: round2(quote.total - amountDueNow) }
  }
  return { plan: 'full', amountDueNow: quote.total, balance: 0 }
}

module.exports = {
  TYPE_PRICES,
  MEMBERSHIP_JOIN_FEE,
  COACHING_RATES,
  round2,
  priceForType,
  isMemberType,
  visitPrice,
  monthsBetween,
  normalizeCoaching,
  computeQuote,
  applyPaymentPlan,
}
