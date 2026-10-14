import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowUpRight, Upload } from 'lucide-react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import MapView from '../components/MapView'
import AddressSearch from '../components/AddressSearch'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import './EditItemPage.css'

const categories = ['Cameras', 'Electronics', 'Calculators', 'Projectors', 'Bicycles', 'Books', 'Other']
const maxPhotoSize = 5 * 1024 * 1024
const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp']
const acceptedExtensions = ['.jpg', '.jpeg', '.png', '.webp']

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function safePhotoFilename(filename) {
  const safeName = filename.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '')
  return safeName || 'item-photo'
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

function EditLoading() {
  return <main className="add-item-page edit-item-page"><div className="add-item-container"><div className="details-skeleton-bar" /><div className="edit-item-loading-card" role="status" aria-label="Loading listing details"><i /><i /><i /><i /></div></div></main>
}

export default function EditItemPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const fileInput = useRef(null)
  const redirectTimer = useRef(null)
  const [today] = useState(() => localDateString())
  const [item, setItem] = useState(null)
  const [form, setForm] = useState({ title: '', category: '', description: '', price: '', location: '', address: '', latitude: null, longitude: null, availableFrom: '', availableTo: '' })
  const [locationMessage, setLocationMessage] = useState('')
  const [photo, setPhoto] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [loading, setLoading] = useState(true)
  const [notAllowed, setNotAllowed] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [blockingBookings, setBlockingBookings] = useState([])

  const loadItem = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured. Check your project URL and public API key in .env.')
    const { data: listing, error: itemError } = await supabase.from('items')
      .select('id, owner_id, title, description, category, price_per_day, location, image_url, available_from, available_to')
      .eq('id', id)
      .maybeSingle()
    if (itemError) throw itemError
    if (!listing || listing.owner_id !== user?.id) return { listing: null, bookings: [] }
    const { data: coordinates, error: locationError } = await supabase.rpc('get_owned_item_address', { p_item_id: listing.id })
    if (locationError) throw locationError
    return { listing: { ...listing, ...(coordinates?.[0] || { latitude: null, longitude: null }) } }
  }, [id, user?.id])

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError('')
    setNotAllowed(false)
    loadItem()
      .then(({ listing }) => {
        if (!active) return
        if (!listing) {
          setNotAllowed(true)
          return
        }
        setItem(listing)
        setForm({
          title: listing.title || '',
          category: listing.category || '',
          description: listing.description || '',
          price: String(listing.price_per_day ?? ''),
          location: listing.location || '',
          address: listing.address || '',
          latitude: listing.latitude,
          longitude: listing.longitude,
          availableFrom: listing.available_from || '',
          availableTo: listing.available_to || '',
        })
      })
      .catch((loadError) => { if (active) setLoadError(loadError?.message || 'We could not load this listing. Please try again.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [loadItem])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])
  useEffect(() => () => {
    if (redirectTimer.current) window.clearTimeout(redirectTimer.current)
  }, [])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setError('')
    setBlockingBookings([])
  }

  function updateMapLocation(value) {
    if (value?.error) {
      setLocationMessage(value.error)
      return
    }
    setLocationMessage('')
    setForm((current) => ({ ...current, latitude: value.latitude, longitude: value.longitude }))
  }

  function updatePickupAddress(value) {
    setForm((current) => ({ ...current, address: value.address, latitude: value.latitude, longitude: value.longitude }))
  }

  function choosePhoto(file) {
    setPhotoError('')
    if (!file) return
    const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`
    const validType = acceptedTypes.includes(file.type) || (!file.type && acceptedExtensions.includes(extension))
    if (!validType) {
      setPhotoError('Please choose a JPG, PNG, or WebP image.')
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    if (file.size > maxPhotoSize) {
      setPhotoError('That image is too large. Choose a photo under 5 MB.')
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    setPhoto(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  function validateForm() {
    if (!form.title.trim()) return 'Add a title for your item.'
    if (!form.category) return 'Choose a category for your item.'
    if (!form.price || Number(form.price) <= 0 || !Number.isFinite(Number(form.price))) return 'Enter a price per day greater than Rs. 0.'
    if (!form.location.trim()) return 'Add the city or area where your item is available.'
    if (!form.address.trim() || form.latitude == null || form.longitude == null) return 'Search for your pickup address or landmark and place its map pin.'
    if (!form.availableFrom || !form.availableTo) return 'Choose both dates when your item is available.'
    if (form.availableFrom < today || form.availableTo < today) return 'Availability dates cannot be in the past.'
    if (form.availableTo < form.availableFrom) return 'Available to must be the same day as or after Available from.'
    if (photoError) return photoError
    return ''
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setBlockingBookings([])
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }
    if (!supabase || !item || item.owner_id !== user?.id) {
      setError('You are not allowed to update this listing.')
      return
    }

    setSubmitting(true)
    let uploadedPath = null
    try {
      const { data: latestBookings, error: bookingError } = await supabase.from('bookings')
        .select('id, start_date, end_date')
        .eq('item_id', item.id)
        .eq('status', 'confirmed')
        .order('start_date', { ascending: true })
      if (bookingError) throw new Error(`We could not verify your confirmed bookings. ${bookingError.message}`)
      const conflicts = (latestBookings || []).filter((booking) => form.availableFrom > booking.start_date || form.availableTo < booking.end_date)
      if (conflicts.length) {
        setBlockingBookings(conflicts)
        setError('Availability must continue to cover every confirmed booking. Adjust the date range or wait until the booking is no longer confirmed.')
        return
      }

      let imageUrl = item.image_url
      if (photo) {
        const safeFilename = safePhotoFilename(photo.name)
        uploadedPath = `${user.id}/${Date.now()}-${safeFilename}`
        const { error: uploadError } = await supabase.storage.from('item-images').upload(uploadedPath, photo, {
          cacheControl: '3600',
          upsert: false,
          contentType: photo.type,
        })
        if (uploadError) throw new Error(`We could not upload the new photo. Confirm the item-images bucket and its policies are set up, then try again. Details: ${uploadError.message}`)
        imageUrl = supabase.storage.from('item-images').getPublicUrl(uploadedPath).data.publicUrl
        if (!imageUrl) throw new Error('The photo uploaded, but Supabase did not return a public URL. Check the item-images bucket settings.')
      }

      const { data, error: updateError } = await supabase.from('items').update({
        title: form.title.trim(),
        category: form.category,
        description: form.description.trim() || null,
        price_per_day: Number(form.price),
        location: form.location.trim(),
        address: form.address.trim(),
        latitude: form.latitude,
        longitude: form.longitude,
        available_from: form.availableFrom,
        available_to: form.availableTo,
        image_url: imageUrl,
      }).eq('id', item.id).eq('owner_id', user.id).select('id').maybeSingle()
      if (updateError) throw new Error(`Your listing could not be updated. ${updateError.message}`)
      if (!data) throw new Error('Your listing could not be updated. Refresh the page and try again.')

      setSuccess('Your changes are saved. Taking you back to My Listings…')
      redirectTimer.current = window.setTimeout(() => navigate('/my-listings', { replace: true }), 1100)
    } catch (saveError) {
      if (uploadedPath) {
        try { await supabase.storage.from('item-images').remove([uploadedPath]) } catch { /* Keep the listing error visible. */ }
      }
      setError(saveError?.message || 'Something went wrong while saving your listing. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <EditLoading />
  if (notAllowed) return <main className="add-item-page edit-item-page"><div className="add-item-container"><section className="edit-item-state" role="alert"><span className="details-section-kicker">PRIVATE LISTING</span><h1>You can’t edit this item.</h1><p>This listing is unavailable or belongs to another member.</p><Link to="/my-listings" className="details-primary-link">Back to My Listings</Link></section></div></main>
  if (loadError) return <main className="add-item-page edit-item-page"><div className="add-item-container"><section className="edit-item-state" role="alert"><span className="details-section-kicker">A LITTLE PAUSE</span><h1>We couldn’t load this listing.</h1><p>{loadError}</p><Button type="button" onClick={() => window.location.reload()}>Try again</Button></section></div></main>

  return <main className="add-item-page edit-item-page">
    <div className="add-item-container">
      <div className="add-item-heading">
        <span className="eyebrow add-item-eyebrow"><span className="eyebrow-dot" /> MAKE IT YOURS</span>
        <h1>Edit your listing details.</h1>
        <p>Update the details renters see. Existing confirmed bookings stay protected.</p>
      </div>
      <ol className="listing-progress" aria-label="Listing form sections">
        <li className="is-current"><span>01</span><strong>Details</strong></li>
        <li><span>02</span><strong>Photos and price</strong></li>
        <li><span>03</span><strong>Location and availability</strong></li>
      </ol>
      <form className="listing-card" onSubmit={handleSubmit} noValidate>
        <section className="listing-section" aria-labelledby="edit-basics-heading">
          <div className="section-heading"><span className="section-number">01</span><div><h2 id="edit-basics-heading">The basics</h2><p>Keep the important details up to date.</p></div></div>
          <div className="listing-fields">
            <Input id="title" name="title" label="Item title" value={form.title} onChange={updateField} placeholder="e.g. Canon EOS 80D camera" autoComplete="off" required />
            <div className="field"><label htmlFor="category">Category</label><div className="select-wrap"><select id="category" name="category" value={form.category} onChange={updateField} required><option value="" disabled>Choose a category</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select><span className="select-chevron" aria-hidden="true" /></div></div>
            <div className="field listing-full-width"><label htmlFor="description">Description <span className="label-optional">Optional</span></label><textarea id="description" name="description" value={form.description} onChange={updateField} rows="4" maxLength="1200" placeholder="Share useful details, condition, or what’s included." /></div>
          </div>
        </section>
        <section className="listing-section" aria-labelledby="edit-rental-heading">
          <div className="section-heading"><span className="section-number">02</span><div><h2 id="edit-rental-heading">Rental details</h2><p>Set a fair daily price and pickup area.</p></div></div>
          <div className="listing-fields">
            <div className="currency-field"><Input id="price" name="price" label="Price per day (₹)" type="number" min="0.01" step="0.01" value={form.price} onChange={updateField} placeholder="e.g. 750" required trailing={<span className="currency-prefix" aria-hidden="true">₹</span>} /></div>
            <div className="listing-full-width"><Input id="location" name="location" label="Location (city or area)" value={form.location} onChange={updateField} placeholder="e.g. Indiranagar, Bengaluru" autoComplete="address-level2" required /><AddressSearch label="Pickup address or nearby landmark" value={form.address} onChange={(address) => setForm((current) => ({ ...current, address, latitude: null, longitude: null }))} onSelect={updatePickupAddress} /><MapView latitude={form.latitude} longitude={form.longitude} onChange={updateMapLocation} height={245} label="Set precise pickup pin" />{locationMessage && <p className="location-map-error" role="status">{locationMessage}</p>}</div>
          </div>
        </section>
        <section className="listing-section" aria-labelledby="edit-availability-heading">
          <div className="section-heading"><span className="section-number">03</span><div><h2 id="edit-availability-heading">When it’s available</h2><p>Your date range must cover every confirmed booking.</p></div></div>
          <div className="listing-fields">
            <Input id="availableFrom" name="availableFrom" label="Available from" type="date" min={today} value={form.availableFrom} onChange={updateField} required />
            <Input id="availableTo" name="availableTo" label="Available to" type="date" min={form.availableFrom || today} value={form.availableTo} onChange={updateField} required />
          </div>
          {blockingBookings.length > 0 && <div className="edit-item-conflicts" role="alert"><strong>These confirmed bookings fall outside the new availability:</strong><ul>{blockingBookings.map((booking) => <li key={booking.id}>{formatDate(booking.start_date)} – {formatDate(booking.end_date)}</li>)}</ul></div>}
        </section>
        <section className="listing-section photo-section" aria-labelledby="edit-photo-heading">
          <div className="section-heading"><span className="section-number">04</span><div><h2 id="edit-photo-heading">Item photo <span className="label-optional">Optional</span></h2><p>Leave the current photo or choose a new one.</p></div></div>
          <div className={`photo-dropzone${dragging ? ' is-dragging' : ''}${previewUrl || (!photo && item.image_url) ? ' has-preview' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) }} onDrop={(event) => { event.preventDefault(); setDragging(false); choosePhoto(event.dataTransfer.files?.[0]) }}>
            <input ref={fileInput} id="edit-item-photo" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => choosePhoto(event.target.files?.[0])} aria-describedby="edit-photo-help" />
            {previewUrl ? <div className="photo-preview"><img src={previewUrl} alt={`Preview of ${photo?.name || 'new item photo'}`} /><span className="photo-preview-name">{photo?.name}</span></div>
              : item.image_url ? <div className="edit-current-photo"><img src={item.image_url} alt={`Current photo of ${item.title}`} /><span>Current photo</span></div>
                : <label className="photo-drop-label" htmlFor="edit-item-photo"><span className="upload-icon"><Upload /></span><span className="photo-prompt"><strong>Drop a new photo here</strong><span>or <span className="browse-link">browse files</span></span></span><span id="edit-photo-help" className="photo-help">JPG, PNG or WebP · up to 5 MB</span></label>}
            {(previewUrl || item.image_url) && <div className="photo-ready"><span className="photo-ready-copy"><strong>{previewUrl ? 'New photo ready' : 'Current photo kept'}</strong><span id="edit-photo-help">Choose a new image to replace it.</span></span><label className="photo-change" htmlFor="edit-item-photo">Change photo</label>{previewUrl && <button type="button" className="photo-remove" onClick={() => { setPhoto(null); setPreviewUrl(''); setPhotoError(''); if (fileInput.current) fileInput.current.value = '' }}>Keep current</button>}</div>}
          </div>
          {photoError && <p className="photo-error" role="alert">{photoError}</p>}
        </section>
        {error && <p className="listing-message listing-error" role="alert"><span aria-hidden="true">!</span>{error}</p>}
        {success && <p className="listing-message listing-success" role="status">{success}</p>}
        <div className="listing-actions"><Link to="/my-listings" className="edit-item-cancel">Cancel</Link><Button type="submit" loading={submitting} className="listing-submit">Save changes <ArrowUpRight /></Button></div>
      </form>
      <p className="add-item-trust"><span className="trust-dot" /> Your confirmed bookings are protected while you edit.</p>
    </div>
  </main>
}
