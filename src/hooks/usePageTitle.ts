import { useEffect } from 'react'

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Afribok`
    return () => {
      document.title = 'Afribok — care that keeps moving'
    }
  }, [title])
}
