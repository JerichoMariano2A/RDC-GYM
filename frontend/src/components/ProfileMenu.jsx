import React, { useEffect, useRef, useState } from 'react'
import {
  changePassword,
  changeUsername,
  deletePromo,
  fetchMyPhoto,
  fetchMyProfile,
  fetchPromoImage,
  fetchPromoMeta,
  getTheme,
  getUsername,
  logout,
  removeMyPhoto,
  setToken,
  storeUsername,
  updateMyName,
  uploadMyPhoto,
  uploadPromo,
  applyTheme,
} from '../services/auth'

const PHOTO_MIME_PATTERN = /^image\/(png|jpe?g|gif|webp)$/i
const MAX_PHOTO_BYTES = 4 * 1024 * 1024
const MAX_BANNER_BYTES = 6 * 1024 * 1024

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map(part => part[0].toUpperCase()).join('')
}

function Avatar({ src, name, large }) {
  if (src) {
    return <img src={src} alt={name || 'Profile'} className={`profile-avatar ${large ? 'profile-avatar-lg' : ''}`} />
  }
  return (
    <span className={`profile-avatar-fallback ${large ? 'profile-avatar-lg' : ''}`}>
      {initialsOf(name)}
    </span>
  )
}

function IconPerson() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function IconGear() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function IconDisplay() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}

function IconImage() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

