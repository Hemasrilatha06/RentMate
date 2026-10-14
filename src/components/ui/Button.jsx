export default function Button({ children, loading = false, className = '', ...props }) {
  return (
    <button className={`button ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <span className="button-spinner" aria-hidden="true" />}
      {loading ? 'Please wait…' : children}
    </button>
  )
}

