import React from 'react'

export default function Sidebar({ items, activeItem, onSelect, onLogout }) {
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
      <button
        type="button"
        className="sidebar-logout"
        onClick={() => {
          if (window.confirm('Are you sure you want to logout?')) onLogout()
        }}
      >
        Logout
      </button>
    </aside>
  )
}
