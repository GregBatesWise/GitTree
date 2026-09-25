import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// Native dialogs can leave the page unable to receive typed input on Windows;
// re-focus the window and the element that had focus once the dialog closes.
const nativeConfirm = window.confirm.bind(window)
window.confirm = (message?: string): boolean => {
  const prev = document.activeElement as HTMLElement | null
  const result = nativeConfirm(message)
  void window.api.refocus().then(() => prev?.focus?.())
  return result
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
