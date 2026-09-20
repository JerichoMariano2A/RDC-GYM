import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchPromoImage, fetchPromoMeta } from '../services/auth'

export default function Sidebar({ items, activeItem, onSelect }) {
  const [promoUrl, setPromoUrl] = useState(null)
  const [promoMeta, setPromoMeta] = useState(null)
  const [promoError, setPromoError] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const stampRef = useRef(null)
  const urlRef = useRef(null)

  useEffect(() => {
    if (!lightboxOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setLightboxOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxOpen])

  useEffect(() => {
    let cancelled = false
    async function loadPromo() {
      try {
        const meta = await fetchPromoMeta()
        if (cancelled) return
        setPromoMeta(meta)
        const stamp = meta?.hasImage ? meta.updatedAt : null
        if (stamp === stampRef.current) return
        stampRef.current = stamp
        if (!stamp) {
          if (urlRef.current) URL.revokeObjectURL(urlRef.current)
          urlRef.current = null
          setPromoUrl(null)
          setPromoError(false)
          return
        }
        try {
          const blob = await fetchPromoImage()
          if (cancelled) return
          const next = URL.createObjectURL(blob)
          if (urlRef.current) URL.revokeObjectURL(urlRef.current)
          urlRef.current = next
          setPromoUrl(next)
          setPromoError(false)
        } catch (err) {
          if (!cancelled) setPromoError(true)
        }
      } catch (err) {
        // keep showing the last known state on transient failures
      }
    }
    loadPromo()
    const intervalId = setInterval(loadPromo, 8000)
    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [])

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="/logo.png" alt="RDC GYM" className="sidebar-logo" />
        <div>
          <strong>RDC GYM</strong>
          <span>Check-in / Check-out</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        {items.map(item => (
          <button
            key={item.label}
            type="button"
            className={`sidebar-link ${activeItem === item.label ? 'active' : ''}`}
            onClick={() => onSelect(item.label)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-promo">
        <div className="sidebar-promo-title-row">
          <div className="sidebar-promo-title">What's New</div>
        </div>
        {promoUrl ? (
          <>
            <img
              src={promoUrl}
              alt={promoMeta?.fileName || 'What\'s New announcement'}
              className="sidebar-promo-img"
              onClick={() => setLightboxOpen(true)}
            />
            <div className="sidebar-promo-hint">Click photo to view full size</div>
            {promoMeta?.updatedAt && (
              <div className="sidebar-promo-meta">Posted {promoMeta.updatedAt}{promoMeta.uploadedBy ? ` by ${promoMeta.uploadedBy}` : ''}</div>
            )}
          </>
        ) : (
          <div className="sidebar-promo-empty">{promoError ? 'Announcement image unavailable.' : 'No announcement posted yet.'}</div>
        )}
      </div>
      {lightboxOpen && promoUrl && createPortal(
        <div
          className="promo-lightbox no-print"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            className="promo-lightbox-close"
            aria-label="Close full screen view"
            onClick={() => setLightboxOpen(false)}
          >
            ×
          </button>
          <img
            src={promoUrl}
            alt={promoMeta?.fileName || 'What\'s New announcement'}
            onClick={e => e.stopPropagation()}
          />
        </div>,
        document.body,
      )}
    </aside>
  )
}
