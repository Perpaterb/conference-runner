/**
 * Live data hooks (US-056, US-057).
 *
 * onSnapshot is the primary transport. On top of it we run:
 *  - a polling timer that forces a server read, so a silently dead socket still refreshes,
 *  - a refresh on tab focus, since backgrounded tabs get throttled,
 *  - a refresh on `online`, so a device coming back from a dead spot catches up immediately.
 *
 * `status` drives the connection indicator: live once a snapshot has arrived from the server,
 * polling when the socket has gone quiet past the timeout, offline when the browser says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  query,
  type DocumentData,
  type Query,
  type QueryConstraint,
} from 'firebase/firestore'
import { db } from './firebase'

export type LiveStatus = 'connecting' | 'live' | 'polling' | 'offline' | 'error'

/** How often the fallback poll forces a server read. */
export const POLL_INTERVAL_MS = 20_000
/** Silence longer than this downgrades the indicator from live to polling. */
export const LIVE_TIMEOUT_MS = 45_000

export interface LiveState<T> {
  data: T
  status: LiveStatus
  error: Error | null
  /** Force an immediate server read. */
  refresh: () => void
  lastUpdatedAt: number | null
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

/**
 * Shared plumbing for the two hooks below: tracks freshness, wires the poll timer, the focus
 * listener and the online listener, and derives the status.
 */
function useLivePlumbing(enabled: boolean, poll: () => void) {
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const online = useOnline()

  const markFresh = useCallback(() => setLastUpdatedAt(Date.now()), [])

  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => {
      poll()
      // Re-render so the status can decay to "polling" even when nothing changed.
      setTick((t) => t + 1)
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [enabled, poll])

  useEffect(() => {
    if (!enabled) return
    const onFocus = () => {
      if (document.visibilityState === 'visible') poll()
    }
    window.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)
    return () => {
      window.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onFocus)
    }
  }, [enabled, poll])

  const status: LiveStatus = useMemo(() => {
    void tick
    if (!online) return 'offline'
    if (lastUpdatedAt === null) return 'connecting'
    return Date.now() - lastUpdatedAt > LIVE_TIMEOUT_MS ? 'polling' : 'live'
  }, [online, lastUpdatedAt, tick])

  return { status, lastUpdatedAt, markFresh }
}

type WithId = { id: string }

/** Live subscription to a collection, mapped through `convert`. */
export function useLiveCollection<T extends WithId>(
  path: string | null,
  convert: (id: string, data: DocumentData) => T,
  constraints: QueryConstraint[] = [],
): LiveState<T[]> {
  const [data, setData] = useState<T[]>([])
  const [error, setError] = useState<Error | null>(null)
  const convertRef = useRef(convert)
  convertRef.current = convert

  // Constraints are typically rebuilt every render; the key keeps effects stable.
  const constraintKey = JSON.stringify(
    constraints.map((c) => (c as unknown as { type?: string }).type ?? 'c'),
  )
  const queryRef = useRef<Query | null>(null)

  const poll = useCallback(() => {
    const q = queryRef.current
    if (!q) return
    getDocsFromServer(q)
      .then((snap) => {
        setData(snap.docs.map((d) => convertRef.current(d.id, d.data())))
        setError(null)
      })
      .catch((e: Error) => setError(e))
  }, [])

  const { status, lastUpdatedAt, markFresh } = useLivePlumbing(Boolean(path), poll)

  useEffect(() => {
    if (!path) {
      setData([])
      queryRef.current = null
      return
    }
    const q = query(collection(db(), path), ...constraints)
    queryRef.current = q
    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => convertRef.current(d.id, d.data())))
        setError(null)
        markFresh()
      },
      (e) => setError(e),
    )
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, constraintKey, markFresh])

  return { data, status, error, refresh: poll, lastUpdatedAt }
}

/** Live subscription to a single document. */
export function useLiveDoc<T extends WithId>(
  path: string | null,
  convert: (id: string, data: DocumentData) => T,
): LiveState<T | null> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const convertRef = useRef(convert)
  convertRef.current = convert

  const poll = useCallback(() => {
    if (!path) return
    getDocFromServer(doc(db(), path))
      .then((snap) => {
        setData(snap.exists() ? convertRef.current(snap.id, snap.data()) : null)
        setError(null)
      })
      .catch((e: Error) => setError(e))
  }, [path])

  const { status, lastUpdatedAt, markFresh } = useLivePlumbing(Boolean(path), poll)

  useEffect(() => {
    if (!path) {
      setData(null)
      return
    }
    const unsub = onSnapshot(
      doc(db(), path),
      (snap) => {
        setData(snap.exists() ? convertRef.current(snap.id, snap.data()) : null)
        setError(null)
        markFresh()
      },
      (e) => setError(e),
    )
    return unsub
  }, [path, markFresh])

  return { data, status, error, refresh: poll, lastUpdatedAt }
}

/** A clock that re-renders on an interval, for the now-line and countdowns. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    const onVisible = () => setNow(Date.now())
    window.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
  return now
}
