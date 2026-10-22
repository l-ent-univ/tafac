import { Component } from 'react'
import { Icon } from '@iconify/react'
import { navigateTo } from '../appRoute'
import { CARD_CLASSES, SECONDARY_BUTTON } from '../scodocPageUtils'

export default class PageErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('PageErrorBoundary caught an error:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  handleGoDashboard = () => {
    this.setState({ hasError: false, error: null })
    navigateTo('dashboard')
  }

  render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || 'Une erreur inattendue est survenue lors de l’affichage de cette page.'

      return (
        <section className="w-full pt-6 px-6 pb-12 max-md:px-3 max-md:pt-4" role="alert">
          <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6">
            <div className={`${CARD_CLASSES} flex flex-col items-start gap-4 p-6 max-md:p-4 border-error/30`}>
              <div className="size-10 rounded-full bg-error-bg flex items-center justify-center text-error shrink-0">
                <Icon icon="carbon:warning-alt" className="size-6" />
              </div>

              <div className="flex flex-col gap-1.5 min-w-0">
                <h2 className="m-0 text-[20px] font-bold text-text leading-snug">
                  Un problème est survenu sur cette page
                </h2>
                <p className="m-0 font-body text-[14px] leading-relaxed text-text-secondary whitespace-pre-line">
                  {errorMessage}
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2 flex-wrap">
                <button
                  type="button"
                  onClick={this.handleRetry}
                  className="rounded-full border-0 bg-brand px-4 py-2 font-body text-[14px] font-semibold text-bg hover:bg-brand-hover transition-colors"
                >
                  Réessayer
                </button>
                <button
                  type="button"
                  onClick={this.handleGoDashboard}
                  className={SECONDARY_BUTTON}
                >
                  <Icon icon="carbon:home" className="size-4" />
                  <span>Retour au tableau de bord</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className={SECONDARY_BUTTON}
                >
                  <Icon icon="carbon:renew" className="size-4" />
                  <span>Recharger la page</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      )
    }

    return this.props.children
  }
}
