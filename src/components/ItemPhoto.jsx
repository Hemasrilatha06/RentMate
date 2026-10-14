import { useEffect, useState } from 'react'
import CategoryPlaceholder from './CategoryPlaceholder'

export default function ItemPhoto({ item, className }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [item.image_url])

  if (!item.image_url || failed) {
    return <CategoryPlaceholder category={item.category} title={item.title} />
  }

  return <img
    className={className}
    src={item.image_url}
    alt={item.title || 'Item'}
    loading="lazy"
    onError={() => setFailed(true)}
  />
}
