import ItemCard from './ItemCard'

export default function ItemGrid({ items, userId, ratingSummaries = {}, nearbyCoordinates = null }) {
  return <div className="item-grid">{items.map((item) => <ItemCard key={item.id} item={item} isOwner={item.owner_id === userId} ratingSummary={ratingSummaries[item.id]} nearbyCoordinates={nearbyCoordinates} />)}</div>
}
