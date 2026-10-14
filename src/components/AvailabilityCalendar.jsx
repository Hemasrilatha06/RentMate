import { useState } from 'react'

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateFromKey(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function dateLabel(value) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(dateFromKey(value))
}

function dateOverlaps(start, end, ranges) {
  return ranges.some((range) => start <= range.end_date && end >= range.start_date)
}

export default function AvailabilityCalendar({
  item,
  bookedRanges = [],
  mode = 'display',
  startDate = '',
  endDate = '',
  onSelect,
  disabled = false,
  disabledMessage = 'Dates are not selectable right now',
}) {
  const today = dateKey(new Date())
  const [month, setMonth] = useState(() => {
    const initial = mode === 'select' && item.available_from > today ? item.available_from : today
    const date = dateFromKey(initial)
    return new Date(date.getFullYear(), date.getMonth(), 1)
  })
  const firstWeekday = (month.getDay() + 6) % 7
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const days = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)]
  while (days.length % 7) days.push(null)
  const monthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(month)
  const selectingEnd = Boolean(startDate && !endDate)

  function statusFor(key) {
    const isPast = key < today
    const isBooked = bookedRanges.some((range) => key >= range.start_date && key <= range.end_date)
    const insideWindow = key >= item.available_from && key <= item.available_to
    const rangeBlocked = selectingEnd && dateOverlaps(startDate, key, bookedRanges)
    const beforeStart = selectingEnd && key < startDate
    const selected = key === startDate || key === endDate || (startDate && endDate && key > startDate && key < endDate)
    let status = 'outside'
    if (isPast) status = 'past'
    else if (isBooked || rangeBlocked) status = 'booked'
    else if (insideWindow) status = 'available'
    if (selected) status = 'selected'
    return { status, isPast, isBooked, insideWindow, rangeBlocked, beforeStart, selected }
  }

  function changeMonth(offset) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  return <div className={`availability-calendar ${mode === 'select' ? 'availability-calendar-select' : ''}`}>
    <div className="availability-calendar-head">
      <strong>{monthLabel}</strong>
      <div>
        <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month">‹</button>
        <button type="button" onClick={() => changeMonth(1)} aria-label="Next month">›</button>
      </div>
    </div>
    <div className="availability-calendar-grid" role="grid" aria-label={`${monthLabel} availability`}>
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day} className="availability-weekday" role="columnheader">{day}</span>)}
      {days.map((day, index) => {
        if (!day) return <span key={`empty-${index}`} className="availability-day-empty" aria-hidden="true" />
        const key = dateKey(new Date(month.getFullYear(), month.getMonth(), day))
        const { status, isPast, isBooked, insideWindow, rangeBlocked, beforeStart, selected } = statusFor(key)
        const blocked = mode === 'select' && (disabled || isPast || !insideWindow || isBooked || rangeBlocked || beforeStart)
        const tooltip = (isBooked || rangeBlocked) ? 'Already booked' : disabled ? disabledMessage : beforeStart ? 'Choose a date on or after the start date' : isPast ? 'Past date' : !insideWindow ? 'Outside availability' : ''
        const label = `${dateLabel(key)}${tooltip ? `, ${tooltip}` : selected ? ', selected' : ', available'}`
        return mode === 'select'
          ? <button key={key} type="button" className={`availability-day is-${status}`} disabled={blocked} title={tooltip || undefined} aria-label={label} aria-pressed={Boolean(selected)} onClick={() => onSelect?.(key)}>{day}</button>
          : <span key={key} role="gridcell" className={`availability-day is-${status}`} title={tooltip || undefined} aria-label={label}>{day}</span>
      })}
    </div>
    <div className="availability-legend" aria-label="Calendar key">
      <span><i className="legend-available" />Available</span>
      <span><i className="legend-booked" />Booked</span>
      <span><i className="legend-past" />Past</span>
    </div>
    {mode === 'select' && <p className="availability-select-help" aria-live="polite">{selectingEnd ? `Choose an end date on or after ${dateLabel(startDate)}.` : 'Choose a start date, then an end date.'} Booked days are disabled.</p>}
  </div>
}

export { dateKey, dateFromKey, dateLabel }
