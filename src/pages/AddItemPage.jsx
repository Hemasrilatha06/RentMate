import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Upload } from 'lucide-react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import MapView from '../components/MapView'
import './AddItemPage.css'
import AddressSearch from '../components/AddressSearch'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'

const categories = ['Cameras', 'Electronics', 'Calculators', 'Projectors', 'Bicycles', 'Books', 'Other']
const maxPhotoSize = 5 * 1024 * 1024
const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp']
const acceptedExtensions = ['.jpg', '.jpeg', '.png', '.webp']

function safePhotoFilename(filename) {
  const safeName = filename
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  return safeName || 'item-photo'
}

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function PhotoPreview({ file, previewUrl }) {
  if (!file || !previewUrl) return null
  return <div className="photo-preview"><img src={previewUrl} alt={`Preview of ${file.name}`} /><span className="photo-preview-name">{file.name}</span></div>
}

export default function AddItemPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const fileInput = useRef(null)
  const redirectTimer = useRef(null)
  const [today] = useState(() => localDateString())
  const [form, setForm] = useState({ title: '', category: '', description: '', price: '', location: '', address: '', latitude: null, longitude: null, availableFrom: '', availableTo: '' })
  const [locationMessage, setLocationMessage] = useState('')
  const [photo, setPhoto] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    if (redirectTimer.current) window.clearTimeout(redirectTimer.current)
  }, [previewUrl])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
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
      setPhoto(null)
      setPreviewUrl('')
      setPhotoError('Please choose a JPG, PNG, or WebP image.')
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    if (file.size > maxPhotoSize) {
      setPhoto(null)
      setPreviewUrl('')
      setPhotoError('That image is too large. Choose a photo under 5 MB.')
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    setPhoto(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  function handlePhotoChange(event) {
    choosePhoto(event.target.files?.[0])
  }

  function handleDrop(event) {
    event.preventDefault()
    setDragging(false)
    choosePhoto(event.dataTransfer.files?.[0])
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
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }
    if (!supabase) {
      setError('Supabase is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.')
      return
    }
    setSubmitting(true)
    let uploadedPath = null
    try {
      let imageUrl = null
      if (photo) {
        const safeFilename = safePhotoFilename(photo.name)
        uploadedPath = `${user.id}/${Date.now()}-${safeFilename}`
        const { error: uploadError } = await supabase.storage.from('item-images').upload(uploadedPath, photo, {
          cacheControl: '3600',
          upsert: false,
          contentType: photo.type,
        })
        if (uploadError) {
          throw new Error(`We could not upload that photo to Supabase Storage. Confirm the item-images bucket and its policies are set up, then try again. Details: ${uploadError.message}`)
        }
        imageUrl = supabase.storage.from('item-images').getPublicUrl(uploadedPath).data.publicUrl
        if (!imageUrl) throw new Error('The photo uploaded, but Supabase did not return a public image URL. Check that item-images is configured as a public bucket.')
      }

      const { error: insertError } = await supabase.from('items').insert({
        owner_id: user.id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category,
        price_per_day: Number(form.price),
        location: form.location.trim(),
        address: form.address.trim(),
        latitude: form.latitude,
        longitude: form.longitude,
        image_url: imageUrl,
        available_from: form.availableFrom,
        available_to: form.availableTo,
      })
      if (insertError) {
        if (uploadedPath) {
          try {
            await supabase.storage.from('item-images').remove([uploadedPath])
          } catch {
            // Preserve the database error; a leftover image can be cleaned up later.
          }
        }
        throw new Error(`Your item could not be saved. ${insertError.message}`)
      }

      setSuccess('Your listing is live. Taking you back home…')
      redirectTimer.current = window.setTimeout(() => navigate('/', { replace: true }), 1200)
    } catch (submitError) {
      setError(submitError?.message || 'Something went wrong while saving your listing. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="add-item-page">
      <div className="add-item-container">
        <div className="add-item-heading">
          <span className="eyebrow add-item-eyebrow"><span className="eyebrow-dot" /> SHARE SOMETHING GOOD</span>
          <h1>List an item for rent.</h1>
          <p>A few details help the right person find your item and book it with confidence.</p>
        </div>

        <ol className="listing-progress" aria-label="Listing form sections">
          <li className="is-current"><span>01</span><strong>Item details</strong></li>
          <li><span>02</span><strong>Rental details</strong></li>
          <li><span>03</span><strong>Pickup map</strong></li>
          <li><span>04</span><strong>Availability</strong></li>
          <li><span>05</span><strong>Item photo</strong></li>
        </ol>

        <form className="listing-card" onSubmit={handleSubmit} noValidate>
          <section className="listing-section" aria-labelledby="basics-heading">
            <div className="section-heading"><span className="section-number">01</span><div><h2 id="basics-heading">The basics</h2><p>Tell people what you’re sharing.</p></div></div>
            <div className="listing-fields item-details-fields">
              <Input id="title" name="title" label="Item title" value={form.title} onChange={updateField} placeholder="e.g. Canon EOS 80D camera" autoComplete="off" required />
              <div className="field"><label htmlFor="category">Category</label><div className="select-wrap"><select id="category" name="category" value={form.category} onChange={updateField} required><option value="" disabled>Choose a category</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select><span className="select-chevron" aria-hidden="true" /></div></div>
              <div className="field listing-full-width"><label htmlFor="description">Description <span className="label-optional">Optional</span></label><textarea id="description" name="description" value={form.description} onChange={updateField} rows="4" maxLength="1200" placeholder="Share useful details, condition, or what’s included." /></div>
            </div>
          </section>

          <section className="listing-section" aria-labelledby="rental-heading">
            <div className="section-heading"><span className="section-number">02</span><div><h2 id="rental-heading">Rental details</h2><p>Set a fair daily price and pickup area.</p></div></div>
            <div className="listing-fields rental-fields">
              <div className="currency-field"><Input id="price" name="price" label="Price per day (₹)" type="number" min="0.01" step="0.01" value={form.price} onChange={updateField} placeholder="e.g. 750" required trailing={<span className="currency-prefix" aria-hidden="true">₹</span>} /></div>
              <Input id="location" name="location" label="Location" value={form.location} onChange={updateField} placeholder="City or area" autoComplete="address-level2" required />
              <div className="listing-full-width"><AddressSearch label="Pickup address or nearby landmark" value={form.address} onChange={(address) => setForm((current) => ({ ...current, address, latitude: null, longitude: null }))} onSelect={updatePickupAddress} /></div>
            </div>
          </section>

          <section className="listing-section map-section" aria-labelledby="pickup-map-heading">
            <div className="section-heading"><span className="section-number">03</span><div><h2 id="pickup-map-heading">Pickup location map</h2><p>Drag the pin to the exact place renters should collect your item.</p></div></div>
            <MapView latitude={form.latitude} longitude={form.longitude} onChange={updateMapLocation} onError={(message) => setLocationMessage(message)} height={520} rotationEnabled label="Set precise pickup pin" />
            {locationMessage && <p className="location-map-error" role="status">{locationMessage}</p>}
          </section>

          <section className="listing-section" aria-labelledby="availability-heading">
            <div className="section-heading"><span className="section-number">04</span><div><h2 id="availability-heading">When it’s available</h2><p>Choose the dates someone can rent your item.</p></div></div>
            <div className="listing-fields availability-fields">
              <Input id="availableFrom" name="availableFrom" label="Available from" type="date" min={today} value={form.availableFrom} onChange={updateField} required />
              <Input id="availableTo" name="availableTo" label="Available to" type="date" min={form.availableFrom || today} value={form.availableTo} onChange={updateField} required />
            </div>
          </section>

          <section className="listing-section photo-section" aria-labelledby="photo-heading">
            <div className="section-heading"><span className="section-number">05</span><div><h2 id="photo-heading">Item photo <span className="label-optional">Optional</span></h2><p>A clear photo helps your listing stand out.</p></div></div>
            <div className={`photo-dropzone${dragging ? ' is-dragging' : ''}${previewUrl ? ' has-preview' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) }} onDrop={handleDrop}>
              <input ref={fileInput} id="item-photo" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={handlePhotoChange} aria-describedby="photo-help" />
              {previewUrl ? <PhotoPreview file={photo} previewUrl={previewUrl} /> : <label className="photo-drop-label" htmlFor="item-photo"><span className="upload-icon"><Upload /></span><span className="photo-prompt"><strong>Drop your photo here</strong><span>or <span className="browse-link">browse files</span></span></span><span id="photo-help" className="photo-help">JPG, PNG or WebP · up to 5 MB</span></label>}
              {previewUrl && <div className="photo-ready"><span className="photo-ready-copy"><strong>Photo ready</strong><span id="photo-help">Choose another image or remove this one.</span></span><label className="photo-change" htmlFor="item-photo">Change photo</label><button type="button" className="photo-remove" onClick={() => { setPhoto(null); setPreviewUrl(''); setPhotoError(''); if (fileInput.current) fileInput.current.value = '' }}>Remove</button></div>}
            </div>
            {photoError && <p className="photo-error" role="alert">{photoError}</p>}
          </section>

          {error && <p className="listing-message listing-error" role="alert"><span aria-hidden="true">!</span>{error}</p>}
          {success && <p className="listing-message listing-success" role="status">{success}</p>}
          <div className="listing-actions"><span className="listing-footnote">You can edit your listing anytime.</span><Button type="submit" loading={submitting} className="listing-submit">Publish listing <ArrowUpRight /></Button></div>
        </form>
        <p className="add-item-trust"><span className="trust-dot" /> Your listing is visible to signed-in RentMate members.</p>
      </div>
    </main>
  )
}
