import './CategoryPlaceholder.css'
import { Bike, BookOpen, Calculator, Camera, Laptop, Package, Projector } from 'lucide-react'

const categoryStyles = {
  Cameras: 'camera',
  Electronics: 'electronics',
  Calculators: 'calculator',
  Projectors: 'projector',
  Bicycles: 'bicycle',
  Books: 'books',
  Other: 'other',
}

const categoryIcons = { Cameras: Camera, Electronics: Laptop, Calculators: Calculator, Projectors: Projector, Bicycles: Bike, Books: BookOpen, Other: Package }

export default function CategoryPlaceholder({ category, title = 'Item' }) {
  const style = categoryStyles[category] || 'other'
  const Icon = categoryIcons[category] || Package
  return <div className={`category-placeholder category-placeholder-${style}`} role="img" aria-label={`No photo for ${title}. ${category || 'Other'} themed illustration.`}>
    <span className="category-placeholder-glow" aria-hidden="true" />
    <span className="category-placeholder-orbit" aria-hidden="true" />
    <Icon aria-hidden="true" focusable="false" />
    <span className="category-placeholder-label" aria-hidden="true">{category || 'A good find'}</span>
  </div>
}
