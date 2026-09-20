import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

function money(value) {
  return Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function buildSalesPdf(sales, range) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 42

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('RDC GYM', marginX, 48)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'normal')
  doc.text('POS Sales Report', marginX, 66)
  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text(`Period: ${range.from} to ${range.to}`, marginX, 82)
  doc.text(`Generated: ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}`, marginX, 96)

  doc.setDrawColor(201, 42, 42)
  doc.setLineWidth(2)
  doc.line(marginX, 106, pageWidth - marginX, 106)

  autoTable(doc, {
    startY: 122,
    theme: 'plain',
    styles: { fontSize: 11, cellPadding: 3 },
    body: [
      ['Visit Income', `PHP ${money(sales.visitTotal)}`],
      ['Membership Income', `PHP ${money(sales.membershipTotal)}`],
      ['TOTAL SALES', `PHP ${money(sales.totalSales)}`],
    ],
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 180 },
      1: { halign: 'right' },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.row.index === 2) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.textColor = [201, 42, 42]
        data.cell.styles.fontSize = 12
      }
    },
    margin: { left: marginX, right: marginX },
  })

  let cursor = (doc.lastAutoTable?.finalY || 160) + 28

  autoTable(doc, {
    startY: cursor,
    head: [['Visit sales by type', 'Paid Visits', 'Amount']],
    body: (sales.clientSales || []).map(row => [row.type, String(row.visits), `PHP ${money(row.total)}`]),
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [201, 42, 42], textColor: 255 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    margin: { left: marginX, right: marginX },
  })

  cursor = (doc.lastAutoTable?.finalY || cursor) + 22
  autoTable(doc, {
    startY: cursor,
    head: [['Membership sales by plan', 'Subscriptions', 'Amount']],
    body: (sales.membershipSales || []).map(row => [row.type, String(row.count), `PHP ${money(row.total)}`]),
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [31, 41, 55], textColor: 255 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    margin: { left: marginX, right: marginX },
  })

  cursor = (doc.lastAutoTable?.finalY || cursor) + 22
  autoTable(doc, {
    startY: cursor,
    head: [['Date', 'Source', 'Type', 'Qty', 'Amount']],
    body: (sales.dailyBreakdown || []).map(row => [
      typeof row.sale_date === 'string' ? row.sale_date.slice(0, 10) : row.sale_date,
      row.source,
      row.type,
      String(row.qty),
      `PHP ${money(row.total)}`,
    ]),
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 4 },
    headStyles: { fillColor: [75, 85, 99], textColor: 255 },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: marginX, right: marginX },
  })

  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(130)
    doc.text(`RDC GYM POS Sales Report - ${range.from} to ${range.to}`, marginX, doc.internal.pageSize.getHeight() - 24)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - marginX, doc.internal.pageSize.getHeight() - 24, { align: 'right' })
  }

  return doc
}

const TAB_TITLES = {
  overview: 'Sales Overview',
  'membership-sales': 'Membership Sales',
  attendance: 'Attendance Summary',
  'peak-hours': 'Peak Gym Hours',
  'membership-status': 'Membership Status',
  'staff-activity': 'Staff Activity',
  transactions: 'Recent Transactions',
}

