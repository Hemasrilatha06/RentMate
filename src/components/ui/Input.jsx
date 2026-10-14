export default function Input({ id, label, type = 'text', hint, trailing, ...props }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input id={id} name={id} type={type} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
        {trailing}
      </div>
      {hint && <small id={`${id}-hint`} className="field-hint">{hint}</small>}
    </div>
  )
}

