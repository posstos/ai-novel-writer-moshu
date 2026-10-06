import type { SVGProps } from 'react'

/** A book under a roof: the mark of Moshu's private writing room. */
export default function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" {...props}>
      <path d="M9 22 24 10l15 12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 25c-4-3-8-4-13-3v14c5-1 9 0 13 3 4-3 8-4 13-3V22c-5-1-9 0-13 3Z" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" />
      <path d="M24 25v14M15.5 27.5l4 1M28.5 28.5l4-1M15.5 31.5l4 1M28.5 32.5l4-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="36.5" cy="11.5" r="2.2" fill="currentColor" />
    </svg>
  )
}
