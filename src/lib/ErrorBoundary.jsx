import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('App error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#b00020', lineHeight: 1.6 }}>
          <h2>畫面發生錯誤</h2>
          <p>{String(this.state.error?.message ?? this.state.error)}</p>
          <button
            onClick={() => { window.location.hash = '#/'; window.location.reload() }}
            style={{ padding: '8px 16px', fontSize: 15, cursor: 'pointer' }}
          >
            重新載入
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
