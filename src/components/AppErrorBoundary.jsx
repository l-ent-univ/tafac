import { Component } from 'react'
import LentButton from './LentButton'

// The last resort: an error while rendering would otherwise leave a blank
// page, on every visit when what broke is kept in the browser (a stored
// setting). The student gets a way out instead.
class AppErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error(error)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center font-body">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[20px] font-semibold leading-tight">Une erreur est survenue</h1>
          <p className="text-[15px] opacity-70">La page n’a pas pu s’afficher</p>
        </div>
        <LentButton onClick={() => window.location.reload()}>Recharger la page</LentButton>
      </main>
    )
  }
}

export default AppErrorBoundary
