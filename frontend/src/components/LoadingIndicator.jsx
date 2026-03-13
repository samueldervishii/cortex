function LoadingIndicator({ statusText }) {
  return (
    <div className="message system loading">
      <div className="typing-indicator">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span className="status-text">{statusText}</span>
    </div>
  )
}

export default LoadingIndicator
