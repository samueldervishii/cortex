import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

interface ProfileModalProps {
  isOpen: boolean
  onClose: () => void
  onToast?: (message: string) => void
}

function ProfileModal({ isOpen, onClose, onToast }: ProfileModalProps) {
  const { user, updateProfile, changePassword, deleteAccount } = useAuth() as any
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [showPasswordSection, setShowPasswordSection] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (isOpen && user) {
      setDisplayName(user.display_name || '')
      setUsername(user.username || '')
      setError('')
      setShowPasswordSection(false)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordError('')
      setShowDeleteConfirm(false)
      setDeletePassword('')
      setDeleteError('')
    }
  }, [isOpen, user])

  if (!isOpen || !user) return null

  const initials = (displayName || user.email)
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s: string) => s[0].toUpperCase())
    .join('')

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await updateProfile(displayName.trim(), username.trim())
      onToast?.('Profile updated')
      onClose()
    } catch (err: any) {
      const msg = err?.response?.data?.detail
      setError(msg || 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    setPasswordError('')
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }
    setChangingPassword(true)
    try {
      await changePassword(currentPassword, newPassword)
      setShowPasswordSection(false)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      onToast?.('Password changed')
    } catch (err: any) {
      const msg = err?.response?.data?.detail
      setPasswordError(msg || 'Failed to change password')
    } finally {
      setChangingPassword(false)
    }
  }

  const handleDeleteAccount = async () => {
    setDeleteError('')
    setDeleting(true)
    try {
      await deleteAccount(deletePassword)
    } catch (err: any) {
      const msg = err?.response?.data?.detail
      setDeleteError(msg || 'Failed to delete account')
      setDeleting(false)
    }
  }

  return (
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="profile-modal-title">Edit profile</h2>

        <div className="profile-avatar-section">
          <div className="profile-avatar">
            <span className="profile-avatar-initials">{initials}</span>
          </div>
        </div>

        <div className="profile-form">
          <div className="profile-field">
            <label className="profile-label">Display name</label>
            <input
              className="profile-input"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              maxLength={100}
            />
          </div>

          <div className="profile-field">
            <label className="profile-label">Username</label>
            <input
              className="profile-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
              placeholder="username"
              maxLength={50}
            />
          </div>

          {error && <p className="profile-error">{error}</p>}

          <p className="profile-hint">
            Your profile helps people recognize you in shared sessions.
          </p>

          <div className="profile-actions">
            <button className="profile-btn cancel" onClick={onClose}>
              Cancel
            </button>
            <button className="profile-btn save" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>

          <div className="profile-divider" />

          {!showPasswordSection ? (
            <button className="profile-link-btn" onClick={() => setShowPasswordSection(true)}>
              Change password
            </button>
          ) : (
            <div className="profile-section">
              <h3 className="profile-section-title">Change password</h3>
              <div className="profile-field">
                <label className="profile-label">Current password</label>
                <input
                  className="profile-input"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                />
              </div>
              <div className="profile-field">
                <label className="profile-label">New password</label>
                <input
                  className="profile-input"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="profile-field">
                <label className="profile-label">Confirm new password</label>
                <input
                  className="profile-input"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                />
              </div>
              {passwordError && <p className="profile-error">{passwordError}</p>}
              <div className="profile-actions">
                <button
                  className="profile-btn cancel"
                  onClick={() => setShowPasswordSection(false)}
                >
                  Cancel
                </button>
                <button
                  className="profile-btn save"
                  onClick={handleChangePassword}
                  disabled={changingPassword || !currentPassword || !newPassword}
                >
                  {changingPassword ? 'Changing...' : 'Change password'}
                </button>
              </div>
            </div>
          )}

          <div className="profile-divider" />

          {!showDeleteConfirm ? (
            <button className="profile-link-btn danger" onClick={() => setShowDeleteConfirm(true)}>
              Delete account
            </button>
          ) : (
            <div className="profile-section danger">
              <h3 className="profile-section-title danger">Delete account</h3>
              <p className="profile-danger-text">
                This will permanently delete your account and all your data. This action cannot be
                undone.
              </p>
              <div className="profile-field danger">
                <label className="profile-label">Enter your password to confirm</label>
                <input
                  className="profile-input"
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Your password"
                />
              </div>
              {deleteError && <p className="profile-error">{deleteError}</p>}
              <div className="profile-actions">
                <button className="profile-btn cancel" onClick={() => setShowDeleteConfirm(false)}>
                  Cancel
                </button>
                <button
                  className="profile-btn delete"
                  onClick={handleDeleteAccount}
                  disabled={deleting || !deletePassword}
                >
                  {deleting ? 'Deleting...' : 'Delete my account'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ProfileModal
