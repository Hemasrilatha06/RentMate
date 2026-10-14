import { supabase } from './supabaseClient'

export const ITEMS_PER_PAGE = 12

function escapeSearchValue(value) {
  // Escape SQL LIKE wildcards and the quoting characters used by PostgREST's
  // OR filter. Quoting the value also keeps commas and parentheses literal.
  return value.replace(/[\\%_"]/g, (character) => `\\${character}`)
}

export async function fetchActiveItems({ offset = 0, limit = ITEMS_PER_PAGE, filters = {} } = {}) {
  if (!supabase) throw new Error('Supabase is not configured. Check your project URL and public API key in .env.')

  let query = supabase
    .from('items')
    .select('id, owner_id, title, description, category, price_per_day, location, image_url, available_from, available_to, created_at', { count: 'exact' })
    .eq('is_active', true)

  const search = filters.search?.trim()
  if (search) {
    const pattern = `"%${escapeSearchValue(search)}%"`
    const fields = ['title', 'description', 'category', 'location']
    query = query.or(fields.map((field) => `${field}.ilike.${pattern}`).join(','))
  }
  if (filters.category && filters.category !== 'All') query = query.eq('category', filters.category)
  if (filters.minPrice !== '' && filters.minPrice != null) query = query.gte('price_per_day', Number(filters.minPrice))
  if (filters.maxPrice !== '' && filters.maxPrice != null) query = query.lte('price_per_day', Number(filters.maxPrice))

  const location = filters.location?.trim()
  if (location) query = query.ilike('location', `%${escapeSearchValue(location)}%`)

  if (filters.availableFrom && filters.availableTo) {
    if (filters.availableFrom > filters.availableTo) return { items: [], hasMore: false, count: 0 }
    query = query.lte('available_from', filters.availableFrom).gte('available_to', filters.availableTo)
  }

  if (filters.sort === 'price-asc') query = query.order('price_per_day', { ascending: true }).order('created_at', { ascending: false })
  else if (filters.sort === 'price-desc') query = query.order('price_per_day', { ascending: false }).order('created_at', { ascending: false })
  else query = query.order('created_at', { ascending: false })

  const { data, error, count } = await query.range(offset, offset + limit - 1)
  if (error) throw new Error(error.message || 'Could not load items.')
  const items = data || []
  return { items, count: count ?? null, hasMore: count == null ? items.length === limit : offset + items.length < count }
}

export async function fetchAllActiveItems(filters = {}) {
  const allItems = []
  let offset = 0
  let result
  do {
    result = await fetchActiveItems({ offset, limit: 1000, filters })
    allItems.push(...result.items)
    offset += result.items.length
  } while (result.hasMore && result.items.length)
  return { items: allItems, count: result?.count ?? allItems.length, hasMore: false }
}
