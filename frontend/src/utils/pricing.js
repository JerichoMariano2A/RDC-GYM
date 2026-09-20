export const TYPE_PRICES = {
  'Member - Session': 50,
  'Member - Monthly': 700,
  'Member - Yearly': 500,
  'Non-Member - Session': 70,
  'Non-Member - Student': 60,
  'Non-Member - Monthly': 1100,
}

export const DEFAULT_TYPE_PRICES = { ...TYPE_PRICES }

export const MEMBERSHIP_JOIN_FEE = 500

export const COACHING_RATES = {
  daily: { regular: 249, student: 219 },
  monthly: { regular: 3499, student: 3199 },
}

export const DEFAULT_COACHING_RATES = JSON.parse(JSON.stringify(COACHING_RATES))

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function priceForType(type) {
  return TYPE_PRICES[type] ?? 0
}

export function toISODate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addMonthsISO(isoDate, months) {
  const date = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return isoDate
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + Math.max(1, Number(months) || 1))
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDay))
  return toISODate(date)
}

export function monthsBetween(fromISO, toISO) {
  const from = new Date(`${fromISO}T00:00:00`)
  const to = new Date(`${toISO}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 1
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  if (to.getDate() < from.getDate()) months -= 1
  return Math.max(1, months)
}

export function normalizeCoaching(coaching) {
  const key = String(coaching || '').toLowerCase()
  return COACHING_RATES[key] ? key : 'none'
}

export function computeQuote({ type, subscribedOn, expiresOn, coaching, isStudent, sessions, joinFee, typePrice, coachingRate, typeQuantity }) {
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

export function applyPaymentPlan(quote, plan) {
  if (plan === 'installment' && quote.coachingTotal > 0) {
    const amountDueNow = round2(quote.total - quote.coachingTotal + quote.coachingTotal / 2)
    return { plan: 'installment', amountDueNow, balance: round2(quote.total - amountDueNow) }
  }
  return { plan: 'full', amountDueNow: quote.total, balance: 0 }
}

export function membershipLineLabel(type, quote, isMember = true) {
  const base = String(type || '').replace(/^Member - |^Non-Member - /, '')
  const label = `${base} ${isMember ? 'Membership' : 'Visit'}`
  return quote.membershipTypeMultiplier > 1 ? `${label} × ${quote.months} month${quote.months === 1 ? '' : 's'}` : label
}

export function coachingLineLabel(quote) {
  if (quote.coachingType === 'daily') {
    return `Daily Coaching × ${quote.coachingUnits} session${quote.coachingUnits === 1 ? '' : 's'}`
  }
  if (quote.coachingType === 'monthly') {
    return `Monthly Coaching × ${quote.coachingUnits} month${quote.coachingUnits === 1 ? '' : 's'}`
  }
  return 'Coaching'
}