export function buildTabPdf(tabKey, data, range) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 42
  const title = TAB_TITLES[tabKey] || 'Report'

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('RDC GYM', marginX, 48)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'normal')
  doc.text(title, marginX, 66)
  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text(`Period: ${range.from} to ${range.to}`, marginX, 82)
  doc.text(`Generated: ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}`, marginX, 96)

  doc.setDrawColor(201, 42, 42)
  doc.setLineWidth(2)
  doc.line(marginX, 106, pageWidth - marginX, 106)

  let cursor = 128

  const keyValue = rows => {
    autoTable(doc, {
      startY: cursor,
      theme: 'plain',
      styles: { fontSize: 11, cellPadding: 3 },
      body: rows,
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 180 },
        1: { halign: 'right' },
      },
      margin: { left: marginX, right: marginX },
    })
    cursor = (doc.lastAutoTable?.finalY || cursor) + 16
  }

  const summaryTable = (head, body) => {
    autoTable(doc, {
      startY: cursor,
      head,
      body: body.length ? body : [[{ content: 'No data for this period.', colSpan: head[0].length }]],
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [201, 42, 42], textColor: 255 },
      margin: { left: marginX, right: marginX },
    })
    cursor = (doc.lastAutoTable?.finalY || cursor) + 16
  }

  if (tabKey === 'overview') {
    const s = data?.summary || {}
    keyValue([
      ["Today's Revenue", `PHP ${money(s.todayRevenue)}`],
      ['Total Revenue', `PHP ${money(s.totalRevenue)}`],
      ["Today's Transactions", String(s.todayTransactions || 0)],
      ['Total Transactions', String(s.totalTransactions || 0)],
      ['Active Members', String(s.activeMembers || 0)],
      ["Today's Check-Ins", String(s.todayCheckIns || 0)],
      ["Today's Check-Outs", String(s.todayCheckOuts || 0)],
      ['Currently Inside', String(s.currentlyInside || 0)],
    ])
  }

  if (tabKey === 'membership-sales') {
    const items = data?.membershipSales?.items || []
    const mostSold = items.length ? items.reduce((a, b) => Number(a.count) > Number(b.count) ? a : b) : null
    const highest = items.length ? items.reduce((a, b) => Number(a.revenue) > Number(b.revenue) ? a : b) : null
    keyValue([
      ['Most Sold', mostSold ? `${mostSold.type} (${mostSold.count})` : 'N/A'],
      ['Highest Revenue', highest ? `PHP ${money(highest.revenue)}` : 'N/A'],
    ])
    summaryTable(
      [['Membership Type', 'Number Sold', 'Revenue', '% of Sales']],
      items.map(row => [row.type, String(row.count), `PHP ${money(row.revenue)}`, `${row.percentage}%`])
    )
  }

  if (tabKey === 'attendance') {
    const a = data?.attendance || {}
    keyValue([
      ['Total Check-Ins', String(a.totalCheckIns || 0)],
      ['Total Check-Outs', String(a.totalCheckOuts || 0)],
      ['Currently Inside', String(a.currentlyInside || 0)],
      ['Total Visits', String(a.totalVisits || 0)],
    ])
    summaryTable(
      [['Day', 'Visits']],
      (a.dailyVisits || []).map(d => [d.day, String(d.visits)])
    )
  }

  if (tabKey === 'peak-hours') {
    keyValue([['Peak Hour', data?.peakHour || 'N/A']])
    summaryTable(
      [['Hour', 'Visits']],
      (data?.peakHours || []).map(h => [h.label, String(h.visits)])
    )
  }

  if (tabKey === 'membership-status') {
    const s = data?.membershipStatus || {}
    keyValue([
      ['Active', String(s.active || 0)],
      ['Expiring Soon', String(s.expiringSoon || 0)],
      ['Expired', String(s.expired || 0)],
    ])
  }

  if (tabKey === 'staff-activity') {
    summaryTable(
      [['Staff Name', 'Transactions', 'Sales', 'Check-Ins', 'Check-Outs']],
      (data?.staffActivity || []).map(s => [s.name, String(s.transactions), `PHP ${money(s.sales)}`, String(s.checkIns), String(s.checkOuts)])
    )
  }

  if (tabKey === 'transactions') {
    summaryTable(
      [['Transaction #', 'Date', 'Time', 'Member', 'Type', 'Amount', 'Payment Method', 'Status']],
      (data?.recentTransactions || []).map(tx => [tx.transactionNo, tx.date, tx.time, tx.member, tx.type, `PHP ${money(tx.amount)}`, tx.paymentMethod, tx.status])
    )
  }

  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(130)
    doc.text(`RDC GYM - ${title}`, marginX, doc.internal.pageSize.getHeight() - 24)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - marginX, doc.internal.pageSize.getHeight() - 24, { align: 'right' })
  }

  return doc
}