export default function ProfileMenu({ onLogout }) {
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState(null)
  const [photoUrl, setPhotoUrl] = useState(null)
  const [modal, setModal] = useState(null)

  const [draftName, setDraftName] = useState('')
  const [draftPhoto, setDraftPhoto] = useState(null)
  const [draftRemovePhoto, setDraftRemovePhoto] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState(null)
  const profileFileRef = useRef(null)

  const [newUsername, setNewUsername] = useState('')
  const [usernamePassword, setUsernamePassword] = useState('')
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [showUsernamePassword, setShowUsernamePassword] = useState(false)
  const [showPwCurrent, setShowPwCurrent] = useState(false)
  const [showPwNew, setShowPwNew] = useState(false)
  const [showPwConfirm, setShowPwConfirm] = useState(false)
  const [settingsMsg, setSettingsMsg] = useState(null)
  const [settingsSaving, setSettingsSaving] = useState('')
  const [pendingAction, setPendingAction] = useState(null)

  const [theme, setThemeState] = useState(() => getTheme())

  const [bannerMeta, setBannerMeta] = useState(null)
  const [bannerPreviewUrl, setBannerPreviewUrl] = useState(null)
  const [bannerDraft, setBannerDraft] = useState(null)
  const [bannerSaving, setBannerSaving] = useState(false)
  const [bannerMsg, setBannerMsg] = useState(null)
  const bannerFileRef = useRef(null)
  const bannerUrlRef = useRef(null)

  const menuRef = useRef(null)
  const photoUrlRef = useRef(null)

  const isAdmin = profile?.role === 'admin'
  const displayName = profile?.fullName || profile?.username || getUsername() || 'User'
  const roleLabel = profile?.role === 'admin' ? 'Administrator' : 'Staff'

  async function refreshPhoto(data) {
    if (photoUrlRef.current) {
      URL.revokeObjectURL(photoUrlRef.current)
      photoUrlRef.current = null
      setPhotoUrl(null)
    }
    if (data?.hasPhoto && data?.id) {
      try {
        const blob = await fetchMyPhoto(data.id)
        const next = URL.createObjectURL(blob)
        photoUrlRef.current = next
        setPhotoUrl(next)
      } catch (err) {
        setPhotoUrl(null)
      }
    }
  }

  async function loadProfile() {
    try {
      const data = await fetchMyProfile()
      setProfile(data)
      await refreshPhoto(data)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    loadProfile()
    return () => {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current)
      if (bannerUrlRef.current) URL.revokeObjectURL(bannerUrlRef.current)
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      if (pendingAction) {
        setPendingAction(null)
        return
      }
      if (modal) setModal(null)
      else setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, pendingAction])

  async function loadBanner() {
    try {
      const meta = await fetchPromoMeta()
      setBannerMeta(meta)
      if (meta?.hasImage) {
        try {
          const blob = await fetchPromoImage()
          if (bannerUrlRef.current) URL.revokeObjectURL(bannerUrlRef.current)
          const next = URL.createObjectURL(blob)
          bannerUrlRef.current = next
          setBannerPreviewUrl(next)
        } catch (err) {
          setBannerPreviewUrl(null)
        }
      } else {
        if (bannerUrlRef.current) {
          URL.revokeObjectURL(bannerUrlRef.current)
          bannerUrlRef.current = null
        }
        setBannerPreviewUrl(null)
      }
    } catch (err) {
      console.error(err)
    }
  }

  function openModal(kind) {
    setOpen(false)
    setProfileMsg(null)
    setSettingsMsg(null)
    setBannerMsg(null)
    if (kind === 'profile') {
      setDraftName(profile?.fullName || '')
      setDraftPhoto(null)
      setDraftRemovePhoto(false)
    }
    if (kind === 'settings') {
      setNewUsername('')
      setUsernamePassword('')
      setPwCurrent('')
      setPwNew('')
      setPwConfirm('')
    }
    if (kind === 'display') {
      setThemeState(getTheme())
    }
    if (kind === 'banner') {
      setBannerDraft(null)
      loadBanner()
    }
    setModal(kind)
  }

  function closeModal() {
    setModal(null)
    loadProfile()
  }

  function handleDraftPhotoSelect(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!PHOTO_MIME_PATTERN.test(file.type)) {
      setProfileMsg({ ok: false, text: 'Only PNG, JPG, GIF or WEBP images are allowed.' })
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setProfileMsg({ ok: false, text: 'That image is too large. Maximum size is 4MB.' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setDraftPhoto({ dataUrl: reader.result, fileName: file.name })
      setDraftRemovePhoto(false)
      setProfileMsg(null)
    }
    reader.readAsDataURL(file)
  }

  async function saveProfile(event) {
    event.preventDefault()
    if (profileSaving) return
    const hasChanges = (draftRemovePhoto && !draftPhoto && profile?.hasPhoto) || draftPhoto || draftName.trim() !== (profile?.fullName || '')
    if (hasChanges && !window.confirm('Save changes to your profile?')) return
    setProfileSaving(true)
    setProfileMsg(null)
    try {
      let updated = profile
      if (draftRemovePhoto && !draftPhoto && profile?.hasPhoto) {
        await removeMyPhoto()
        updated = { ...updated, hasPhoto: false }
      }
      if (draftPhoto) {
        updated = await uploadMyPhoto(draftPhoto.dataUrl, draftPhoto.fileName)
      }
      if (draftName.trim() !== (updated?.fullName || '')) {
        updated = await updateMyName(draftName.trim())
      }
      setProfile(updated)
      await refreshPhoto(updated)
      setDraftPhoto(null)
      setDraftRemovePhoto(false)
      setProfileMsg({ ok: true, text: 'Profile saved.' })
    } catch (err) {
      console.error(err)
      setProfileMsg({ ok: false, text: err.response?.data?.error || 'Failed to save profile' })
    } finally {
      setProfileSaving(false)
    }
  }

  function submitUsernameChange(event) {
    event.preventDefault()
    if (!newUsername.trim() || !usernamePassword) {
      setSettingsMsg({ ok: false, text: 'Enter the new username and your current password.' })
      return
    }
    setPendingAction('username')
  }

  function submitPasswordChange(event) {
    event.preventDefault()
    if (!pwCurrent || !pwNew || !pwConfirm) {
      setSettingsMsg({ ok: false, text: 'Fill in all password fields.' })
      return
    }
    if (pwNew !== pwConfirm) {
      setSettingsMsg({ ok: false, text: 'New password and confirm password do not match.' })
      return
    }
    setPendingAction('password')
  }

  async function confirmPendingAction() {
    if (!pendingAction) return
    const kind = pendingAction
    setPendingAction(null)
    setSettingsSaving(kind)
    setSettingsMsg(null)
    try {
      if (kind === 'username') {
        const res = await changeUsername(newUsername.trim(), usernamePassword)
        setToken(res.token)
        storeUsername(res.username)
        const data = await fetchMyProfile()
        setProfile(data)
        setNewUsername('')
        setUsernamePassword('')
        setSettingsMsg({ ok: true, text: `Username changed to "${res.username}". Use it on your next sign in.` })
      } else {
        await changePassword(pwCurrent, pwNew, pwConfirm)
        setPwCurrent('')
        setPwNew('')
        setPwConfirm('')
        setSettingsMsg({ ok: true, text: 'Password changed successfully. Use the new password on your next sign in.' })
      }
    } catch (err) {
      setSettingsMsg({
        ok: false,
        text: err.response?.data?.error || (kind === 'username' ? 'Failed to change username' : 'Failed to change password'),
      })
    } finally {
      setSettingsSaving('')
    }
  }

  function pickTheme(next) {
    setThemeState(next)
    applyTheme(next)
  }

  function handleBannerSelect(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!PHOTO_MIME_PATTERN.test(file.type)) {
      setBannerMsg({ ok: false, text: 'Only PNG, JPG, GIF or WEBP images can be posted.' })
      return
    }
    if (file.size > MAX_BANNER_BYTES) {
      setBannerMsg({ ok: false, text: 'That image is too large. Maximum size is 6MB.' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setBannerDraft({ dataUrl: reader.result, fileName: file.name })
      setBannerMsg(null)
    }
    reader.readAsDataURL(file)
  }

  async function postBanner() {
    if (!bannerDraft || bannerSaving) return
    const action = bannerMeta?.hasImage ? 'replace the current announcement' : 'post this announcement'
    const confirmed = window.confirm(
      `Are you sure you want to ${action}? It becomes visible in every admin and staff navigation panel.`,
    )
    if (!confirmed) return
    setBannerSaving(true)
    setBannerMsg(null)
    try {
      await uploadPromo(bannerDraft.dataUrl, bannerDraft.fileName)
      setBannerDraft(null)
      await loadBanner()
      setBannerMsg({ ok: true, text: 'Announcement posted - sidebars update automatically within seconds.' })
    } catch (err) {
      setBannerMsg({ ok: false, text: err.response?.data?.error || 'Failed to post announcement' })
    } finally {
      setBannerSaving(false)
    }
  }

  async function removeBanner() {
    if (!bannerMeta?.hasImage || bannerSaving) return
    const confirmed = window.confirm('Remove the current announcement? It disappears from every sidebar immediately.')
    if (!confirmed) return
    setBannerSaving(true)
    setBannerMsg(null)
    try {
      await deletePromo()
      await loadBanner()
      setBannerMsg({ ok: true, text: 'Announcement removed - sidebars update automatically.' })
    } catch (err) {
      setBannerMsg({ ok: false, text: err.response?.data?.error || 'Failed to remove announcement' })
    } finally {
      setBannerSaving(false)
    }
  }

  function handleLogout() {
    setOpen(false)
    if (window.confirm('Are you sure you want to logout?')) onLogout()
  }

  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        type="button"
        className={open ? 'profile-trigger open' : 'profile-trigger'}
        onClick={() => setOpen(prev => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Account"
      >
        <Avatar src={photoUrl} name={displayName} />
        <span className="profile-trigger-text">
          <strong>{displayName}</strong>
          <small>{roleLabel}</small>
        </span>
        <span className="profile-caret" aria-hidden="true"></span>
      </button>

      {open && (
        <div className="profile-dropdown" role="menu">
          <div className="profile-dropdown-head">
            <Avatar src={photoUrl} name={displayName} large />
            <div className="profile-dropdown-head-text">
              <strong>{displayName}</strong>
              <small>@{profile?.username || getUsername() || 'user'} · {roleLabel}</small>
            </div>
          </div>
          <button type="button" className="profile-menu-item" onClick={() => openModal('profile')}>
            <IconPerson />
            <span>
              <strong>See profile</strong>
              <small>{isAdmin ? 'Change the admin name and photo' : 'Change your name and photo'}</small>
            </span>
          </button>
          <button type="button" className="profile-menu-item" onClick={() => openModal('settings')}>
            <IconGear />
            <span>
              <strong>Settings &amp; privacy</strong>
              <small>Change your username and password</small>
            </span>
          </button>
          <button type="button" className="profile-menu-item" onClick={() => openModal('display')}>
            <IconDisplay />
            <span>
              <strong>Display &amp; accessibility</strong>
              <small>Switch between dark mode and light mode</small>
            </span>
          </button>
          <button type="button" className="profile-menu-item" onClick={() => openModal('banner')}>
            <IconImage />
            <span>
              <strong>What's New</strong>
              <small>Post, replace or remove the announcement banner</small>
            </span>
          </button>
          <div className="profile-menu-divider" role="separator"></div>
          <button type="button" className="profile-menu-item profile-menu-logout" onClick={handleLogout}>
            <IconLogout />
            <span>
              <strong>Log out</strong>
              <small>End this session securely</small>
            </span>
          </button>
        </div>
      )}

      {modal === 'profile' && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="modal-card">
            <h3>Profile</h3>
            <p className="modal-subtitle">Update how your account appears in the panel.</p>
            <form onSubmit={saveProfile}>
              <div className="profile-edit-row">
                <Avatar src={draftPhoto ? draftPhoto.dataUrl : photoUrl} name={draftName || displayName} large />
                <div className="profile-edit-actions">
                  <input
                    ref={profileFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    onChange={handleDraftPhotoSelect}
                    hidden
                  />
                  <button type="button" className="pill" onClick={() => profileFileRef.current?.click()}>
                    {photoUrl ? 'Change Photo' : 'Choose Photo'}
                  </button>
                  {(photoUrl || draftPhoto) && (
                    <button
                      type="button"
                      className="pill danger"
                      onClick={() => { setDraftPhoto(null); setDraftRemovePhoto(true) }}
                    >
                      Remove Photo
                    </button>
                  )}
                  <span className="muted-text">PNG, JPG, GIF or WEBP - up to 4MB.</span>
                </div>
              </div>
              <label className="field-block">
                Name
                <input value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="Enter display name" maxLength={120} />
              </label>
              {profileMsg && <div className={profileMsg.ok ? 'status-message' : 'status-message error'}>{profileMsg.text}</div>}
              <div className="submit-row">
                <button type="button" className="pill" onClick={closeModal}>Close</button>
                <button type="submit" className="pill action" disabled={profileSaving}>
                  {profileSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal === 'settings' && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="modal-card">
            <h3>Settings &amp; Privacy</h3>
            <p className="modal-subtitle">Manage your login credentials.</p>
            <form onSubmit={submitUsernameChange}>
              <div className="settings-section-title">Username</div>
              <label className="field-block">
                New Username
                <input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="Enter new username" maxLength={100} />
              </label>
              <label className="field-block">
                Current Password
                <div className="password-field">
                  <input
                    type={showUsernamePassword ? 'text' : 'password'}
                    value={usernamePassword}
                    onChange={e => setUsernamePassword(e.target.value)}
                    placeholder="Confirm with current password"
                  />
                  <button
                    type="button"
                    className={showUsernamePassword ? 'password-toggle show' : 'password-toggle'}
                    onClick={() => setShowUsernamePassword(prev => !prev)}
                    aria-label={showUsernamePassword ? 'Hide password' : 'Show password'}
                  >
                    <span className="eye-icon" aria-hidden="true"></span>
                  </button>
                </div>
              </label>
              <div className="submit-row">
                <button type="submit" className="pill action" disabled={settingsSaving === 'username'}>
                  {settingsSaving === 'username' ? 'Updating…' : 'Update Username'}
                </button>
              </div>
            </form>
            <div className="profile-menu-divider" style={{ margin: '18px 0' }}></div>
            <form onSubmit={submitPasswordChange}>
              <div className="settings-section-title">Password</div>
              <label className="field-block">
                Current Password
                <div className="password-field">
                  <input
                    type={showPwCurrent ? 'text' : 'password'}
                    value={pwCurrent}
                    onChange={e => setPwCurrent(e.target.value)}
                    placeholder="Enter current password"
                  />
                  <button
                    type="button"
                    className={showPwCurrent ? 'password-toggle show' : 'password-toggle'}
                    onClick={() => setShowPwCurrent(prev => !prev)}
                    aria-label={showPwCurrent ? 'Hide password' : 'Show password'}
                  >
                    <span className="eye-icon" aria-hidden="true"></span>
                  </button>
                </div>
              </label>
              <label className="field-block">
                New Password
                <div className="password-field">
                  <input
                    type={showPwNew ? 'text' : 'password'}
                    value={pwNew}
                    onChange={e => setPwNew(e.target.value)}
                    placeholder="At least 6 characters"
                  />
                  <button
                    type="button"
                    className={showPwNew ? 'password-toggle show' : 'password-toggle'}
                    onClick={() => setShowPwNew(prev => !prev)}
                    aria-label={showPwNew ? 'Hide password' : 'Show password'}
                  >
                    <span className="eye-icon" aria-hidden="true"></span>
                  </button>
                </div>
              </label>
              <label className="field-block">
                Confirm New Password
                <div className="password-field">
                  <input
                    type={showPwConfirm ? 'text' : 'password'}
                    value={pwConfirm}
                    onChange={e => setPwConfirm(e.target.value)}
                    placeholder="Re-enter new password"
                  />
                  <button
                    type="button"
                    className={showPwConfirm ? 'password-toggle show' : 'password-toggle'}
                    onClick={() => setShowPwConfirm(prev => !prev)}
                    aria-label={showPwConfirm ? 'Hide password' : 'Show password'}
                  >
                    <span className="eye-icon" aria-hidden="true"></span>
                  </button>
                </div>
              </label>
              <div className="submit-row">
                <button type="submit" className="pill action" disabled={settingsSaving === 'password'}>
                  {settingsSaving === 'password' ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </form>
            {settingsMsg && <div className={settingsMsg.ok ? 'status-message' : 'status-message error'}>{settingsMsg.text}</div>}
            <div className="submit-row">
              <button type="button" className="pill" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}

      {modal === 'display' && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="modal-card">
            <h3>Display &amp; Accessibility</h3>
            <p className="modal-subtitle">Choose the appearance of the whole system.</p>
            <div className="theme-options">
              {[
                { value: 'light', label: 'Light Mode', hint: 'Bright surfaces, recommended for daytime' },
                { value: 'dark', label: 'Dark Mode', hint: 'Dimmed surfaces, easier on the eyes at night' },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={theme === option.value ? 'theme-option selected' : 'theme-option'}
                  onClick={() => pickTheme(option.value)}
                >
                  <span className={`theme-swatch ${option.value}`}></span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </span>
                </button>
              ))}
            </div>
            <p className="muted-text">Your choice is remembered on this device and applies instantly across every page.</p>
            <div className="submit-row">
              <button type="button" className="pill action" onClick={closeModal}>Done</button>
            </div>
          </div>
        </div>
      )}

      {modal === 'banner' && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="modal-card">
            <h3>What's New</h3>
            <p className="modal-subtitle">Post, replace or remove the announcement image shown in every navigation panel. Sidebars update automatically within seconds.</p>
            {bannerMeta?.hasImage && (
              <p className="muted-text">
                Current announcement posted {bannerMeta.updatedAt}{bannerMeta.uploadedBy ? ` by ${bannerMeta.uploadedBy}` : ''}
              </p>
            )}
            <div className="promo-manager-body">
              <div className="promo-preview">
                {bannerDraft ? (
                  <img src={bannerDraft.dataUrl} alt={bannerDraft.fileName} />
                ) : bannerPreviewUrl ? (
                  <img src={bannerPreviewUrl} alt="Current announcement" />
                ) : (
                  <div className="promo-empty">No announcement posted yet</div>
                )}
              </div>
              <div className="promo-controls">
                <input
                  ref={bannerFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={handleBannerSelect}
                  hidden
                />
                <button type="button" className="pill" onClick={() => bannerFileRef.current?.click()}>
                  {bannerMeta?.hasImage ? 'Change Image' : 'Choose Image'}
                </button>
                {bannerDraft ? (
                  <>
                    <button type="button" className="pill action" disabled={bannerSaving} onClick={postBanner}>
                      {bannerSaving ? 'Posting…' : bannerMeta?.hasImage ? 'Replace Announcement' : 'Post Announcement'}
                    </button>
                    <button type="button" className="pill" onClick={() => setBannerDraft(null)}>Cancel Preview</button>
                  </>
                ) : bannerMeta?.hasImage ? (
                  <button type="button" className="pill danger" disabled={bannerSaving} onClick={removeBanner}>
                    Remove Announcement
                  </button>
                ) : null}
                <span className="muted-text">PNG, JPG, GIF or WEBP - up to 6MB.</span>
              </div>
            </div>
            {bannerMsg && <div className={bannerMsg.ok ? 'status-message' : 'status-message error'}>{bannerMsg.text}</div>}
            <div className="submit-row">
              <button type="button" className="pill" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}

      {pendingAction && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setPendingAction(null) }}>
          <div className="modal-card">
            <h3>{pendingAction === 'username' ? 'Confirm Username Change' : 'Confirm Password Change'}</h3>
            <p className="modal-subtitle">
              {pendingAction === 'username'
                ? 'Review the change below. You will use the new username on your next sign in.'
                : 'Review the change below. Make sure you can remember the new password.'}
            </p>
            <div className="confirm-lines">
              {pendingAction === 'username' ? (
                <>
                  <div className="confirm-line">
                    <span>Account</span>
                    <span>{profile?.username || getUsername() || '-'}</span>
                  </div>
                  <div className="confirm-line strong">
                    <span>New Username</span>
                    <span>{newUsername.trim()}</span>
                  </div>
                  <div className="confirm-line">
                    <span>Verification</span>
                    <span>Current password will be checked</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="confirm-line">
                    <span>Account</span>
                    <span>{profile?.username || getUsername() || '-'}</span>
                  </div>
                  <div className="confirm-line strong">
                    <span>New Password</span>
                    <span>{pwNew}</span>
                  </div>
                  <div className="confirm-line">
                    <span>Takes Effect</span>
                    <span>On your next sign in</span>
                  </div>
                </>
              )}
            </div>
            <div className="submit-row no-print">
              <button type="button" className="pill" onClick={() => setPendingAction(null)} disabled={Boolean(settingsSaving)}>
                Cancel
              </button>
              <button type="button" className="pill action" onClick={confirmPendingAction} disabled={Boolean(settingsSaving)}>
                {settingsSaving ? 'Saving…' : 'Yes, Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
