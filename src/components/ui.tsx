import { useEffect, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import type { LiveStatus } from '../lib/live'

/** Connection indicator for US-057. */
export function ConnectionBadge({ status }: { status: LiveStatus }) {
  const map: Record<LiveStatus, { cls: string; label: string; title: string }> = {
    connecting: { cls: '', label: 'Connecting', title: 'Opening the realtime connection' },
    live: { cls: 'ok', label: 'Live', title: 'Realtime updates are flowing' },
    polling: {
      cls: 'warn',
      label: 'Polling',
      title: 'The realtime connection is quiet; refreshing on a timer instead',
    },
    offline: { cls: 'bad', label: 'Offline', title: 'This device has no network connection' },
    error: { cls: 'bad', label: 'Error', title: 'The connection reported an error' },
  }
  const s = map[status]
  return (
    <span className={`badge ${s.cls}`} title={s.title}>
      <span className="dot" />
      {s.label}
    </span>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(900px, 100%)' } : undefined} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** QR code for the event link (US-011), rendered locally with no external service. */
export function QrCode({ value, size = 180 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, value, { width: size, margin: 1 }).catch((e: Error) =>
      setError(e.message),
    )
  }, [value, size])

  const download = () => {
    const url = canvasRef.current?.toDataURL('image/png')
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = 'event-qr.png'
    a.click()
  }

  if (error) return <p className="error small">Could not render the QR code: {error}</p>

  return (
    <div className="stack" style={{ alignItems: 'flex-start', gap: '0.5rem' }}>
      <div className="qr">
        <canvas ref={canvasRef} />
      </div>
      <button className="small" onClick={download}>
        Download QR PNG
      </button>
    </div>
  )
}

export function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="link-box">
      <code>{url}</code>
      <button
        className="small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url)
          } catch {
            // Clipboard access is blocked in some browsers; the link is selectable anyway.
          }
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/** Confirmation gate for destructive actions such as a wipe-and-replace import. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = 'danger',
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = window.setTimeout(() => setArmed(false), 5000)
    return () => window.clearTimeout(id)
  }, [armed])

  return armed ? (
    <button
      className={className}
      onClick={() => {
        setArmed(false)
        onConfirm()
      }}
    >
      {confirmLabel}
    </button>
  ) : (
    <button className={className} onClick={() => setArmed(true)}>
      {label}
    </button>
  )
}
